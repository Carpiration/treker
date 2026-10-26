-- Трекер задач: схема базы Supabase.
-- Выполнить целиком в Supabase → SQL Editor. Повторный запуск безопасен (обновляет функции и правила).
--
-- Вход — по номеру телефона и PIN. Номер (только цифры, 7XXXXXXXXXX) хранится как служебный e-mail
-- <номер>@<loginDomain из config.js>; писем на него не отправляется,
-- поэтому в Authentication → Sign In / Providers → Email нужно выключить «Confirm email».
-- Первый зарегистрированный становится администратором; остальные ждут одобрения (pending).

create extension if not exists pgcrypto with schema extensions;

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

-- Приглашение администратора: регистрация с этим логином сразу получает активный профиль.
create table if not exists public.invites (
  login      text primary key check (login ~ '^[a-z0-9._-]{3,32}$'),
  name       text not null check (char_length(name) between 1 and 60),
  role       text not null default 'user' check (role in ('user', 'admin')),
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
alter table public.profiles add column if not exists pending boolean not null default false;
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);

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
alter table public.invites  enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "profiles: чтение" on public.profiles;
create policy "profiles: чтение" on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());

drop policy if exists "profiles: своё имя и настройки" on public.profiles;
create policy "profiles: своё имя и настройки" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active()) with check (id = auth.uid());

drop policy if exists "invites: администратор" on public.invites;
create policy "invites: администратор" on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

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
revoke all on public.profiles, public.invites, public.tasks from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, prefs) on public.profiles to authenticated;
grant select, insert, update, delete on public.invites to authenticated;
grant select, insert, delete on public.tasks to authenticated;
grant update (title, descr, status, assignee_id, updated_at, done_at) on public.tasks to authenticated;

-- ---------- новый пользователь ----------
-- Первый зарегистрированный (пока нет администратора) становится администратором.
-- Приглашённые администратором сразу активны; зарегистрировавшиеся сами — ждут одобрения и до него ничего не видят.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lg  text := lower(split_part(new.email, '@', 1));
  nm  text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), lg), 60);
  inv public.invites%rowtype;
begin
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    insert into public.profiles (id, name, login, role, active)
    values (new.id, nm, lg, 'admin', true);
    return new;
  end if;
  select * into inv from public.invites where login = lg;
  if found then
    insert into public.profiles (id, name, login, role, active) values (new.id, inv.name, lg, inv.role, true);
    delete from public.invites where login = lg;
  else
    insert into public.profiles (id, name, login, role, active, pending) values (new.id, nm, lg, 'user', false, true);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

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
  if p_name = '' or char_length(p_name) > 60 then raise exception 'Введите имя (до 60 символов)'; end if;
  if p_login !~ '^[a-z0-9._-]{3,32}$' then raise exception 'Некорректный номер телефона'; end if;
  if p_role not in ('user', 'admin') then raise exception 'Неизвестная роль'; end if;
  if coalesce(p_password, '') <> '' and char_length(p_password) < 6 then raise exception 'PIN — 6 цифр'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'Профиль не найден'; end if;
  if exists (select 1 from public.profiles where login = p_login and id <> target)
     or exists (select 1 from public.invites where login = p_login) then
    raise exception 'Этот номер уже зарегистрирован';
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

revoke execute on function public.admin_save_user(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.admin_save_user(uuid, text, text, text, boolean, text) to authenticated;
revoke execute on function public.is_active(), public.is_admin() from public, anon;
grant execute on function public.is_active(), public.is_admin() to authenticated;
grant execute on function public.needs_setup() to anon, authenticated;

-- ---------- обновления в реальном времени ----------
do $$
begin
  begin alter publication supabase_realtime add table public.tasks;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;
