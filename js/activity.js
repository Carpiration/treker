'use strict';
/* ---------- уведомления, архив, журнал, перенос задач ----------
   Страницы открываются в окне настроек (openPage). Журнал и уведомления пишет база (триггеры),
   приложение только показывает их. */
const ARCHIVE_DAYS = 30;
const DAY = 86400000;
const nick = id => id === state.me ? 'Вы' : user(id)?.name || 'Кто-то';
const plain = id => id === state.me ? 'вы' : user(id)?.name || '—';
const quote = s => `«${esc(s)}»`;
const unread = () => state.db.notes.filter(n => !n.readAt).length;
const fmtDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  return diff === 0 ? 'Сегодня' : diff === 1 ? 'Вчера' : fmtDay.format(d);
}
// Где лежит задача: группа или личное пространство (и папка, если её видно).
function placeText(groupId, ownerId, folderId) {
  if (groupId) return group(groupId) ? `группа ${quote(group(groupId).name)}` : 'группа';
  if (!ownerId) return '';
  const f = folderId && folder(folderId);
  const who = ownerId === state.me ? 'Мои задачи' : `личные ${esc(user(ownerId)?.name || '—')}`;
  return f ? `${who} → ${quote(f.name)}` : who;
}

/* ---------- колокольчик ---------- */
function renderBell() {
  const n = unread(), b = $('#bellBtn');
  b.querySelector('.bell-n').textContent = n > 99 ? '99+' : n || '';
  b.classList.toggle('has-n', n > 0);
  b.setAttribute('aria-label', n ? `Уведомления: ${n} новых` : 'Уведомления');
  // Число на значке установленного приложения (где браузер это умеет).
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
$('#bellBtn').addEventListener('click', () => openPage('notes'));

/* ---------- уведомления ---------- */
function noteText(n) {
  const a = esc(nick(n.actorId)), d = n.data;
  // Папка целиком: в title — её название, в data.count — сколько задач.
  if (d.folder) {
    const f = `папку ${quote(n.title)}`, c = d.count != null ? ` (задач: ${d.count})` : '';
    switch (n.kind) {
      case 'moved': return `${a} передал(а) вам ${f}${c}`;
      case 'transfer_request': return d.answer === 'accepted' ? `Вы приняли ${f} от ${a}` : d.answer === 'declined' ? `Вы отклонили ${f} от ${a}`
        : d.answer === 'cancelled' ? `${a} отменил(а) передачу папки` : `${a} хочет передать вам ${f}${c}`;
      case 'transfer_accepted': return `${a} принял(а) вашу ${f}`;
      case 'transfer_declined': return `${a} отклонил(а) ${f} — она осталась у вас`;
    }
  }
  switch (n.kind) {
    case 'assigned': return `${a} назначил(а) вам задачу`;
    case 'status': return `${a}: статус → ${esc(statusOf(d.to).label)}`;
    case 'deleted': return `${a} удалил(а) вашу задачу`;
    case 'restored': return `${a} восстановил(а) вашу задачу`;
    case 'moved': return `${a} перенёс(ла) вашу задачу${d.to_group || d.to_folder ? ` в ${placeText(d.to_group, d.to_group ? null : state.me, d.to_folder)}` : ''}`;
    case 'transfer_request': return d.answer === 'accepted' ? `Вы приняли задачу от ${a}` : d.answer === 'declined' ? `Вы отклонили задачу от ${a}`
      : d.answer === 'cancelled' ? `${a} отменил(а) передачу` : `${a} хочет передать вам задачу`;
    case 'transfer_accepted': return `${a} принял(а) вашу задачу`;
    case 'transfer_declined': return `${a} отклонил(а) передачу — задача осталась у вас`;
    case 'transfer_cancelled': return `${a} отменил(а) передачу`;
    case 'purge_soon': return 'Завтра задача удалится из архива навсегда';
    default: return 'Уведомление';
  }
}
const NOTE_ICONS = { assigned: 'user', status: 'check', deleted: 'trash', restored: 'undo', moved: 'move', transfer_request: 'move',
  transfer_accepted: 'check', transfer_declined: 'x', transfer_cancelled: 'x', purge_soon: 'clock' };
function buildNotesPage() {
  const notes = state.db.notes;
  let html = '', day = '';
  for (const n of notes) {
    const dl = dayLabel(n.createdAt);
    if (dl !== day) { day = dl; html += `<div class="day-h">${dl}</div>`; }
    const tr = n.kind === 'transfer_request' && !n.data.answer
      && [...state.db.transfers, ...state.db.ftransfers].some(x => x.id === n.transferId && x.status === 'pending');
    const open = n.taskId && state.db.tasks.some(t => t.id === n.taskId && !t.deletedAt);
    html += `<div class="ntf${!n.readAt || state.freshNotes?.has(n.id) ? ' new' : ''}">
      <span class="ntf-ic">${icon(NOTE_ICONS[n.kind] || 'bell')}</span>
      <div class="ntf-txt"><b>${noteText(n)}</b>
        ${n.title && !n.data.folder ? `<span class="ntf-t">${open ? `<button type="button" class="link" data-goto="${n.taskId}">${esc(n.title)}</button>` : esc(n.title)}</span>` : ''}
        <span class="hint">${fmtTime.format(n.createdAt)}${n.kind === 'purge_soon' ? ' · восстановить можно в «Архиве»' : ''}</span>
        ${tr ? `<div class="row-actions"><button class="btn primary sm" type="button" data-tr-yes="${n.transferId}">Принять</button>
          <button class="btn ghost sm" type="button" data-tr-no="${n.transferId}">Отклонить</button></div>` : ''}
      </div></div>`;
  }
  const read = notes.some(n => n.readAt);
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Уведомления">
    ${pushCardHtml()}
    ${notes.length ? `<div class="ntfs">${html}</div>` : `<div class="empty">${icon('bell')}<span>Уведомлений нет. Здесь появится, когда кто-то назначит вам задачу, сменит её статус или передаст задачу.</span></div>`}
    ${read ? `<button class="btn ghost sm" type="button" id="clearNotes">Убрать прочитанные</button>` : ''}
  </section>`;
}
// Открыли список — новые помечаются прочитанными (подсветка остаётся до закрытия окна).
function afterNotesOpen() {
  if (unread()) ops.markRead().then(renderBell);
  pushRefresh().then(refreshNotesPush);
}

async function answerTransfer(id, accept, btn) {
  const isFolder = state.db.ftransfers.some(x => x.id === id);
  btnBusy(btn, true, accept ? 'Принимаем…' : 'Отклоняем…');
  try { await backend.rpc('respond_transfer', { p_transfer: id, p_accept: accept }); await backend.reload(); }
  catch (e) { btnBusy(btn, false); toast(errText(e)); return; }
  render();
  toast(!accept ? 'Передача отклонена' : isFolder ? 'Папка принята — она в «Моих задачах»' : 'Задача принята — она в папке «Переданные»');
}
async function cancelTransfer(id, btn) {
  btnBusy(btn, true, 'Отменяем…');
  try { await backend.rpc('cancel_transfer', { p_transfer: id }); await backend.reload(); }
  catch (e) { btnBusy(btn, false); toast(errText(e)); return; }
  render(); toast('Передача отменена');
}
// Перейти к задаче: открыть её пространство, прокрутить и подсветить.
function gotoTask(id) {
  const t = state.db.tasks.find(x => x.id === id && !x.deletedAt); if (!t) return;
  closeDlg($('#settings'));
  state.space = t.groupId ? `g:${t.groupId}` : t.ownerId === state.me ? 'me' : `u:${t.ownerId}`;
  state.folder = 'all'; state.who = 'all'; state.tapId = id;
  render({ flip: false });
  const el = $(`#list [data-task="${id}"]`);
  if (el) { el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
}

/* ---------- архив ---------- */
function buildArchivePage() {
  const list = state.db.tasks.filter(t => t.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  const rows = list.map(t => {
    const left = Math.max(0, Math.ceil((t.deletedAt + ARCHIVE_DAYS * DAY - Date.now()) / DAY));
    const confirm = state.confirmDel === t.id;
    return `<div class="arc">
      <div class="arc-txt"><b>${esc(t.title)}</b>
        <span class="hint">${placeText(t.groupId, t.ownerId, t.folderId)} · удалил(а) ${esc(plain(t.deletedBy))}, ${when(t.deletedAt)}</span>
        <span class="arc-left${left <= 1 ? ' soon' : ''}">${left <= 1 ? 'Удалится в течение суток' : `Удалится через ${left} дн.`}</span></div>
      <div class="arc-act">
        <button class="btn sm" type="button" data-restore="${t.id}">${icon('undo')}Восстановить</button>
        <button class="btn ghost sm danger" type="button" data-purge="${t.id}">${confirm ? 'Точно навсегда?' : 'Удалить навсегда'}</button>
      </div></div>`;
  }).join('');
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Архив">
    <p class="hint">Удалённые задачи хранятся ${ARCHIVE_DAYS} дней, затем стираются. За сутки до этого придёт уведомление.
      ${isAdmin() ? 'Вы видите все удалённые задачи (кроме скрытых папок).' : 'Здесь задачи, которые удалили вы.'}</p>
    ${rows ? `<div class="arc-list">${rows}</div>` : `<div class="empty">${icon('trash')}<span>Архив пуст.</span></div>`}
  </section>`;
}

/* ---------- журнал ---------- */
const EVENT_KINDS = [
  ['created', 'Создание'], ['status', 'Статус'], ['assigned', 'Исполнитель'], ['edited', 'Правка'], ['moved', 'Перенос'],
  ['deleted', 'Удаление'], ['restored', 'Восстановление'], ['transfer', 'Передача админу'],
];
const TRANSFER_KINDS = ['transfer_requested', 'transfer_accepted', 'transfer_declined', 'transfer_cancelled'];
let journal = { events: [], filters: { actor: '', kind: '', where: '' }, more: false, loading: false };
function eventText(e) {
  // В журнале — всегда ники (и свой тоже): «Вы перенёс(ла)» читается плохо.
  const d = e.data, a = `<b>${esc(user(e.actorId)?.name || 'Кто-то')}</b>`;
  const name = id => esc(user(id)?.name || '—');
  switch (e.kind) {
    case 'created': return `${a} создал(а) ${quote(e.title)}${d.assignee && d.assignee !== e.actorId ? ` для ${name(d.assignee)}` : ''}`;
    case 'status': return d.to === 'doing' && d.from === 'todo' ? `${a} взял(а) в работу ${quote(e.title)}`
      : d.to === 'done' ? `${a} завершил(а) ${quote(e.title)}` : `${a}: ${quote(e.title)} — ${esc(statusOf(d.from).label)} → ${esc(statusOf(d.to).label)}`;
    case 'assigned': return !d.to ? `${a} снял(а) исполнителя с ${quote(e.title)}` : d.to === e.actorId ? `${a} взял(а) себе ${quote(e.title)}`
      : `${a} назначил(а) ${quote(e.title)} на ${name(d.to)}`;
    case 'edited': return d.old_title ? `${a} переименовал(а) ${quote(d.old_title)} → ${quote(e.title)}` : `${a} изменил(а) описание ${quote(e.title)}`;
    case 'moved': {
      const f = d.to_folder && folder(d.to_folder);
      const to = d.to_group ? placeText(d.to_group) : d.to_owner === e.actorId ? `свои задачи${f ? ` → ${quote(f.name)}` : ''}`
        : `задачи ${name(d.to_owner)}${f ? ` → ${quote(f.name)}` : ''}`;
      return `${a} перенёс(ла) ${quote(e.title)} в ${to}`;
    }
    case 'deleted': return `${a} удалил(а) ${quote(e.title)}`;
    case 'restored': return `${a} восстановил(а) ${quote(e.title)}`;
    case 'transfer_requested': return `${a} предложил(а) передать ${quote(e.title)} → ${name(d.to)}`;
    case 'transfer_accepted': return `${a} принял(а) ${quote(e.title)} от ${name(d.from)}`;
    case 'transfer_declined': return `${a} отклонил(а) ${quote(e.title)} от ${name(d.from)}`;
    case 'transfer_cancelled': return `${a} отменил(а) передачу ${quote(e.title)}`;
    default: return `${a}: ${quote(e.title)}`;
  }
}
function journalQuery(before) {
  const f = journal.filters, q = { before };
  if (f.actor) q.actor = f.actor;
  if (f.kind) q.kind = f.kind === 'transfer' ? TRANSFER_KINDS : f.kind;
  if (f.where.startsWith('g:')) q.group = f.where.slice(2);
  else if (f.where.startsWith('u:')) q.owner = f.where.slice(2);
  return q;
}
async function loadJournal(more = false) {
  if (journal.loading) return;
  journal.loading = true;
  if (!more) { journal.events = []; renderJournal(); }
  try {
    const before = more ? journal.events.at(-1)?.id : undefined;
    const list = await backend.loadEvents(journalQuery(before));
    journal.events = journal.events.concat(list);
    journal.more = list.length === 100;
  } catch (e) { toast(errText(e, 'Нет связи с сервером')); }
  journal.loading = false;
  if (state.page === 'journal' && $('#settings').open) renderJournal();
}
function buildJournalPage() {
  const f = journal.filters;
  const people = [...state.db.users].filter(u => u.active || journal.events.some(e => e.actorId === u.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Журнал">
    <div class="j-filters">
      <label class="field"><span class="sr-only">Кто</span><select class="input" id="jActor">${opt('', 'Все люди', f.actor)}${people.map(u => opt(u.id, u.id === state.me ? `${u.name} (вы)` : u.name, f.actor)).join('')}</select></label>
      <label class="field"><span class="sr-only">Действие</span><select class="input" id="jKind">${opt('', 'Все действия', f.kind)}${EVENT_KINDS.map(([v, l]) => opt(v, l, f.kind)).join('')}</select></label>
      <label class="field"><span class="sr-only">Где</span><select class="input" id="jWhere">${opt('', 'Везде', f.where)}${opt(`u:${state.me}`, 'Мои задачи', f.where)}
        ${visibleGroups().map(g => opt(`g:${g.id}`, g.name, f.where)).join('')}
        ${activeUsers().filter(u => u.id !== state.me).map(u => opt(`u:${u.id}`, `Личные: ${u.name}`, f.where)).join('')}</select></label>
    </div>
    <div id="jList" class="j-list" aria-live="polite"></div>
  </section>`;
  renderJournal();
}
function renderJournal() {
  const box = $('#jList'); if (!box) return;
  if (!journal.events.length) {
    box.innerHTML = journal.loading ? '<p class="empty-s">Загрузка…</p>' : `<div class="empty">${icon('list')}<span>Записей нет${Object.values(journal.filters).some(Boolean) ? ' — попробуйте другой фильтр' : ''}.</span></div>`;
    return;
  }
  let html = '', day = '';
  for (const e of journal.events) {
    const dl = dayLabel(e.createdAt);
    if (dl !== day) { day = dl; html += `<div class="day-h">${dl}</div>`; }
    const where = placeText(e.groupId, e.ownerId, e.folderId);
    html += `<div class="ev ev-${e.kind.startsWith('transfer') ? 'transfer' : e.kind}"><span class="ev-time">${fmtTime.format(e.createdAt)}</span>
      <span class="ev-txt">${eventText(e)}${where && !journal.filters.where && e.kind !== 'moved' ? `<span class="hint"> · ${where}</span>` : ''}</span></div>`;
  }
  box.innerHTML = html + (journal.more ? `<button class="btn ghost sm block" type="button" id="jMore">${journal.loading ? 'Загрузка…' : 'Показать ещё'}</button>` : '');
}

/* ---------- перенос задачи ---------- */
function openMove(taskId) { state.moveTask = taskId; state.moveUser = null; openPage('move'); }
function buildMovePage() {
  const t = state.db.tasks.find(x => x.id === state.moveTask);
  if (!t || !taskEditable(t)) { $('#stBody').innerHTML = '<p class="empty-s">Задачу уже нельзя перенести.</p>'; return; }
  const here = (g, o, f) => (t.groupId || null) === (g || null) && (t.ownerId || null) === (o || null) && (t.folderId || null) === (f || null);
  const opt = (attrs, ic, label, sub = '', off = false) =>
    `<button type="button" class="mv"${attrs}${off ? ' disabled' : ''}>${ic}<span class="mv-txt"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</span>${off ? '<span class="tag">здесь</span>' : icon('down', 'mv-go')}</button>`;
  let body;
  if (state.moveUser) {
    const u = user(state.moveUser), adminT = u.role === 'admin';
    const folders = userFolders(u.id).filter(f => !f.hidden && f.kind !== 'transfers');
    body = `<button type="button" class="btn ghost sm" data-mv-back>${icon('down', 'back-ic')}Назад</button>
      <p class="hint">${adminT ? `${esc(u.name)} — администратор: задача перейдёт к нему после его согласия.` : `Задача сразу перейдёт к ${esc(u.name)}.`} Выберите папку:</p>
      <div class="mv-list">${opt(` data-mv-owner="${u.id}"`, icon('inbox'), '«Переданные»', 'По умолчанию')}
        ${folders.map(f => opt(` data-mv-owner="${u.id}" data-mv-folder="${f.id}"`, icon('folder'), quote(f.name))).join('')}</div>`;
  } else {
    const mine = userFolders(state.me);
    const groups = visibleGroups().filter(g => isAdmin() || isMember(g.id));
    const people = activeUsers().filter(u => u.id !== state.me).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    body = `<p class="t-quote">${quote(t.title)}</p>
      <h4 class="mv-h">Мои задачи</h4><div class="mv-list">
        ${opt(` data-mv-owner="${state.me}"`, icon('user'), 'Без папки', '', here(null, state.me, null))}
        ${mine.map(f => opt(` data-mv-owner="${state.me}" data-mv-folder="${f.id}"`, icon(f.hidden ? 'eye-off' : 'folder'), quote(f.name), '', here(null, state.me, f.id))).join('')}</div>
      ${groups.length ? `<h4 class="mv-h">В группу</h4><div class="mv-list">${groups.map(g => opt(` data-mv-group="${g.id}"`, icon('grid'), esc(g.name), '', here(g.id, null, null))).join('')}</div>` : ''}
      ${people.length ? `<h4 class="mv-h">Передать человеку</h4><div class="mv-list">${people.map(u =>
        opt(` data-mv-user="${u.id}"`, avatar(u), esc(u.name), u.role === 'admin' ? 'Администратор — нужно его согласие' : 'В его «Мои задачи»')).join('')}</div>` : ''}`;
  }
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Перенести задачу">${body}</section>`;
}
async function doMove(btn, { group: g = null, owner: o = null, folder: f = null }) {
  const id = state.moveTask;
  $$('.mv').forEach(b => { b.disabled = true; });
  let res;
  try { res = await backend.rpc('move_task', { p_task: id, p_group: g, p_owner: o, p_folder: f }); await backend.reload(); }
  catch (e) { toast(errText(e)); buildMovePage(); return; }
  closeDlg($('#settings'));
  state.tapId = null;
  render();
  const where = g ? `группу «${group(g)?.name}»` : o === state.me ? (f ? `папку «${folder(f)?.name}»` : '«Мои задачи»') : user(o)?.name;
  toast(res === 'requested' ? `Запрос отправлен: ${user(o)?.name} должен согласиться` : `Перенесено: ${where}`);
}

/* ---------- передать папку целиком ---------- */
function openGiveFolder(fid) { state.giveFolder = fid; openPage('give'); }
function buildGivePage() {
  const f = folder(state.giveFolder);
  if (!f || f.ownerId !== state.me) { $('#stBody').innerHTML = '<p class="empty-s">Папку уже нельзя передать.</p>'; return; }
  const n = state.db.tasks.filter(t => t.folderId === f.id && !t.deletedAt).length;
  const people = activeUsers().filter(u => u.id !== state.me).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Передать папку">
    <p class="t-quote">«${esc(f.name)}» · задач: ${n}</p>
    <p class="hint">Папка со всеми задачами перейдёт к человеку целиком и исчезнет у вас. Администратору — после его согласия.</p>
    ${people.length ? `<div class="mv-list">${people.map(u => `<button type="button" class="mv" data-give="${u.id}">${avatar(u)}
      <span class="mv-txt"><b>${esc(u.name)}</b><span>${u.role === 'admin' ? 'Администратор — нужно его согласие' : 'Сразу в его «Мои задачи»'}</span></span>${icon('down', 'mv-go')}</button>`).join('')}</div>`
      : '<p class="empty-s">Больше никого нет.</p>'}
  </section>`;
}
async function giveFolder(to) {
  const f = folder(state.giveFolder), u = user(to);
  $$('[data-give]').forEach(b => { b.disabled = true; });
  let res;
  try { res = await backend.rpc('transfer_folder', { p_folder: f.id, p_to: to }); await backend.reload(); }
  catch (e) { toast(errText(e)); buildGivePage(); return; }
  closeDlg($('#settings'));
  if (state.folder === f.id && res === 'moved') state.folder = 'all';
  render();
  toast(res === 'requested' ? `Запрос отправлен: ${u.name} должен согласиться` : `Папка «${f.name}» передана: ${u.name}`);
}

/* ---------- обработчики страниц ---------- */
$('#stBody').addEventListener('click', e => {
  const go = e.target.closest('[data-goto]'); if (go) return gotoTask(go.dataset.goto);
  const yes = e.target.closest('[data-tr-yes]'); if (yes) return answerTransfer(yes.dataset.trYes, true, yes);
  const no = e.target.closest('[data-tr-no]'); if (no) return answerTransfer(no.dataset.trNo, false, no);
  if (e.target.closest('#clearNotes')) return ops.clearRead().then(() => { buildSettings(); renderBell(); });
  const rs = e.target.closest('[data-restore]');
  if (rs) { const t = state.db.tasks.find(x => x.id === rs.dataset.restore); ops.restoreTask(rs.dataset.restore).then(okk => okk && toast(`Восстановлено: «${t.title}»`)); return; }
  const pu = e.target.closest('[data-purge]');
  if (pu) {
    const id = pu.dataset.purge;
    if (state.confirmDel !== id) { state.confirmDel = id; buildSettings(); $(`[data-purge="${id}"]`)?.focus(); return; }
    state.confirmDel = null; ops.purgeTask(id).then(okk => okk && toast('Удалено навсегда'));
    return;
  }
  if (e.target.closest('#jMore')) return loadJournal(true);
  const gv = e.target.closest('[data-give]'); if (gv && !gv.disabled) return giveFolder(gv.dataset.give);
  if (e.target.closest('[data-mv-back]')) { state.moveUser = null; buildMovePage(); return; }
  const mu = e.target.closest('[data-mv-user]'); if (mu) { state.moveUser = mu.dataset.mvUser; buildMovePage(); $('.mv')?.focus(); return; }
  const mv = e.target.closest('.mv:not(:disabled)');
  if (mv) doMove(mv, { group: mv.dataset.mvGroup || null, owner: mv.dataset.mvOwner || null, folder: mv.dataset.mvFolder || null });
});
$('#stBody').addEventListener('change', e => {
  const k = { jActor: 'actor', jKind: 'kind', jWhere: 'where' }[e.target.id];
  if (k) { journal.filters[k] = e.target.value; loadJournal(); }
});
