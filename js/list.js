'use strict';
/* ---------- рендер ---------- */
function render(opts) {
  if (!state.me) return;
  renderTop();
  renderChips();
  renderComposerAssign();
  renderList(opts);
  if ($('#settings').open) refreshSettings();
}

// Значок описания склеен с последним словом, чтобы не переносился на строку один.
function titleHtml(t) {
  if (!t.desc) return esc(t.title);
  const i = t.title.lastIndexOf(' ');
  return `${esc(t.title.slice(0, i + 1))}<span class="nowrap">${esc(t.title.slice(i + 1))}${icon('text', 'has-desc')}</span><span class="sr-only">, есть описание</span>`;
}
function taskHtml(t) {
  const editing = state.editing === t.id, open = openIds().has(t.id);
  const rw = taskEditable(t), inGroup = !!t.groupId;
  const showA = pref('showAssignee') && inGroup, a = user(t.assigneeId), author = user(t.authorId), s = statusOf(t.status);
  const pill = `${statusIcon(s.id)}<span class="lbl">${s.label}</span>`;
  const statusMenu = rw ? menuHtml({ kind: 'status', id: t.id, cls: 'st', attrs: `data-s="${s.id}"`, btn: pill, label: `Статус: ${s.label}. Изменить`,
    items: STATUSES.map(x => itemHtml(x.id, `<span class="st-ic" data-s="${x.id}">${statusIcon(x.id)}</span>${x.label}`, x.id === s.id)).join('') })
    : `<span class="st ro" data-s="${s.id}">${pill}</span>`;
  const noA = '<span class="avatar" aria-hidden="true">–</span>';
  const assignMenu = !showA ? '' : rw ? menuHtml({ kind: 'assign', id: t.id, cls: 'av-btn', btn: a ? avatar(a) : noA,
    label: `Исполнитель: ${t.assigneeId === state.me ? 'вы' : a?.name || 'нет'}. Передать задачу`, items: assigneeItems(t.groupId, t.assigneeId) })
    : `<span class="av-btn ro">${a ? avatar(a) : noA}</span>`;
  const head = editing
    ? `<textarea class="t-title-input" id="et-${t.id}" rows="1" maxlength="200" autocomplete="off" aria-label="Название задачи" aria-describedby="et-${t.id}-err">${esc(t.title)}</textarea>`
    : `<button type="button" class="t-main" data-main="${t.id}" aria-expanded="${open}" aria-controls="tm-${t.id}"><span class="t-title">${titleHtml(t)}</span></button>`;
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
  return `<article class="task${t.status === 'done' ? ' done' : ''}${open ? ' open' : ''}${editing ? ' editing' : ''}" data-task="${t.id}">${
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
  const firstDone = tasks.findIndex(t => t.status === 'done');
  const doneCount = firstDone < 0 ? 0 : tasks.length - firstDone;
  const info = cur();
  const empty = !canWrite(info) ? 'Здесь задач нет или они скрыты.'
    : info.kind === 'group' && state.who !== 'all' ? `У «${esc(user(state.who)?.name || '—')}» задач нет.`
    : state.folder !== 'all' && info.kind === 'me' ? 'В папке пусто. Новая задача попадёт сюда.'
    : 'Задач нет. Добавьте первую — поле сверху.';
  list.innerHTML = tasks.length
    ? tasks.map((t, i) => (i === firstDone ? `<div class="sep" role="presentation">Готово · ${doneCount}</div>` : '') + taskHtml(t)).join('')
    : `<div class="empty">${icon('inbox')}<span>${empty}</span></div>`;

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
    const pill = $(`[data-menu="status"][data-id="${state.flash}"] .st`, list);
    if (pill && !reduced()) pill.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.05)' }, { transform: 'none' }], { duration: 260, easing: EASE });
    state.flash = null;
  }
}

/* ---------- новая задача ---------- */
function setDescOpen(open) {
  $('#cBox').classList.toggle('with-desc', open);
  $('#moreBtn').setAttribute('aria-expanded', String(open));
  $('#moreBtn').classList.toggle('has-text', !open && !!$('#nDesc').value.trim());
}
$('#moreBtn').addEventListener('click', () => {
  const open = !$('#cBox').classList.contains('with-desc');
  setDescOpen(open);
  (open ? $('#nDesc') : $('#nTitle')).focus();
});
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
  ops.addTasks([task]);
  const to = user(place.assigneeId);
  if (to && to.id !== state.me) toast(`Задача для ${to.name}`, () => ops.undoCreate(task.id));
  $('#nTitle').focus();
});
$('#nTitle').addEventListener('input', () => { delete $('#cBox').dataset.invalid; $('#nTitle').removeAttribute('aria-invalid'); $('#nTitleErr').hidden = true; });
$('#nDesc').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#newForm').requestSubmit();
  if (e.key === 'Escape') { setDescOpen(false); $('#nTitle').focus(); }
});

/* ---------- действия с задачами ---------- */
function setStatus(id, s) {
  const t = state.db.tasks.find(x => x.id === id);
  if (!t || t.status === s) return;
  state.flash = id;
  ops.patchTask(id, { status: s, doneAt: s === 'done' ? Date.now() : null });
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
