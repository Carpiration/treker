'use strict';
// Общее: настройки, помощники, состояние, поля форм. Скрипты подключаются по порядку (index.html), общая область видимости.
// Подключение к Supabase — в config.js. Без него приложение не запускается: данные живут только на сервере.
const CFG = window.TREKER_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseKey);
const SB_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
const SB_SRI = 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R';
const DB_KEY = 'treker-v3';
const LEGACY_KEY = 'team-tasks-v2';
const IMPORTED_KEY = 'treker-imported';
const UNDO_MS = 4000;
const STATUSES = [
  { id: 'todo',  label: 'Не начато' },
  { id: 'doing', label: 'В процессе' },
  { id: 'done',  label: 'Готово' },
];
const ROLES = { user: 'Участник', admin: 'Администратор' };
// Настройки вида хранятся в профиле (prefs) и одинаковы на всех устройствах человека.
// taskFx: фон задач — 'rays' (лучи по цвету статуса), 'outline' (цветная обводка), 'off';
// fxAnim: лёгкое переливание; statusView: статус в строке — 'pill' (метка), 'dot' (цветной индикатор), 'hide'.
// accent — акцентный цвет; bg* — градиентный фон: включён, сила (%), распространение (vmax), положение X/Y (%).
const PREF_DEFAULTS = { showAssignee: true, prioOff: false, taskFx: 'rays', fxAnim: false, statusView: 'pill',
  accent: '#ff8a3d', bgOn: true, bgStrength: 34, bgSpread: 80, bgX: 92, bgY: 0 };
