'use strict';
/* ---------- пространства задач ----------
   state.space: 'me' — свои личные задачи, 'g:<id>' — группа, 'u:<id>' — личные задачи другого человека (только просмотр).
   В личном пространстве полоса фильтров — папки (state.folder: 'all' | 'root' | <id папки>),
   в группе — исполнители (state.who: 'all' | <id человека>). */
const MAX_GROUPS = 7;
const group = id => state.db.groups.find(g => g.id === id);
const isMember = (gid, uid = state.me) => state.db.members.some(m => m.groupId === gid && m.userId === uid);
const userGroups = uid => state.db.groups.filter(g => isMember(g.id, uid));
// Администратор видит все группы, остальные — свои.
const visibleGroups = () => (isAdmin() ? state.db.groups : userGroups(state.me)).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const groupMembers = gid => activeUsers().filter(u => isMember(gid, u.id))
  .sort((a, b) => (b.id === state.me) - (a.id === state.me) || a.name.localeCompare(b.name, 'ru'));
const userFolders = uid => state.db.folders.filter(f => f.ownerId === uid)
  .sort((a, b) => (b.kind === 'transfers') - (a.kind === 'transfers') || a.name.localeCompare(b.name, 'ru'));
const folder = id => state.db.folders.find(f => f.id === id);

function spaceInfo(space = state.space) {
  if (space.startsWith('g:')) { const g = group(space.slice(2)); return g && { kind: 'group', id: g.id, group: g }; }
  if (space.startsWith('u:')) { const u = user(space.slice(2)); return u?.active && u.id !== state.me ? { kind: 'user', id: u.id, user: u } : null; }
  return { kind: 'me', id: state.me };
}
const cur = () => spaceInfo() || spaceInfo('me');
function spaceLabel(info = cur()) {
  if (info.kind === 'group') return info.group.name;
  if (info.kind === 'user') return info.user.name;
  return 'Мои задачи';
}
// Можно ли создавать задачи и менять их в текущем пространстве.
function canWrite(info = cur()) {
  if (info.kind === 'me') return true;
  if (info.kind === 'group') return isAdmin() || isMember(info.id);
  return false;
}
const taskEditable = t => !t.deletedAt && (t.groupId ? isAdmin() || isMember(t.groupId) : t.ownerId === state.me);
// Запрос на передачу задачи администратору, который ещё ждёт ответа.
const pendingTransfer = taskId => state.db.transfers.find(x => x.taskId === taskId && x.status === 'pending');

// Задачи пространства без учёта фильтра — для счётчиков.
function spaceTasks(info = cur()) {
  return state.db.tasks.filter(t => !t.deletedAt && (info.kind === 'group' ? t.groupId === info.id : !t.groupId && t.ownerId === info.id));
}
function filterTasks(list, info = cur()) {
  if (info.kind === 'group') return state.who === 'all' ? list : list.filter(t => t.assigneeId === state.who);
  if (state.folder === 'all') return list;
  return list.filter(t => (t.folderId || 'root') === state.folder);
}
// Переключатель «Активные / Готовые» (state.view). Активные — по дате создания (смена статуса строку не двигает),
// готовые — по времени завершения, свежие сверху.
function visibleTasks() {
  const done = state.view === 'done';
  return filterTasks(spaceTasks()).filter(t => (t.status === 'done') === done || state.leaving.has(t.id))
    .sort((a, b) => done ? (b.doneAt || 0) - (a.doneAt || 0) : b.createdAt - a.createdAt);
}
const activeCount = list => list.filter(t => t.status !== 'done').length;

// Пространство или фильтр пропали (исключили из группы, папку удалили или скрыли) — возвращаемся на допустимое.
function fixSpace() {
  if (!spaceInfo()) { state.space = 'me'; state.folder = 'all'; state.who = 'all'; }
  const info = cur();
  if (info.kind === 'group') {
    if (state.who !== 'all' && !groupMembers(info.id).some(u => u.id === state.who)) state.who = 'all';
  } else if (state.folder !== 'all' && state.folder !== 'root' && !folder(state.folder)) state.folder = 'all';
  else if (state.folder === 'root' && info.kind === 'user' && info.user.rootHidden) state.folder = 'all';
}
function setSpace(space) {
  state.space = space; state.folder = 'all'; state.who = 'all'; state.newAssignee = undefined;
  state.editing = null; state.tapId = null;
  render();
  $('[data-menu="space"] .menu-btn')?.focus();
}

