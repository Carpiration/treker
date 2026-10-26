'use strict';
/* ---------- уведомления с отменой ---------- */
function toast(text, undo) {
  $$('#toasts .toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = `toast${undo ? '' : ' plain'}`;
  el.innerHTML = `<span class="tx">${esc(text)}</span>${undo ? `<button type="button">Отменить</button><span class="timer" style="animation-duration:${UNDO_MS}ms" aria-hidden="true"></span>` : ''}`;
  let done = false;
  const hide = () => {
    if (done) return; done = true; clearTimeout(timer);
    if (reduced() || !el.isConnected) return el.remove();
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 160, easing: EASE }).onfinish = () => el.remove();
    setTimeout(() => el.remove(), 220);
  };
  const timer = setTimeout(hide, undo ? UNDO_MS : 2400);
  if (undo) $('button', el).onclick = () => { if (done) return; hide(); undo(); };
  $('#toasts').append(el);
}

/* ---------- синхронизация, сеть, служебное ---------- */
setInterval(remoteChanged, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) remoteChanged(); });
function updateNet() { $('#net').hidden = navigator.onLine; }
addEventListener('online', () => { updateNet(); remoteChanged(); });
addEventListener('offline', updateNet);
updateNet();

addEventListener('scroll', () => $('#top').classList.toggle('scrolled', scrollY > 4), { passive: true });
// N — быстро перейти к полю новой задачи.
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyN') return;
  if (!state.me || $('#settings').open || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
  e.preventDefault(); $('#nTitle').focus();
});

/* ---------- кнопка «Назад» в Android-приложении ---------- */
// Закрывает верхний открытый слой; false — закрывать нечего, приложение сворачивается.
window.appBack = () => {
  if (openMenu) { setMenu(openMenu, false); return true; }
  const d = $('#settings');
  if (d.open) { if (state.pfOpen) closeProfile(); else closeDlg(d); return true; }
  if (state.editing) { cancelEdit(); return true; }
  if (state.tapId) { state.tapId = null; applyPeek(); return true; }
  return false;
};

/* ---------- старт ---------- */
function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить модуль синхронизации. Проверьте интернет.'));
    document.head.append(s);
  });
}
async function boot() {
  $('#bootRetry').hidden = true; $('#boot').classList.remove('error'); $('#bootText').textContent = 'Загрузка…';
  try {
    if (!CLOUD) throw new Error('не настроено подключение к серверу (config.js)');
    if (!backend) { await loadScript(SB_SRC, SB_SRI); backend = cloudBackend(); }
    const id = await backend.start();
    if (id) enter(id); else await showAuth();
  } catch (e) {
    $('#boot').classList.add('error');
    $('#bootText').textContent = /fetch|network|интернет/i.test(e?.message || '') || !navigator.onLine
      ? 'Нет связи с сервером. Проверьте интернет.' : `Не удалось загрузить данные: ${e?.message || e}`;
    $('#bootRetry').hidden = false;
  }
}
$('#bootRetry').addEventListener('click', boot);
boot();
