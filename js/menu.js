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
  if (state.hoverId) { clearTimeout(peekCloseT); peekCloseT = setTimeout(() => { state.hoverId = null; applyPeek(); }, 100); }
  // Небольшая задержка: проводя курсором по списку, не раскрываем каждую строку.
  if (id) peekOpenT = setTimeout(() => { clearTimeout(peekCloseT); state.hoverId = id; applyPeek(); }, state.hoverId ? 140 : 200);
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
function openCtx(id, x, y, byKey = false) {
  const t = state.db.tasks.find(v => v.id === id && !v.deletedAt); if (!t) return;
  if (openMenu) setMenu(openMenu, false);
  closeAppMenu();
  ctxTask = id;
  const m = $('#ctx');
  m.innerHTML = ctxItems(t);
  m.hidden = false; m.style.left = '0px'; m.style.top = '0px'; m.style.maxHeight = '';
  // Не вылезаем за край экрана: при нехватке места снизу — раскрываем вверх.
  const r = m.getBoundingClientRect(), pad = 8;
  const left = Math.min(Math.max(pad, x), innerWidth - r.width - pad);
  let top = y;
  if (y + r.height > innerHeight - pad) top = Math.max(pad, y - r.height);
  if (top + r.height > innerHeight - pad) m.style.maxHeight = `${innerHeight - top - pad}px`;
  m.style.left = `${left}px`; m.style.top = `${top}px`;
  m.style.transformOrigin = `${x - left}px ${y >= top ? y - top : 0}px`;
  $(`#list [data-task="${id}"]`)?.classList.add('ctx-on');
  if (byKey || finePointer()) $('.menu-item', m)?.focus({ preventScroll: true });
}
function closeCtx(focusTask) {
  const m = $('#ctx'); if (m.hidden) return;
  m.hidden = true;
  $$('#list .ctx-on').forEach(el => el.classList.remove('ctx-on'));
  if (focusTask) $(`[data-main="${ctxTask}"]`)?.focus({ preventScroll: true });
  ctxTask = null;
}
const ctxOpen = () => !$('#ctx').hidden;
$('#ctx').addEventListener('click', e => {
  const b = e.target.closest('[data-ctx]'); if (!b) return;
  const id = ctxTask, act = b.dataset.ctx, v = b.dataset.v;
  closeCtx(act !== 'del' && act !== 'move');
  if (act === 'edit') startEdit(id);
  else if (act === 'status') setStatus(id, v);
  else if (act === 'assign') transfer(id, v);
  else if (act === 'move') openMove(id);
  else if (act === 'cancel-tr') cancelTransfer(pendingTransfer(id)?.id, b);
  else if (act === 'del') removeTask(id);
  else if (act === 'open') { state.tapId = id; applyPeek(); }
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
// Долгое нажатие (~0,5 с) на строке задачи; сдвиг пальца или прокрутка отменяют.
$('#list').addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const row = e.target.closest('[data-task]');
  if (!row || e.target.closest('[data-menu],button:not(.t-main),textarea,input,form')) return;
  pressAt = { x: e.clientX, y: e.clientY };
  clearTimeout(pressT);
  pressT = setTimeout(() => {
    pressT = null; swallowClick = true;
    navigator.vibrate?.(12);
    openCtx(row.dataset.task, pressAt.x, pressAt.y);
  }, 480);
});
const cancelPress = () => { clearTimeout(pressT); pressT = null; };
$('#list').addEventListener('pointermove', e => { if (pressT && pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress(); });
['pointerup', 'pointercancel'].forEach(t => $('#list').addEventListener(t, cancelPress));
// Отпускание пальца после долгого нажатия не должно раскрывать/закрывать задачу.
document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; if (!e.target.closest('#ctx')) { e.stopPropagation(); e.preventDefault(); } } }, true);
document.addEventListener('pointerdown', e => { if (ctxOpen() && !e.target.closest('#ctx')) closeCtx(); }, true);
addEventListener('scroll', () => { cancelPress(); closeCtx(); }, { passive: true });
addEventListener('resize', () => closeCtx());