/* ---------- шапка: выбор пространства ---------- */
function renderTop() {
  fixSpace();
  const info = cur(), label = spaceLabel(info);
  const groups = visibleGroups(), people = activeUsers().filter(u => u.id !== state.me).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const n = (list) => { const c = activeCount(list); return c ? `<span class="m-cnt">${c}</span>` : ''; };
  const items = [itemHtml('me', `${icon('user')}<span class="nm">Мои задачи</span>${n(spaceTasks(spaceInfo('me')))}`, info.kind === 'me')]
    .concat(groups.length ? [labelHtml('Группы')] : [], groups.map(g =>
      itemHtml(`g:${g.id}`, `${icon('users')}<span class="nm">${esc(g.name)}</span>${n(spaceTasks({ kind: 'group', id: g.id }))}`, info.kind === 'group' && info.id === g.id)))
    .concat(people.length ? [labelHtml('Личные задачи других')] : [], people.map(u =>
      itemHtml(`u:${u.id}`, `${avatar(u)}<span class="nm">${esc(u.name)}</span>`, info.kind === 'user' && info.id === u.id))).join('');
  $('#whoSlot').innerHTML = menuHtml({ kind: 'space', cls: 'who-btn', align: 'left', items,
    btn: `<span class="nm">${esc(label)}</span>${icon('down', 'chev')}`, label: `${label}. Выбрать группу или чьи задачи показать` });
  $$('#viewSeg .seg-b').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('#listTitle').textContent = label;
  renderBell();
  const waiting = isAdmin() && state.db.users.some(u => u.pending && !u.active);
  $('#settingsBtn').classList.toggle('has-dot', waiting);
  $('#settingsBtn').setAttribute('aria-label', waiting ? 'Меню — есть заявки на вход' : 'Меню');
  // Чужие личные задачи — только просмотр: поля новой задачи нет.
  const w = canWrite(info);
  $('#newForm').hidden = !w;
  $('#nTitleErr').hidden ||= !w;
  $('#app').classList.toggle('readonly', !w);
}

/* ---------- выбор папки (в личных задачах) или исполнителя (в группе) ----------
   На экране — одна кнопка с текущим выбором («Все ▾»). По нажатию — список: папки с количеством задач,
   глаз — скрыть папку от других, «Новая папка». Удержание или правая кнопка на папке — её меню
   (переименовать, скрыть, передать целиком, удалить). В группе в списке — люди со счётчиками. */
