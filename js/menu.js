'use strict';
/* ---------- выпадающие списки: наведение, клик, касание, клавиатура ---------- */
let openMenu = null, menuOpenT = null, menuCloseT = null;
function menuHtml({ kind, id = kind, btn, label, items, cls = '', attrs = '', align = 'right' }) {
  return `<div class="menu${align === 'left' ? ' left' : ''}" data-menu="${kind}" data-id="${id}">
    <button type="button" class="menu-btn ${cls}" ${attrs} aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}">${btn}</button>
    <div class="menu-list" role="menu" hidden>${items}</div></div>`;
}
// Подпись раздела в списке (не выбирается).
const labelHtml = text => `<div class="menu-label" role="presentation">${esc(text)}</div>`;
function itemHtml(value, html, checked) {
  if (value === '-') return '<div class="menu-sep" role="separator"></div>';
  return `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${!!checked}" data-value="${value}">${html}${checked ? `<span class="ck">${icon('check')}</span>` : ''}</button>`;
}
function setMenu(m, open, by) {
  if (!m || !m.isConnected) { if (openMenu === m) openMenu = null; return; }
  const list = $('.menu-list', m), btn = $('.menu-btn', m);
  if (open) {
    clearTimeout(menuOpenT); clearTimeout(menuCloseT);
    if (openMenu && openMenu !== m) setMenu(openMenu, false);
    openMenu = m; m.dataset.by = by;
    if (!list.hidden) return;
    list.hidden = false; btn.setAttribute('aria-expanded', 'true');
    // Не помещается снизу — раскрываем вверх (но не под закреплённую шапку).
    m.classList.remove('up'); list.style.maxHeight = '';
    const b = btn.getBoundingClientRect(), h = list.getBoundingClientRect().height;
    const ceiling = m.closest('.top') ? 0 : $('#top').getBoundingClientRect().bottom;
    const below = innerHeight - b.bottom - 12, above = b.top - ceiling - 12;
    if (h > below && above > below) m.classList.add('up');
    const room = Math.max(below, above);
    if (h > room) list.style.maxHeight = `${Math.max(room, 120)}px`;
  } else {
    list.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (openMenu === m) {
      openMenu = null;
      // Пока список был открыт, пришли изменения с другого устройства — применяем сейчас.
      if (state.pending) { state.pending = false; render(); }
    }
  }
}
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const m = e.target.closest('[data-menu]');
  if (m) {
    if (openMenu === m) clearTimeout(menuCloseT);
    else { clearTimeout(menuOpenT); menuOpenT = setTimeout(() => setMenu(m, true, 'hover'), 110); }
  }
  hoverTask(e.target.closest('[data-task]')?.dataset.task || null);
});
document.addEventListener('pointerout', e => {
  if (e.pointerType !== 'mouse') return;
  const m = e.target.closest('[data-menu]');
  if (m && !m.contains(e.relatedTarget)) {
    clearTimeout(menuOpenT);
    if (openMenu === m && m.dataset.by === 'hover') { clearTimeout(menuCloseT); menuCloseT = setTimeout(() => setMenu(m, false), 180); }
  }
  if (!e.relatedTarget) hoverTask(null);
});
let lastPointer = 'mouse';
document.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);
document.addEventListener('click', e => {
  const btn = e.target.closest('.menu-btn');
  if (btn) {
    const m = btn.closest('[data-menu]');
    clearTimeout(menuOpenT);
    // Открытый наведением список клик закрепляет; повторный клик закрывает.
    if (openMenu !== m) setMenu(m, true, 'click');
    else if (m.dataset.by === 'hover') m.dataset.by = 'click';
    else setMenu(m, false);
    return;
  }
  // Пункты меню задачи (#ctx) обрабатывает свой обработчик.
  const item = e.target.closest('[data-menu] .menu-item');
  if (item) { const m = item.closest('[data-menu]'); setMenu(m, false); onMenuPick(m.dataset.menu, m.dataset.id, item.dataset.value); return; }
  if (openMenu && !openMenu.contains(e.target)) setMenu(openMenu, false);
  if (state.tapId && lastPointer === 'touch' && e.target.isConnected && !e.target.closest('[data-task]')) { state.tapId = null; applyPeek(); }
});
document.addEventListener('keydown', e => {
  const m = e.target.closest?.('[data-menu]'); if (!m) return;
  const list = $('.menu-list', m), items = $$('.menu-item', m), i = items.indexOf(document.activeElement);
  if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); setMenu(m, false); $('.menu-btn', m).focus(); }
  else if (e.key === 'Tab' && !list.hidden) setMenu(m, false);
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    if (list.hidden) setMenu(m, true, 'kbd');
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (i < 0) next = e.key === 'ArrowUp' ? items.length - 1 : Math.max(0, items.findIndex(x => x.getAttribute('aria-checked') === 'true'));
    else next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
});
document.addEventListener('focusout', e => {
  const m = e.target.closest?.('[data-menu]');
  if (m && e.relatedTarget && !m.contains(e.relatedTarget) && m.dataset.by !== 'hover') setMenu(m, false);
});

