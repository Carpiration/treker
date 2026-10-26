'use strict';
// Данные: Supabase, кеш state.db, изменения «сразу на экране, затем на сервере», синхронизация.
function cloudBackend() {
  const auth = key => ({ auth: { persistSession: key !== 'treker-temp', autoRefreshToken: key !== 'treker-temp', detectSessionInUrl: false, storageKey: key } });
  const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, auth('treker-auth'));
  // Отдельный клиент без сохранения сессии: проверить текущий PIN, не выходя из своего профиля.
  let tempClient = null;
  const temp = () => (tempClient ||= supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, auth('treker-temp')));
  const email = login => `${loginKey(login)}@${CFG.loginDomain || 'treker.local'}`;
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const iso = ms => ms == null ? null : new Date(ms).toISOString();
  // Поля приложения ↔ колонки базы. Даты в приложении — миллисекунды.
  const COLS = {
    tasks: { id: 'id', title: 'title', desc: 'descr', status: 'status', assigneeId: 'assignee_id', authorId: 'author_id',
      groupId: 'group_id', ownerId: 'owner_id', folderId: 'folder_id', createdAt: 'created_at', updatedAt: 'updated_at', doneAt: 'done_at', deletedAt: 'deleted_at' },
    notifications: { readAt: 'read_at' },
    profiles: { id: 'id', name: 'name', prefs: 'prefs', rootHidden: 'root_hidden', avatar: 'avatar' },
    groups: { id: 'id', name: 'name', createdBy: 'created_by' },
    group_members: { groupId: 'group_id', userId: 'user_id' },
    folders: { id: 'id', ownerId: 'owner_id', name: 'name', hidden: 'hidden', kind: 'kind' },
  };
  const toRow = (table, o) => Object.fromEntries(Object.entries(o).filter(([k]) => k in COLS[table])
    .map(([k, v]) => [COLS[table][k], k.endsWith('At') ? iso(v) : v]));
  const toTask = r => ({ id: r.id, title: r.title, desc: r.descr, status: r.status, assigneeId: r.assignee_id, authorId: r.author_id,
    groupId: r.group_id, ownerId: r.owner_id, folderId: r.folder_id,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), doneAt: r.done_at ? Date.parse(r.done_at) : null,
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null, deletedBy: r.deleted_by });
  const toNote = r => ({ id: r.id, kind: r.kind, taskId: r.task_id, title: r.title, actorId: r.actor_id, data: r.data || {},
    transferId: r.transfer_id, readAt: r.read_at ? Date.parse(r.read_at) : null, createdAt: Date.parse(r.created_at) });
  const toTransfer = r => ({ id: r.id, taskId: r.task_id, fromId: r.from_id, toId: r.to_id, folderId: r.folder_id, status: r.status });
  const toEvent = r => ({ id: r.id, taskId: r.task_id, title: r.title, actorId: r.actor_id, kind: r.kind, data: r.data || {},
    groupId: r.group_id, ownerId: r.owner_id, folderId: r.folder_id, createdAt: Date.parse(r.created_at) });
  const toUser = r => ({ id: r.id, name: r.name, login: r.login, role: r.role, active: r.active, pending: !!r.pending,
    prefs: r.prefs || {}, rootHidden: !!r.root_hidden, avatar: r.avatar || null });
  const toGroup = r => ({ id: r.id, name: r.name, createdAt: Date.parse(r.created_at) });
  const toMember = r => ({ groupId: r.group_id, userId: r.user_id });
  const toFolder = r => ({ id: r.id, ownerId: r.owner_id, name: r.name, hidden: r.hidden, kind: r.kind, createdAt: Date.parse(r.created_at) });
  // Строка таблицы по ключу: { id } или составной ключ участника группы.
  const match = (q, key) => { for (const [k, v] of Object.entries(key)) q = q.eq(k, v); return q; };
  let uid = null, chan = null;
  return {
    mode: 'cloud',
    async start() {
      const { data } = await sb.auth.getSession();
      uid = data.session?.user.id || null;
      if (!uid) return null;
      await this.reload();
      if (!user(uid)?.active) { await this.logout(); return null; }
      return uid;
    },
    async needsSetup() { return ok(await sb.rpc('needs_setup')); },
    // Профиль создаёт база (register_user): первый зарегистрированный — администратор, остальные ждут одобрения.
    async register(name, phone, pin) {
      const active = ok(await sb.rpc('register_user', { p_name: name, p_phone: normPhone(phone), p_pin: pin }));
      if (!active) return { active: false, pending: true };
      return { id: await this.login(phone, pin), active: true };
    },
    async login(login, pw) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email(login), password: pw });
      if (error) throw authError(error);
      uid = data.user.id;
      await this.reload();
      if (!user(uid)?.active) { const u = user(uid); await this.logout(); throw new Error(inactiveText(u)); }
      return uid;
    },
    async logout() { uid = null; this.unsubscribe(); await sb.auth.signOut({ scope: 'local' }).catch(() => {}); },
    async reload() {
      const [u, t, g, m, f] = await Promise.all(['profiles', 'tasks', 'groups', 'group_members', 'folders'].map(x => sb.from(x).select('*')));
      const [n, tr, ft] = await Promise.all([
        sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('task_transfers').select('*').eq('status', 'pending'),
        sb.from('folder_transfers').select('*').eq('status', 'pending'),
      ]);
      state.db = { users: ok(u).map(toUser), tasks: ok(t).map(toTask), groups: ok(g).map(toGroup), members: ok(m).map(toMember),
        folders: ok(f).map(toFolder), notes: ok(n).map(toNote), transfers: ok(tr).map(toTransfer),
        ftransfers: ok(ft).map(r => ({ id: r.id, folderId: r.folder_id, fromId: r.from_id, toId: r.to_id, name: r.name, status: r.status })) };
    },
    // Общие операции: таблица, объект с полями приложения, ключ строки (в колонках базы).
    async insert(table, list) { ok(await sb.from(table).insert([].concat(list).map(o => toRow(table, o)))); },
    async update(table, key, f) { ok(await match(sb.from(table).update(toRow(table, f)), key)); },
    // Возвращает удалённые строки: пустой список — правила доступа не дали удалить.
    async remove(table, key) { return ok(await match(sb.from(table).delete(), key).select()); },
    async rpc(name, args) { return ok(await sb.rpc(name, args)); },
    // Журнал: последние события с фильтрами; before — id, с которого продолжить («Показать ещё»).
    async loadEvents({ actor, kind, group, owner, before, limit = 100 } = {}) {
      let q = sb.from('task_events').select('*').order('id', { ascending: false }).limit(limit);
      if (actor) q = q.eq('actor_id', actor);
      if (kind) q = q.in('kind', [].concat(kind));
      if (group) q = q.eq('group_id', group);
      if (owner) q = q.eq('owner_id', owner).is('group_id', null);
      if (before) q = q.lt('id', before);
      return ok(await q).map(toEvent);
    },
    // Своё фото: в папку <id>/ хранилища avatars; старое удаляем после замены.
    async uploadAvatar(blob, ext) {
      const path = `${uid}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      return path;
    },
    async removeAvatar(path) { await sb.storage.from('avatars').remove([path]).catch(() => {}); },
    async removePush(endpoint) { ok(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
    async pushTest() {
      const { data, error } = await sb.functions.invoke('push', { body: { op: 'test' } });
      if (error) throw error;
      return data;
    },
    async markRead() { ok(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null)); },
    async clearRead() { ok(await sb.from('notifications').delete().eq('user_id', uid).not('read_at', 'is', null)); },
    insertTasks(list) { return this.insert('tasks', list); },
    updateTask(id, f) { return this.update('tasks', { id }, f); },
    deleteTask(id) { return this.remove('tasks', { id }); },
    updateSelf(f) { return this.update('profiles', { id: uid }, f); },
    async changePassword(oldPw, newPw) {
      const chk = await temp().auth.signInWithPassword({ email: email(user(uid).login), password: oldPw });
      if (chk.error) throw new Error(/invalid login/i.test(chk.error.message) ? 'Неверный текущий PIN' : chk.error.message);
      await temp().auth.signOut({ scope: 'local' }).catch(() => {});
      const { error } = await sb.auth.updateUser({ password: newPw });
      if (error) throw authError(error);
    },
    async saveUser(id, d) {
      if (id) {
        ok(await sb.rpc('admin_save_user', { target: id, p_name: d.name, p_login: normPhone(d.login), p_role: d.role, p_active: d.active, p_password: d.password || null }));
        await this.reload();
        return id;
      }
      // Новый сотрудник от администратора: база создаёт вход и сразу активный профиль.
      const created = ok(await sb.rpc('admin_create_user', { p_name: d.name, p_phone: normPhone(d.login), p_pin: d.password, p_role: d.role }));
      await this.reload();
      return created;
    },
    subscribe(cb) {
      this.unsubscribe();
      chan = sb.channel('treker-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_transfers' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'folder_transfers' }, cb)
        .subscribe();
    },
    unsubscribe() { if (chan) { sb.removeChannel(chan); chan = null; } },
  };
}
function authError(e) {
  const m = e?.message || String(e);
  if (/invalid login credentials/i.test(m)) return new Error('Неверный номер или PIN');
  if (/banned/i.test(m)) return new Error('Профиль отключён администратором');
  if (/already (been )?registered|already exists/i.test(m)) return new Error('Этот номер уже зарегистрирован');
  if (/password/i.test(m)) return new Error(`PIN не подошёл: ${m}`);
  return e instanceof Error ? e : new Error(m);
}
function errText(e, offline = 'Нет связи с сервером — изменение не сохранено') {
  const m = e?.message || '';
  if (/profiles_name_lower|duplicate key.*name/i.test(m)) return 'Этот ник уже занят';
  if (/profiles_nick_format/i.test(m)) return 'Ник — от 2 до 30 символов: буквы, цифры и знаки _ . -';
  if (/groups_name_lower/i.test(m)) return 'Группа с таким названием уже есть';
  if (/folders_owner_name/i.test(m)) return 'Папка с таким названием уже есть';
  if (/group_members_pkey/i.test(m)) return 'Уже состоит в этой группе';
  if (/tasks_group_id_fkey/i.test(m)) return 'В группе есть задачи (в том числе в архиве)';
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(m)) return offline;
  return m || 'Не удалось сохранить';
}

/* ---------- изменения: сразу на экране, затем на сервере ---------- */
let inflight = 0, dirty = false, syncT = null;
async function commit(apply, persist) {
  const snap = structuredClone(state.db);
  apply(state.db);
  render();
  inflight++;
  try { await persist(); return true; }
  catch (e) {
    toast(errText(e));
    try { await backend.reload(); } catch { state.db = snap; }
    render();
    return false;
  } finally {
    inflight--;
    if (!inflight && dirty) { dirty = false; remoteChanged(); }
  }
}
const ops = {
  addTasks: list => commit(db => { for (const t of list) if (!db.tasks.some(x => x.id === t.id)) db.tasks.push({ ...t }); }, () => backend.insertTasks(list)),
  patchTask(id, f) {
    f = { ...f, updatedAt: Date.now() };
    return commit(db => { const t = db.tasks.find(x => x.id === id); if (t) Object.assign(t, f); }, () => backend.updateTask(id, f));
  },
  // Удаление — в архив на 30 дней; восстановить может удаливший или администратор.
  archiveTask(id) {
    const f = { deletedAt: Date.now() };
    return commit(db => Object.assign(db.tasks.find(x => x.id === id) || {}, f, { deletedBy: state.me }), () => backend.updateTask(id, f));
  },
  restoreTask: id => commit(db => Object.assign(db.tasks.find(x => x.id === id) || {}, { deletedAt: null, deletedBy: null }),
    async () => { await backend.rpc('restore_task', { p_task: id }); await backend.reload(); }),
  // Навсегда — только из архива. Отмена создания задачи (тост «Отменить») — тоже сюда не подходит: см. undoCreate.
  purgeTask: id => commit(db => { db.tasks = db.tasks.filter(x => x.id !== id); }, () => backend.deleteTask(id)),
  // Отменить только что созданную задачу: в архив, чтобы не мусорить, и сразу навсегда.
  async undoCreate(id) { if (await ops.archiveTask(id)) return ops.purgeTask(id); },
  markRead: () => commit(db => { for (const n of db.notes) n.readAt ||= Date.now(); }, () => backend.markRead()),
  clearRead: () => commit(db => { db.notes = db.notes.filter(n => !n.readAt); }, () => backend.clearRead()),
  patchSelf: f => commit(db => Object.assign(db.users.find(u => u.id === state.me), f), () => backend.updateSelf(f)),
  // Группы и участники (администратор), папки (свои).
  addGroup: g => commit(db => db.groups.push(g), () => backend.insert('groups', g)),
  renameGroup: (id, name) => commit(db => Object.assign(db.groups.find(g => g.id === id), { name }), () => backend.update('groups', { id }, { name })),
  removeGroup: id => commit(db => { db.groups = db.groups.filter(g => g.id !== id); db.members = db.members.filter(m => m.groupId !== id); },
    async () => { if (!(await backend.remove('groups', { id })).length) throw new Error('В группе есть задачи — сначала перенесите или удалите их'); }),
  addMember: (groupId, userId) => commit(db => db.members.push({ groupId, userId }), () => backend.insert('group_members', { groupId, userId })),
  removeMember: (groupId, userId) => commit(db => { db.members = db.members.filter(m => !(m.groupId === groupId && m.userId === userId)); },
    () => backend.remove('group_members', { group_id: groupId, user_id: userId })),
  addFolder: f => commit(db => db.folders.push(f), () => backend.insert('folders', f)),
  patchFolder: (id, f) => commit(db => Object.assign(db.folders.find(x => x.id === id), f), () => backend.update('folders', { id }, f)),
  removeFolder: id => commit(db => { db.folders = db.folders.filter(f => f.id !== id); for (const t of db.tasks) if (t.folderId === id) t.folderId = null; },
    () => backend.remove('folders', { id })),
};
// Изменения с других устройств и вкладок: перечитываем данные целиком (их немного) и перерисовываем.
function remoteChanged() { clearTimeout(syncT); syncT = setTimeout(syncNow, 150); }
async function syncNow() {
  if (!state.me || !backend) return;
  if (inflight) { dirty = true; return; }
  const before = JSON.stringify(state.db);
  try { await backend.reload(); } catch { return; }
  if (!user(state.me)?.active) { logout(inactiveText(user(state.me))); return; }
  if (JSON.stringify(state.db) === before) return;
  // Пока открыт выпадающий список, не перерисовываем — догоним после закрытия.
  if (openMenu) { state.pending = true; return; }
  render();
}
