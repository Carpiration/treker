'use strict';
/* ---------- рендер ---------- */
// Классы вида на <body>: действуют и на список, и на предпросмотр в настройках.
function applyLook(p = pref) {
  applyAccentBg(k => k in lookDraft ? lookDraft[k] : p(k));
  const b = document.body.classList;
  for (const v of ['rays', 'outline', 'off']) b.toggle(`fx-${v}`, p('taskFx') === v);
  b.toggle('fx-anim', !!p('fxAnim') && p('taskFx') !== 'off');
  for (const v of ['pill', 'dot', 'hide']) b.toggle(`st-${v}`, p('statusView') === v);
}
function render(opts) {
  if (!state.me) return;
  applyLook();
  renderTop();
  renderChips();
  renderComposerAssign();
  renderComposerPrio();
  renderList(opts);
  if ($('#settings').open) refreshSettings();
}

// Короткий предпросмотр описания: до 200 знаков, переносы строк и маркеры списка сохраняются.
function subText(d) {
  const s = d.trim().replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n');
  if (s.length <= 200) return s;
  const cut = s.slice(0, 200), sp = cut.search(/\s\S{0,12}$/);
  return (sp > 120 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}
function taskHtml(t) {
  const editing = state.editing === t.id, open = openIds().has(t.id);
  const rw = taskEditable(t), inGroup = !!t.groupId;
  const showA = pref('showAssignee') && inGroup, a = user(t.assigneeId), author = user(t.authorId), s = statusOf(t.status);
  const view = pref('statusView');
  // Статус в строке: метка с текстом, цветной индикатор или ничего (меняется через меню задачи).
  const pill = view === 'dot' ? `<span class="dot" aria-hidden="true"></span><span class="sr-only">${s.label}</span>`
    : `${statusIcon(s.id)}<span class="lbl">${s.label}</span>`;
  const stCls = view === 'dot' ? 'st st-ind' : 'st';
  const statusMenu = view === 'hide' ? '' : rw ? menuHtml({ kind: 'status', id: t.id, cls: stCls, attrs: `data-s="${s.id}" title="${s.label}"`, btn: pill, label: `Статус: ${s.label}. Изменить`,
    items: STATUSES.map(x => itemHtml(x.id, `<span class="st-ic" data-s="${x.id}">${statusIcon(x.id)}</span>${x.label}`, x.id === s.id)).join('') })
    : `<span class="${stCls} ro" data-s="${s.id}" title="${s.label}">${pill}</span>`;
  const noA = '<span class="avatar" aria-hidden="true">–</span>';
  const assignMenu = !showA ? '' : rw ? menuHtml({ kind: 'assign', id: t.id, cls: 'av-btn', btn: a ? avatar(a) : noA,
    label: `Исполнитель: ${t.assigneeId === state.me ? 'вы' : a?.name || 'нет'}. Передать задачу`, items: assigneeItems(t.groupId, t.assigneeId) })
    : `<span class="av-btn ro">${a ? avatar(a) : noA}</span>`;
  const head = editing
    ? `<textarea class="t-title-input" id="et-${t.id}" rows="1" maxlength="200" autocomplete="off" aria-label="Название задачи" aria-describedby="et-${t.id}-err">${esc(t.title)}</textarea>`
    : `<button type="button" class="t-main" data-main="${t.id}" aria-expanded="${open}" aria-controls="tm-${t.id}"><span class="t-title">${esc(t.title)}</span>${
      t.desc ? `<span class="t-sub"><span class="t-sub-in">${esc(subText(t.desc))}</span></span>` : ''}${
      view === 'hide' ? `<span class="sr-only">, ${s.label}</span>` : ''}</button>`;
  const meta = [
    showA ? (a ? `Исполнитель: ${esc(a.name)}` : 'без исполнителя') : '',
    !inGroup && t.folderId && folder(t.folderId) && state.folder === 'all' ? `папка «${esc(folder(t.folderId).name)}»` : '',
    `создал(а) ${esc(author?.name || '—')}, ${when(t.createdAt)}`,
    t.status === 'done' && t.doneAt ? `готово ${when(t.doneAt)}` : '',
  ].filter(Boolean).join(' · ');
  const tr = pendingTransfer(t.id);
  const trNote = tr ? `<div class="t-wait">${icon('clock')}Ждёт согласия: ${esc(user(tr.toId)?.name || '—')}</div>` : '';
  const more = editing ? `
      <div class="field-error" id="et-${t.id}-err" hidden></div>
      <label class="sr-only" for="ed-${t.id}">Описание</label>
      <textarea class="t-desc-input" id="ed-${t.id}" maxlength="5000" placeholder="Описание: что именно, где, как проверить">${esc(t.desc)}</textarea>
      ${imgsHtml(t, true)}
      <div class="t-actions">
        <button class="btn primary sm" type="submit">Сохранить</button>
        <button class="btn ghost sm" type="button" data-cancel>Отмена</button>
        <button class="btn ghost sm danger push" type="button" data-del="${t.id}">${icon('trash')}Удалить</button>
      </div>`
    : `${t.desc ? `<p class="t-desc">${esc(t.desc)}</p>` : ''}${imgsHtml(t, false)}
      <div class="t-meta">${meta.charAt(0).toUpperCase() + meta.slice(1)}</div>${trNote}
      ${rw || t.desc ? `<div class="t-actions">${rw ? `
        <button class="btn ghost sm" type="button" data-edit="${t.id}">${icon('edit')}Изменить</button>
        ${tr ? `<button class="btn ghost sm" type="button" data-cancel-tr="${tr.id}">${icon('x')}Отменить передачу</button>`
          : `<button class="btn ghost sm" type="button" data-move="${t.id}">${icon('move')}Перенести</button>`}
        <button class="btn ghost sm danger" type="button" data-del="${t.id}">${icon('trash')}Удалить</button>` : ''}
        ${t.desc ? `<button class="icon-btn t-copy" type="button" data-copy="${t.id}" aria-label="Скопировать описание" title="Скопировать описание">${icon('copy')}</button>` : ''}
      </div>` : ''}`;
  // Метка важности слева (в папках с режимом «Важно / Потом»): нажатие переключает.
  const pr = taskPrio(t), prLbl = t.important ? 'Важно' : 'Потом';
  const prHtml = !pr ? '' : rw
    ? `<button type="button" class="t-pr" data-pr="${t.id}" aria-label="${prLbl}. Сделать «${t.important ? 'Потом' : 'Важно'}»" title="${prLbl} — нажмите, чтобы сделать «${t.important ? 'Потом' : 'Важно'}»"><span>${prLbl}</span></button>`
    : `<span class="t-pr ro" title="${prLbl}"><span>${prLbl}</span></span>`;
  // Свёрнутая задача: изображения — ровной полоской внизу, под описанием (раскрытая показывает их после полного описания).
  const strip = !editing && t.images?.length ? `<div class="t-strip" role="group" aria-label="Изображения">${t.images.map((k, i) =>
    `<button type="button" class="img-btn" data-view-img="${t.id}" data-i="${i}" tabindex="${open ? -1 : 0}" aria-label="Изображение ${i + 1} из ${t.images.length} — открыть">${thumbImg(k)}</button>`).join('')}</div>` : '';
  const inner = `${prHtml}<div class="t-head">${head}<div class="t-side">${assignMenu}${statusMenu}</div></div>${strip}
    <div class="t-more" id="tm-${t.id}"><div class="t-more-in"><div class="t-pad">${more}</div></div></div>`;
  // t-fx — слой фона (лучи/переливание), --ro — свой поворот лучей у каждой задачи, чтобы карточки не были одинаковыми.
  return `<article class="task${t.status === 'done' ? ' done' : ''}${open ? ' open' : ''}${editing ? ' editing' : ''}${pr ? ` has-pr pr-${t.important ? 'hi' : 'lo'}` : ''}" data-task="${t.id}" data-s="${s.id}" style="--ro:${hue(t.id)}deg"><span class="t-fx" aria-hidden="true"></span>${
    editing ? `<form data-form="${t.id}" novalidate>${inner}</form>` : inner}</article>`;
}

function focusSelector() {
  const a = document.activeElement;
  if (!a || a === document.body || !$('#list').contains(a)) return null;
  const m = a.closest('[data-menu]');
  if (m) return `[data-menu="${m.dataset.menu}"][data-id="${m.dataset.id}"] .menu-btn`;
  if (a.id) return `#${CSS.escape(a.id)}`;
  if (a.dataset.main) return `[data-main="${a.dataset.main}"]`;
  return null;
}

// FLIP: строки плавно переезжают на новые места, новые — проявляются.
function renderList({ flip = true } = {}) {
  const list = $('#list'), animate = flip && !reduced();
  const prev = new Map();
  if (animate) $$('[data-task]', list).forEach(el => prev.set(el.dataset.task, el.getBoundingClientRect().top));
  const ed = state.editing && $(`#et-${CSS.escape(state.editing)}`);
  const draft = ed && { title: ed.value, desc: $(`#ed-${CSS.escape(state.editing)}`).value };
  const fsel = focusSelector(), fa = document.activeElement;
  const sel = fa && 'selectionStart' in fa && fsel?.startsWith('#') ? [fa.selectionStart, fa.selectionEnd] : null;

  const tasks = visibleTasks();
  if (state.editing && !tasks.some(t => t.id === state.editing)) state.editing = null;
  const info = cur();
  const empty = !canWrite(info) ? 'Здесь задач нет или они скрыты.'
    : info.kind === 'group' && state.who !== 'all' ? `У «${esc(user(state.who)?.name || '—')}» задач нет.`
    : state.folder !== 'all' && info.kind === 'me' ? 'В папке пусто. Новая задача попадёт сюда.'
    : 'Задач нет. Добавьте первую — поле сверху.';
  list.innerHTML = tasks.length
    ? tasks.map(taskHtml).join('')
    : `<div class="empty">${icon('inbox')}<span>${empty}</span></div>`;
  // Строка со сменённым статусом нарисована заново: стартуем со старого цвета (до любых замеров — иначе
  // браузер успеет посчитать новый цвет) и в следующем кадре плавно перетекаем в новый (--st анимируемое).
  const morph = state.flash?.from && !reduced() && $(`[data-task="${state.flash.id}"]`, list);
  if (morph) {
    morph.style.setProperty('--st', `var(--st-${state.flash.from})`);
    morph.getBoundingClientRect();
    requestAnimationFrame(() => morph.style.removeProperty('--st'));
  }

  const et = state.editing && $(`#et-${CSS.escape(state.editing)}`);
  if (draft && et) { et.value = draft.title; $(`#ed-${CSS.escape(state.editing)}`).value = draft.desc; }
  if (fsel) { const el = $(fsel, list); if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch {} } }

  if (animate) {
    let k = 0;
    $$('[data-task]', list).forEach(el => {
      const top = prev.get(el.dataset.task);
      if (top === undefined) {
        el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 220, easing: EASE, delay: Math.min(k++ * 18, 180), fill: 'backwards' });
      } else {
        const dy = top - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
      }
    });
  }
  if (state.flash) {
    const pill = $(`[data-menu="status"][data-id="${state.flash.id}"] .st`, list);
    if (pill && !reduced()) pill.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.05)' }, { transform: 'none' }], { duration: 260, easing: EASE });
    state.flash = null;
  }
  for (const [id, to] of state.leaving) if (!list.querySelector(`[data-task="${id}"].leaving`)) flyAway(id, to);
  hydrateImages(list);
}

