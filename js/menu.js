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
  const item = e.target.closest('.menu-item');
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