const EASE = 'cubic-bezier(.2,.8,.2,1)';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const statusIcon = id => `<svg class="si" viewBox="0 0 16 16" aria-hidden="true"><use href="#s-${id}"/></svg>`;
const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[0];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => matchMedia('(pointer: fine)').matches;
const fmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function when(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'только что';
  if (d < 3600000) return `${Math.floor(d / 60000)} мин назад`;
  if (d < 6 * 3600000) return `${Math.floor(d / 3600000)} ч назад`;
  return fmt.format(ts).replace('.', '');
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatar(u, cls = '') {
  if (!u) return `<span class="avatar ${cls}" aria-hidden="true">?</span>`;
  const h = hue(u.id + u.name);
  // Инициалы: у ника из нескольких частей (Анна_К) — первые буквы частей, иначе две первые буквы.
  const parts = u.name.split(/[\s_.-]+/).filter(Boolean);
  const ini = (parts.length > 1 ? parts[0][0] + parts[1][0] : u.name.slice(0, 2)).toUpperCase();
  // Картинка (готовая или своё фото) поверх инициалов: если не загрузится — останутся инициалы.
  const src = avatarSrc(u.avatar);
  return `<span class="avatar ${cls}${u.active === false ? ' off' : ''}${src ? ' pic' : ''}" style="background:hsl(${h} 30% 24%);color:hsl(${h} 75% 82%)" aria-hidden="true">${esc(ini)}${
    src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`;
}
// Аватар: 'preset:N' — из набора icons/avatars, 'up:<путь>' — своё фото в хранилище Supabase.
const AVATAR_PRESETS = 10;
function avatarSrc(a) {
  if (!a) return '';
  if (a.startsWith('preset:')) return `icons/avatars/a${a.slice(7)}.svg`;
  if (a.startsWith('up:')) return `${CFG.supabaseUrl}/storage/v1/object/public/avatars/${a.slice(3)}`;
  return '';
}
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function btnBusy(btn, busy, text) {
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(text)}`; }
  else if (btn.dataset.label != null) { btn.disabled = false; btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
}

/* ---------- состояние ---------- */
// hoverId — подробности под курсором, kbdId — под фокусом с клавиатуры, tapId — открыты касанием.
let backend = null;
const state = { db: { users: [], tasks: [], groups: [], members: [], folders: [], notes: [], transfers: [], ftransfers: [] }, me: null,
  space: 'me', folder: 'all', who: 'all', newFolder: false, view: 'active',
  editing: null, hoverId: null, kbdId: null, tapId: null, newAssignee: undefined, newImportant: null, newImages: [], pending: false, pfOpen: null, flash: null,
  leaving: new Map() };  // задачи, улетающие в «Готовые»/«Активные»: id → куда
const user = id => state.db.users.find(u => u.id === id);
const me = () => user(state.me);
const isAdmin = () => me()?.role === 'admin';
const activeUsers = () => state.db.users.filter(u => u.active);
const activeAdmins = () => activeUsers().filter(u => u.role === 'admin');
const pref = k => (me()?.prefs || {})[k] ?? PREF_DEFAULTS[k];

/* ---------- поля форм ---------- */
function fieldHtml(id, label, attrs = '', value = '') {
  return `<div class="field"><label for="${id}">${label}</label>
    <input class="input" id="${id}" value="${esc(value)}" aria-describedby="${id}-err" ${attrs}>
    <div class="field-error" id="${id}-err" hidden></div></div>`;
}
function pwFieldHtml(id, label, autocomplete, placeholder = '', attrs = PIN_ATTRS) {
  return `<div class="field"><label for="${id}">${label}</label>
    <div class="pw"><input class="input" type="password" id="${id}" autocomplete="${autocomplete}" placeholder="${esc(placeholder)}" ${attrs} aria-describedby="${id}-err">
    <button type="button" class="icon-btn" data-eye aria-label="Показать" aria-pressed="false">${icon('eye')}</button></div>
    <div class="field-error" id="${id}-err" hidden></div></div>`;
}
function setErr(input, msg) {
  const el = typeof input === 'string' ? document.getElementById(input) : input;
  const box = document.getElementById(`${el.id}-err`);
  if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  if (box) { box.textContent = msg || ''; box.hidden = !msg; }
  return !msg;
}
/* ---------- номер телефона ----------
   Храним только цифры с кодом страны (998936723009). Пользователь вводит одни цифры,
   поле само расставляет скобки и тире: +998(93)672-30-09, +7(999)123-45-67. */
const PHONE_MASKS = [
  { code: '998', groups: [3, 2, 3, 2, 2] },  // Узбекистан
  { code: '7',   groups: [1, 3, 3, 2, 2] },  // Россия, Казахстан
];
const phoneMask = d => PHONE_MASKS.find(m => d.startsWith(m.code));
const phoneMax = d => { const m = phoneMask(d); return m ? m.groups.reduce((a, b) => a + b) : 15; };
const normPhone = raw => String(raw || '').replace(/\D/g, '').slice(0, 15);
function fmtPhone(raw) {
  const d = normPhone(raw); if (!d) return '';
  const m = phoneMask(d); if (!m) return `+${d}`;
  const p = []; let i = 0;
  for (const n of m.groups) { if (i >= d.length) break; p.push(d.slice(i, i + n)); i += n; }
  return `+${p[0]}${p[1] ? `(${p[1]}` : ''}${p[2] ? `)${p[2]}` : ''}${p[3] ? `-${p[3]}` : ''}${p[4] ? `-${p[4]}` : ''}${d.slice(i)}`;
}
// Текстовые логины из самой первой версии (например, admin) продолжают работать.
const loginKey = raw => { const d = normPhone(raw); return /^\d{11,15}$/.test(d) ? d : String(raw || '').trim().toLowerCase(); };
const fmtLogin = login => !login ? '' : /^\d+$/.test(login) ? fmtPhone(login) : login;
const PHONE_EXAMPLE = '+998(93)123-45-67';
const PHONE_ATTRS = `type="tel" inputmode="numeric" maxlength="22" data-phone placeholder="${PHONE_EXAMPLE}"`;
function phoneError(raw) {
  const d = normPhone(raw);
  if (!d) return 'Введите номер телефона';
  const m = phoneMask(d);
  return (m ? d.length === phoneMax(d) : d.length >= 11) ? '' : `Номер целиком, например ${PHONE_EXAMPLE}`;
}
function loginError(raw, exceptId, db = state.db) {
  const f = phoneError(raw); if (f) return f;
  const key = normPhone(raw);
  if (db.users.some(u => u.id !== exceptId && u.login && u.login.toLowerCase() === key)) return 'Этот номер уже зарегистрирован';
  return '';
}
// Маска при вводе: курсор остаётся после той же цифры; Backspace перед скобкой или тире стирает цифру.
document.addEventListener('keydown', e => { if (e.target.matches?.('[data-phone]')) e.target.dataset.prev = normPhone(e.target.value); }, true);
document.addEventListener('input', e => {
  const el = e.target; if (!el.matches?.('[data-phone]')) return;
  let left = normPhone(el.value.slice(0, el.selectionStart)).length;
  let d = el.value.replace(/\D/g, '');
  if (e.inputType === 'deleteContentBackward' && d === el.dataset.prev && left > 0) { d = d.slice(0, left - 1) + d.slice(left); left--; }
  d = d.slice(0, phoneMax(d));
  el.value = fmtPhone(d); el.dataset.prev = d;
  let k = 0; for (let c = 0; c < left && k < el.value.length; k++) if (/\d/.test(el.value[k])) c++;
  // Курсор не встаёт перед скобкой/тире, следующими за последней введённой цифрой.
  if (document.activeElement === el) el.setSelectionRange(k, k);
});

/* ---------- ник ----------
   Уникален во всей системе (без учёта регистра), это проверяет и база. */
const NICK_ATTRS = 'maxlength="30" autocomplete="nickname" autocapitalize="off" spellcheck="false"';
function nickError(raw) {
  const n = String(raw || '').trim();
  if (!n) return 'Введите ник';
  if (n.length < 2 || n.length > 30) return 'Ник — от 2 до 30 символов';
  if (!/^[\p{L}\p{N}_.-]+$/u.test(n)) return 'Ник — буквы, цифры и знаки _ . - без пробелов';
  return '';
}
const nickTaken = (n, exceptId, db = state.db) => db.users.some(u => u.id !== exceptId && u.name.toLowerCase() === n.trim().toLowerCase());
const PIN_ATTRS = 'inputmode="numeric" maxlength="6"';
const pinError = pin => /^\d{6}$/.test(pin) ? '' : 'PIN — ровно 6 цифр';
const inactiveText = u => u?.pending ? 'Профиль ждёт одобрения администратора' : 'Профиль отключён администратором';
document.addEventListener('input', e => { if (e.target.getAttribute?.('aria-invalid')) setErr(e.target, ''); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-eye]'); if (!b) return;
  const inp = b.previousElementSibling, show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Скрыть' : 'Показать');
  b.innerHTML = icon(show ? 'eye-off' : 'eye');
});
