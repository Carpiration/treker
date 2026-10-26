'use strict';
/* ---------- пуш-уведомления на этом устройстве ----------
   Браузер подписывается на пуши (ключ сервера — push_public_key), подписка хранится в push_subscriptions.
   Отправляет база: новое уведомление → функция push → устройства получателя. Показывает sw.js. */
const push = { state: 'unknown', busy: false };
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Что умеет это устройство: ok | apk (оболочка Android) | ios-browser (iPhone без «На экран Домой») | unsupported
function pushSupport() {
  if (window.TrekerBridge) return 'apk';
  if (isIOS() && !standalone()) return 'ios-browser';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}
const swRegistration = () => navigator.serviceWorker.register('sw.js');
async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function saveSub(sub) {
  const j = sub.toJSON();
  await backend.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: deviceName() });
}
function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIOS() ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /YaBrowser/.test(ua) ? 'Яндекс' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Браузер';
  return `${br}${os ? ` · ${os}` : ''}`;
}
// Состояние для страницы уведомлений. Уже подписанный браузер привязываем к вошедшему пользователю.
async function pushRefresh(rebind = false) {
  const sup = pushSupport();
  if (sup !== 'ok') { push.state = sup; return; }
  if (Notification.permission === 'denied') { push.state = 'denied'; return; }
  try {
    const sub = await currentSub();
    push.state = sub && Notification.permission === 'granted' ? 'on' : 'off';
    if (sub && rebind && push.state === 'on') await saveSub(sub);
  } catch { push.state = 'off'; }
}
async function pushEnable(btn) {
  push.busy = true; btnBusy(btn, true, 'Включаем…');
  try {
    if (await Notification.requestPermission() !== 'granted') { push.state = 'denied'; return; }
    const key = await backend.rpc('push_public_key');
    if (!key) throw new Error('Сервер уведомлений ещё не готов — попробуйте через минуту');
    const reg = await swRegistration();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Подписка с другим ключом сервера не будет работать — оформляем заново.
    if (sub && b64uOf(sub.options.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
    await saveSub(sub);
    push.state = 'on';
    toast('Пуш-уведомления включены на этом устройстве');
  } catch (e) { toast(errText(e, 'Нет связи с сервером')); }
  finally { push.busy = false; btnBusy(btn, false); refreshNotesPush(); }
}
async function pushDisable(btn) {
  push.busy = true; btnBusy(btn, true, 'Выключаем…');
  try {
    const sub = await currentSub();
    if (sub) { await backend.removePush(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
    push.state = 'off';
    toast('Пуши на этом устройстве выключены');
  } catch (e) { toast(errText(e)); }
  finally { push.busy = false; btnBusy(btn, false); refreshNotesPush(); }
}
async function pushTest(btn) {
  btnBusy(btn, true, 'Отправляем…');
  try {
    const r = await backend.pushTest();
    toast(r?.sent ? `Отправлено на устройства: ${r.sent}. Сейчас придёт уведомление.` : 'Не удалось доставить — выключите и включите пуши заново');
  } catch (e) { toast(errText(e, 'Нет связи с сервером')); }
  finally { btnBusy(btn, false); }
}
// Выход: это устройство больше не должно получать пуши вышедшего человека.
async function pushForget() {
  try { const sub = pushSupport() === 'ok' && await currentSub(); if (sub) await backend.removePush(sub.endpoint); } catch {}
}
function b64uOf(buf) {
  if (!buf) return '';
  let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

// Блок вверху страницы «Уведомления».
function pushCardHtml() {
  const st = push.state;
  const card = (cls, ic, title, text, actions = '') => `<div class="push-card ${cls}" id="pushCard">
    <span class="push-ic">${icon(ic)}</span><div class="push-txt"><b>${title}</b><span class="hint">${text}</span>${actions ? `<div class="row-actions">${actions}</div>` : ''}</div></div>`;
  switch (st) {
    case 'on': return card('on', 'bell', 'Пуши на этом устройстве включены', 'Придут, даже когда приложение закрыто.',
      `<button class="btn sm" type="button" id="pushTestBtn">Проверить</button><button class="btn ghost sm" type="button" id="pushOffBtn">Выключить</button>`);
    case 'off': return card('', 'bell', 'Пуши на этом устройстве выключены', 'Включите, чтобы узнавать о новых задачах, смене статуса и передачах сразу.',
      `<button class="btn primary sm" type="button" id="pushOnBtn">Включить</button>`);
    case 'denied': return card('warn', 'bell', 'Уведомления запрещены в браузере', 'Разрешите их для этого сайта: значок замка или «i» слева от адреса → Уведомления → Разрешить. Затем обновите страницу.');
    case 'ios-browser': return card('', 'bell', 'На iPhone пуши работают из приложения на экране «Домой»', 'Нажмите «Поделиться» → «На экран „Домой“», откройте «Задачи» оттуда и включите уведомления здесь.');
    case 'apk': return card('', 'bell', 'В Android-приложении пуши пока не приходят', 'Откройте сайт в Chrome и включите уведомления там — они будут приходить на телефон. Пуши прямо в приложении — следующая доработка.');
    case 'unsupported': return card('warn', 'bell', 'Этот браузер не поддерживает пуш-уведомления', 'Подойдут Chrome, Edge, Яндекс Браузер, Firefox или Safari (macOS, iOS 16.4+).');
    default: return card('', 'bell', 'Пуш-уведомления', 'Проверяем…');
  }
}
function refreshNotesPush() {
  const c = $('#pushCard'); if (!c) return;
  c.outerHTML = pushCardHtml();
}
$('#stBody').addEventListener('click', e => {
  if (e.target.closest('#pushOnBtn')) pushEnable(e.target.closest('button'));
  else if (e.target.closest('#pushOffBtn')) pushDisable(e.target.closest('button'));
  else if (e.target.closest('#pushTestBtn')) pushTest(e.target.closest('button'));
});

// Нажали на пуш, когда приложение уже открыто, — показываем уведомления.
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
  if (e.data?.type === 'open-notes' && state.me) { closeCtx(); remoteChanged(); openPage('notes'); }
});
// Приложение открыто нажатием на пуш (?note=…) — сразу к уведомлениям, адрес очищаем.
function openFromPush() {
  const p = new URLSearchParams(location.search);
  if (!p.has('note')) return;
  history.replaceState(null, '', location.pathname);
  openPage('notes');
}
