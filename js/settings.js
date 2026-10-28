'use strict';
/* ---------- меню (шестерёнка) ----------
   Плавно раскрывается под кнопкой; каждый пункт открывает свою страницу в окне настроек. */
function menuEntries() {
  const u = me(), waiting = state.db.users.filter(x => x.pending && !x.active).length;
  return [
    { page: 'profile', html: `${avatar(u)}<span class="am-txt"><b>${esc(u.name)}</b><span>Профиль, PIN, выход</span></span>` },
    { page: 'look', html: `${icon('palette')}<span class="am-txt"><b>Внешний вид</b><span>Фон задач, статусы</span></span>` },
    isAdmin() && { page: 'users', html: `${icon('users')}<span class="am-txt"><b>Пользователи</b><span>${waiting ? `Заявки: ${waiting}` : 'Профили и доступ'}</span></span>${waiting ? `<span class="am-badge">${waiting}</span>` : ''}` },
    { page: 'groups', html: `${icon('grid')}<span class="am-txt"><b>Группы</b><span>${isAdmin() ? 'Создать, добавить людей' : 'Где вы состоите'}</span></span>` },
    { page: 'folders', html: `${icon('folder')}<span class="am-txt"><b>Мои папки</b><span>Создать, скрыть от других</span></span>` },
    { page: 'journal', html: `${icon('list')}<span class="am-txt"><b>Журнал</b><span>Кто что когда сделал</span></span>` },
    { page: 'archive', html: `${icon('trash')}<span class="am-txt"><b>Архив</b><span>Удалённое хранится ${ARCHIVE_DAYS} дней</span></span>${archiveCount() ? `<span class="am-n">${archiveCount()}</span>` : ''}` },
  ].filter(Boolean);
}
function openAppMenu() {
  const m = $('#appMenu');
  m.innerHTML = menuEntries().map((x, i) => `<button type="button" class="am-item" role="menuitem" data-page="${x.page}" style="--i:${i}">${x.html}</button>`).join('');
  m.hidden = false;
  $('#settingsBtn').setAttribute('aria-expanded', 'true');
  if (finePointer() || lastPointer !== 'touch') $('.am-item', m)?.focus({ preventScroll: true });
}
function closeAppMenu(focusBtn) {
  const m = $('#appMenu'); if (m.hidden || m.classList.contains('closing')) return;
  $('#settingsBtn').setAttribute('aria-expanded', 'false');
  const done = () => { m.classList.remove('closing'); m.hidden = true; };
  if (reduced()) done(); else { m.classList.add('closing'); setTimeout(done, 150); }
  if (focusBtn) $('#settingsBtn').focus();
}
const appMenuOpen = () => !$('#appMenu').hidden && !$('#appMenu').classList.contains('closing');
$('#settingsBtn').addEventListener('click', () => appMenuOpen() ? closeAppMenu() : openAppMenu());
$('#appMenu').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) { closeAppMenu(); openPage(b.dataset.page); } });
document.addEventListener('pointerdown', e => { if (appMenuOpen() && !e.target.closest('#appMenu,#settingsBtn')) closeAppMenu(); });
$('#appMenu').addEventListener('keydown', e => {
  const items = $$('.am-item'), i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeAppMenu(true); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  else if (e.key === 'Tab') closeAppMenu();
});

/* ---------- страницы настроек ---------- */
const PAGES = {
  profile: { title: 'Профиль', build: buildProfilePage },
  look:    { title: 'Внешний вид', build: buildLookPage },
  users:   { title: 'Пользователи', build: buildUsersPage, admin: true },
  groups:  { title: 'Группы', build: buildGroupsPage },
  folders: { title: 'Мои папки', build: buildFoldersPage },
  // Страницы из activity.js (подключается позже) — через обёртки.
  notes:   { title: 'Уведомления', build: () => buildNotesPage(), open: () => afterNotesOpen() },
  journal: { title: 'Журнал', build: () => buildJournalPage(), open: () => loadJournal() },
  archive: { title: 'Архив', build: () => buildArchivePage() },
  move:    { title: 'Перенести задачу', build: () => buildMovePage() },
  give:    { title: 'Передать папку', build: () => buildGivePage() },
};
const archiveCount = () => state.db.tasks.filter(t => t.deletedAt).length;
function openPage(page) {
  if (!PAGES[page] || (PAGES[page].admin && !isAdmin())) return;
  Object.assign(state, { page, pfOpen: null, gOpen: null, confirmDel: null });
  if (page === 'notes') state.freshNotes = new Set(state.db.notes.filter(n => !n.readAt).map(n => n.id));
  $('#stH').textContent = PAGES[page].title;
  buildSettings();
  const d = $('#settings');
  if (!d.open) d.showModal();
  $('#stBody').scrollTop = 0;
  PAGES[page].open?.();
}
function buildSettings() {
  if (PAGES[state.page]?.admin && !isAdmin()) state.page = 'profile';
  PAGES[state.page].build();
}
// Изменения с сервера, пока окно открыто: перерисовываем страницу, если человек сейчас ничего не вводит.
function refreshSettings() {
  const a = document.activeElement;
  if (a && $('#stBody').contains(a) && a.matches('input:not([type=checkbox]),textarea,select')) return;
  if (state.page === 'users' && state.pfOpen) return;
  // После перестройки возвращаем фокус на тот же переключатель (иначе он уходит в начало страницы).
  const id = a && $('#stBody').contains(a) ? a.id : '';
  buildSettings();
  if (id) document.getElementById(id)?.focus({ preventScroll: true });
}
function closeDlg(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (reduced()) { d.close(); return; }
  d.classList.add('closing');
  const done = () => { if (!d.classList.contains('closing')) return; d.classList.remove('closing'); d.close(); };
  d.addEventListener('animationend', function end(e) { if (e.target !== d) return; d.removeEventListener('animationend', end); done(); });
  setTimeout(done, 320);
}
$('#settings').addEventListener('cancel', e => { e.preventDefault(); closeDlg(e.currentTarget); });
$('#settings').addEventListener('click', e => { if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeDlg(e.currentTarget); });