function onMenuPick(kind, id, value) {
  if (kind === 'new') { state.newAssignee = value === 'none' ? null : value; renderComposerAssign(); $('#nTitle').focus(); }
  else if (kind === 'space') setSpace(value);
  else if (kind === 'assign') transfer(id, value);
  else if (kind === 'status') setStatus(id, value);
}

/* ---------- подробности: наведение, фокус с клавиатуры, касание ---------- */
let peekOpenT = null, peekCloseT = null, underPointer = null;
function hoverTask(id) {
  if (id === underPointer) return;
  underPointer = id;
  clearTimeout(peekOpenT);
  if (id && id === state.hoverId) { clearTimeout(peekCloseT); return; }
  // Закрываем не сразу: курсор, ненадолго соскочивший со строки, не «схлопывает» её.
  if (state.hoverId) { clearTimeout(peekCloseT); peekCloseT = setTimeout(() => { state.hoverId = null; applyPeek(); }, 220); }
  // Задержка перед раскрытием: проводя курсором по списку, не раскрываем каждую строку.
  if (id) peekOpenT = setTimeout(() => { clearTimeout(peekCloseT); state.hoverId = id; applyPeek(); }, state.hoverId ? 260 : 320);
}
function openIds() { return new Set([state.hoverId, state.kbdId, state.tapId, state.editing].filter(Boolean)); }
function applyPeek() {
  const ids = openIds();
  $$('#list [data-task]').forEach(el => {
    const on = ids.has(el.dataset.task);
    if (el.classList.contains('open') === on) return;
    el.classList.toggle('open', on);
    $('.t-main', el)?.setAttribute('aria-expanded', String(on));
  });
}
document.addEventListener('focusin', e => {
  const t = e.target.closest('#list [data-task]');
  const id = t && e.target.matches(':focus-visible') ? t.dataset.task : null;
  if (id !== state.kbdId) { state.kbdId = id; applyPeek(); }
});

/* ---------- меню задачи: правая кнопка мыши, долгое нажатие, клавиша «Меню» / Shift+F10 ----------
   Статус, исполнитель, перенос, правка и удаление — даже если статусы и исполнители в строке скрыты. */