// Завершение (или возврат из «Готовых»): вспышка цветом статуса, затем задача улетает к переключателю.
function flyAway(id, to) {
  const el = $(`#list [data-task="${id}"]`), seg = $(`#viewSeg [data-view="${to}"]`);
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    state.leaving.delete(id);
    render();
    if (!reduced()) seg?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: EASE });
  };
  if (!el || !seg || reduced()) return finish();
  el.classList.add('leaving');
  const r = el.getBoundingClientRect(), s = seg.getBoundingClientRect();
  const dx = s.left + s.width / 2 - (r.left + r.width / 2), dy = s.top + s.height / 2 - (r.top + r.height / 2);
  el.animate([
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: 'scale(1.025)', opacity: 1, offset: .32 },
    { transform: 'scale(1)', opacity: 1, offset: .45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: .15, offset: 1 },
  ], { duration: 950, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'forwards' }).onfinish = finish;
  setTimeout(finish, 1200);  // в фоновой вкладке анимация может не закончиться
}

/* ---------- новая задача ---------- */
// Описание: свёрнуто — тонкая полоска с подсказкой или началом текста; раскрыто — поле фиксированной высоты.
// Сворачивается, когда фокус уходит из описания (клик вне поля, Esc, отправка).
function setDescOpen(open) {
  const box = $('#cBox'), ta = $('#nDesc'), text = ta.value.trim();
  box.classList.toggle('with-desc', open);
  $('#descPeek').setAttribute('aria-expanded', String(open));
  ta.tabIndex = open ? 0 : -1;
  $('#descPeekTx').textContent = text ? text.replace(/\s+/g, ' ') : 'Описание — необязательно';
  $('#descPeek').classList.toggle('has-text', !!text);
}
$('#descPeek').addEventListener('click', () => { setDescOpen(true); $('#nDesc').focus(); });
// Нажатие на «Добавить», выбор исполнителя и метку важности не забирает фокус у описания: иначе описание сворачивается
// прямо под курсором, кнопка становится ниже, и клик проходит мимо — задача не добавлялась.
['.c-side', '#nPrio'].forEach(s => $(s).addEventListener('mousedown', e => { if ($('#cBox').classList.contains('with-desc') && e.target.closest('button')) e.preventDefault(); }));
$('#nDesc').addEventListener('focusout', e => { if (!e.relatedTarget || !$('#cDesc').contains(e.relatedTarget)) setDescOpen(false); });
$('#newForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#nTitle').value.trim();
  if (!title) {
    $('#cBox').dataset.invalid = ''; $('#nTitle').setAttribute('aria-invalid', 'true');
    $('#nTitleErr').textContent = 'Напишите, что нужно сделать'; $('#nTitleErr').hidden = false;
    $('#nTitle').focus(); return;
  }
  if (!canWrite()) return;
  const now = Date.now(), place = newTaskPlace(), id = newId();
  const task = { id, title, desc: $('#nDesc').value.trim(), status: 'todo', ...place, images: composerImages(id),
    authorId: state.me, createdAt: now, updatedAt: now, doneAt: null };
  // Поле очищаем сразу: повторный Enter создаст новую задачу, а не дубль этой.
  $('#nTitle').value = ''; $('#nDesc').value = ''; setDescOpen(false);
  state.newAssignee = undefined; state.newImportant = null;
  // Показываем вкладку, куда попала новая задача.
  state.view = viewPrio() ? (task.important ? 'important' : 'later') : 'active';
  ops.addTasks([task]);
  renderComposerImages();
  const to = user(place.assigneeId);
  if (to && to.id !== state.me) toast(`Задача для ${to.name}`, () => ops.undoCreate(task.id));
  $('#nTitle').focus();
});
$('#nTitle').addEventListener('input', () => { delete $('#cBox').dataset.invalid; $('#nTitle').removeAttribute('aria-invalid'); $('#nTitleErr').hidden = true; });
// Клавиатура (ПК): Enter — новая строка (из названия — переход в описание), Shift+Enter (или Ctrl+Enter) — добавить задачу.
// На телефоне Enter в названии по-прежнему добавляет: у экранной клавиатуры нет Shift+Enter.
const addKey = e => e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey) && !e.isComposing;
$('#nTitle').addEventListener('keydown', e => {
  if (addKey(e)) { e.preventDefault(); $('#newForm').requestSubmit(); return; }
  if (e.key === 'Enter' && !e.isComposing && finePointer()) {
    e.preventDefault();
    setDescOpen(true);
    const d = $('#nDesc'); d.focus(); d.setSelectionRange(d.value.length, d.value.length);
  }
});
$('#nDesc').addEventListener('keydown', e => {
  if (addKey(e)) { e.preventDefault(); $('#newForm').requestSubmit(); }
  if (e.key === 'Escape') { e.preventDefault(); $('#nTitle').focus(); }
});

