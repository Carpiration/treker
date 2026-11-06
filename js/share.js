'use strict';
/* ---------- общие папки: настройка (страница «Общая папка») ----------
   Администратор папки (её создатель) делает её общей, добавляет и убирает людей, отключает общий доступ.
   Участник видит состав и может выйти. Права на задачи — в spaces.js (taskEditable и др.) и в базе. */
function openShare(fid) { state.shareFolder = fid; state.shConfirm = null; openPage('share'); }

function buildSharePage() {
  const f = folder(state.shareFolder);
  if (!f) { $('#stBody').innerHTML = '<p class="empty-s">Папки больше нет или вы в ней не участвуете.</p>'; return; }
  const admin = f.ownerId === state.me, ask = state.shConfirm;
  const n = state.db.tasks.filter(t => !t.groupId && t.folderId === f.id && !t.deletedAt).length;
  const rules = `<ul class="sh-rules">
      <li>Задачи хранятся один раз и видны всем участникам.</li>
      <li>Статус задачи меняет любой участник — исполнитель, автор и администратор получают уведомление.</li>
      <li>Название, описание, фото, исполнителя и удаление меняют администратор и автор своей задачи.</li>
      <li>Важность чужой задачи участник меняет заявкой — администратор отвечает в колокольчике.</li>
      <li>В общей папке всегда видны статусы и «чья задача» — исполнитель.</li></ul>`;
  let body;
  if (!f.shared) {
    body = admin ? `<p class="hint">Сейчас папка личная. Сделайте её общей, и вы — её администратор — сможете добавить людей.</p>${rules}
      <button class="btn primary" type="button" data-sh-on>${icon('users')}Сделать общей</button>`
      : '<p class="empty-s">Папка больше не общая.</p>';
  } else {
    const people = folderPeople(f.id);
    const rows = people.map(u => `<div class="sh-row">${avatar(u)}
      <span class="sh-txt"><b>${esc(u.id === state.me ? `${u.name} (вы)` : u.name)}</b><span class="hint">${u.id === f.ownerId ? 'администратор' : 'участник'}</span></span>
      ${admin && u.id !== f.ownerId ? (ask === u.id
        ? `<button class="btn sm danger-solid" type="button" data-sh-del="${u.id}">Убрать?</button>`
        : `<button class="icon-btn danger-ic" type="button" data-sh-del="${u.id}" aria-label="Убрать из папки: ${esc(u.name)}" title="Убрать из папки">${icon('x')}</button>`) : ''}
    </div>`).join('');
    const rest = admin ? activeUsers().filter(u => u.id !== state.me && !isFolderMember(f.id, u.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru')) : [];
    body = `<div class="sh-list">${rows}</div>
      ${admin ? `<h3 class="st-sub">Добавить человека</h3>${rest.length
        ? `<div class="mv-list">${rest.map(u => `<button type="button" class="mv" data-sh-add="${u.id}">${avatar(u)}
            <span class="mv-txt"><b>${esc(u.name)}</b><span>${u.role === 'admin' ? 'Администратор приложения' : 'Сотрудник'}</span></span>${icon('plus', 'mv-go')}</button>`).join('')}</div>`
        : '<p class="empty-s">Все уже в папке.</p>'}` : ''}
      ${rules}
      ${admin ? (ask === 'off'
        ? `<p class="hint">Участники потеряют доступ, задачи останутся у вас в скрытой папке «${esc(f.name)}».</p>
           <div class="row-actions"><button class="btn danger-solid sm" type="button" data-sh-off>Да, отключить</button><button class="btn ghost sm" type="button" data-sh-no>Отмена</button></div>`
        : `<button class="btn ghost sm danger" type="button" data-sh-ask="off">Отключить общий доступ</button>`)
        : (ask === 'leave'
          ? `<p class="hint">Ваши задачи в папке останутся, исполнителем станет администратор.</p>
             <div class="row-actions"><button class="btn danger-solid sm" type="button" data-sh-leave>Да, выйти</button><button class="btn ghost sm" type="button" data-sh-no>Отмена</button></div>`
          : `<button class="btn ghost sm danger" type="button" data-sh-ask="leave">Покинуть папку</button>`)}`;
  }
  $('#stBody').innerHTML = `<section class="st-sec" aria-label="Общая папка">
    <p class="t-quote">«${esc(f.name)}» · задач: ${n}${f.shared ? ` · участников: ${folderPeople(f.id).length}` : ''}</p>${body}</section>`;
}

async function shareAct(fn, okMsg) {
  state.shConfirm = null;
  const okk = await fn();
  if (okk && okMsg) toast(okMsg);
  buildSettings();
}
$('#stBody').addEventListener('click', e => {
  if (state.page !== 'share') return;
  const f = folder(state.shareFolder); if (!f) return;
  if (e.target.closest('[data-sh-on]')) return shareAct(() => ops.setFolderShared(f.id, true), 'Папка стала общей — добавьте людей');
  if (e.target.closest('[data-sh-no]')) { state.shConfirm = null; return buildSettings(); }
  const ask = e.target.closest('[data-sh-ask]'); if (ask) { state.shConfirm = ask.dataset.shAsk; return buildSettings(); }
  if (e.target.closest('[data-sh-off]')) return shareAct(() => ops.setFolderShared(f.id, false), 'Общий доступ отключён');
  const add = e.target.closest('[data-sh-add]'); if (add) return shareAct(() => ops.addFolderMember(f.id, add.dataset.shAdd), `${nick(add.dataset.shAdd)} добавлен(а) в папку`);
  const del = e.target.closest('[data-sh-del]');
  if (del) {
    const id = del.dataset.shDel;
    if (state.shConfirm !== id) { state.shConfirm = id; buildSettings(); return $(`[data-sh-del="${id}"]`)?.focus(); }
    return shareAct(() => ops.removeFolderMember(f.id, id), `${nick(id)} убран(а) из папки`);
  }
  if (e.target.closest('[data-sh-leave]')) {
    state.shConfirm = null;
    return ops.removeFolderMember(f.id, state.me).then(okk => { if (okk) { toast(`Вы вышли из папки «${f.name}»`); openPage('folders'); } });
  }
});
