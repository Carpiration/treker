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
  const COLS = { id: 'id', title: 'title', desc: 'descr', status: 'status', assigneeId: 'assignee_id', authorId: 'author_id', createdAt: 'created_at', updatedAt: 'updated_at', doneAt: 'done_at' };
  const toRow = t => Object.fromEntries(Object.entries(t).filter(([k]) => k in COLS).map(([k, v]) => [COLS[k], k.endsWith('At') ? iso(v) : v]));
  const toTask = r => ({ id: r.id, title: r.title, desc: r.descr, status: r.status, assigneeId: r.assignee_id, authorId: r.author_id,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), doneAt: r.done_at ? Date.parse(r.done_at) : null });
  const toUser = r => ({ id: r.id, name: r.name, login: r.login, role: r.role, active: r.active, pending: !!r.pending, prefs: r.prefs || {} });
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
      const [u, t] = await Promise.all([sb.from('profiles').select('*'), sb.from('tasks').select('*')]);
      state.db = { users: ok(u).map(toUser), tasks: ok(t).map(toTask) };
    },
    async insertTasks(list) { ok(await sb.from('tasks').insert(list.map(toRow))); },
    async updateTask(id, f) { ok(await sb.from('tasks').update(toRow(f)).eq('id', id)); },
    async deleteTask(id) { ok(await sb.from('tasks').delete().eq('id', id)); },
    async updateSelf(f) { ok(await sb.from('profiles').update(f).eq('id', uid)); },
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
  removeTask: id => commit(db => { db.tasks = db.tasks.filter(x => x.id !== id); }, () => backend.deleteTask(id)),
  patchSelf: f => commit(db => Object.assign(db.users.find(u => u.id === state.me), f), () => backend.updateSelf(f)),
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