// Задачи, оставшиеся в этом браузере от прежней версии, — их можно перенести на сервер.
function deviceTasks() {
  if (!backend) return null;
  try { if (localStorage.getItem(IMPORTED_KEY)) return null; } catch { return null; }
  // В Android-приложении задачи версии 1.0 передаёт мост (они лежали под адресом file://, недоступным сайту).
  const sources = [() => localStorage.getItem(DB_KEY), () => localStorage.getItem(LEGACY_KEY), () => window.TrekerBridge?.legacy()];
  for (const read of sources) {
    try {
      const db = JSON.parse(read());
      // Нетронутые демо-данные старой версии (v2, rev 1) не предлагаем.
      if (db?.tasks?.length && (db.v === 3 || db.rev > 1)) return db;
    } catch {}
  }
  return null;
}

/* ---------- профиль ---------- */
function buildProfilePage() {
  const u = me(), dev = deviceTasks();
  $('#stBody').innerHTML = `
    <section class="st-sec" aria-label="Профиль">
      <div class="me-card">${avatar(u, 'xl')}<span><b>${esc(u.name)}</b><span class="hint">${esc(fmtLogin(u.login))} · ${ROLES[u.role]}</span></span></div>
      ${avatarPickerHtml(u)}
      <form class="inline" id="nameForm" novalidate>
        ${fieldHtml('stName', 'Ник', NICK_ATTRS, u.name)}
        <button class="btn" type="submit">Сохранить</button>
      </form>
      <details class="fold" id="pwFold"><summary>${icon('down', 'chev')}Сменить PIN</summary>
        <form class="fold-body" id="pwForm" novalidate>
          <input type="text" autocomplete="username" value="${esc(u.login || '')}" hidden>
          ${pwFieldHtml('stPwOld', 'Текущий PIN', 'current-password', '', 'maxlength="128"')}
          ${pwFieldHtml('stPwNew', 'Новый PIN', 'new-password', '6 цифр')}
          <button class="btn" type="submit">Сменить PIN</button>
        </form>
      </details>
    </section>
    ${dev ? `<section class="st-sec" aria-labelledby="stImpH">
      <h3 class="sub-h" id="stImpH">Перенос с этого устройства</h3>
      <p class="hint">В этом браузере остались задачи из прежней версии: ${dev.tasks.length}. Их можно один раз перенести в «Мои задачи».</p>
      <button class="btn" type="button" id="importBtn">Перенести задачи: ${dev.tasks.length}</button>
    </section>` : ''}
    <section class="st-sec">
      <p class="hint">Данные хранятся на сервере и синхронизируются между всеми устройствами.</p>
      <button class="btn ghost danger block" type="button" id="logoutBtn">${icon('logout')}Выйти</button>
    </section>`;
}

