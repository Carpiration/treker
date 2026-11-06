'use strict';
/* ---------- выбор срока: готовые шаблоны (сутки, 2 дня, неделя, 2 недели) и календарь ----------
   Один выбор на всё приложение: у поля новой задачи, в «Изменить» и по нажатию на срок в списке.
   openDuePicker(кнопка, текущий срок | null, onPick(срок | null)). */
const DUE_PRESETS = [['Сутки', 1], ['2 дня', 2], ['Неделя', 7], ['2 недели', 14]];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
let dp = null;

function closeDuePicker(refocus = true) {
  if (!dp) return;
  const { el, back, anchor } = dp;
  dp = null;
  el.remove(); back.remove();
  document.removeEventListener('keydown', dpKey, true);
  window.removeEventListener('resize', placeDuePicker);
  if (refocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
}
function openDuePicker(anchor, current, onPick, { clear = true } = {}) {
  closeCtx?.();
  closeDuePicker(false);
  const base = current || todayYmd();
  const back = document.createElement('div'); back.className = 'dp-back';
  const el = document.createElement('div'); el.className = 'dp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Срок задачи');
  document.body.append(back, el);
  dp = { el, back, anchor, cur: current || null, onPick, clear, ym: base.slice(0, 7) };
  back.addEventListener('click', () => closeDuePicker());
  el.addEventListener('click', dpClick);
  document.addEventListener('keydown', dpKey, true);
  window.addEventListener('resize', placeDuePicker);
  renderDuePicker();
  placeDuePicker();
  (el.querySelector('.dp-d.sel') || el.querySelector('.dp-d.today') || el.querySelector('.dp-d'))?.focus({ preventScroll: true });
}
function renderDuePicker() {
  const { el, cur, ym, clear } = dp, [y, m] = ym.split('-').map(Number), today = todayYmd();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  const cells = Array.from({ length: lead }, () => '<span class="dp-gap"></span>');
  for (let d = 1; d <= days; d++) {
    const s = `${ym}-${String(d).padStart(2, '0')}`;
    cells.push(`<button type="button" class="dp-d${s === cur ? ' sel' : ''}${s === today ? ' today' : ''}" data-d="${s}" aria-pressed="${s === cur}" aria-label="${d} ${MONTHS[m - 1].toLowerCase()}">${d}</button>`);
  }
  const pre = DUE_PRESETS.map(([t, n]) => { const s = addDaysYmd(today, n); return `<button type="button" class="dp-pre${s === cur ? ' on' : ''}" data-d="${s}">${t}</button>`; }).join('');
  el.innerHTML = `<div class="dp-pres" role="group" aria-label="Готовые сроки">${pre}</div>
    <div class="dp-head"><button type="button" class="dp-nav" data-nav="-1" aria-label="Прошлый месяц">${icon('left')}</button>
      <b class="dp-mon" aria-live="polite">${MONTHS[m - 1]} ${y}</b>
      <button type="button" class="dp-nav" data-nav="1" aria-label="Следующий месяц">${icon('right')}</button></div>
    <div class="dp-wk" aria-hidden="true">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="dp-grid">${cells.join('')}</div>
    <div class="dp-foot"><button type="button" class="dp-link" data-d="${today}">Сегодня</button>
      ${clear ? `<button type="button" class="dp-link dp-none${cur ? '' : ' on'}" data-d="">Без срока</button>` : ''}</div>`;
}
function placeDuePicker() {
  if (!dp) return;
  const { el, anchor } = dp, vw = innerWidth, vh = innerHeight;
  const sheet = vw <= 560;
  el.classList.toggle('sheet', sheet); dp.back.classList.toggle('sheet', sheet);
  if (sheet) { el.style.left = el.style.top = ''; return; }
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(8, r.right - w), vw - w - 8), top = r.bottom + 6;
  if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = `${left}px`; el.style.top = `${top}px`;
}
function dpClick(e) {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const [y, m] = dp.ym.split('-').map(Number), d = new Date(y, m - 1 + +nav.dataset.nav, 1);
    dp.ym = ymd(d).slice(0, 7); renderDuePicker(); placeDuePicker();
    dp.el.querySelector(`[data-nav="${nav.dataset.nav}"]`)?.focus({ preventScroll: true });
    return;
  }
  const pick = e.target.closest('[data-d]');
  if (!pick) return;
  const cb = dp.onPick, anchor = dp.anchor;
  closeDuePicker(false);
  cb(pick.dataset.d || null);
  if (anchor?.isConnected) anchor.focus({ preventScroll: true });
}
// Клавиатура: Esc закрывает; стрелки двигаются по дням.
function dpKey(e) {
  if (!dp) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDuePicker(); return; }
  const cell = e.target.closest?.('.dp-d');
  if (!cell || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const all = [...dp.el.querySelectorAll('.dp-d')], i = all.indexOf(cell);
  const j = i + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[e.key];
  if (all[j]) all[j].focus();
}
