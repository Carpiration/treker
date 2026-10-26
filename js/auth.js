'use strict';
/* ---------- вход и регистрация ---------- */
let authMode = 'login';
function setAuthMode(mode, firstRun = false) {
  authMode = mode;
  const reg = mode === 'register';
  $('#authH').textContent = reg ? 'Регистрация' : 'Вход';
  $('#authHint').textContent = firstRun ? 'Вы первый — станете администратором и будете одобрять остальных.'
    : 'После регистрации администратор включит ваш профиль.';
  $('#authHint').hidden = !reg;
  $('#authBtn').textContent = reg ? 'Зарегистрироваться' : 'Войти';
  $('#authSwitch').textContent = reg ? 'Уже есть профиль? Войти' : 'Нет профиля? Зарегистрироваться';
  $('#authSwitch').hidden = firstRun;
  const phone = $('#lgLogin')?.value || '';
  $('#loginFields').innerHTML = (reg ? fieldHtml('lgName', 'Ник', NICK_ATTRS) : '')
    + fieldHtml('lgLogin', 'Номер телефона', `${PHONE_ATTRS} autocomplete="username"`, fmtPhone(phone))
    + pwFieldHtml('lgPass', 'PIN', reg ? 'new-password' : 'current-password', reg ? 'Придумайте 6 цифр' : '6 цифр',
      reg ? PIN_ATTRS : 'inputmode="numeric" maxlength="128"');  // при входе — без ограничения: старые пароли длиннее
  setAuthErr('');
}
function setAuthErr(msg) { $('#authErr').textContent = msg; $('#authErr').hidden = !msg; }
function setAuthNote(msg) { $('#authNote').textContent = msg; $('#authNote').hidden = !msg; }
async function showAuth(msg) {
  $('#boot').hidden = true; $('#app').hidden = true; $('#authScreen').hidden = false;
  let firstRun = false;
  try { firstRun = await backend.needsSetup(); } catch {}
  setAuthNote('');
  setAuthMode(firstRun ? 'register' : 'login', firstRun);
  if (msg) setAuthErr(msg);
  if (finePointer()) $('#loginFields input').focus();
}
$('#authSwitch').addEventListener('click', () => {
  setAuthNote('');
  setAuthMode(authMode === 'login' ? 'register' : 'login');
  if (finePointer()) $('#loginFields input').focus();
});
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#authBtn'); if (btn.disabled) return;
  const li = $('#lgLogin'), pi = $('#lgPass'), ni = $('#lgName');
  const phone = li.value.trim(), pin = pi.value, name = ni?.value.trim();
  const reg = authMode === 'register';
  setAuthErr('');
  let bad = null;
  const check = (el, msg) => { if (!setErr(el, msg) && !bad) bad = el; };
  if (ni) check(ni, nickError(name));
  check(li, reg ? phoneError(phone) : phone ? '' : 'Введите номер телефона');
  check(pi, reg ? pinError(pin) : pin ? '' : 'Введите PIN');
  if (bad) return bad.focus();
  btnBusy(btn, true, reg ? 'Регистрируем…' : 'Входим…');
  try {
    if (reg) {
      const u = await backend.register(name, phone, pin);
      btnBusy(btn, false);
      if (u.active) { pi.value = ''; enter(u.id); return; }
      setAuthMode('login');
      $('#lgLogin').value = phone;
      setAuthNote('Заявка отправлена. Войти можно, когда администратор одобрит профиль.');
      return;
    }
    const id = await backend.login(phone, pin);
    btnBusy(btn, false);
    pi.value = '';
    enter(id);
  } catch (err) {
    btnBusy(btn, false);
    const msg = errText(err, 'Нет связи с сервером. Проверьте интернет.');
    if (ni && /ник/i.test(msg)) { setErr(ni, msg); ni.focus(); return; }
    if (/уже зарегистрирован|Номер целиком/.test(msg)) { setErr(li, msg); li.focus(); return; }
    if (/Неверный номер/.test(msg)) setErr(pi, msg); else setAuthErr(msg);
    pi.select(); pi.focus();
  }
});
function enter(id) {
  state.me = id;
  Object.assign(state, { space: 'me', folder: 'all', who: 'all', newFolder: false, view: 'active', editing: null, hoverId: null, kbdId: null, tapId: null, newAssignee: undefined });
  $('#boot').hidden = true; $('#authScreen').hidden = true; $('#app').hidden = false;
  backend.subscribe(remoteChanged);
  render({ flip: false });
  // На телефоне автофокус сразу открывал бы клавиатуру поверх списка.
  if (finePointer()) $('#nTitle').focus();
}
async function logout(msg) {
  if (openMenu) setMenu(openMenu, false);
  closeAppMenu();
  const d = $('#settings'); if (d.open) { d.classList.remove('closing'); d.close(); }
  state.me = null; state.editing = null;
  $$('#toasts .toast').forEach(t => t.remove());
  await backend.logout();
  showAuth(msg);
}