/* ---------- аватар ---------- */
function avatarPickerHtml(u) {
  const cur = u.avatar || '';
  const opt = (v, html, title) => `<button type="button" class="av-opt${cur === v ? ' on' : ''}" role="radio" aria-checked="${cur === v}" data-avatar="${v}" title="${title}">${html}</button>`;
  const names = ['Лиса', 'Кот', 'Сова', 'Панда', 'Робот', 'Пришелец', 'Привидение', 'Космонавт', 'Кактус', 'Осьминог'];
  return `<div class="av-pick">
    <div class="av-grid" role="radiogroup" aria-label="Аватар">
      ${opt('', avatar({ ...u, avatar: null }), 'Инициалы')}
      ${names.map((n, i) => opt(`preset:${i + 1}`, `<img src="icons/avatars/a${i + 1}.svg" alt="">`, n)).join('')}
      ${cur.startsWith('up:') ? opt(cur, `<img src="${esc(avatarSrc(cur))}" alt="">`, 'Своё фото') : ''}
    </div>
    <label class="av-drop" id="avDrop" tabindex="0">
      <input type="file" id="avFile" accept="image/*" class="sr-only">
      ${icon('upload')}<span><b>Своё фото</b><span class="hint dnd-only">Перетащите сюда или нажмите, чтобы выбрать с компьютера</span><span class="hint touch-only">Выбрать из галереи</span></span>
    </label>
  </div>`;
}
// Фото обрезается по центру до квадрата 256×256 и сжимается (WebP, где можно, иначе JPEG).
async function squareImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('Это не картинка');
  if (file.size > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть картинку')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight), size = 256;
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const toBlob = type => new Promise(res => c.toBlob(res, type, .88));
    let blob = await toBlob('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
async function uploadAvatar(file) {
  const drop = $('#avDrop'); drop?.classList.add('busy');
  try {
    const blob = await squareImage(file), old = me().avatar;
    const path = await backend.uploadAvatar(blob, blob.type === 'image/webp' ? 'webp' : 'jpg');
    if (await ops.patchSelf({ avatar: `up:${path}` })) {
      toast('Фото установлено');
      if (old?.startsWith('up:')) backend.removeAvatar(old.slice(3));
    }
  } catch (e) { toast(errText(e)); }
  finally { $('#avDrop')?.classList.remove('busy'); }
}
async function setAvatar(v) {
  const old = me().avatar;
  if ((old || '') === v) return;
  if (await ops.patchSelf({ avatar: v || null }) && old?.startsWith('up:') && old !== v) backend.removeAvatar(old.slice(3));
}
$('#stBody').addEventListener('click', e => { const b = e.target.closest('[data-avatar]'); if (b) setAvatar(b.dataset.avatar); });
$('#stBody').addEventListener('change', e => { if (e.target.id === 'avFile' && e.target.files[0]) uploadAvatar(e.target.files[0]); });
$('#stBody').addEventListener('keydown', e => { if (e.target.id === 'avDrop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#avFile').click(); } });
// Перетаскивание файла (ПК): подсветка зоны и загрузка по отпусканию.
['dragenter', 'dragover'].forEach(t => $('#stBody').addEventListener(t, e => {
  const d = e.target.closest('#avDrop'); if (!d) return; e.preventDefault(); d.classList.add('over');
}));
['dragleave', 'drop'].forEach(t => $('#stBody').addEventListener(t, e => {
  const d = e.target.closest('#avDrop'); if (!d) return; e.preventDefault(); d.classList.remove('over');
  if (t === 'drop' && e.dataTransfer?.files?.[0]) uploadAvatar(e.dataTransfer.files[0]);
}));
// Файл бросили мимо зоны — не даём браузеру открыть его вместо приложения.
['dragover', 'drop'].forEach(t => addEventListener(t, e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }));