/* ---------- действия с задачами ---------- */
function setStatus(id, s) {
  const t = state.db.tasks.find(x => x.id === id);
  if (!t || t.status === s) return;
  const from = t.status;
  state.flash = { id, from };
  // Задача уходит из текущего списка (в «Готовые» или обратно) — сначала анимация, потом исчезает.
  const leaves = (s === 'done') !== (from === 'done');
  const to = s === 'done' ? 'done' : tabOf({ ...t, status: s });
  if (leaves) { state.leaving.set(id, to); closeCtx(); state.tapId = null; state.editing = null; }
  ops.patchTask(id, { status: s, doneAt: s === 'done' ? Date.now() : null });
  if (leaves) toast(s === 'done' ? 'Готово — задача в «Готовых»' : `Задача снова в «${VIEWS[to]}»`,
    () => setStatus(id, from));
}
// Важно ↔ Потом. В папке с режимом задача уходит на другую вкладку — с той же анимацией, что и «Готово».
function setImportant(id, v) {
  const t = state.db.tasks.find(x => x.id === id);
  if (!t || !!t.important === v || !taskEditable(t)) return;
  const prio = viewPrio(), leaves = prio && t.status !== 'done' && effView(prio) !== 'active';
  const to = v ? 'important' : 'later';
  if (leaves) { state.leaving.set(id, to); closeCtx(); state.tapId = null; if (state.editing === id) saveEdit(id, true); }
  ops.patchTask(id, { important: v });
  toast(leaves ? `Задача в «${VIEWS[to]}»` : v ? 'Отмечено: важно' : 'Отмечено: потом', () => setImportant(id, !v));
}
/* метка важности у поля новой задачи (видна в папке с режимом) */
function renderComposerPrio() {
  const b = $('#nPrio'), on = viewPrio() && canWrite();
  b.hidden = !on; $('#cBox').classList.toggle('has-pr', on);
  if (!on) return;
  const hi = newImportant();
  b.className = `t-pr c-pr pr-${hi ? 'hi' : 'lo'}`;
  b.innerHTML = `<span>${hi ? 'Важно' : 'Потом'}</span>`;
  b.setAttribute('aria-label', `Новая задача: ${hi ? 'важно' : 'потом'}. Переключить`);
  b.title = `Новая задача — «${hi ? 'Важно' : 'Потом'}». Нажмите, чтобы переключить`;
}
$('#nPrio').addEventListener('click', () => { state.newImportant = !newImportant(); renderComposerPrio(); });
function transfer(taskId, toId) {
  if (toId === 'none') toId = null;
  const t = state.db.tasks.find(x => x.id === taskId);
  if (!t || t.assigneeId === toId) return;
  const from = t.assigneeId;
  if (state.editing === taskId) saveEdit(taskId, true);
  ops.patchTask(taskId, { assigneeId: toId });
  const msg = !toId ? 'Исполнитель снят' : toId === state.me ? 'Задача теперь ваша' : `Задача передана: ${user(toId).name}`;
  toast(msg, () => { if (state.db.tasks.find(x => x.id === taskId)?.assigneeId === toId) ops.patchTask(taskId, { assigneeId: from }); });
}
function startEdit(id) {
  if (state.editing && state.editing !== id) saveEdit(state.editing, true);
  state.editing = id;
  renderList({ flip: false });
  const inp = $(`#et-${CSS.escape(id)}`);
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
// quiet: сохраняем черновик молча (при переходе к другой задаче), пустое название — не сохраняем.
function saveEdit(id, quiet = false) {
  const ti = $(`#et-${CSS.escape(id)}`); if (!ti) return true;
  const title = ti.value.replace(/\s*\n\s*/g, ' ').trim(), desc = $(`#ed-${CSS.escape(id)}`).value.trim();
  if (!title) {
    if (quiet) { state.editing = null; return true; }
    setErr(ti, 'Название не может быть пустым'); ti.focus(); return false;
  }
  state.editing = null;
  const t = state.db.tasks.find(x => x.id === id);
  if (t && (t.title !== title || (t.desc || '') !== desc)) ops.patchTask(id, { title, desc });
  else renderList({ flip: false });
  if (!quiet) $(`[data-main="${id}"]`)?.focus({ preventScroll: true });
  return true;
}
function cancelEdit() {
  const id = state.editing; state.editing = null;
  renderList({ flip: false });
  $(`[data-main="${id}"]`)?.focus({ preventScroll: true });
}
function removeTask(id) {
  const el = $(`#list [data-task="${id}"]`);
  if (!el || el.dataset.removing) return;
  el.dataset.removing = '1';
  const hadFocus = el.contains(document.activeElement);
  const next = el.nextElementSibling?.closest?.('[data-task]') ? el.nextElementSibling : el.previousElementSibling;
  const nextId = next?.dataset?.task;
  let gone = false;
  const go = () => {
    if (gone) return; gone = true;
    if (state.editing === id) state.editing = null;
    if (state.tapId === id) state.tapId = null;
    ops.archiveTask(id);
    if (hadFocus) ($(`[data-main="${nextId}"]`) || $('#nTitle')).focus({ preventScroll: true });
    toast('Задача в архиве на 30 дней', () => ops.restoreTask(id));
  };
  if (reduced()) return go();
  el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }], { duration: 160, easing: EASE, fill: 'forwards' }).onfinish = go;
  // Данные не должны ждать анимацию: в фоновой вкладке кадры не рисуются и onfinish откладывается.
  setTimeout(go, 200);
}

