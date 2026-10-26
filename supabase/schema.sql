-- Трекер задач: схема базы Supabase.
-- Выполнить целиком в Supabase → SQL Editor. Повторный запуск безопасен (обновляет функции и правила).
--
-- Вход — по номеру телефона и PIN. Номер (только цифры, 7XXXXXXXXXX) хранится как служебный e-mail
-- <номер>@<домен из app_email_domain()>, писем на него не отправляется.
-- Пользователей создаёт сама база (register_user / admin_create_user), а не регистрация Supabase Auth:
-- так вход не зависит от проверки домена e-mail и от настройки «Confirm email».
-- Первый зарегистрированный становится администратором; остальные ждут одобрения (pending).

create extension if not exists pgcrypto with schema extensions;

-- Домен служебных адресов. Должен совпадать с loginDomain в config.js. После создания профилей не менять.
create or replace function public.app_email_domain() returns text
language sql immutable set search_path = '' as $$ select 'treker.local' $$;

-- ---------- таблицы ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  login      text not null unique check (login ~ '^[a-z0-9._-]{3,32}$'),
  role       text not null default 'user' check (role in ('user', 'admin')),
  active     boolean not null default true,
  pending    boolean not null default false,
  prefs      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  descr       text not null default '' check (char_length(descr) <= 5000),
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  assignee_id uuid references public.profiles (id) on delete set null,
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_author_idx on public.tasks (author_id);

-- Ник уникален без учёта регистра: буквы, цифры, _ . - (2–30 символов).
create unique index if not exists profiles_name_lower_idx on public.profiles (lower(name));
do $$ begin
  alter table public.profiles add constraint profiles_nick_format check (name ~ '^[\w.-]{2,30}$');
exception when duplicate_object then null; end $$;

-- Приглашения прежней версии больше не нужны: сотрудников администратор создаёт функцией admin_create_user.
drop table if exists public.invites;

-- ---------- проверки прав ----------
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;

-- Нужен ли первый запуск (создание администратора). Доступно до входа.
create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where role = 'admin' and active)
$$;

-- ---------- правила доступа (RLS) ----------
alter table public.profiles enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "profiles: чтение" on public.profiles;
create policy "profiles: чтение" on public.profiles for select to authenticated
  using (public.is_active() or id = (select auth.uid()));

drop policy if exists "profiles: своё имя и настройки" on public.profiles;
create policy "profiles: своё имя и настройки" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and public.is_active()) with check (id = (select auth.uid()));

drop policy if exists "tasks: чтение" on public.tasks;
create policy "tasks: чтение" on public.tasks for select to authenticated using (public.is_active());
drop policy if exists "tasks: создание" on public.tasks;
create policy "tasks: создание" on public.tasks for insert to authenticated with check (public.is_active());
drop policy if exists "tasks: изменение" on public.tasks;
create policy "tasks: изменение" on public.tasks for update to authenticated
  using (public.is_active()) with check (public.is_active());
drop policy if exists "tasks: удаление" on public.tasks;
create policy "tasks: удаление" on public.tasks for delete to authenticated using (public.is_active());

-- Права на уровне колонок: себе можно менять только имя и настройки; роль, логин и доступ — через admin_save_user.
revoke all on public.profiles, public.tasks from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, prefs) on public.profiles to authenticated;
grant select, insert, delete on public.tasks to authenticated;
grant update (title, descr, status, assignee_id, updated_at, done_at) on public.tasks to authenticated;

-- ---------- новый пользователь ----------
-- Профиль создаётся триггером на auth.users.
-- Первый (пока нет администратора) — администратор. Созданные администратором сразу активны:
-- это отмечено в raw_app_meta_data, которое клиент сам задать не может. Остальные ждут одобрения.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lg  text := lower(split_part(new.email, '@', 1));
  nm  text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), lg), 60);
  by_admin boolean := coalesce(new.raw_app_meta_data ->> 'treker_by_admin', '') = 'true';
  rl  text := case when new.raw_app_meta_data ->> 'treker_role' = 'admin' then 'admin' else 'user' end;