let ctxTask = null, pressT = null, pressAt = null, swallowClick = false;
function ctxItems(t) {
  const rw = taskEditable(t), tr = pendingTransfer(t.id), it = (act, html, v = '', cls = '', checked) =>
    `<button type="button" class="menu-item${cls}" role="${checked === undefined ? 'menuitem' : 'menuitemradio'}"${checked === undefined ? '' : ` aria-checked="${checked}"`} data-ctx="${act}" data-v="${v}">${html}${checked ? `<span class="ck">${icon('check')}</span>` : ''}</button>`;
  if (!rw) return it('open', `${icon('text')}Подробнее`) + (t.groupId || t.ownerId === state.me ? '' : `<div class="menu-label">Только просмотр</div>`);
  let h = it('edit', `${icon('edit')}Изменить`) + labelHtml('Статус')
    + STATUSES.map(s => it('status', `<span class="st-ic" data-s="${s.id}">${statusIcon(s.id)}</span>${s.label}`, s.id, '', t.status === s.id)).join('');
  if (taskPrio(t)) h += labelHtml('Важность')
    + it('prio', '<span class="pr-ic hi" aria-hidden="true"></span>Важно', 'hi', '', !!t.important)
    + it('prio', '<span class="pr-ic lo" aria-hidden="true"></span>Потом', 'lo', '', !t.important);
  if (t.groupId) {
    const members = groupMembers(t.groupId);
    h += labelHtml('Исполнитель') + members.map(u => it('assign', `${avatar(u)}<span class="nm">${u.id === state.me ? 'Себе' : esc(u.name)}</span>`, u.id, '', t.assigneeId === u.id)).join('')
      + it('assign', `<span class="avatar" aria-hidden="true">–</span>Без исполнителя`, 'none', '', !t.assigneeId);
  }
  h += '<div class="menu-sep" role="separator"></div>'
    + (tr ? it('cancel-tr', `${icon('x')}Отменить передачу`) : it('move', `${icon('move')}Перенести…`))
    + it('del', `${icon('trash')}Удалить`, '', ' danger');
  return h;
}
// Меню у точки (x, y): задачи или папки. onPick(действие, значение, кнопка) — что делать с выбранным пунктом.
let ctxPick = null, ctxAt = { x: 0, y: 0 };
function showCtx(html, x, y, byKey, onPick, label) {
  if (openMenu) setMenu(openMenu, false);
  closeAppMenu();
  ctxPick = onPick; ctxAt = { x, y };
  const m = $('#ctx');
  m.setAttribute('aria-label', label);
  m.innerHTML = html;
  m.hidden = false; ctxScrollY = scrollY; m.style.left = '0px'; m.style.top = '0px'; m.style.maxHeight = '';
  // Не вылезаем за край экрана: при нехватке места снизу — раскрываем вверх.
  // offsetWidth/Height — размеры без анимации появления; clientWidth — без полосы прокрутки.
  const r = { width: m.offsetWidth, height: m.offsetHeight }, pad = 8, vw = document.documentElement.clientWidth;
  const left = Math.min(Math.max(pad, x), vw - r.width - pad);
  let top = y;
  if (y + r.height > innerHeight - pad) top = Math.max(pad, y - r.height);
  if (top + r.height > innerHeight - pad) m.style.maxHeight = `${innerHeight - top - pad}px`;
  m.style.left = `${left}px`; m.style.top = `${top}px`;
  m.style.transformOrigin = `${x - left}px ${y >= top ? y - top : 0}px`;
  if (byKey || finePointer()) $('.menu-item', m)?.focus({ preventScroll: true });
}
function openCtx(id, x, y, byKey = false) {
  const t = state.db.tasks.find(v => v.id === id && !v.deletedAt); if (!t) return;
  showCtx(ctxItems(t), x, y, byKey, (act, v, b) => taskAction(id, act, v, b), 'Действия с задачей');
  ctxTask = id;
  $(`#list [data-task="${id}"]`)?.classList.add('ctx-on');
}
function taskAction(id, act, v, b) {
  if (act === 'edit') startEdit(id);
  else if (act === 'status') setStatus(id, v);
  else if (act === 'prio') setImportant(id, v === 'hi');
  else if (act === 'assign') transfer(id, v);
  else if (act === 'move') openMove(id);
  else if (act === 'cancel-tr') cancelTransfer(pendingTransfer(id)?.id, b);
  else if (act === 'del') removeTask(id);
  else if (act === 'open') { state.tapId = id; applyPeek(); }
}
// Меню папки: «Без папки» — только видимость; своя папка — переименовать, скрыть, передать целиком, удалить.
function openFolderCtx(fid, x, y, byKey = false) {
  const it = (act, html, cls = '') => `<button type="button" class="menu-item${cls}" role="menuitem" data-ctx="${act}">${html}</button>`;
  let html;
  if (fid === 'root') {
    const hid = me().rootHidden;
    html = labelHtml('Без папки') + it('hide', `${icon(hid ? 'eye' : 'eye-off')}${hid ? 'Показать другим' : 'Скрыть от других'}`) + prioItem(!!me().rootPrio);
  } else {
    const f = folder(fid); if (!f) return;
    const ft = pendingFolderTransfer(fid);
    html = labelHtml(f.name)
      + (f.kind === 'transfers' ? '' : it('rename', `${icon('edit')}Переименовать`))
      + it('hide', `${icon(f.hidden ? 'eye' : 'eye-off')}${f.hidden ? 'Показать другим' : 'Скрыть от других'}`)
      + prioItem(!!f.prio)
      + (ft ? it('cancel-ft', `${icon('x')}Отменить передачу (${esc(user(ft.toId)?.name || '—')})`) : it('give', `${icon('move')}Передать папку целиком…`))
      + (f.kind === 'transfers' ? '' : '<div class="menu-sep" role="separator"></div>' + it('del', `${icon('trash')}Удалить папку…`, ' danger'));
  }
  showCtx(html, x, y, byKey, (act, v, b) => folderAction(fid, act, b), 'Действия с папкой');
}
// Режим «Важно / Потом» у папки: переключатель с галочкой.
const prioItem = on => `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${on}" data-ctx="prio">${icon('flag')}Режим «Важно / Потом»${on ? `<span class="ck">${icon('check')}</span>` : ''}</button>`;
function toggleFolderPrio(fid) {
  const f = fid === 'root' ? null : folder(fid), on = !(f ? f.prio : me().rootPrio), name = f ? `«${f.name}»` : '«Без папки»';
  const done = okk => okk && toast(on ? (prioShown() ? `${name}: задачи делятся на «Важно» и «Потом»` : `${name}: режим включён, но у вас он скрыт во «Внешнем виде»`)
    : `${name}: режим «Важно / Потом» выключен`);
  (f ? ops.patchFolder(fid, { prio: on }) : ops.patchSelf({ rootPrio: on })).then(done);
}
// Подтверждение удаления — прямо в том же меню, на том же месте.
function confirmFolderDel(fid) {
  const f = folder(fid); if (!f) return;
  const n = state.db.tasks.filter(t => t.folderId === fid && !t.deletedAt).length;
  const it = (act, html, cls = '') => `<button type="button" class="menu-item${cls}" role="menuitem" data-ctx="${act}">${html}</button>`;
  const html = labelHtml(`Удалить «${f.name}»?`)
    + `<p class="menu-note">${n ? `Задачи (${n}) не удалятся — перейдут в «Без папки».` : 'Папка пустая.'}</p>`
    + it('del-yes', `${icon('trash')}Удалить папку`, ' danger') + it('del-no', `${icon('x')}Отмена`);
  showCtx(html, ctxAt.x, ctxAt.y, true, act => folderAction(fid, act), 'Удаление папки');
}
function deleteFolder(id) {
  const name = folder(id)?.name;
  if (state.folder === id) state.folder = 'all';
  return ops.removeFolder(id).then(okk => okk && toast(`Папка «${name}» удалена, задачи — в «Без папки»`));
}
function folderAction(fid, act, b) {
  if (act === 'del') return confirmFolderDel(fid);
  if (act === 'del-no') return;
  if (act === 'del-yes') return deleteFolder(fid);
  if (act === 'prio') return toggleFolderPrio(fid);
  if (act === 'hide') {
    if (fid === 'root') return ops.patchSelf({ rootHidden: !me().rootHidden }).then(okk => okk && toast(me().rootHidden ? 'Задачи без папки скрыты от других' : 'Задачи без папки видны другим'));
    const f = folder(fid);
    return ops.patchFolder(fid, { hidden: !f.hidden }).then(okk => okk && toast(f.hidden ? `«${f.name}» скрыта от всех` : `«${f.name}» видна другим`));
  }
  setPicker(false);
  if (act === 'rename') { openPage('folders'); const i = $(`#f-${fid}-name`); i?.focus(); i?.select(); }
  else if (act === 'give') openGiveFolder(fid);
  else if (act === 'cancel-ft') cancelTransfer(pendingFolderTransfer(fid)?.id, b);
}
function closeCtx(focusTask) {
  const m = $('#ctx'); if (m.hidden) return;
  m.hidden = true; ctxPick = null;
  $$('#list .ctx-on').forEach(el => el.classList.remove('ctx-on'));
  if (focusTask) $(`[data-main="${ctxTask}"]`)?.focus({ preventScroll: true });
  ctxTask = null;
}
const ctxOpen = () => !$('#ctx').hidden;
$('#ctx').addEventListener('click', e => {
  const b = e.target.closest('[data-ctx]'); if (!b) return;
  const pick = ctxPick, act = b.dataset.ctx;
  closeCtx(ctxTask && !['del', 'move'].includes(act));
  pick?.(act, b.dataset.v, b);
});
$('#ctx').addEventListener('keydown', e => {
  const items = $$('#ctx .menu-item'), i = items.indexOf(document.activeElement);
  if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeCtx(true); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
});
$('#list').addEventListener('contextmenu', e => {
  const row = e.target.closest('[data-task]'); if (!row || e.target.closest('textarea,input')) return;
  e.preventDefault();
  // На сенсорных экранах меню открывает долгое нажатие (ниже) — не дублируем.
  if (lastPointer === 'touch') return;
  openCtx(row.dataset.task, e.clientX, e.clientY);
});
$('#list').addEventListener('keydown', e => {
  if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
  const row = e.target.closest('[data-task]'); if (!row || e.target.closest('textarea,input')) return;
  e.preventDefault();
  const r = (e.target.closest('.t-main') || row).getBoundingClientRect();
  openCtx(row.dataset.task, r.left + 16, r.bottom, true);
});
// Долгое нажатие (~0,5 с) пальцем; сдвиг пальца или прокрутка отменяют.
function bindLongPress(root, rowSel, skipSel, onLong) {
  root.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const row = e.target.closest(rowSel);
    if (!row || (skipSel && e.target.closest(skipSel))) return;
    pressAt = { x: e.clientX, y: e.clientY };
    clearTimeout(pressT);
    pressT = setTimeout(() => { pressT = null; swallowClick = true; navigator.vibrate?.(12); onLong(row, pressAt.x, pressAt.y); }, 480);
  });
  root.addEventListener('pointermove', e => { if (pressT && pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress(); });
  ['pointerup', 'pointercancel'].forEach(t => root.addEventListener(t, cancelPress));
}
const cancelPress = () => { clearTimeout(pressT); pressT = null; };
bindLongPress($('#list'), '[data-task]', '[data-menu],button:not(.t-main),textarea,input,form', (row, x, y) => openCtx(row.dataset.task, x, y));
bindLongPress($('#chips'), '.fp-row[data-folder]', '.fp-eye', (row, x, y) => openFolderCtx(row.dataset.folder, x, y));
$('#chips').addEventListener('contextmenu', e => {
  const row = e.target.closest('.fp-row[data-folder]'); if (!row) return;
  e.preventDefault();
  if (lastPointer !== 'touch') openFolderCtx(row.dataset.folder, e.clientX, e.clientY);
});
$('#chips').addEventListener('keydown', e => {
  if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
  const row = e.target.closest('.fp-row[data-folder]'); if (!row) return;
  e.preventDefault(); const r = row.getBoundingClientRect(); openFolderCtx(row.dataset.folder, r.left + 24, r.bottom, true);
});
// Отпускание пальца после долгого нажатия не должно раскрывать/закрывать задачу.
document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; if (!e.target.closest('#ctx')) { e.stopPropagation(); e.preventDefault(); } } }, true);
document.addEventListener('pointerdown', e => { if (ctxOpen() && !e.target.closest('#ctx')) closeCtx(); }, true);
// Закрываем меню только при настоящей прокрутке страницы (а не при «пустом» событии scroll).
let ctxScrollY = 0;
addEventListener('scroll', () => { cancelPress(); if (Math.abs(scrollY - ctxScrollY) > 4) closeCtx(); }, { passive: true });
addEventListener('resize', () => closeCtx());
