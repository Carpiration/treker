// Web Push без сторонних библиотек: только WebCrypto (работает и в Deno, и в Node 18+).
// Шифрование содержимого — aes128gcm (RFC 8188, RFC 8291), подпись сервера — VAPID (RFC 8292, ES256).

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Новая пара ключей VAPID: публичный (65 байт, base64url — для браузера) и закрытый (JWK — хранится на сервере).
export async function generateVapidKeys() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64u(await subtle.exportKey('raw', kp.publicKey)),
    privateJwk: await subtle.exportKey('jwk', kp.privateKey),
  };
}

// Заголовок Authorization: подписанный токен (на 12 часов) для конкретного push-сервиса.
export async function vapidHeader(endpoint, { publicKey, privateJwk, subject }) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto сразу даёт подпись в формате JOSE (r‖s, 64 байта).
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

// Шифрование сообщения для подписки браузера (keys.p256dh, keys.auth). Одна запись, без дополнения.
export async function encryptPayload(text, { p256dh, auth }) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(enc.encode(text), new Uint8Array([2]));  // 0x02 — признак последней записи
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 16, 0]);  // размер записи 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Отправка. Возвращает статус push-сервиса: 201 — принято; 404/410 — подписка больше не действует.
export async function sendPush(sub, text, vapid, { ttl = 86400, urgency = 'normal', topic } = {}) {
  const body = await encryptPayload(text, sub.keys);
  const headers = {
    Authorization: await vapidHeader(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic) headers.Topic = topic;
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return { status: res.status, text: res.ok ? '' : (await res.text()).slice(0, 300) };
}