begin
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    insert into public.profiles (id, name, login, role, active) values (new.id, nm, lg, 'admin', true);
  elsif by_admin then
    insert into public.profiles (id, name, login, role, active) values (new.id, nm, lg, rl, true);
  else
    insert into public.profiles (id, name, login, role, active, pending) values (new.id, nm, lg, 'user', false, true);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Создание записи входа (auth.users + auth.identities). Только для функций ниже, клиенту недоступно.
create or replace function public.create_login(p_login text, p_pin text, p_name text, p_app jsonb)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid  uuid := gen_random_uuid();
  mail text := p_login || '@' || public.app_email_domain();
begin
  if exists (select 1 from auth.users where email = mail) or exists (select 1 from public.profiles where login = p_login) then
    raise exception 'Этот номер уже зарегистрирован';
  end if;
  if exists (select 1 from public.profiles where lower(name) = lower(p_name)) then
    raise exception 'Этот ник уже занят';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
    crypt(p_pin, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')) || coalesce(p_app, '{}'::jsonb),
    jsonb_build_object('name', p_name), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid,
    jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());
  return uid;
end $$;
revoke execute on function public.create_login(text, text, text, jsonb) from public, anon, authenticated;

-- Проверки полей, общие для регистрации и создания сотрудника.
-- Номер: Узбекистан 998 + 9 цифр, Россия/Казахстан 7 + 10 цифр, другие страны — 11–15 цифр.
create or replace function public.check_new_login(p_name text, p_login text, p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(trim(p_name), '') !~ '^[\w.-]{2,30}$' then
    raise exception 'Ник — от 2 до 30 символов: буквы, цифры и знаки _ . -';
  end if;
  if not (coalesce(p_login, '') ~ '^998\d{9}$' or coalesce(p_login, '') ~ '^7\d{10}$'
          or (coalesce(p_login, '') ~ '^\d{11,15}$' and p_login !~ '^(998|7)')) then
    raise exception 'Номер целиком, например +998(93)123-45-67';
  end if;
  if coalesce(p_pin, '') !~ '^\d{6}$' then raise exception 'PIN — ровно 6 цифр'; end if;
end $$;

-- Регистрация. Доступна до входа. Возвращает, активен ли профиль сразу (первый — администратор).
create or replace function public.register_user(p_name text, p_phone text, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  perform public.check_new_login(p_name, p_phone, p_pin);
  -- Защита от засорения заявками: одобрять их всё равно вручную.
  if (select count(*) from public.profiles where pending and not active) >= 50 then
    raise exception 'Слишком много заявок ждут одобрения. Попросите администратора разобрать их.';
  end if;
  uid := public.create_login(p_phone, p_pin, trim(p_name), '{}'::jsonb);
  return (select active from public.profiles where id = uid);
end $$;

-- Новый сотрудник от администратора: сразу активен, одобрение не нужно.
create or replace function public.admin_create_user(p_name text, p_phone text, p_pin text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Нет прав администратора' using errcode = '42501'; end if;
  perform public.check_new_login(p_name, p_phone, p_pin);
  if p_role not in ('user', 'admin') then raise exception 'Неизвестная роль'; end if;
  return public.create_login(p_phone, p_pin, trim(p_name),
    jsonb_build_object('treker_by_admin', 'true', 'treker_role', p_role));
end $$;

-- ---------- изменение профиля администратором ----------
create or replace function public.admin_save_user(
  target uuid, p_name text, p_login text, p_role text, p_active boolean, p_password text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  others int;
  dom    text;
begin
  if not public.is_admin() then
    raise exception 'Нет прав администратора' using errcode = '42501';
  end if;
  p_name  := trim(p_name);
  p_login := lower(trim(p_login));
  if p_name !~ '^[\w.-]{2,30}$' then raise exception 'Ник — от 2 до 30 символов: буквы, цифры и знаки _ . -'; end if;
  if p_login !~ '^[a-z0-9._-]{3,32}$' then raise exception 'Некорректный номер телефона'; end if;
  if p_role not in ('user', 'admin') then raise exception 'Неизвестная роль'; end if;
  if coalesce(p_password, '') <> '' and p_password !~ '^\d{6}$' then raise exception 'PIN — ровно 6 цифр'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'Профиль не найден'; end if;
  if exists (select 1 from public.profiles where login = p_login and id <> target) then
    raise exception 'Этот номер уже зарегистрирован';
  end if;
  if exists (select 1 from public.profiles where lower(name) = lower(p_name) and id <> target) then
    raise exception 'Этот ник уже занят';
  end if;
  if target = auth.uid() and not p_active then raise exception 'Нельзя отключить свой профиль'; end if;
  select count(*) into others from public.profiles where role = 'admin' and active and id <> target;
  if others = 0 and (p_role <> 'admin' or not p_active) then
    raise exception 'Должен остаться хотя бы один администратор';
  end if;

  update public.profiles
    set name = p_name, login = p_login, role = p_role, active = p_active, pending = pending and not p_active
  where id = target;

  select split_part(email, '@', 2) into dom from auth.users where id = target;
  update auth.users set
    email = p_login || '@' || dom,
    encrypted_password = case when coalesce(p_password, '') <> '' then crypt(p_password, gen_salt('bf')) else encrypted_password end,
    banned_until = case when p_active then null else '2999-01-01'::timestamptz end,
    updated_at = now()
  where id = target;
  update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p_login || '@' || dom))
  where user_id = target and provider = 'email';
end $$;

-- ---------- права на функции ----------
revoke execute on function public.register_user(text, text, text) from public;
grant execute on function public.register_user(text, text, text) to anon, authenticated;
revoke execute on function public.admin_create_user(text, text, text, text) from public, anon;
grant execute on function public.admin_create_user(text, text, text, text) to authenticated;
revoke execute on function public.admin_save_user(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_save_user(uuid, text, text, text, boolean, text) to authenticated;
revoke execute on function public.is_active(), public.is_admin() from public, anon;
grant execute on function public.is_active(), public.is_admin() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.check_new_login(text, text, text) from public, anon, authenticated;
grant execute on function public.needs_setup() to anon, authenticated;

-- ---------- обновления в реальном времени ----------
do $$
begin
  begin alter publication supabase_realtime add table public.tasks;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
-- Группы, личные папки, видимость.
-- Пространства задач: группа (общая для её участников) или личное пространство владельца («Мои задачи»).
-- Личные задачи лежат в корне или в папках; любую папку и корень можно скрыть от всех, включая администратора.

-- ---------- таблицы ----------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 40),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists groups_name_lower_idx on public.groups (lower(name));

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  hidden     boolean not null default false,
  kind       text not null default 'user' check (kind in ('user', 'transfers')),
  created_at timestamptz not null default now()
);
create unique index if not exists folders_owner_name_idx on public.folders (owner_id, lower(name));

alter table public.profiles add column if not exists root_hidden boolean not null default false;

alter table public.tasks add column if not exists group_id  uuid references public.groups (id) on delete restrict;
alter table public.tasks add column if not exists owner_id  uuid references public.profiles (id) on delete cascade;
alter table public.tasks add column if not exists folder_id uuid references public.folders (id) on delete set null;
create index if not exists tasks_group_idx on public.tasks (group_id);
create index if not exists tasks_owner_idx on public.tasks (owner_id);
create index if not exists tasks_folder_idx on public.tasks (folder_id);
-- Задача ровно в одном пространстве; папка — только у личной задачи.
do $$ begin
  alter table public.tasks add constraint tasks_one_space check ((group_id is null) <> (owner_id is null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_folder_personal check (folder_id is null or group_id is null);
exception when duplicate_object then null; end $$;

-- ---------- проверки прав ----------
create or replace function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (select 1 from public.group_members where group_id = g and user_id = auth.uid())
$$;

-- Видит ли текущий пользователь задачу.
create or replace function public.task_visible(g uuid, o uuid, f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active() then false
    when g is not null then public.is_admin() or public.is_group_member(g)
    when o = auth.uid() then true
    when f is null then not coalesce((select root_hidden from public.profiles where id = o), true)
    else not coalesce((select hidden from public.folders where id = f), true)
  end
$$;

-- Может ли текущий пользователь менять задачу (и класть задачу в это пространство).
create or replace function public.task_editable(g uuid, o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and case
    when g is not null then public.is_admin() or public.is_group_member(g)
    else o = auth.uid()
  end
$$;

-- ---------- целостность ----------
-- Не больше 7 групп у одного человека.
create or replace function public.check_group_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.group_members where user_id = new.user_id) >= 7 then
    raise exception 'У пользователя уже 7 групп — это максимум';
  end if;
  return new;
end $$;
drop trigger if exists group_limit on public.group_members;
create trigger group_limit before insert on public.group_members
  for each row execute function public.check_group_limit();

-- Личная задача принадлежит владельцу (он же исполнитель), папка — только своя.
-- Исполнитель задачи группы — её участник (или никто).
create or replace function public.check_task_space() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is null then
    new.assignee_id := new.owner_id;
    if new.folder_id is not null and not exists (select 1 from public.folders where id = new.folder_id and owner_id = new.owner_id) then
      raise exception 'Папка принадлежит другому человеку';
    end if;
  elsif new.assignee_id is not null
    and not exists (select 1 from public.group_members where group_id = new.group_id and user_id = new.assignee_id) then
    raise exception 'Исполнитель не состоит в этой группе';
  end if;
  return new;
end $$;
drop trigger if exists task_space on public.tasks;
create trigger task_space before insert or update of group_id, owner_id, folder_id, assignee_id on public.tasks
  for each row execute function public.check_task_space();

-- ---------- правила доступа (RLS) ----------
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.folders       enable row level security;

drop policy if exists "groups: чтение" on public.groups;
create policy "groups: чтение" on public.groups for select to authenticated
  using (public.is_admin() or public.is_group_member(id));
drop policy if exists "groups: администратор" on public.groups;
create policy "groups: администратор" on public.groups for insert to authenticated with check (public.is_admin());
drop policy if exists "groups: переименование" on public.groups;
create policy "groups: переименование" on public.groups for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Удалить можно только пустую группу: задачи сначала переносят.
drop policy if exists "groups: удаление пустой" on public.groups;
create policy "groups: удаление пустой" on public.groups for delete to authenticated
  using (public.is_admin() and not exists (select 1 from public.tasks t where t.group_id = groups.id));

drop policy if exists "group_members: чтение" on public.group_members;
create policy "group_members: чтение" on public.group_members for select to authenticated
  using (public.is_admin() or public.is_group_member(group_id));
drop policy if exists "group_members: добавление" on public.group_members;
create policy "group_members: добавление" on public.group_members for insert to authenticated with check (public.is_admin());
drop policy if exists "group_members: исключение" on public.group_members;
create policy "group_members: исключение" on public.group_members for delete to authenticated using (public.is_admin());

drop policy if exists "folders: чтение" on public.folders;
create policy "folders: чтение" on public.folders for select to authenticated
  using (owner_id = (select auth.uid()) or (public.is_active() and not hidden));
drop policy if exists "folders: свои" on public.folders;
create policy "folders: свои" on public.folders for all to authenticated
  using (owner_id = (select auth.uid()) and public.is_active())
  with check (owner_id = (select auth.uid()) and public.is_active());

drop policy if exists "tasks: чтение" on public.tasks;
create policy "tasks: чтение" on public.tasks for select to authenticated
  using (public.task_visible(group_id, owner_id, folder_id));
drop policy if exists "tasks: создание" on public.tasks;
create policy "tasks: создание" on public.tasks for insert to authenticated
  with check (public.task_editable(group_id, owner_id));
drop policy if exists "tasks: изменение" on public.tasks;
create policy "tasks: изменение" on public.tasks for update to authenticated
  using (public.task_editable(group_id, owner_id)) with check (public.task_editable(group_id, owner_id));
drop policy if exists "tasks: удаление" on public.tasks;
create policy "tasks: удаление" on public.tasks for delete to authenticated
  using (public.task_editable(group_id, owner_id));

-- ---------- права на колонки и функции ----------
revoke all on public.groups, public.group_members, public.folders from anon, authenticated;
grant select, insert, delete on public.groups to authenticated;
grant update (name) on public.groups to authenticated;
grant select, insert, delete on public.group_members to authenticated;
grant select, insert, delete on public.folders to authenticated;
grant update (name, hidden) on public.folders to authenticated;
grant update (name, prefs, root_hidden) on public.profiles to authenticated;
grant update (title, descr, status, assignee_id, updated_at, done_at, group_id, owner_id, folder_id) on public.tasks to authenticated;

revoke execute on function public.is_group_member(uuid), public.task_visible(uuid, uuid, uuid),
  public.task_editable(uuid, uuid) from public, anon;
grant execute on function public.is_group_member(uuid), public.task_visible(uuid, uuid, uuid),
  public.task_editable(uuid, uuid) to authenticated;
revoke execute on function public.check_group_limit(), public.check_task_space() from public, anon, authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.groups;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.folders;       exception when duplicate_object then null; end;
end $$;


-- =====================================================================
-- Архив, журнал действий, уведомления, перенос и передача задач.
-- ---------- архив: удалённые задачи хранятся 30 дней ----------
alter table public.tasks add column if not exists deleted_at   timestamptz;
alter table public.tasks add column if not exists deleted_by   uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists purge_warned boolean not null default false;
create index if not exists tasks_deleted_idx on public.tasks (deleted_at) where deleted_at is not null;

-- ---------- журнал действий ----------
create table if not exists public.task_events (
  id         bigint generated always as identity primary key,
  task_id    uuid not null,
  title      text not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null check (kind in ('created', 'status', 'assigned', 'edited', 'moved', 'deleted', 'restored',
               'transfer_requested', 'transfer_accepted', 'transfer_declined', 'transfer_cancelled')),
  data       jsonb not null default '{}'::jsonb,
  group_id   uuid references public.groups (id) on delete set null,
  owner_id   uuid references public.profiles (id) on delete cascade,
  folder_id  uuid references public.folders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists task_events_created_idx on public.task_events (created_at desc);
create index if not exists task_events_task_idx on public.task_events (task_id);
create index if not exists task_events_group_idx on public.task_events (group_id);
create index if not exists task_events_owner_idx on public.task_events (owner_id);
create index if not exists task_events_actor_idx on public.task_events (actor_id);

-- ---------- уведомления ----------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('assigned', 'status', 'deleted', 'restored', 'moved',
                'transfer_request', 'transfer_accepted', 'transfer_declined', 'transfer_cancelled', 'purge_soon')),
  task_id     uuid,
  title       text not null default '',
  actor_id    uuid references public.profiles (id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  transfer_id uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------- передача задачи администратору: ждёт его согласия ----------
create table if not exists public.task_transfers (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  from_id    uuid not null references public.profiles (id) on delete cascade,
  to_id      uuid not null references public.profiles (id) on delete cascade,
  folder_id  uuid references public.folders (id) on delete set null,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists task_transfers_one_pending on public.task_transfers (task_id) where status = 'pending';
create index if not exists task_transfers_to_idx on public.task_transfers (to_id);
create index if not exists task_transfers_from_idx on public.task_transfers (from_id);

-- ---------- удаление в архив: кто удалил, записывает база ----------
create or replace function public.task_archive_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid(); new.purge_warned := false;
  elsif new.deleted_at is null then
    new.deleted_by := null; new.purge_warned := false;
  end if;
  return new;
end $$;
drop trigger if exists task_archive on public.tasks;
create trigger task_archive before update of deleted_at on public.tasks
  for each row execute function public.task_archive_mark();

-- ---------- журнал и уведомления исполнителю: пишет база при любом изменении задачи ----------
create or replace function public.notify(p_user uuid, p_kind text, p_task uuid, p_title text, p_actor uuid, p_data jsonb default '{}'::jsonb, p_transfer uuid default null)
returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, task_id, title, actor_id, data, transfer_id)
  select p_user, p_kind, p_task, p_title, p_actor, coalesce(p_data, '{}'::jsonb), p_transfer
  where p_user is not null and p_user is distinct from p_actor
    and exists (select 1 from public.profiles where id = p_user and active)
$$;

create or replace function public.log_event(t public.tasks, p_kind text, p_data jsonb default '{}'::jsonb, p_actor uuid default auth.uid())
returns void
language sql security definer set search_path = public as $$
  insert into public.task_events (task_id, title, actor_id, kind, data, group_id, owner_id, folder_id)
  values (t.id, t.title, p_actor, p_kind, coalesce(p_data, '{}'::jsonb), t.group_id, t.owner_id, t.folder_id)
$$;

create or replace function public.task_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.deleted_by, new.author_id);
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new, 'created', jsonb_build_object('assignee', new.assignee_id), actor);
    perform public.notify(new.assignee_id, 'assigned', new.id, new.title, actor);
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null then
      perform public.log_event(new, 'deleted', '{}'::jsonb, actor);
      perform public.notify(new.assignee_id, 'deleted', new.id, new.title, actor);
    else
      perform public.log_event(new, 'restored', '{}'::jsonb, actor);
      perform public.notify(new.assignee_id, 'restored', new.id, new.title, actor);
    end if;
    return new;
  end if;
  if new.group_id is distinct from old.group_id or new.owner_id is distinct from old.owner_id or new.folder_id is distinct from old.folder_id then
    perform public.log_event(new, 'moved', jsonb_build_object(
      'from_group', old.group_id, 'to_group', new.group_id, 'from_owner', old.owner_id, 'to_owner', new.owner_id,
      'from_folder', old.folder_id, 'to_folder', new.folder_id), actor);
    if new.assignee_id is not distinct from old.assignee_id then
      perform public.notify(new.assignee_id, 'moved', new.id, new.title, actor, jsonb_build_object('to_group', new.group_id, 'to_folder', new.folder_id));
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    -- При передаче в чужое личное пространство исполнитель меняется сам собой — в журнале достаточно «перенесена».
    if new.owner_id is not distinct from old.owner_id then
      perform public.log_event(new, 'assigned', jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id), actor);
    end if;
    perform public.notify(new.assignee_id,
      case when new.owner_id is distinct from old.owner_id then 'moved' else 'assigned' end,
      new.id, new.title, actor, jsonb_build_object('to_group', new.group_id, 'to_folder', new.folder_id));
  end if;
  if new.status is distinct from old.status then
    perform public.log_event(new, 'status', jsonb_build_object('from', old.status, 'to', new.status), actor);
    perform public.notify(new.assignee_id, 'status', new.id, new.title, actor, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.title is distinct from old.title or new.descr is distinct from old.descr then
    perform public.log_event(new, 'edited', case when new.title is distinct from old.title
      then jsonb_build_object('old_title', old.title) else '{}'::jsonb end, actor);
  end if;
  return new;
end $$;
drop trigger if exists task_log on public.tasks;
create trigger task_log after insert or update on public.tasks
  for each row execute function public.task_log();

-- ---------- служебная папка «Переданные» ----------
create or replace function public.transfers_folder(p_owner uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  select id into f from public.folders where owner_id = p_owner and (kind = 'transfers' or lower(name) = 'переданные')
    order by (kind = 'transfers') desc limit 1;
  if f is null then
    insert into public.folders (owner_id, name, kind) values (p_owner, 'Переданные', 'transfers') returning id into f;
  end if;
  return f;
end $$;

-- ---------- перенос задачи ----------
-- В свою папку, в группу (участник или администратор) или другому человеку в его папку
-- (по умолчанию — «Переданные»). Администратору — только с его согласия: создаётся запрос.
-- Возвращает 'moved' или 'requested'.
create or replace function public.move_task(p_task uuid, p_group uuid default null, p_owner uuid default null, p_folder uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  t   public.tasks;
  tgt public.profiles;
  f   uuid := p_folder;
  a   uuid;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.deleted_at is not null or not public.task_visible(t.group_id, t.owner_id, t.folder_id)
     or not public.task_editable(t.group_id, t.owner_id) then
    raise exception 'Эту задачу нельзя перенести';
  end if;
  if exists (select 1 from public.task_transfers where task_id = p_task and status = 'pending') then
    raise exception 'Задача уже ждёт согласия на передачу';
  end if;
  if (p_group is null) = (p_owner is null) then raise exception 'Не выбрано, куда перенести'; end if;

  if p_group is not null then
    if not (public.is_admin() or public.is_group_member(p_group)) then raise exception 'Вы не состоите в этой группе'; end if;
    a := case
      when exists (select 1 from public.group_members where group_id = p_group and user_id = t.assignee_id) then t.assignee_id
      when exists (select 1 from public.group_members where group_id = p_group and user_id = me) then me end;
    update public.tasks set group_id = p_group, owner_id = null, folder_id = null, assignee_id = a, updated_at = now() where id = p_task;
    return 'moved';
  end if;

  select * into tgt from public.profiles where id = p_owner;
  if not found or not tgt.active then raise exception 'Человек не найден или отключён'; end if;
  if f is not null and not exists (select 1 from public.folders where id = f and owner_id = p_owner and (not hidden or owner_id = me)) then
    raise exception 'Папка не найдена';
  end if;
  if p_owner = me then
    update public.tasks set group_id = null, owner_id = me, folder_id = f, updated_at = now() where id = p_task;
    return 'moved';
  end if;
  if tgt.role = 'admin' then
    insert into public.task_transfers (task_id, from_id, to_id, folder_id) values (p_task, me, p_owner, f)
      returning id into a;
    perform public.log_event(t, 'transfer_requested', jsonb_build_object('to', p_owner, 'folder', f), me);
    perform public.notify(p_owner, 'transfer_request', p_task, t.title, me, jsonb_build_object('folder', f), a);
    return 'requested';
  end if;
  update public.tasks set group_id = null, owner_id = p_owner, folder_id = coalesce(f, public.transfers_folder(p_owner)), updated_at = now()
    where id = p_task;
  return 'moved';
end $$;

-- Ответ на передачу: принять (задача переходит в выбранную папку или «Переданные») или отклонить.
create or replace function public.respond_transfer(p_transfer uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  tr public.task_transfers;
  t  public.tasks;
begin
  select * into tr from public.task_transfers where id = p_transfer for update;
  if not found or tr.to_id <> auth.uid() then raise exception 'Запрос не найден'; end if;
  if tr.status <> 'pending' then raise exception 'На этот запрос уже ответили'; end if;
  select * into t from public.tasks where id = tr.task_id;
  if p_accept then
    if t.deleted_at is not null then raise exception 'Задачу уже удалили'; end if;
    update public.tasks set group_id = null, owner_id = tr.to_id,
      folder_id = coalesce((select id from public.folders where id = tr.folder_id and owner_id = tr.to_id), public.transfers_folder(tr.to_id)),
      updated_at = now() where id = tr.task_id;
  end if;
  update public.task_transfers set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now() where id = p_transfer;
  update public.notifications set read_at = coalesce(read_at, now()), data = data || jsonb_build_object('answer', case when p_accept then 'accepted' else 'declined' end)
    where transfer_id = p_transfer and user_id = tr.to_id;
  perform public.log_event(t, case when p_accept then 'transfer_accepted' else 'transfer_declined' end, jsonb_build_object('from', tr.from_id), tr.to_id);
  perform public.notify(tr.from_id, case when p_accept then 'transfer_accepted' else 'transfer_declined' end, t.id, t.title, tr.to_id);
end $$;

-- Отменить свой запрос на передачу, пока на него не ответили.
create or replace function public.cancel_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tr public.task_transfers;
  t  public.tasks;
begin
  select * into tr from public.task_transfers where id = p_transfer for update;
  if not found or tr.from_id <> auth.uid() then raise exception 'Запрос не найден'; end if;
  if tr.status <> 'pending' then raise exception 'На этот запрос уже ответили'; end if;
  update public.task_transfers set status = 'cancelled', decided_at = now() where id = p_transfer;
  update public.notifications set data = data || '{"answer":"cancelled"}'::jsonb where transfer_id = p_transfer;
  select * into t from public.tasks where id = tr.task_id;
  perform public.log_event(t, 'transfer_cancelled', jsonb_build_object('to', tr.to_id), tr.from_id);
end $$;

-- Восстановить из архива: удаливший или администратор.
create or replace function public.restore_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or t.deleted_at is null then raise exception 'Задачи нет в архиве'; end if;
  if not (t.deleted_by = auth.uid() or public.is_admin()) or not public.task_visible(t.group_id, t.owner_id, t.folder_id) then
    raise exception 'Восстановить может удаливший или администратор';
  end if;
  update public.tasks set deleted_at = null, updated_at = now() where id = p_task;
end $$;

-- ---------- правила доступа ----------
alter table public.task_events    enable row level security;
alter table public.notifications  enable row level security;
alter table public.task_transfers enable row level security;

-- Удалённые задачи видят только удаливший и администратор (в архиве); изменить удалённую нельзя — только восстановить.
alter policy "tasks: чтение" on public.tasks
  using (public.task_visible(group_id, owner_id, folder_id)
         and (deleted_at is null or deleted_by = (select auth.uid()) or public.is_admin()));
alter policy "tasks: изменение" on public.tasks
  using (deleted_at is null and public.task_editable(group_id, owner_id))
  with check (public.task_editable(group_id, owner_id));
-- Навсегда удалить можно только задачу из архива.
alter policy "tasks: удаление" on public.tasks
  using (deleted_at is not null and (deleted_by = (select auth.uid()) or public.is_admin())
         and public.task_visible(group_id, owner_id, folder_id));

drop policy if exists "task_events: чтение" on public.task_events;
create policy "task_events: чтение" on public.task_events for select to authenticated
  using (public.is_active() and (
    actor_id = (select auth.uid())
    or (group_id is not null and (public.is_admin() or public.is_group_member(group_id)))
    or (group_id is null and (owner_id = (select auth.uid()) or public.task_visible(null, owner_id, folder_id)))));

drop policy if exists "notifications: свои" on public.notifications;
create policy "notifications: свои" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications: прочитать" on public.notifications;
create policy "notifications: прочитать" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "notifications: убрать" on public.notifications;
create policy "notifications: убрать" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "task_transfers: участники" on public.task_transfers;
create policy "task_transfers: участники" on public.task_transfers for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

do $$
begin
  begin alter publication supabase_realtime add table public.task_events;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_transfers; exception when duplicate_object then null; end;
end $$;

-- ---------- права ----------
revoke all on public.task_events, public.notifications, public.task_transfers from anon, authenticated;
grant select on public.task_events to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.task_transfers to authenticated;
grant update (title, descr, status, assignee_id, updated_at, done_at, group_id, owner_id, folder_id, deleted_at) on public.tasks to authenticated;
revoke execute on function public.move_task(uuid, uuid, uuid, uuid), public.respond_transfer(uuid, boolean),
  public.cancel_transfer(uuid), public.restore_task(uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid, uuid, uuid), public.respond_transfer(uuid, boolean),
  public.cancel_transfer(uuid), public.restore_task(uuid) to authenticated;
revoke execute on function public.notify(uuid, text, uuid, text, uuid, jsonb, uuid), public.log_event(public.tasks, text, jsonb, uuid),
  public.transfers_folder(uuid), public.task_log(), public.task_archive_mark() from public, anon, authenticated;

-- ---------- обслуживание архива (pg_cron) ----------
create extension if not exists pg_cron;
-- За сутки до автоочистки — уведомление удалившему.
create or replace function public.archive_warn() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in update public.tasks set purge_warned = true
           where deleted_at is not null and not purge_warned and deleted_at < now() - interval '29 days'
           returning id, title, deleted_by, deleted_at
  loop
    perform public.notify(r.deleted_by, 'purge_soon', r.id, r.title, null,
      jsonb_build_object('purge_at', r.deleted_at + interval '30 days'));
  end loop;
end $$;
revoke execute on function public.archive_warn() from public, anon, authenticated;
select cron.schedule('treker-archive-warn', '7 * * * *', 'select public.archive_warn()');
-- Каждый час: задачи старше 30 дней в архиве и уведомления старше 60 дней удаляются.
select cron.schedule('treker-archive-purge', '17 * * * *',
  $job$delete from public.tasks where deleted_at < now() - interval '30 days'; delete from public.notifications where created_at < now() - interval '60 days'$job$);


-- =====================================================================
-- Аватары: готовые (preset:1..10) или своё фото в хранилище avatars (папка <id пользователя>/).
alter table public.profiles add column if not exists avatar text
  check (avatar is null or avatar ~ '^(preset:([1-9]|10)|up:[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80})$');
grant update (name, prefs, root_hidden, avatar) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "avatars: загрузка в свою папку" on storage.objects;
create policy "avatars: загрузка в свою папку" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_active());
drop policy if exists "avatars: замена своих" on storage.objects;
create policy "avatars: замена своих" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars: удаление своих" on storage.objects;
create policy "avatars: удаление своих" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Удаление файла требует и права на чтение строки — только своя папка.
drop policy if exists "avatars: свои файлы" on storage.objects;
create policy "avatars: свои файлы" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