/* ---------- внешний вид ---------- */
function segHtml(name, value, opts) {
  return `<div class="seg wide" role="radiogroup" aria-label="${esc(name)}">${opts.map(([v, l]) =>
    `<button type="button" class="seg-b${v === value ? ' on' : ''}" role="radio" aria-checked="${v === value}" data-pref="${name}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
// Предпросмотр — те же классы, что у настоящих задач (вид задаётся классами на <body>).
function previewCards() {
  const view = pref('statusView'), who = pref('showAssignee'), prio = prioShown(), demo = [
    ['todo', 'Купить подарки', 'Список — в заметках, бюджет до пятницы', me()],
    ['doing', 'Подготовить презентацию', '', { id: 'demo-a', name: 'Аня', avatar: 'preset:2' }],
    ['done', 'Созвон в 15:00', 'Итоги — в общем чате', { id: 'demo-b', name: 'Макс', avatar: 'preset:9' }],
  ];
  return demo.map(([s, title, desc, u], i) => {
    const st = statusOf(s);
    const status = view === 'hide' ? '' : view === 'dot'
      ? `<span class="st st-ind ro" data-s="${s}" title="${st.label}"><span class="dot"></span></span>`
      : `<span class="st ro" data-s="${s}">${statusIcon(s)}<span class="lbl">${st.label}</span></span>`;
    const hi = i === 0, pr = prio && s !== 'done';
    return `<div class="task${s === 'done' ? ' done' : ''}${pr ? ` has-pr pr-${hi ? 'hi' : 'lo'}` : ''}" data-s="${s}" style="--ro:${i * 97 + 40}deg"><span class="t-fx" aria-hidden="true"></span>
      ${pr ? `<span class="t-pr ro"><span>${hi ? 'Важно' : 'Потом'}</span></span>` : ''}
      <div class="t-head"><span class="t-main"><span class="t-title">${title}</span>${desc ? `<span class="t-sub">${desc}</span>` : ''}</span>
      <div class="t-side">${who ? `<span class="av-btn ro">${avatar(u)}</span>` : ''}${status}</div></div></div>`;
  }).join('');
}
function buildLookPage() {
  const fx = pref('taskFx');
  $('#stBody').innerHTML = `<section class="st-sec" aria-labelledby="lkAccH">
      <h3 class="sub-h" id="lkAccH">Акцентный цвет</h3>
      ${accentHtml()}
    </section>
    <section class="st-sec" aria-labelledby="lkBgH">
      <h3 class="sub-h" id="lkBgH">Фон приложения</h3>
      ${bgHtml()}
    </section>
    <section class="st-sec" aria-label="Предпросмотр задач">
      <div class="list look-prev" aria-hidden="true">${previewCards()}</div>
      <p class="hint">Цвет — статус: красный — не начато, жёлтый — в процессе, зелёный — готово.</p>
    </section>
    <section class="st-sec" aria-labelledby="lkFxH">
      <h3 class="sub-h" id="lkFxH">Фон задач</h3>
      ${segHtml('taskFx', fx, [['rays', 'Лучи'], ['outline', 'Обводка'], ['off', 'Выключен']])}
      <label class="switch-row${fx === 'off' ? ' off' : ''}"><span class="txt"><span>Переливание</span>
        <span class="hint">${fx === 'outline' ? 'По рамке бегает блик' : 'Лучи медленно поворачиваются'} (цвет не меняется)</span></span>
        <input type="checkbox" class="switch" role="switch" id="prefAnim"${pref('fxAnim') ? ' checked' : ''}${fx === 'off' ? ' disabled' : ''}></label>
    </section>
    <section class="st-sec" aria-labelledby="lkStH">
      <h3 class="sub-h" id="lkStH">Статус в строке</h3>
      ${segHtml('statusView', pref('statusView'), [['pill', 'Метка'], ['dot', 'Индикатор'], ['hide', 'Скрыть']])}
      <p class="hint">Статус всегда можно сменить в меню задачи: правая кнопка мыши или долгое нажатие.</p>
    </section>
    <section class="st-sec" aria-labelledby="lkMoreH">
      <h3 class="sub-h" id="lkMoreH">Ещё</h3>
      <label class="switch-row"><span class="txt"><span>Показывать, чья задача</span>
        <span class="hint">Аватар исполнителя в строке задачи — в группах (в «Моих задачах» все задачи ваши).${
          state.db.groups.some(g => isMember(g.id)) ? '' : ' Сейчас вы не состоите ни в одной группе — аватар виден только в предпросмотре выше.'}</span></span>
        <input type="checkbox" class="switch" role="switch" id="prefAssignee"${pref('showAssignee') ? ' checked' : ''}></label>
      <label class="switch-row"><span class="txt"><span>Режим «Важно / Потом»</span>
        <span class="hint">Метка слева от задач и вкладки «Важные · Потом · Готовые» — в папках, где режим включён
          (меню папки: удержание или правая кнопка мыши). Выключение действует только у вас.</span></span>
        <input type="checkbox" class="switch" role="switch" id="prefPrio"${prioShown() ? ' checked' : ''}></label>
    </section>`;
  syncPad();  // точка свечения на мини-экране
}
function setPref(k, v) {
  ops.patchSelf({ prefs: { ...me().prefs, [k]: v } });
}
$('#stBody').addEventListener('click', e => {
  const b = e.target.closest('[data-pref]'); if (!b || b.classList.contains('on')) return;
  const k = b.dataset.pref, v = b.dataset.v;
  setPref(k, v);
  $(`[data-pref="${k}"][data-v="${v}"]`)?.focus({ preventScroll: true });
});

/* ---------- пользователи (администратор) ---------- */
function buildUsersPage() {
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Пользователи">
    <p class="hint">Новые люди регистрируются сами и ждут одобрения. Можно и сразу создать профиль.</p>
    <div class="pf-list" id="pfList"></div></section>`;
  renderProfiles();
}

/* ---------- группы ---------- */
function buildGroupsPage() {
  const groups = visibleGroups(), admin = isAdmin();
  const intro = admin
    ? `<p class="hint">У каждой группы свои задачи и свои участники. Человек может состоять максимум в ${MAX_GROUPS} группах. Без групп у него остаются «Мои задачи».</p>`
    : `<p class="hint">Состав групп меняет администратор. Задачи группы видят только её участники.</p>`;
  const list = groups.length ? groups.map(g => groupHtml(g, admin)).join('') : `<p class="empty-s">Групп пока нет.</p>`;
  const add = admin ? `<form class="inline" id="groupNew" novalidate>
      ${fieldHtml('gNewName', 'Новая группа', 'maxlength="40" autocomplete="off" placeholder="Например, Склад"')}
      <button class="btn" type="submit">${icon('plus')}Создать</button></form>` : '';
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Группы">${intro}<div class="g-list">${list}</div>${add}</section>`;
}
function groupHtml(g, admin) {
  const members = groupMembers(g.id), open = state.gOpen === g.id;
  const tasks = state.db.tasks.filter(t => t.groupId === g.id).length;
  const faces = members.slice(0, 5).map(u => avatar(u)).join('');
  const row = `<button type="button" class="pf-row" data-g="${g.id}" aria-expanded="${open}"${admin ? '' : ' disabled'}>
      ${icon('grid', 'g-ic')}<span class="pf-txt"><b>${esc(g.name)}${isMember(g.id) ? '<span class="tag">вы</span>' : ''}</b>
      <span class="hint">${members.length ? `Участников: ${members.length}` : 'Нет участников'} · задач: ${tasks}</span></span>
      <span class="faces">${faces}</span>${admin ? icon('down', 'chev') : ''}</button>`;
  if (!open) return `<div class="pf">${row}</div>`;
  const people = activeUsers().sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(u => {
    const on = isMember(g.id, u.id), n = userGroups(u.id).length, full = !on && n >= MAX_GROUPS;
    return `<label class="switch-row m-row${full ? ' full' : ''}">${avatar(u)}<span class="txt"><span>${esc(u.name)}</span>
      <span class="hint">${full ? `Уже ${MAX_GROUPS} групп — максимум` : `Групп: ${n} из ${MAX_GROUPS}`}</span></span>
      <input type="checkbox" class="switch" role="switch" data-member="${u.id}" data-group="${g.id}"${on ? ' checked' : ''}${full ? ' disabled' : ''}></label>`;
  }).join('');
  return `<div class="pf open">${row}<div class="pf-form">
    <form class="inline" data-g-rename="${g.id}" novalidate>${fieldHtml(`g-${g.id}-name`, 'Название', 'maxlength="40" autocomplete="off"', g.name)}
      <button class="btn" type="submit">Сохранить</button></form>
    <h4>Участники</h4><div class="m-list">${people}</div>
    <div class="row-actions"><button class="btn ghost sm danger push" type="button" data-g-del="${g.id}"${tasks ? ` disabled aria-describedby="g-${g.id}-dh"` : ''}>${icon('trash')}${state.confirmDel === g.id ? 'Точно удалить?' : 'Удалить группу'}</button></div>
    ${tasks ? `<p class="hint" id="g-${g.id}-dh">Удалить можно только пустую группу: сначала перенесите её задачи или удалите их навсегда (в том числе из архива).</p>` : ''}
  </div></div>`;
}

/* ---------- папки ---------- */
function buildFoldersPage() {
  const u = me(), folders = userFolders(state.me);
  const rows = folders.map(f => `<div class="f-row" data-f="${f.id}">
      <form class="f-name" data-f-rename="${f.id}" novalidate><label class="sr-only" for="f-${f.id}-name">Название папки</label>
        <input class="input" id="f-${f.id}-name" value="${esc(f.name)}" maxlength="40" autocomplete="off"${f.kind === 'transfers' ? ' readonly title="Служебная папка: сюда приходят переданные вам задачи"' : ''}></form>
      <button type="button" class="icon-btn prio-tg${f.prio ? ' on' : ''}" data-f-prio="${f.id}" aria-pressed="${!!f.prio}" aria-label="Режим «Важно / Потом»" title="Режим «Важно / Потом»: ${f.prio ? 'включён' : 'выключен'}">${icon('flag')}</button>
      <label class="eye-tg" title="${f.hidden ? 'Скрыта от других' : 'Видна другим'}"><input type="checkbox" class="sr-only" data-f-hide="${f.id}"${f.hidden ? '' : ' checked'}>
        ${icon(f.hidden ? 'eye-off' : 'eye')}<span class="sr-only">Видна другим</span></label>
      ${f.kind === 'transfers' ? '' : state.confirmDel === f.id
        ? `<button type="button" class="btn sm danger-solid" data-f-del="${f.id}" title="Задачи перейдут в «Без папки»">${icon('trash')}Удалить?</button>`
        : `<button type="button" class="icon-btn danger-ic" data-f-del="${f.id}" aria-label="Удалить папку" title="Удалить папку">${icon('trash')}</button>`}
    </div>`).join('');
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Мои папки">
    <p class="hint">Папки — внутри «Мои задачи». Другие люди могут смотреть ваши задачи; скрытую папку не видит никто, даже администратор.</p>
    <label class="switch-row"><span class="txt"><span>Задачи без папки видны другим</span>
      <span class="hint">${u.rootHidden ? 'Сейчас скрыты от всех' : 'Сейчас видны всем участникам'}</span></span>
      <input type="checkbox" class="switch" role="switch" id="rootVisible"${u.rootHidden ? '' : ' checked'}></label>
    <div class="f-list">${rows || '<p class="empty-s">Папок пока нет.</p>'}</div>
    <form class="inline" id="folderNew" novalidate>
      ${fieldHtml('fNewName', 'Новая папка', 'maxlength="40" autocomplete="off" placeholder="Например, Дом"')}
      <button class="btn" type="submit">${icon('plus')}Создать</button></form>
  </section>`;
}

function renderProfiles() {
  const box = $('#pfList'); if (!box) return;
  // Сначала заявки на вход, затем активные (вы — первым), затем отключённые.
  const rank = u => u.pending && !u.active ? 0 : u.active ? 1 : 2;
  const users = [...state.db.users].sort((a, b) =>
    rank(a) - rank(b) || ((b.id === state.me) - (a.id === state.me)) || a.name.localeCompare(b.name, 'ru'));
  box.innerHTML = users.map(profileHtml).join('') + (state.pfOpen === 'new'
    ? `<div class="pf open">${profileForm(null)}</div>`
    : `<button class="btn ghost block add-pf" type="button" data-pf-new>${icon('plus')}Новый профиль</button>`);
}
function profileHtml(u) {
  const open = state.pfOpen === u.id;
  const n = state.db.tasks.filter(t => t.assigneeId === u.id && t.status !== 'done').length;
  const waiting = u.pending && !u.active;
  const sub = [u.login ? esc(fmtLogin(u.login)) : 'нет входа', ROLES[u.role], waiting || u.active ? '' : 'отключён'].filter(Boolean).join(' · ');
  return `<div class="pf${u.active || waiting ? '' : ' off'}${open ? ' open' : ''}">
    <button type="button" class="pf-row" data-pf="${u.id}" aria-expanded="${open}">${avatar(u)}
      <span class="pf-txt"><b>${esc(u.name)}${u.id === state.me ? '<span class="tag">вы</span>' : ''}${waiting ? '<span class="tag">заявка</span>' : ''}</b><span class="hint">${sub}</span></span>
      <span class="cnt" title="Активных задач">${n || ''}</span>${icon('down', 'chev')}</button>
    ${open ? profileForm(u) : ''}</div>`;
}
function profileForm(u) {
  const id = u ? u.id : 'new';
  const lastAdmin = u && u.active && u.role === 'admin' && activeAdmins().length === 1;
  const hasLogin = !!u?.login;
  return `<form class="pf-form" data-pf-form="${id}" novalidate>
    ${u ? '' : '<h4>Новый профиль</h4>'}
    ${fieldHtml(`pf-${id}-name`, 'Ник', NICK_ATTRS.replace('nickname', 'off'), u?.name)}
    ${fieldHtml(`pf-${id}-login`, 'Номер телефона', `${PHONE_ATTRS} autocomplete="off"`, fmtLogin(u?.login))}
    ${pwFieldHtml(`pf-${id}-pw`, hasLogin ? 'Новый PIN' : 'PIN', 'new-password', hasLogin ? 'Пусто — не менять' : '6 цифр')}
    <div class="field"><label for="pf-${id}-role">Роль</label>
      <select class="input" id="pf-${id}-role"${lastAdmin ? ` disabled aria-describedby="pf-${id}-rh"` : ''}>
        ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${(u?.role || 'user') === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>${lastAdmin ? `<span class="hint" id="pf-${id}-rh">Единственного администратора нельзя понизить</span>` : ''}</div>
    <div class="field-error" id="pf-${id}-form-err" role="alert" hidden></div>
    <div class="row-actions">
      <button class="btn primary sm" type="submit">${u ? 'Сохранить' : 'Создать'}</button>
      <button class="btn ghost sm" type="button" data-pf-cancel>Отмена</button>
      ${u && u.id !== state.me ? `<button class="btn sm push${u.active ? ' ghost danger' : u.pending ? ' primary' : ' ghost'}" type="button" data-pf-toggle="${u.id}">${u.active ? 'Отключить' : u.pending ? 'Одобрить' : 'Включить'}</button>` : ''}
    </div></form>`;
}
function openProfile(id) {
  state.pfOpen = id;
  renderProfiles();
  const first = $(`#pf-${id}-name`);
  first?.focus({ preventScroll: true });
  first?.closest('.pf')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
}
function closeProfile() {
  const id = state.pfOpen; state.pfOpen = null;
  renderProfiles();
  ($(`[data-pf="${id}"]`) || $('[data-pf-new]'))?.focus({ preventScroll: true });
}
async function toggleActive(btn, id) {
  const u = user(id), on = !u.active;
  const data = { name: u.name, login: u.login, role: u.role, active: on, password: '' };
  btnBusy(btn, true, on ? (u.pending ? 'Одобряем…' : 'Включаем…') : 'Отключаем…');
  try { await backend.saveUser(id, data); }
  catch (e) { btnBusy(btn, false); setFormErr(id, errText(e)); return; }
  state.pfOpen = null;
  render(); renderProfiles();
  $(`[data-pf="${id}"]`)?.focus({ preventScroll: true });
  if (on && u.pending) toast(`${u.name}: доступ открыт`);
  if (!on) toast(`${u.name}: профиль отключён`, async () => {
    try { await backend.saveUser(id, { ...data, active: true }); render(); } catch (e) { toast(errText(e)); }
  });
}
function setFormErr(id, msg) { const box = $(`#pf-${id}-form-err`); if (box) { box.textContent = msg; box.hidden = !msg; } }

async function importDeviceTasks(btn) {
  const src = deviceTasks(); if (!src) return;
  const users = src.users || [];
  // Задачи попадают в «Мои задачи»; автор с устройства → профиль в базе: по номеру, затем по нику, иначе — вы.
  const map = localId => {
    const lu = users.find(x => x.id === localId); if (!lu) return state.me;
    const byLogin = lu.login && state.db.users.find(x => x.login === loginKey(lu.login));
    const byName = state.db.users.find(x => x.name.trim().toLowerCase() === lu.name.trim().toLowerCase());
    return (byLogin || byName)?.id || state.me;
  };
  const list = src.tasks.map(t => ({
    id: newId(), title: String(t.title || '').slice(0, 200) || 'Без названия', desc: String(t.desc || '').slice(0, 5000),
    status: STATUSES.some(s => s.id === t.status) ? t.status : 'todo', ownerId: state.me, assigneeId: state.me, authorId: map(t.authorId),
    createdAt: t.createdAt || Date.now(), updatedAt: t.updatedAt || t.createdAt || Date.now(), doneAt: t.status === 'done' ? t.doneAt || Date.now() : null,
  }));
  btnBusy(btn, true, 'Переносим…');
  try { await backend.insertTasks(list); }
  catch (e) { btnBusy(btn, false); toast(errText(e)); return; }
  try { localStorage.setItem(IMPORTED_KEY, String(Date.now())); } catch {}
  await backend.reload().catch(() => {});
  buildSettings(); render();
  toast(`Перенесено задач: ${list.length}`);
}

$('#stBody').addEventListener('click', e => {
  if (e.target.closest('#logoutBtn')) return logout();
  const g = e.target.closest('[data-g]');
  if (g) { state.gOpen = state.gOpen === g.dataset.g ? null : g.dataset.g; state.confirmDel = null; buildSettings(); $(`[data-g="${g.dataset.g}"]`)?.focus({ preventScroll: true }); return; }
  const gd = e.target.closest('[data-g-del]');
  if (gd && !gd.disabled) {
    const id = gd.dataset.gDel;
    if (state.confirmDel !== id) { state.confirmDel = id; buildSettings(); $(`[data-g-del="${id}"]`)?.focus(); return; }
    const name = group(id)?.name;
    state.confirmDel = null; state.gOpen = null;
    if (state.space === `g:${id}`) state.space = 'me';
    ops.removeGroup(id).then(okk => okk && toast(`Группа «${name}» удалена`));
    return;
  }
  const fp = e.target.closest('[data-f-prio]'); if (fp) return toggleFolderPrio(fp.dataset.fPrio);
  const fd = e.target.closest('[data-f-del]');
  if (fd) {
    const id = fd.dataset.fDel;
    if (state.confirmDel !== id) { state.confirmDel = id; buildSettings(); $(`[data-f-del="${id}"]`)?.focus(); return; }
    state.confirmDel = null;
    deleteFolder(id);
    return;
  }
  const imp = e.target.closest('#importBtn'); if (imp) return importDeviceTasks(imp);
  if (e.target.closest('[data-pf-new]')) return openProfile('new');
  if (e.target.closest('[data-pf-cancel]')) return closeProfile();
  const row = e.target.closest('[data-pf]');
  if (row) return state.pfOpen === row.dataset.pf ? closeProfile() : openProfile(row.dataset.pf);
  const tg = e.target.closest('[data-pf-toggle]');
  if (tg && !tg.disabled) toggleActive(tg, tg.dataset.pfToggle);
});
$('#stBody').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'prefAssignee') setPref('showAssignee', t.checked);
  else if (t.id === 'prefPrio') setPref('prioOff', !t.checked);
  else if (t.id === 'prefAnim') setPref('fxAnim', t.checked);
  else if (t.id === 'rootVisible') ops.patchSelf({ rootHidden: !t.checked });
  else if (t.dataset.member) {
    const u = user(t.dataset.member), g = group(t.dataset.group);
    (t.checked ? ops.addMember(g.id, u.id) : ops.removeMember(g.id, u.id))
      .then(okk => okk && toast(t.checked ? `${u.name} теперь в группе «${g.name}»` : `${u.name} исключён(а) из «${g.name}»`));
  } else if (t.dataset.fHide) {
    const f = folder(t.dataset.fHide);
    ops.patchFolder(f.id, { hidden: !t.checked }).then(okk => okk && toast(t.checked ? `«${f.name}» видна другим` : `«${f.name}» скрыта от всех`));
  } else if (t.closest('[data-f-rename]')) t.closest('form').requestSubmit();
});
// Название группы или папки: проверка, сохранение, сообщение об ошибке под полем.
function nameError(name, taken) {
  if (!name) return 'Введите название';
  if (name.length > 40) return 'До 40 символов';
  return taken ? 'Такое название уже есть' : '';
}
$('#stBody').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('[type=submit]', f);
  if (btn?.disabled) return;
  if (f.id === 'nameForm') {
    const inp = $('#stName'), name = inp.value.trim();
    if (!setErr(inp, nickError(name) || (nickTaken(name, state.me) ? 'Этот ник уже занят' : ''))) return inp.focus();
    if (name !== me().name && await ops.patchSelf({ name })) toast('Ник сохранён');
  } else if (f.id === 'pwForm') {
    const o = $('#stPwOld'), n = $('#stPwNew');
    const okO = setErr(o, o.value ? '' : 'Введите текущий PIN'), okN = setErr(n, pinError(n.value));
    if (!okO) return o.focus();
    if (!okN) return n.focus();
    btnBusy(btn, true, 'Сохраняем…');
    try { await backend.changePassword(o.value, n.value); }
    catch (err) {
      btnBusy(btn, false);
      const msg = errText(err);
      if (/текущий/.test(msg)) { setErr(o, msg); o.focus(); } else { setErr(n, msg); n.focus(); }
      return;
    }
    btnBusy(btn, false);
    o.value = ''; n.value = ''; $('#pwFold').open = false;
    toast('PIN изменён');
  } else if (f.dataset.pfForm) submitProfile(f, btn);
  else if (f.id === 'groupNew') {
    const inp = $('#gNewName'), name = inp.value.trim();
    if (!setErr(inp, nameError(name, state.db.groups.some(g => g.name.toLowerCase() === name.toLowerCase())))) return inp.focus();
    const g = { id: newId(), name, createdBy: state.me, createdAt: Date.now() };
    state.gOpen = g.id;
    if (await ops.addGroup(g)) { toast(`Группа «${name}» создана — добавьте участников`); buildSettings(); }
  } else if (f.dataset.gRename) {
    const id = f.dataset.gRename, inp = $(`#g-${id}-name`), name = inp.value.trim();
    if (!setErr(inp, nameError(name, state.db.groups.some(g => g.id !== id && g.name.toLowerCase() === name.toLowerCase())))) return inp.focus();
    if (name !== group(id).name && await ops.renameGroup(id, name)) toast('Название сохранено');
  } else if (f.id === 'folderNew') {
    const inp = $('#fNewName'), name = inp.value.trim();
    if (!setErr(inp, nameError(name, userFolders(state.me).some(x => x.name.toLowerCase() === name.toLowerCase())))) return inp.focus();
    if (await ops.addFolder({ id: newId(), ownerId: state.me, name, hidden: false, kind: 'user', createdAt: Date.now() })) { toast(`Папка «${name}» создана`); buildSettings(); $('#fNewName')?.focus(); }
  } else if (f.dataset.fRename) {
    const id = f.dataset.fRename, inp = $(`#f-${id}-name`), name = inp.value.trim(), fo = folder(id);
    if (!fo || name === fo.name) return;
    const err = nameError(name, userFolders(state.me).some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase()));
    if (err) { toast(err); inp.value = fo.name; return; }
    if (await ops.patchFolder(id, { name })) toast('Папка переименована');
  }
});
async function submitProfile(f, btn) {
  const id = f.dataset.pfForm, isNew = id === 'new', u = isNew ? null : user(id);
  const el = k => $(`#pf-${id}-${k}`, f);
  const name = el('name').value.trim(), login = el('login').value.trim(), pw = el('pw').value, roleSel = el('role');
  let bad = null;
  const check = (input, msg) => { if (!setErr(input, msg) && !bad) bad = input; };
  check(el('name'), nickError(name) || (nickTaken(name, u?.id) ? 'Этот ник уже занят' : ''));
  check(el('login'), loginError(login, u?.id));
  check(el('pw'), pw || isNew || !u.login ? pinError(pw) : '');
  setFormErr(id, '');
  if (bad) return bad.focus();
  const data = { name, login, role: roleSel.disabled ? u.role : roleSel.value, active: u ? u.active : true, password: pw };
  btnBusy(btn, true, isNew ? 'Создаём…' : 'Сохраняем…');
  let savedId;
  try { savedId = await backend.saveUser(u?.id || null, data); }
  catch (err) {
    btnBusy(btn, false);
    const msg = errText(err);
    if (/ник/i.test(msg)) { setErr(el('name'), msg); el('name').focus(); }
    else if (/номер/i.test(msg)) { setErr(el('login'), msg); el('login').focus(); }
    else if (/PIN/.test(msg)) { setErr(el('pw'), msg); el('pw').focus(); }
    else setFormErr(id, msg);
    return;
  }
  state.pfOpen = null;
  render();
  if (!$('#settings').open) return;
  if (state.page !== 'users') { buildSettings(); return; }
  renderProfiles();
  $(`[data-pf="${savedId}"]`)?.focus({ preventScroll: true });
  toast(isNew ? `Профиль создан: ${name}` : 'Профиль сохранён');
}
