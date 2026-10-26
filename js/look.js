'use strict';
/* ---------- акцентный цвет и градиентный фон ----------
   Применяются CSS-переменными на <html>; настройки — в профиле (prefs), поэтому одинаковы на всех устройствах. */
const ACCENTS = [
  ['#ff8a3d', 'Оранжевый'], ['#ff2e45', 'Красный'], ['#ff4fa3', 'Розовый'], ['#a173ff', 'Фиолетовый'], ['#3d8bff', 'Синий'],
  ['#22c3e6', 'Голубой'], ['#19c9a3', 'Бирюзовый'], ['#5fd35f', 'Зелёный'], ['#ffc233', 'Жёлтый'], ['#e9ecf1', 'Светлый'],
];
const hexOk = v => /^#[0-9a-f]{6}$/i.test(v || '');
// Тёмный или светлый текст на кнопке акцентного цвета — по яркости.
function onAccent(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b > .32 ? '#14110d' : '#ffffff';
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v)));
// p — функция чтения настройки (pref или черновик во время перетаскивания).
function applyAccentBg(p = pref) {
  const root = document.documentElement.style, acc = hexOk(p('accent')) ? p('accent') : PREF_DEFAULTS.accent;
  root.setProperty('--accent', acc);
  root.setProperty('--on-accent', onAccent(acc));
  root.setProperty('--bg-x', `${clamp(p('bgX'), 0, 100)}%`);
  root.setProperty('--bg-y', `${clamp(p('bgY'), 0, 100)}%`);
  root.setProperty('--bg-s', `${clamp(p('bgStrength'), 0, 80)}%`);
  root.setProperty('--bg-r', `${clamp(p('bgSpread'), 20, 160)}vmax`);
  root.setProperty('--bg-rn', clamp(p('bgSpread'), 20, 160));  // то же число — для мини-экрана в настройках
  document.body.classList.toggle('bg-off', !p('bgOn'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d0e10');
}
// Перетаскивание и ползунки меняют вид сразу (черновик), а в профиль сохраняется по окончании — без лишних запросов.
const lookDraft = {};
const draftPref = k => k in lookDraft ? lookDraft[k] : pref(k);
let saveT = null;
function previewPref(k, v) { lookDraft[k] = v; applyAccentBg(draftPref); }
function commitDraft() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const changes = Object.fromEntries(Object.entries(lookDraft).filter(([k, v]) => pref(k) !== v));
    for (const k of Object.keys(lookDraft)) delete lookDraft[k];
    if (Object.keys(changes).length) ops.patchSelf({ prefs: { ...me().prefs, ...changes } });
  }, 250);
}

function accentHtml() {
  const cur = (pref('accent') || '').toLowerCase(), custom = !ACCENTS.some(([c]) => c === cur);
  return `<div class="swatches" role="radiogroup" aria-label="Акцентный цвет">${ACCENTS.map(([c, n]) =>
    `<button type="button" class="sw${c === cur ? ' on' : ''}" role="radio" aria-checked="${c === cur}" data-accent="${c}" style="--c:${c}" title="${n}"><span class="sr-only">${n}</span></button>`).join('')}
    <label class="sw sw-custom${custom ? ' on' : ''}" title="Свой цвет" style="--c:${custom ? cur : '#888'}"><input type="color" id="accentPick" value="${hexOk(cur) ? cur : '#ff8a3d'}" aria-label="Свой цвет"></label>
  </div>`;
}
function bgHtml() {
  const on = !!pref('bgOn');
  return `<label class="switch-row"><span class="txt"><span>Градиентный фон</span><span class="hint">Мягкое свечение акцентного цвета</span></span>
      <input type="checkbox" class="switch" role="switch" id="bgOn"${on ? ' checked' : ''}></label>
    <div class="bg-ctl${on ? '' : ' off'}">
      <div class="bg-pad" id="bgPad" role="slider" tabindex="${on ? 0 : -1}" aria-label="Положение свечения: перетащите точку или используйте стрелки"
        aria-valuetext="${pref('bgX')}% по горизонтали, ${pref('bgY')}% по вертикали">
        <span class="bg-pad-ui" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="bg-dot" aria-hidden="true"></span>
      </div>
      <div class="bg-sliders">
        <label class="rng"><span>Сила <b id="bgSV">${pref('bgStrength')}%</b></span>
          <input type="range" id="bgStrength" min="0" max="80" step="1" value="${pref('bgStrength')}"${on ? '' : ' disabled'}></label>
        <label class="rng"><span>Распространение <b id="bgRV">${pref('bgSpread')}</b></span>
          <input type="range" id="bgSpread" min="20" max="160" step="1" value="${pref('bgSpread')}"${on ? '' : ' disabled'}></label>
        <p class="hint">Положение — перетащите точку на мини-экране слева.</p>
      </div>
    </div>`;
}
// Мини-экран показывает то же свечение, что и фон приложения (те же CSS-переменные).
function syncPad() {
  const pad = $('#bgPad'); if (!pad) return;
  const x = draftPref('bgX'), y = draftPref('bgY');
  pad.style.setProperty('--px', `${x}%`); pad.style.setProperty('--py', `${y}%`);
  pad.setAttribute('aria-valuetext', `${x}% по горизонтали, ${y}% по вертикали`);
}
function padMove(e) {
  const r = $('#bgPad').getBoundingClientRect();
  previewPref('bgX', Math.round(clamp((e.clientX - r.left) / r.width * 100, 0, 100)));
  previewPref('bgY', Math.round(clamp((e.clientY - r.top) / r.height * 100, 0, 100)));
  syncPad();
}
$('#stBody').addEventListener('pointerdown', e => {
  const pad = e.target.closest('#bgPad'); if (!pad || !pref('bgOn')) return;
  e.preventDefault(); pad.setPointerCapture(e.pointerId); pad.classList.add('drag'); padMove(e);
  const move = ev => padMove(ev);
  const up = () => { pad.classList.remove('drag'); pad.removeEventListener('pointermove', move); pad.removeEventListener('pointerup', up); pad.removeEventListener('pointercancel', up); commitDraft(); };
  pad.addEventListener('pointermove', move); pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
});
$('#stBody').addEventListener('keydown', e => {
  if (e.target.id !== 'bgPad') return;
  const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key]; if (!d) return;
  e.preventDefault();
  previewPref('bgX', clamp(draftPref('bgX') + d[0], 0, 100)); previewPref('bgY', clamp(draftPref('bgY') + d[1], 0, 100));
  syncPad(); commitDraft();
});
$('#stBody').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'bgStrength') { previewPref('bgStrength', +t.value); $('#bgSV').textContent = `${t.value}%`; }
  else if (t.id === 'bgSpread') { previewPref('bgSpread', +t.value); $('#bgRV').textContent = t.value; }
  else if (t.id === 'accentPick') { previewPref('accent', t.value.toLowerCase()); t.closest('.sw').style.setProperty('--c', t.value); }
});
$('#stBody').addEventListener('change', e => {
  if (['bgStrength', 'bgSpread', 'accentPick'].includes(e.target.id)) commitDraft();
  else if (e.target.id === 'bgOn') ops.patchSelf({ prefs: { ...me().prefs, bgOn: e.target.checked } });
});
$('#stBody').addEventListener('click', e => {
  const b = e.target.closest('[data-accent]'); if (!b || b.classList.contains('on')) return;
  ops.patchSelf({ prefs: { ...me().prefs, accent: b.dataset.accent } });
  $(`[data-accent="${b.dataset.accent}"]`)?.focus({ preventScroll: true });
});
