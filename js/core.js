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
const PREF_DEFAULTS = { showAssignee: true };
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
  const ini = u.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="avatar ${cls}${u.active === false ? ' off' : ''}" style="background:hsl(${h} 30% 24%);color:hsl(${h} 75% 82%)" aria-hidden="true">${esc(ini)}</span>`;
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
const state = { db: { users: [], tasks: [] }, me: null, who: 'me', editing: null, hoverId: null, kbdId: null, tapId: null, newAssignee: null, pending: false, pfOpen: null, flash: null };
const user = id => state.db.users.find(u => u.id === id);
const me = () => user(state.me);
const isAdmin = () => me()?.role === 'admin';
const activeUsers = () => state.db.users.filter(u => u.active);
const activeAdmins = () => activeUsers().filter(u => u.role === 'admin');
const teamOrder = () => [me(), ...activeUsers().filter(u => u.id !== state.me)].filter(Boolean);
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
// Логин — номер телефона: храним только цифры в международном виде (7XXXXXXXXXX для России).
function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  if (d.length === 10 && d[0] === '9') d = `7${d}`;
  return d;
}
// Текстовые логины из прежней версии (например, admin) продолжают работать.
const loginKey = raw => { const d = normPhone(raw); return /^\d{11,15}$/.test(d) ? d : String(raw || '').trim().toLowerCase(); };
function fmtLogin(login) {
  if (!login) return '';
  if (/^7\d{10}$/.test(login)) return `+7 ${login.slice(1, 4)} ${login.slice(4, 7)}-${login.slice(7, 9)}-${login.slice(9)}`;
  return /^\d+$/.test(login) ? `+${login}` : login;
}
const PHONE_ATTRS = 'type="tel" inputmode="tel" maxlength="20" autocomplete="username" placeholder="+7 999 123-45-67"';
const PIN_ATTRS = 'inputmode="numeric" maxlength="6"';
function phoneError(raw) {
  if (!String(raw || '').trim()) return 'Введите номер телефона';
  return /^\d{11,15}$/.test(normPhone(raw)) ? '' : 'Номер целиком, например +7 999 123-45-67';
}
function loginError(raw, exceptId, db = state.db) {
  const f = phoneError(raw); if (f) return f;
  const key = normPhone(raw);
  if (db.users.some(u => u.id !== exceptId && u.login && u.login.toLowerCase() === key)) return 'Этот номер уже зарегистрирован';
  return '';
}
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