/* ---------- копирование: описание и изображения ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Запасной путь (старые браузеры, Android-оболочка).
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  (document.querySelector('dialog[open]') || document.body).append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
async function copyDesc(id, btn) {
  const t = state.db.tasks.find(x => x.id === id); if (!t?.desc) return;
  if (await copyText(t.desc)) {
    toast('Описание скопировано');
    btn?.classList.add('copied'); setTimeout(() => btn?.classList.remove('copied'), 1200);
  } else toast('Не удалось скопировать — выделите текст и скопируйте вручную');
}
$('#list').addEventListener('click', e => {
  if (e.target.closest('[data-menu]')) return;
  const cp = e.target.closest('[data-copy]'); if (cp) return copyDesc(cp.dataset.copy, cp);
  const pr = e.target.closest('[data-pr]');
  if (pr) { const t = state.db.tasks.find(x => x.id === pr.dataset.pr); return t && setImportant(t.id, !t.important); }
  const ed = e.target.closest('[data-edit]'); if (ed) return startEdit(ed.dataset.edit);
  const del = e.target.closest('[data-del]'); if (del) return removeTask(del.dataset.del);
  const mv = e.target.closest('[data-move]'); if (mv) return openMove(mv.dataset.move);
  const ct = e.target.closest('[data-cancel-tr]'); if (ct) return cancelTransfer(ct.dataset.cancelTr, ct);
  if (e.target.closest('[data-cancel]')) return cancelEdit();
  const main = e.target.closest('[data-main]');
  if (main) {
    const id = main.dataset.main;
    // Касание раскрывает подробности (наведения нет); клик мышью и Enter — сразу редактирование.
    if (lastPointer === 'touch' && e.detail !== 0) { state.tapId = state.tapId === id ? null : id; applyPeek(); }
    else startEdit(id);
  }
});
$('#list').addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault(); saveEdit(f.dataset.form);
});
$('#list').addEventListener('keydown', e => {
  const f = e.target.closest('[data-form]'); if (!f || e.target.closest('[data-menu]')) return;
  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  // Название — многострочное поле только для переноса: Enter сохраняет, а не добавляет строку.
  const titleEnter = e.key === 'Enter' && !e.shiftKey && e.target.classList.contains('t-title-input');
  if (titleEnter || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey))) { e.preventDefault(); saveEdit(f.dataset.form); }
});
