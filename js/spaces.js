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
const taskEditable = t => t.groupId ? isAdmin() || isMember(t.groupId) : t.ownerId === state.me;

// Задачи пространства без учёта фильтра — для счётчиков.
function spaceTasks(info = cur()) {
  return state.db.tasks.filter(t => info.kind === 'group' ? t.groupId === info.id : !t.groupId && t.ownerId === info.id);
}
function filterTasks(list, info = cur()) {
  if (info.kind === 'group') return state.who === 'all' ? list : list.filter(t => t.assigneeId === state.who);
  if (state.folder === 'all') return list;
  return list.filter(t => (t.folderId || 'root') === state.folder);
}
function visibleTasks() {
  return filterTasks(spaceTasks())
    // Стабильный порядок: активные по дате создания, готовые — вниз. Смена «Не начато» ↔ «В процессе» строку не двигает.
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.status === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : b.createdAt - a.createdAt));
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
  const active = activeCount(visibleTasks());
  $('#count').innerHTML = active ? `${active}<span class="sr-only"> активных</span>` : '';
  $('#listTitle').textContent = label;
  const waiting = isAdmin() && state.db.users.some(u => u.pending && !u.active);
  $('#settingsBtn').classList.toggle('has-dot', waiting);
  $('#settingsBtn').setAttribute('aria-label', waiting ? 'Меню — есть заявки на вход' : 'Меню');
  // Чужие личные задачи — только просмотр: поля новой задачи нет.
  const w = canWrite(info);
  $('#newForm').hidden = !w;
  $('#nTitleErr').hidden ||= !w;
  $('#app').classList.toggle('readonly', !w);
}

/* ---------- полоса фильтров: папки или исполнители ---------- */
function chipHtml(value, html, on, extra = '') {
  return `<button type="button" class="chip${on ? ' on' : ''}" data-chip="${value}" aria-pressed="${on}" ${extra}>${html}</button>`;
}
function renderChips() {
  const info = cur(), all = spaceTasks(info), box = $('#chips');
  const cnt = list => { const c = activeCount(list); return c ? `<span class="c-n">${c}</span>` : ''; };
  let html = '';
  if (info.kind === 'group') {
    const members = groupMembers(info.id);
    html = chipHtml('all', `Все${cnt(all)}`, state.who === 'all')
      + members.map(u => chipHtml(u.id, `${avatar(u)}<span class="nm">${u.id === state.me ? 'Мои' : esc(u.name)}</span>${cnt(all.filter(t => t.assigneeId === u.id))}`, state.who === u.id)).join('');
  } else {
    const own = info.kind === 'me';
    const folders = userFolders(info.id);
    const showRoot = own || !info.user.rootHidden;
    if (folders.length || own) {
      html = chipHtml('all', `Все${cnt(all)}`, state.folder === 'all')
        + (showRoot && folders.length ? chipHtml('root', `${own && me().rootHidden ? icon('eye-off', 'c-ic') : ''}Без папки${cnt(all.filter(t => !t.folderId))}`, state.folder === 'root') : '')
        + folders.map(f => chipHtml(f.id, `${f.hidden ? icon('eye-off', 'c-ic') : icon('folder', 'c-ic')}<span class="nm">${esc(f.name)}</span>${cnt(all.filter(t => t.folderId === f.id))}`, state.folder === f.id,
          f.hidden ? 'title="Скрыта от других"' : '')).join('')
        + (own ? (state.newFolder
          ? `<form class="chip-form" id="folderForm" novalidate><input class="chip-input" id="folderName" maxlength="40" placeholder="Название папки" aria-label="Название новой папки" autocomplete="off"></form>`
          : `<button type="button" class="chip add" data-new-folder aria-label="Новая папка" title="Новая папка">${icon('plus')}</button>`) : '');
    }
  }
  box.innerHTML = html;
  box.hidden = !html;
  if (state.newFolder) $('#folderName')?.focus();
}
$('#chips').addEventListener('click', e => {
  if (e.target.closest('[data-new-folder]')) { state.newFolder = true; renderChips(); return; }
  const c = e.target.closest('[data-chip]'); if (!c) return;
  const v = c.dataset.chip, info = cur();
  if (info.kind === 'group') { state.who = v; state.newAssignee = undefined; } else state.folder = v;
  state.editing = null; state.tapId = null;
  render();
  $(`[data-chip="${v}"]`)?.focus({ preventScroll: true });
});
function createFolder(name) {
  name = name.trim();
  state.newFolder = false;
  if (!name) { renderChips(); return; }
  if (userFolders(state.me).some(f => f.name.toLowerCase() === name.toLowerCase())) { toast('Папка с таким названием уже есть'); renderChips(); return; }
  const f = { id: newId(), ownerId: state.me, name, hidden: false, kind: 'user', createdAt: Date.now() };
  state.folder = f.id;
  ops.addFolder(f);
}
$('#chips').addEventListener('submit', e => { if (e.target.id !== 'folderForm') return; e.preventDefault(); createFolder($('#folderName').value); });
$('#chips').addEventListener('keydown', e => { if (e.target.id === 'folderName' && e.key === 'Escape') { e.preventDefault(); state.newFolder = false; renderChips(); $('[data-new-folder]')?.focus(); } });
$('#chips').addEventListener('focusout', e => { if (e.target.id === 'folderName' && state.newFolder) createFolder(e.target.value); });

/* ---------- новая задача: куда и кому ---------- */
// Исполнители для задачи группы — её участники; в личном пространстве исполнитель всегда владелец.
function assigneeItems(gid, current) {
  return groupMembers(gid).map(u => itemHtml(u.id, `${avatar(u)}<span class="nm">${u.id === state.me ? 'Себе' : esc(u.name)}</span>`, u.id === current)).join('')
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
