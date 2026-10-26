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
  renderList(opts);
  if ($('#settings').open) refreshSettings();
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
      t.desc ? `<span class="t-sub">${esc(t.desc.replace(/\s+/g, ' ').slice(0, 240))}</span>` : ''}${
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
      <div class="t-actions">
        <button class="btn primary sm" type="submit">Сохранить</button>
        <button class="btn ghost sm" type="button" data-cancel>Отмена</button>
        <button class="btn ghost sm danger push" type="button" data-del="${t.id}">${icon('trash')}Удалить</button>
      </div>`
    : `${t.desc ? `<p class="t-desc">${esc(t.desc)}</p>` : ''}
      <div class="t-meta">${meta.charAt(0).toUpperCase() + meta.slice(1)}</div>${trNote}
      ${rw ? `<div class="t-actions">
        <button class="btn ghost sm" type="button" data-edit="${t.id}">${icon('edit')}Изменить</button>
        ${tr ? `<button class="btn ghost sm" type="button" data-cancel-tr="${tr.id}">${icon('x')}Отменить передачу</button>`
          : `<button class="btn ghost sm" type="button" data-move="${t.id}">${icon('move')}Перенести</button>`}
        <button class="btn ghost sm danger" type="button" data-del="${t.id}">${icon('trash')}Удалить</button>
      </div>` : ''}`;
  const inner = `<div class="t-head">${head}<div class="t-side">${assignMenu}${statusMenu}</div></div>
    <div class="t-more" id="tm-${t.id}"><div class="t-more-in"><div class="t-pad">${more}</div></div></div>`;
  // t-fx — слой фона (лучи/переливание), --ro — свой поворот лучей у каждой задачи, чтобы карточки не были одинаковыми.
  return `<article class="task${t.status === 'done' ? ' done' : ''}${open ? ' open' : ''}${editing ? ' editing' : ''}" data-task="${t.id}" data-s="${s.id}" style="--ro:${hue(t.id)}deg"><span class="t-fx" aria-hidden="true"></span>${
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
  const now = Date.now(), place = newTaskPlace();
  const task = { id: newId(), title, desc: $('#nDesc').value.trim(), status: 'todo', ...place, authorId: state.me, createdAt: now, updatedAt: now, doneAt: null };
  // Поле очищаем сразу: повторный Enter создаст новую задачу, а не дубль этой.
  $('#nTitle').value = ''; $('#nDesc').value = ''; setDescOpen(false);
  state.newAssignee = undefined;
  state.view = 'active';  // новая задача — активная: показываем, куда она попала
  ops.addTasks([task]);
  const to = user(place.assigneeId);
  if (to && to.id !== state.me) toast(`Задача для ${to.name}`, () => ops.undoCreate(task.id));
  $('#nTitle').focus();
});
$('#nTitle').addEventListener('input', () => { delete $('#cBox').dataset.invalid; $('#nTitle').removeAttribute('aria-invalid'); $('#nTitleErr').hidden = true; });
$('#nDesc').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#newForm').requestSubmit();
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
  if (leaves) { state.leaving.set(id, s === 'done' ? 'done' : 'active'); closeCtx(); state.tapId = null; state.editing = null; }
  ops.patchTask(id, { status: s, doneAt: s === 'done' ? Date.now() : null });
  if (leaves) toast(s === 'done' ? 'Готово — задача в «Готовых»' : 'Задача снова в «Активных»',
    () => setStatus(id, from));
}
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

$('#list').addEventListener('click', e => {
  if (e.target.closest('[data-menu]')) return;
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
  if (titleEnter || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); saveEdit(f.dataset.form); }
});
