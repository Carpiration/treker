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