const pendingFolderTransfer = fid => state.db.ftransfers.find(x => x.folderId === fid && x.status === 'pending');
function filterOptions(info = cur()) {
  const all = spaceTasks(info), n = list => activeCount(list);
  if (info.kind === 'group') {
    return [{ v: 'all', label: 'Все', icon: icon('users'), count: n(all) }]
      .concat(groupMembers(info.id).map(u => ({ v: u.id, label: u.id === state.me ? 'Мои' : u.name, icon: avatar(u), count: n(all.filter(t => t.assigneeId === u.id)) })));
  }
  const own = info.kind === 'me', owner = own ? me() : info.user;
  const opts = [{ v: 'all', label: 'Все', icon: icon('list'), count: n(all) }];
  if (own || !owner.rootHidden) opts.push({ v: 'root', label: 'Без папки', icon: icon('inbox'), count: n(all.filter(t => !t.folderId)), eye: own ? 'root' : null, hidden: own && owner.rootHidden });
  for (const f of userFolders(info.id)) opts.push({ v: f.id, label: f.name, icon: icon('folder'), count: n(all.filter(t => t.folderId === f.id)),
    eye: own ? f.id : null, hidden: f.hidden, folder: own ? f.id : null, wait: own && pendingFolderTransfer(f.id) });
  return opts;
}
function renderChips() {
  const info = cur(), box = $('#chips'), opts = filterOptions(info);
  const value = info.kind === 'group' ? state.who : state.folder;
  const curOpt = opts.find(o => o.v === value) || opts[0];
  const own = info.kind === 'me';
  // Одна «Все» без папок у чужого человека — выбирать нечего.
  if (!own && info.kind !== 'group' && opts.length < 2) { box.innerHTML = ''; box.hidden = true; state.fpOpen = false; return; }
  const rows = opts.map(o => `<div class="fp-row${o.v === value ? ' on' : ''}${o.hidden ? ' hid' : ''}"${o.folder ? ` data-folder="${o.folder}"` : o.eye === 'root' ? ' data-folder="root"' : ''}>
      <button type="button" class="fp-item" role="option" aria-selected="${o.v === value}" data-pick="${o.v}">
        <span class="fp-ic">${o.icon}</span><span class="nm">${esc(o.label)}</span>${o.wait ? `<span class="fp-wait" title="Ждёт согласия на передачу">${icon('clock')}</span>` : ''}
        ${o.count ? `<span class="m-cnt" title="Активных задач">${o.count}</span>` : ''}</button>
      ${o.eye ? `<button type="button" class="fp-eye" data-eye="${o.eye}" aria-pressed="${!o.hidden}" aria-label="${o.hidden ? 'Скрыта от других — показать' : 'Видна другим — скрыть'}" title="${o.hidden ? 'Скрыта от других' : 'Видна другим'}">${icon(o.hidden ? 'eye-off' : 'eye')}</button>` : ''}
    </div>`).join('');
  const add = own ? (state.newFolder
    ? `<form class="fp-new" id="folderForm" novalidate><input class="input" id="folderName" maxlength="40" placeholder="Название папки" aria-label="Название новой папки" autocomplete="off"><button class="btn primary sm" type="submit">Создать</button></form>`
    : `<button type="button" class="fp-add" data-new-folder>${icon('plus')}Новая папка</button>`) : '';
  const hint = own ? `<p class="fp-hint">Удерживайте папку (или правая кнопка мыши) — переименовать, передать целиком, удалить</p>` : '';
  const btnLabel = info.kind === 'group' ? (value === 'all' ? 'Все' : curOpt.label) : curOpt.label;
  box.innerHTML = `<button type="button" class="fbtn" id="fpBtn" aria-haspopup="listbox" aria-expanded="${!!state.fpOpen}" aria-controls="fpPanel">
      <span class="fp-ic">${curOpt.icon}</span><span class="nm">${esc(btnLabel)}</span>${icon('down', 'chev')}</button>
    <div class="fpanel" id="fpPanel" role="listbox" aria-label="${info.kind === 'group' ? 'Чьи задачи' : 'Папка'}"${state.fpOpen ? '' : ' hidden'}>${rows}${add}${hint}</div>`;
  box.hidden = false;
  placePicker();
  if (state.newFolder) $('#folderName')?.focus();
}
// Панель не должна вылезать за правый край экрана.
function placePicker() {
  const pn = $('#fpPanel');
  if (!pn || pn.hidden) return;
  // offsetWidth, а не getBoundingClientRect: во время анимации появления панель чуть уменьшена.
  const gut = Math.min(20, Math.max(10, innerWidth * .04));
  const over = pn.offsetParent.getBoundingClientRect().left + pn.offsetWidth - (document.documentElement.clientWidth - gut);
  pn.style.left = over > 0 ? -over + 'px' : '0px';
}
addEventListener('resize', placePicker);
function setPicker(open, focusBtn) {
  if (!!state.fpOpen === open) return;
  state.fpOpen = open;
  if (!open) state.newFolder = false;
  renderChips();
  if (open && !state.newFolder) ($('#fpPanel .fp-row.on .fp-item') || $('#fpPanel .fp-item'))?.focus({ preventScroll: true });
  if (!open && focusBtn) $('#fpBtn')?.focus();
}
$('#chips').addEventListener('click', e => {
  if (e.target.closest('#fpBtn')) return setPicker(!state.fpOpen);
  if (e.target.closest('[data-new-folder]')) { state.newFolder = true; renderChips(); return; }
  const eye = e.target.closest('[data-eye]');
  if (eye) {
    const v = eye.dataset.eye;
    if (v === 'root') ops.patchSelf({ rootHidden: !me().rootHidden }).then(okk => okk && toast(me().rootHidden ? 'Задачи без папки скрыты от других' : 'Задачи без папки видны другим'));
    else { const f = folder(v); ops.patchFolder(v, { hidden: !f.hidden }).then(okk => okk && toast(f.hidden ? `«${f.name}» скрыта от всех` : `«${f.name}» видна другим`)); }
    return;
  }
  const it = e.target.closest('[data-pick]'); if (!it) return;
  const v = it.dataset.pick, info = cur();
  if (info.kind === 'group') { state.who = v; state.newAssignee = undefined; } else state.folder = v;
  state.editing = null; state.tapId = null; state.fpOpen = false; state.newFolder = false;
  render();
  $('#fpBtn')?.focus({ preventScroll: true });
});
$('#chips').addEventListener('keydown', e => {
  if (e.target.id === 'folderName' && e.key === 'Escape') { e.preventDefault(); state.newFolder = false; renderChips(); $('[data-new-folder]')?.focus(); return; }
  if (!state.fpOpen) { if (e.target.id === 'fpBtn' && e.key === 'ArrowDown') { e.preventDefault(); setPicker(true); } return; }
  if (e.key === 'Escape') { e.preventDefault(); setPicker(false, true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = $$('#fpPanel .fp-item, #fpPanel .fp-add'), i = items.indexOf(document.activeElement);
    e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
// Клик или касание мимо списка — закрыть.
document.addEventListener('pointerdown', e => { if (state.fpOpen && !e.target.closest('#chips') && !e.target.closest('#ctx')) setPicker(false); });
function createFolder(name) {
  name = name.trim();
  state.newFolder = false;
  if (!name) { renderChips(); return; }
  if (userFolders(state.me).some(f => f.name.toLowerCase() === name.toLowerCase())) { toast('Папка с таким названием уже есть'); renderChips(); return; }
  const f = { id: newId(), ownerId: state.me, name, hidden: false, kind: 'user', createdAt: Date.now() };
  state.folder = f.id; state.fpOpen = false;
  ops.addFolder(f).then(okk => okk && toast(`Папка «${name}» создана`));
}
$('#chips').addEventListener('submit', e => { if (e.target.id !== 'folderForm') return; e.preventDefault(); createFolder($('#folderName').value); });

$('#viewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b || b.dataset.view === state.view) return;
  state.view = b.dataset.view; state.editing = null; state.tapId = null;
  render();
});
$('#viewSeg').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); state.view = state.view === 'done' ? 'active' : 'done'; render(); $('#viewSeg .seg-b.on').focus();
});
/* ---------- новая задача: куда и кому ---------- */
// Исполнители для задачи группы — её участники; в личном пространстве исполнитель всегда владелец.
function assigneeItems(gid, current) {
  const tasks = spaceTasks({ kind: 'group', id: gid });
  const n = uid => { const c = activeCount(tasks.filter(t => t.assigneeId === uid)); return c ? `<span class="m-cnt" title="Активных задач">${c}</span>` : ''; };
  return groupMembers(gid).map(u => itemHtml(u.id, `${avatar(u)}<span class="nm">${u.id === state.me ? 'Себе' : esc(u.name)}</span>${n(u.id)}`, u.id === current)).join('')
    + itemHtml('none', `<span class="avatar" aria-hidden="true">–</span><span class="nm">Без исполнителя</span>`, !current);
}
function defaultAssignee(info = cur()) {
  if (info.kind !== 'group') return state.me;
  if (state.who !== 'all') return state.who;
  return isMember(info.id) ? state.me : null;
}
function renderComposerAssign() {
  const info = cur(), slot = $('#nAssignSlot');
  if (info.kind !== 'group') { slot.innerHTML = ''; slot.hidden = true; return; }
  slot.hidden = false;
  if (state.newAssignee !== null && !groupMembers(info.id).some(u => u.id === state.newAssignee)) state.newAssignee = defaultAssignee(info);
  const a = user(state.newAssignee);
  slot.innerHTML = menuHtml({ kind: 'new', cls: 'av-btn', btn: `${a ? avatar(a) : '<span class="avatar" aria-hidden="true">–</span>'}${icon('down', 'chev')}`,
    label: `Кому: ${!a ? 'без исполнителя' : a.id === state.me ? 'себе' : a.name}`, items: assigneeItems(info.id, state.newAssignee) });
}
// Новая задача — в текущем пространстве (и в выбранной папке).
function newTaskPlace() {
  const info = cur();
  if (info.kind === 'group') return { groupId: info.id, ownerId: null, folderId: null, assigneeId: state.newAssignee ?? null };
  const f = state.folder !== 'all' && state.folder !== 'root' ? state.folder : null;
  return { groupId: null, ownerId: state.me, folderId: f, assigneeId: state.me };
}
