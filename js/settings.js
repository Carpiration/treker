'use strict';
/* ---------- настройки ---------- */
function openSettings() {
  state.pfOpen = null;
  buildSettings();
  $('#settings').showModal();
  $('#stBody').scrollTop = 0;
}
function closeDlg(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (reduced()) { d.close(); return; }
  d.classList.add('closing');
  const done = () => { if (!d.classList.contains('closing')) return; d.classList.remove('closing'); d.close(); };
  d.addEventListener('animationend', function end(e) { if (e.target !== d) return; d.removeEventListener('animationend', end); done(); });
  setTimeout(done, 320);
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#settings').addEventListener('cancel', e => { e.preventDefault(); closeDlg(e.currentTarget); });
$('#settings').addEventListener('click', e => { if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeDlg(e.currentTarget); });

// Задачи, оставшиеся на этом устройстве от локального режима, — их можно перенести в облако.
function deviceTasks() {
  if (!backend) return null;
  try { if (localStorage.getItem(IMPORTED_KEY)) return null; } catch { return null; }
  // В Android-приложении задачи версии 1.0 передаёт мост (они лежали под адресом file://, недоступным сайту).
  const sources = [() => localStorage.getItem(DB_KEY), () => localStorage.getItem(LEGACY_KEY), () => window.TrekerBridge?.legacy()];
  for (const read of sources) {
    try {
      const db = JSON.parse(read());
      // Нетронутые демо-данные старой версии (v2, rev 1) не предлагаем.
      if (db?.tasks?.length && (db.v === 3 || db.rev > 1)) return db;
    } catch {}
  }
  return null;
}
function buildSettings() {
  const u = me(), dev = isAdmin() && deviceTasks();
  $('#stBody').innerHTML = `
    <section class="st-sec" aria-label="Профиль">
      <div class="me-card" id="meCard"></div>
      <form class="inline" id="nameForm" novalidate>
        ${fieldHtml('stName', 'Имя', 'maxlength="60" autocomplete="name"', u.name)}
        <button class="btn" type="submit">Сохранить</button>
      </form>
      <details class="fold" id="pwFold"><summary>${icon('down', 'chev')}Сменить PIN</summary>
        <form class="fold-body" id="pwForm" novalidate>
          <input type="text" autocomplete="username" value="${esc(u.login || '')}" hidden>
          ${pwFieldHtml('stPwOld', 'Текущий PIN', 'current-password', '', 'maxlength="128"')}
          ${pwFieldHtml('stPwNew', 'Новый PIN', 'new-password', '6 цифр')}
          <button class="btn" type="submit">Сменить PIN</button>
        </form>
      </details>
    </section>
    <section class="st-sec" aria-labelledby="stViewH">
      <h3 class="sub-h" id="stViewH">Отображение</h3>
      <label class="switch-row"><span class="txt"><span>Показывать, чья задача</span>
        <span class="hint">Аватар исполнителя в строке и имя в подробностях</span></span>
        <input type="checkbox" class="switch" role="switch" id="prefAssignee"${pref('showAssignee') ? ' checked' : ''}></label>
    </section>
    ${isAdmin() ? `<section class="st-sec" aria-labelledby="stPfH" id="pfSec">
      <h3 class="sub-h" id="stPfH">Профили</h3><div class="pf-list" id="pfList"></div></section>` : ''}
    ${dev ? `<section class="st-sec" aria-labelledby="stImpH">
      <h3 class="sub-h" id="stImpH">Перенос с этого устройства</h3>
      <p class="hint">В этом браузере остались задачи из прежней версии: ${dev.tasks.length}. Их можно один раз перенести в общую базу. Исполнители сопоставляются по номеру телефона или имени, остальные задачи достанутся вам.</p>
      <button class="btn" type="button" id="importBtn">Перенести задачи: ${dev.tasks.length}</button>
    </section>` : ''}
    <section class="st-sec">
      <p class="hint">Данные хранятся на сервере и синхронизируются между всеми устройствами.</p>
      <button class="btn ghost danger block" type="button" id="logoutBtn">${icon('logout')}Выйти</button>
    </section>`;
  renderMeCard();
  renderProfiles();
}
function renderMeCard() {
  const u = me();
  $('#meCard').innerHTML = `${avatar(u, 'lg')}<span><b>${esc(u.name)}</b><span class="hint">${esc(fmtLogin(u.login))} · ${ROLES[u.role]}</span></span>`;
}
function refreshSettings() {
  if (!!$('#pfSec') !== isAdmin()) { buildSettings(); return; }
  renderMeCard();
  $('#prefAssignee').checked = pref('showAssignee');
  if (!state.pfOpen) renderProfiles();
}

function renderProfiles() {
  const box = $('#pfList'); if (!box) return;
  // Сначала заявки на вход, затем активные (вы — первым), затем отключённые.
  const rank = u => u.pending && !u.active ? 0 : u.active ? 1 : 2;
  const users = [...state.db.users].sort((a, b) =>
    rank(a) - rank(b) || ((b.id === state.me) - (a.id === state.me)) || a.name.localeCompare(b.name, 'ru'));
  box.innerHTML = users.map(profileHtml).join('') + (state.pfOpen === 'new'
    ? `<div class="pf open">${profileForm(null)}</div>`
    : `<button class="btn ghost block add-pf" type="button" data-pf-new>${icon('plus')}Новый профиль</button>`);
}
function profileHtml(u) {
  const open = state.pfOpen === u.id;
  const n = state.db.tasks.filter(t => t.assigneeId === u.id && t.status !== 'done').length;
  const waiting = u.pending && !u.active;
  const sub = [u.login ? esc(fmtLogin(u.login)) : 'нет входа', ROLES[u.role], waiting || u.active ? '' : 'отключён'].filter(Boolean).join(' · ');
  return `<div class="pf${u.active || waiting ? '' : ' off'}${open ? ' open' : ''}">
    <button type="button" class="pf-row" data-pf="${u.id}" aria-expanded="${open}">${avatar(u)}
      <span class="pf-txt"><b>${esc(u.name)}${u.id === state.me ? '<span class="tag">вы</span>' : ''}${waiting ? '<span class="tag">заявка</span>' : ''}</b><span class="hint">${sub}</span></span>
      <span class="cnt" title="Активных задач">${n || ''}</span>${icon('down', 'chev')}</button>
    ${open ? profileForm(u) : ''}</div>`;
}
function profileForm(u) {
  const id = u ? u.id : 'new';
  const lastAdmin = u && u.active && u.role === 'admin' && activeAdmins().length === 1;
  const hasLogin = !!u?.login;
  return `<form class="pf-form" data-pf-form="${id}" novalidate>
    ${u ? '' : '<h4>Новый профиль</h4>'}
    ${fieldHtml(`pf-${id}-name`, 'Имя', 'maxlength="60" autocomplete="off"', u?.name)}
    ${fieldHtml(`pf-${id}-login`, 'Номер телефона', 'type="tel" inputmode="tel" maxlength="20" autocomplete="off" placeholder="+7 999 123-45-67"', fmtLogin(u?.login))}
    ${pwFieldHtml(`pf-${id}-pw`, hasLogin ? 'Новый PIN' : 'PIN', 'new-password', hasLogin ? 'Пусто — не менять' : '6 цифр')}
    <div class="field"><label for="pf-${id}-role">Роль</label>
      <select class="input" id="pf-${id}-role"${lastAdmin ? ` disabled aria-describedby="pf-${id}-rh"` : ''}>
        ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${(u?.role || 'user') === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>${lastAdmin ? `<span class="hint" id="pf-${id}-rh">Единственного администратора нельзя понизить</span>` : ''}</div>
    <div class="field-error" id="pf-${id}-form-err" role="alert" hidden></div>
    <div class="row-actions">
      <button class="btn primary sm" type="submit">${u ? 'Сохранить' : 'Создать'}</button>
      <button class="btn ghost sm" type="button" data-pf-cancel>Отмена</button>
      ${u && u.id !== state.me ? `<button class="btn sm push${u.active ? ' ghost danger' : u.pending ? ' primary' : ' ghost'}" type="button" data-pf-toggle="${u.id}">${u.active ? 'Отключить' : u.pending ? 'Одобрить' : 'Включить'}</button>` : ''}
    </div></form>`;
}
function openProfile(id) {
  state.pfOpen = id;
  renderProfiles();
  const first = $(`#pf-${id}-name`);
  first?.focus({ preventScroll: true });
  first?.closest('.pf')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
}
function closeProfile() {
  const id = state.pfOpen; state.pfOpen = null;
  renderProfiles();
  ($(`[data-pf="${id}"]`) || $('[data-pf-new]'))?.focus({ preventScroll: true });
}
async function toggleActive(btn, id) {
  const u = user(id), on = !u.active;
  const data = { name: u.name, login: u.login, role: u.role, active: on, password: '' };
  btnBusy(btn, true, on ? (u.pending ? 'Одобряем…' : 'Включаем…') : 'Отключаем…');
  try { await backend.saveUser(id, data); }
  catch (e) { btnBusy(btn, false); setFormErr(id, errText(e)); return; }
  state.pfOpen = null;
  render(); renderProfiles();
  $(`[data-pf="${id}"]`)?.focus({ preventScroll: true });
  if (on && u.pending) toast(`${u.name}: доступ открыт`);
  if (!on) toast(`${u.name}: профиль отключён`, async () => {
    try { await backend.saveUser(id, { ...data, active: true }); render(); } catch (e) { toast(errText(e)); }
  });
}
function setFormErr(id, msg) { const box = $(`#pf-${id}-form-err`); if (box) { box.textContent = msg; box.hidden = !msg; } }

async function importDeviceTasks(btn) {
  const src = deviceTasks(); if (!src) return;
  const users = src.users || [];
  // Исполнитель с устройства → профиль в базе: по номеру, затем по имени; иначе — текущий пользователь.
  const map = localId => {
    const lu = users.find(x => x.id === localId); if (!lu) return state.me;
    const byLogin = lu.login && state.db.users.find(x => x.login === loginKey(lu.login));
    const byName = state.db.users.find(x => x.name.trim().toLowerCase() === lu.name.trim().toLowerCase());
    return (byLogin || byName)?.id || state.me;
  };
  const list = src.tasks.map(t => ({
    id: newId(), title: String(t.title || '').slice(0, 200) || 'Без названия', desc: String(t.desc || '').slice(0, 5000),
    status: STATUSES.some(s => s.id === t.status) ? t.status : 'todo', assigneeId: map(t.assigneeId), authorId: map(t.authorId),
    createdAt: t.createdAt || Date.now(), updatedAt: t.updatedAt || t.createdAt || Date.now(), doneAt: t.status === 'done' ? t.doneAt || Date.now() : null,
  }));
  btnBusy(btn, true, 'Переносим…');
  try { await backend.insertTasks(list); }
  catch (e) { btnBusy(btn, false); toast(errText(e)); return; }
  try { localStorage.setItem(IMPORTED_KEY, String(Date.now())); } catch {}
  await backend.reload().catch(() => {});
  buildSettings(); render();
  toast(`Перенесено задач: ${list.length}`);
}

$('#stBody').addEventListener('click', e => {
  if (e.target.closest('#logoutBtn')) return logout();
  const imp = e.target.closest('#importBtn'); if (imp) return importDeviceTasks(imp);
  if (e.target.closest('[data-pf-new]')) return openProfile('new');
  if (e.target.closest('[data-pf-cancel]')) return closeProfile();
  const row = e.target.closest('[data-pf]');
  if (row) return state.pfOpen === row.dataset.pf ? closeProfile() : openProfile(row.dataset.pf);
  const tg = e.target.closest('[data-pf-toggle]');
  if (tg && !tg.disabled) toggleActive(tg, tg.dataset.pfToggle);
});
$('#stBody').addEventListener('change', e => {
  if (e.target.id !== 'prefAssignee') return;
  ops.patchSelf({ prefs: { ...me().prefs, showAssignee: e.target.checked } });
});
$('#stBody').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('[type=submit]', f);
  if (btn?.disabled) return;
  if (f.id === 'nameForm') {
    const inp = $('#stName'), name = inp.value.trim();
    if (!setErr(inp, name ? '' : 'Введите имя')) return inp.focus();
    if (name !== me().name && await ops.patchSelf({ name })) toast('Имя сохранено');
  } else if (f.id === 'pwForm') {
    const o = $('#stPwOld'), n = $('#stPwNew');
    const okO = setErr(o, o.value ? '' : 'Введите текущий PIN'), okN = setErr(n, pinError(n.value));
    if (!okO) return o.focus();
    if (!okN) return n.focus();
    btnBusy(btn, true, 'Сохраняем…');
    try { await backend.changePassword(o.value, n.value); }
    catch (err) {
      btnBusy(btn, false);
      const msg = errText(err);
      if (/текущий/.test(msg)) { setErr(o, msg); o.focus(); } else { setErr(n, msg); n.focus(); }
      return;
    }
    btnBusy(btn, false);
    o.value = ''; n.value = ''; $('#pwFold').open = false;
    toast('PIN изменён');
  } else if (f.dataset.pfForm) submitProfile(f, btn);
});
async function submitProfile(f, btn) {
  const id = f.dataset.pfForm, isNew = id === 'new', u = isNew ? null : user(id);
  const el = k => $(`#pf-${id}-${k}`, f);
  const name = el('name').value.trim(), login = el('login').value.trim(), pw = el('pw').value, roleSel = el('role');
  let bad = null;
  const check = (input, msg) => { if (!setErr(input, msg) && !bad) bad = input; };
  check(el('name'), name ? '' : 'Введите имя');
  check(el('login'), loginError(login, u?.id));
  check(el('pw'), pw || isNew || !u.login ? pinError(pw) : '');
  setFormErr(id, '');
  if (bad) return bad.focus();
  const data = { name, login, role: roleSel.disabled ? u.role : roleSel.value, active: u ? u.active : true, password: pw };
  btnBusy(btn, true, isNew ? 'Создаём…' : 'Сохраняем…');
  let savedId;
  try { savedId = await backend.saveUser(u?.id || null, data); }
  catch (err) {
    btnBusy(btn, false);
    const msg = errText(err);
    if (/номер/i.test(msg)) { setErr(el('login'), msg); el('login').focus(); }
    else if (/PIN/.test(msg)) { setErr(el('pw'), msg); el('pw').focus(); }
    else setFormErr(id, msg);
    return;
  }
  state.pfOpen = null;
  render();
  if (!$('#settings').open) return;
  if (!$('#pfSec')) { buildSettings(); return; }
  renderProfiles();
  $(`[data-pf="${savedId}"]`)?.focus({ preventScroll: true });
  toast(isNew ? `Профиль создан: ${name}` : 'Профиль сохранён');
}
