// Supabase Edge Function «push»: отправка пуш-уведомлений на устройства.
//   op: 'send'     — вызывает база (триггер на notifications) с секретом x-push-secret: отправить уведомление получателю;
//   op: 'test'     — вызывает приложение с токеном пользователя: тестовый пуш на его устройства;
//   op: 'selftest' — с секретом: проверка шифрования в этой среде (без отправки);
//   op: 'init'     — создать ключи VAPID, если их ещё нет (вернёт публичный ключ).
// Ключи VAPID создаются здесь же и хранятся в public.push_config (доступна только сервисной роли).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateVapidKeys, encryptPayload, vapidHeader, sendPush, b64u } from './webpush.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SITE = 'https://carpiration.github.io/treker/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Config = { public_key: string; private_jwk: JsonWebKey; hook_secret: string };
async function config(): Promise<Config> {
  const read = async () => (await db.from('push_config').select('*').eq('id', 1).single()).data as Config;
  let c = await read();
  if (!c.public_key) {
    const k = await generateVapidKeys();
    // .is(null): если две функции стартовали одновременно, ключи запишет только одна.
    await db.from('push_config').update({ public_key: k.publicKey, private_jwk: k.privateJwk }).eq('id', 1).is('public_key', null);
    c = await read();
  }
  return c;
}

const LABEL: Record<string, string> = { todo: 'Не начато', doing: 'В процессе', done: 'Готово' };
function message(n: any, actor: string) {
  const t = `«${n.title}»`, d = n.data || {};
  if (d.folder) {
    const c = d.count != null ? ` (задач: ${d.count})` : '';
    switch (n.kind) {
      case 'moved': return { title: 'Папка передана вам', body: `${actor} передал(а) вам папку ${t}${c}` };
      case 'transfer_request': return { title: 'Запрос на передачу папки', body: `${actor} хочет передать вам папку ${t}${c}. Откройте, чтобы принять или отклонить.` };
      case 'transfer_accepted': return { title: 'Передача принята', body: `${actor} принял(а) вашу папку ${t}` };
      case 'transfer_declined': return { title: 'Передача отклонена', body: `${actor} отклонил(а) папку ${t} — она осталась у вас` };
    }
  }
  switch (n.kind) {
    case 'assigned': return { title: 'Новая задача', body: `${actor} назначил(а) вам ${t}` };
    case 'status': return { title: `Статус: ${LABEL[d.to] || d.to}`, body: `${actor} изменил(а) статус ${t}` };
    case 'deleted': return { title: 'Задача удалена', body: `${actor} удалил(а) ${t}` };
    case 'restored': return { title: 'Задача восстановлена', body: `${actor} восстановил(а) ${t}` };
    case 'moved': return { title: 'Задача передана вам', body: `${actor} перенёс(ла) ${t}` };
    case 'transfer_request': return { title: 'Запрос на передачу', body: `${actor} хочет передать вам ${t}. Откройте, чтобы принять или отклонить.` };
    case 'transfer_accepted': return { title: 'Передача принята', body: `${actor} принял(а) ${t}` };
    case 'transfer_declined': return { title: 'Передача отклонена', body: `${actor} отклонил(а) ${t} — задача осталась у вас` };
    case 'purge_soon': return { title: 'Архив', body: `Завтра ${t} удалится из архива навсегда` };
    default: return { title: 'Задачи', body: n.title || 'Новое уведомление' };
  }
}

// Отправка на все устройства пользователя; недействительные подписки (404/410) удаляются.
async function deliver(userId: string, payload: Record<string, unknown>, cfg: Config, urgent = false) {
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
  const vapid = { publicKey: cfg.public_key, privateJwk: cfg.private_jwk, subject: SITE };
  let sent = 0, gone = 0, failed = 0;
  for (const s of subs ?? []) {
    try {
      const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), vapid,
        { urgency: urgent ? 'high' : 'normal' });
      if (r.status === 404 || r.status === 410) { gone++; await db.from('push_subscriptions').delete().eq('id', s.id); }
      else if (r.status < 300) { sent++; await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id); }
      else { failed++; console.log('push rejected', r.status, r.text); }
    } catch (e) { failed++; console.log('push error', String(e)); }
  }
  return { devices: subs?.length ?? 0, sent, gone, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => ({}));
  const cfg = await config();
  const secretOk = req.headers.get('x-push-secret') === cfg.hook_secret;

  if (body.op === 'send') {
    if (!secretOk) return json({ error: 'forbidden' }, 403);
    const { data: n } = await db.from('notifications').select('*').eq('id', body.id).maybeSingle();
    if (!n) return json({ devices: 0, sent: 0 });
    const { data: a } = n.actor_id ? await db.from('profiles').select('name').eq('id', n.actor_id).maybeSingle() : { data: null };
    const m = message(n, a?.name || 'Кто-то');
    const res = await deliver(n.user_id, { ...m, tag: n.task_id ? `task-${n.task_id}` : `n-${n.id}`, note: n.id, url: `${SITE}?note=${n.id}` }, cfg,
      n.kind === 'transfer_request');
    return json(res);
  }
  if (body.op === 'test') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return json({ error: 'auth' }, 401);
    const res = await deliver(data.user.id, { title: 'Проверка уведомлений', body: 'Если вы это видите — пуши на этом устройстве работают.', tag: 'test', url: SITE }, cfg);
    return json(res);
  }
  if (body.op === 'selftest') {
    if (!secretOk) return json({ error: 'forbidden' }, 403);
    // Эфемерная «подписка браузера» — проверяем, что шифрование и подпись работают в этой среде.
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const keys = { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    const enc = await encryptPayload('{"title":"selftest"}', keys);
    const auth = await vapidHeader('https://fcm.googleapis.com/fcm/send/x', { publicKey: cfg.public_key, privateJwk: cfg.private_jwk, subject: SITE });
    return json({ ok: true, bytes: enc.length, vapid: auth.startsWith('vapid t=') });
  }
  if (body.op === 'init') return json({ publicKey: cfg.public_key });
  return json({ error: 'unknown op' }, 400);
});
