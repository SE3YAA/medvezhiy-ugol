-- auth.sql — вход по паролю и права по ролям для «Медвежьего угла».
-- Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run.
-- Запускается после sync.sql. Повторный запуск ничего не ломает.
--
-- Что меняется:
--   • таблица records закрыта: напрямую из интернета её больше не прочитать и не изменить;
--   • приложение обращается к данным только через функции ниже, и каждая проверяет, кто спрашивает;
--   • пароли хранятся в зашифрованном виде (bcrypt), на сервере их не видно даже управляющему;
--   • вход выдаёт ключ сессии на 60 дней, в базе лежит только его отпечаток;
--   • после 5 неверных паролей подряд вход по логину блокируется на 10 минут.
--
-- Кто что видит:
--   управляющий — всё;
--   персонал и инструктор — всё для работы, но не кассу, CRM, заявки, промокоды, сертификаты и переписку с гостями;
--   гость — свои брони, заказы, счёт и сообщения; чужие брони только как «занято», без имён и телефонов.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists mu;
revoke all on schema mu from public;

-- ---------- Данные: таблица records переезжает в закрытую схему mu ----------
do $$ begin
  if to_regclass('public.records') is not null and to_regclass('mu.records') is null then
    alter table public.records set schema mu;
  end if;
end $$;

create table if not exists mu.records (
  property   text not null,
  coll       text not null,
  rid        text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (property, coll, rid)
);
create index if not exists records_property_updated on mu.records (property, updated_at);
create index if not exists records_login on mu.records (property, coll, (data->>'login'));

create or replace function mu.records_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on mu.records;
create trigger records_touch before insert or update on mu.records
  for each row execute function mu.records_touch();
drop function if exists public.records_touch();

alter table mu.records enable row level security;
drop policy if exists records_test_access on mu.records;   -- открытый доступ тестового этапа больше не нужен
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on mu.records from anon, authenticated';
  end if;
end $$;

-- Демо-пароли из старых данных больше не хранятся рядом с профилями
update mu.records set data = data - 'pass' where coll = 'users' and data ? 'pass';

-- ---------- Учётные записи, сессии, ключи QR ----------
create table if not exists mu.members (
  property     text not null,                 -- 'mu', 'lg' или '*' (владелец сети: все объекты)
  login        text not null,
  role         text not null check (role in ('admin', 'staff', 'instructor', 'guest')),
  pass_hash    text,                          -- bcrypt; пусто — вход только по ссылке (QR, гость без регистрации)
  active       boolean not null default true,
  fails        int not null default 0,
  locked_until timestamptz,
  last_login   timestamptz,
  created_at   timestamptz not null default now(),
  primary key (property, login)
);
create unique index if not exists members_login_ci on mu.members (property, lower(login));

create table if not exists mu.sessions (
  token_hash text primary key,                -- sha256 ключа: сам ключ знает только телефон
  property   text not null,
  login      text not null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_login on mu.sessions (property, login);

create table if not exists mu.qr_keys (
  property text not null,
  unit_id  text not null,
  key      text not null,
  primary key (property, unit_id)
);

-- ---------- Служебные функции (из интернета не вызываются) ----------
create or replace function mu.sha(t text) returns text language sql immutable as $$
  select encode(extensions.digest(t, 'sha256'), 'hex')
$$;

create or replace function mu.err(msg text) returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', msg)
$$;

-- Новая сессия: возвращает ответ для приложения
create or replace function mu.open_session(p_property text, p_login text, p_role text) returns jsonb
language plpgsql as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from mu.sessions where expires_at < now();
  insert into mu.sessions (token_hash, property, login, expires_at) values (mu.sha(tok), p_property, p_login, now() + interval '60 days');
  update mu.members set last_login = now() where property = p_property and login = p_login;
  return jsonb_build_object('ok', true, 'token', tok, 'login', p_login, 'role', p_role);
end $$;

-- Кто пришёл. Ошибка «session» — приложение попросит войти заново
do $$ begin
  if to_regtype('mu.who_t') is null then create type mu.who_t as (login text, role text, mprop text); end if;
end $$;
create or replace function mu.who(p_token text, p_property text) returns mu.who_t
language plpgsql as $$
declare s mu.sessions; m mu.members; out mu.who_t;
begin
  select * into s from mu.sessions where token_hash = mu.sha(coalesce(p_token, '')) and expires_at > now();
  if not found then raise exception 'session' using errcode = '28000', hint = 'Войдите заново'; end if;
  select * into m from mu.members where property = s.property and login = s.login;
  if not found or not m.active then
    delete from mu.sessions where token_hash = s.token_hash;
    raise exception 'session' using errcode = '28000', hint = 'Доступ отключён';
  end if;
  if m.property <> '*' and m.property <> p_property then
    raise exception 'forbidden' using errcode = '42501', hint = 'Нет доступа к этому объекту';
  end if;
  if s.seen_at < now() - interval '1 hour' then
    update mu.sessions set seen_at = now(), expires_at = now() + interval '60 days' where token_hash = s.token_hash;
  end if;
  out.login := m.login; out.role := m.role; out.mprop := m.property;
  return out;
end $$;

create or replace function mu.need_admin(p_token text, p_property text) returns mu.who_t
language plpgsql as $$
declare w mu.who_t := mu.who(p_token, p_property);
begin
  if w.role <> 'admin' then raise exception 'forbidden' using errcode = '42501', hint = 'Только для управляющего'; end if;
  return w;
end $$;

create or replace function mu.login_taken(p_property text, p_login text) returns boolean language sql stable as $$
  select exists (select 1 from mu.members where property in (p_property, '*') and lower(login) = lower(p_login))
      or exists (select 1 from mu.records where property = p_property and coll = 'users' and lower(rid) = lower(p_login) and not deleted)
$$;

create or replace function mu.put_user(p_property text, p_login text, p_data jsonb) returns void language sql as $$
  insert into mu.records (property, coll, rid, data, deleted) values (p_property, 'users', p_login, p_data, false)
  on conflict (property, coll, rid) do update set data = excluded.data, deleted = false
$$;

-- Номера броней, выездов и проката, которые принадлежат гостю (для его счёта и квитанций)
create or replace function mu.own_ids(p_property text, p_login text) returns text[] language sql stable as $$
  select coalesce(array_agg(data->>'id'), '{}') from mu.records
  where property = p_property and coll in ('bookings', 'rides', 'rentals') and not deleted
    and (data->>'login' = p_login or coalesce(data->'group'->'members', '[]') ? p_login)
$$;

-- Одинаковы ли две записи, если не считать перечисленных полей
create or replace function mu.same_except(a jsonb, b jsonb, keys text[]) returns boolean language sql immutable as $$
  select (coalesce(a, '{}') - keys) = (coalesce(b, '{}') - keys)
$$;

-- ---------- Что видит каждая роль ----------
-- Возвращает запись в том виде, в каком её можно показать, или null, если показывать нельзя
create or replace function mu.view(p_role text, p_me text, p_coll text, p_rid text, d jsonb, own text[]) returns jsonb
language plpgsql immutable as $$
declare mine boolean;
begin
  if d is null then return null; end if;
  if p_role = 'admin' then return d; end if;

  if p_role in ('staff', 'instructor') then
    if p_coll in ('tx', 'crm', 'leads', 'promos', 'certs', 'passes', 'incidents', 'messages', 'waitlist') then return null; end if;
    if p_coll = 'users' and d->>'role' = 'guest' then return null; end if;
    if p_coll = 'notes' and not (d->>'to' in (p_me, 'staff', 'instructor', 'all')) then return null; end if;
    return d;
  end if;

  -- Гость
  mine := d->>'login' = p_me;
  case p_coll
    when '$' then
      if p_rid = 'settings' then return d - 'shiftPay'; end if;
      if p_rid = 'seeded' then return d; end if;
      return null;
    when 'units', 'quads', 'stock', 'promos', 'refs' then return d;
    when 'events' then
      return jsonb_set(d, '{going}', coalesce((select jsonb_agg(case when g->>'login' = p_me then g else jsonb_build_object('n', g->'n') end)
                                               from jsonb_array_elements(coalesce(d->'going', '[]')) g), '[]'));
    when 'reviews' then return case when mine then d else d - 'login' - 'bookingId' end;
    when 'bookings' then
      if mine or (d->>'id') = any(own) then return d; end if;
      return jsonb_strip_nulls(jsonb_build_object('id', d->'id', 'unitId', d->'unitId', 'start', d->'start', 'end', d->'end',
                                                  'date', d->'date', 'from', d->'from', 'to', d->'to', 'closed', d->'closed'));
    when 'rides' then
      if mine then return d; end if;
      return jsonb_strip_nulls(jsonb_build_object('id', d->'id', 'quadId', d->'quadId', 'date', d->'date', 'from', d->'from', 'dur', d->'dur', 'status', d->'status'));
    when 'rentals' then
      if mine then return d; end if;
      return jsonb_strip_nulls(jsonb_build_object('id', d->'id', 'itemId', d->'itemId', 'date', d->'date', 'from', d->'from', 'hours', d->'hours', 'status', d->'status'));
    when 'tasks', 'messages', 'sos', 'waitlist', 'passes', 'certs' then return case when mine then d end;
    when 'notes' then return case when d->>'to' = p_me then d end;
    when 'lost' then return case when d->>'guestLogin' = p_me then d end;
    when 'tx', 'incidents' then
      return case when (d->>'bookingId') = any(own) or (d->>'folio') = any(own) then d end;
    when 'users' then
      if p_rid = p_me then return d; end if;
      if d->>'role' in ('admin', 'staff', 'instructor') then
        return jsonb_build_object('login', d->'login', 'name', d->'name', 'role', d->'role', 'title', d->'title');
      end if;
      return null;
    else return null;
  end case;
end $$;

-- ---------- Что может менять каждая роль ----------
-- old — запись на сервере сейчас (null, если её нет или она удалена), new — что прислал телефон
create or replace function mu.can_write(p_property text, p_role text, p_me text, p_coll text, p_rid text,
                                        old jsonb, new jsonb, del boolean, own text[]) returns boolean
language plpgsql stable as $$
declare oldmine boolean; newmine boolean;
begin
  if p_role = 'admin' then return true; end if;

  if p_role in ('staff', 'instructor') then
    if del then
      if old is null then return true; end if;
      if p_coll in ('notes', 'rides') then return true; end if;
      -- отменённый выезд на квадроциклах убирает и свою оплату
      if p_coll = 'tx' then
        return exists (select 1 from mu.records where property = p_property and coll = 'rides' and data->>'id' = old->>'bookingId');
      end if;
      return false;
    end if;
    if p_coll = 'tx' then return old is null; end if;                       -- касса: только добавлять (бензин, ТО, оплата выезда)
    if p_coll = 'users' then
      if p_rid = p_me then return old is not null and new->>'role' = old->>'role'; end if;
      return false;
    end if;
    if p_coll = '$' then
      if p_rid = 'daily' then return true; end if;
      if p_rid = 'settings' then return old is not null and mu.same_except(old, new, array['weatherStop']); end if;
      return false;
    end if;
    return p_coll in ('tasks', 'accepts', 'units', 'rides', 'quads', 'stock', 'notes', 'checkins', 'moods',
                      'lost', 'fuel', 'tickets', 'bookings', 'rentals', 'sos');
  end if;

  -- Гость
  oldmine := old is not null and old->>'login' = p_me;
  newmine := new is not null and new->>'login' = p_me;

  if del then
    if old is null then return true; end if;
    if p_coll in ('bookings', 'rides', 'rentals', 'tasks', 'waitlist') then return oldmine; end if;
    if p_coll = 'notes' then return old->>'to' = p_me; end if;
    if p_coll = 'tx' then return (old->>'bookingId') = any(own) and old->>'type' = 'in'; end if;
    return false;
  end if;

  if old is null then   -- новая запись
    if p_coll in ('bookings', 'rides', 'rentals', 'sos', 'waitlist', 'passes', 'reviews', 'certs') then return newmine; end if;
    if p_coll = 'messages' then return newmine and new->>'from' = 'guest'; end if;
    if p_coll = 'tasks' then return newmine or new->>'login' is null; end if;   -- заказ гостя или уборка перед его заездом
    if p_coll = 'notes' then return new->>'to' in ('admin', 'staff', 'instructor', p_me); end if;
    if p_coll = 'tx' then
      return new->>'type' = 'in' and (new->>'bookingId' is null or (new->>'bookingId') = any(own) or (new->>'folio') = any(own));
    end if;
    if p_coll = 'leads' then return true; end if;
    if p_coll = 'users' then return p_rid = p_me and new->>'role' = 'guest'; end if;
    return false;
  end if;

  -- изменение существующей записи
  case p_coll
    when 'bookings', 'rides', 'rentals', 'sos', 'waitlist', 'passes', 'reviews', 'tasks' then
      return oldmine and newmine;
    when 'certs' then   -- оплата сертификатом: баланс только уменьшается
      return oldmine and newmine and mu.same_except(old, new, array['balance']) and (new->>'balance')::numeric <= (old->>'balance')::numeric;
    when 'messages' then
      if not (oldmine and newmine) then return false; end if;
      return old->>'from' = 'guest' or mu.same_except(old, new, array['read']);
    when 'notes' then return old->>'to' = p_me and new->>'to' = p_me and mu.same_except(old, new, array['read']);
    when 'stock' then   -- покупка в магазине: остаток только уменьшается
      return mu.same_except(old, new, array['qty']) and (new->>'qty')::numeric <= (old->>'qty')::numeric;
    when 'promos' then
      return mu.same_except(old, new, array['used']) and (new->>'used')::int = (old->>'used')::int + 1;
    when 'tx' then      -- оплата общего счёта при выезде
      return ((old->>'folio') = any(own) or (old->>'bookingId') = any(own))
         and mu.same_except(old, new, array['paid', 'method', 'receipt']);
    when 'users' then
      if p_rid = p_me then
        return old->>'role' = 'guest' and new->>'role' = 'guest'
           and coalesce(old->'points', '0') = coalesce(new->'points', '0')
           and (coalesce((new->>'refDiscount')::boolean, false) <= coalesce((old->>'refDiscount')::boolean, false));
      end if;
      -- гость похвалил чистоту: горничной +5 баллов
      return old->>'role' = 'staff' and mu.same_except(old, new, array['points'])
         and coalesce((new->>'points')::int, 0) = coalesce((old->>'points')::int, 0) + 5;
    else return false;
  end case;
end $$;

-- ---------- Функции для приложения ----------
create or replace function public.mu_status(p_property text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'ready', exists (select 1 from mu.members where property in (p_property, '*') and role = 'admin' and active))
$$;

-- Первый запуск: создать управляющего. Работает, только пока управляющего нет
create or replace function public.mu_setup(p_property text, p_login text, p_password text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p text; nm text := coalesce(nullif(trim(p_name), ''), 'Управляющий'); lg text := trim(coalesce(p_login, ''));
begin
  lock table mu.members in exclusive mode;
  if exists (select 1 from mu.members where role = 'admin') then return mu.err('Управляющий уже создан. Войдите со своим паролем'); end if;
  if lg !~ '^[A-Za-z0-9._-]{3,32}$' then return mu.err('Логин: от 3 до 32 латинских букв или цифр'); end if;
  if length(coalesce(p_password, '')) < 8 then return mu.err('Пароль управляющего — минимум 8 символов'); end if;
  insert into mu.members (property, login, role, pass_hash) values ('*', lg, 'admin', extensions.crypt(p_password, extensions.gen_salt('bf', 10)));
  for p in select distinct property from mu.records union select p_property loop
    perform mu.put_user(p, lg, coalesce((select data from mu.records where property = p and coll = 'users' and rid = lg), '{}'::jsonb)
      || jsonb_build_object('login', lg, 'name', nm, 'role', 'admin', 'title', 'Управляющий') || jsonb_build_object('points', 0));
  end loop;
  return mu.open_session('*', lg, 'admin');
end $$;

create or replace function public.mu_login(p_property text, p_login text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m mu.members;
begin
  select * into m from mu.members where property in (p_property, '*') and lower(login) = lower(trim(coalesce(p_login, '')))
    order by property = '*' limit 1 for update;
  if not found or m.pass_hash is null then perform pg_sleep(0.4); return mu.err('Логин или пароль не подошли'); end if;
  if not m.active then return mu.err('Доступ отключён. Обратитесь к управляющему'); end if;
  if m.locked_until > now() then
    return mu.err('Слишком много попыток. Попробуйте через ' || ceil(extract(epoch from m.locked_until - now()) / 60) || ' мин.');
  end if;
  if m.pass_hash <> extensions.crypt(coalesce(p_password, ''), m.pass_hash) then
    update mu.members set fails = fails + 1, locked_until = case when fails + 1 >= 5 then now() + interval '10 minutes' end
      where property = m.property and login = m.login;
    return mu.err(case when m.fails + 1 >= 5 then 'Слишком много попыток. Вход закрыт на 10 минут' else 'Логин или пароль не подошли' end);
  end if;
  update mu.members set fails = 0, locked_until = null where property = m.property and login = m.login;
  return mu.open_session(m.property, m.login, m.role);
end $$;

-- Регистрация гостя
create or replace function public.mu_register(p_property text, p_login text, p_password text, p_name text, p_phone text, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lg text := trim(coalesce(p_login, '')); refby text; u jsonb;
begin
  if lg !~ '^[A-Za-z0-9._-]{3,32}$' then return mu.err('Логин: от 3 до 32 латинских букв или цифр'); end if;
  if lower(lg) ~ '^(qr-|grp-|v[0-9a-f]{6,})' then return mu.err('Такой логин занят, придумайте другой'); end if;
  if length(coalesce(p_password, '')) < 6 then return mu.err('Пароль — минимум 6 символов'); end if;
  if coalesce(trim(p_name), '') = '' then return mu.err('Укажите имя'); end if;
  if not exists (select 1 from mu.records where property = p_property and coll = 'units') then return mu.err('Объект не найден'); end if;
  if mu.login_taken(p_property, lg) then return mu.err('Такой логин уже занят, придумайте другой'); end if;
  if coalesce(trim(p_ref), '') <> '' then
    select rid into refby from mu.records where property = p_property and coll = 'users' and not deleted
      and upper(data->>'ref') = upper(trim(p_ref)) limit 1;
  end if;
  insert into mu.members (property, login, role, pass_hash) values (p_property, lg, 'guest', extensions.crypt(p_password, extensions.gen_salt('bf', 10)));
  u := jsonb_build_object('login', lg, 'name', trim(p_name), 'role', 'guest', 'title', 'Гость', 'phone', coalesce(trim(p_phone), ''),
                          'points', 0, 'bonus', 0, 'ref', 'G' || upper(substr(md5(lower(lg) || p_property), 1, 5)),
                          'consent', floor(extract(epoch from now()) * 1000)::bigint);
  if refby is not null then u := u || jsonb_build_object('refBy', refby, 'refDiscount', true); end if;
  perform mu.put_user(p_property, lg, u);
  return mu.open_session(p_property, lg, 'guest') || jsonb_build_object('ref', refby is not null);
end $$;

-- Посмотреть дома без регистрации: временный гость без пароля
create or replace function public.mu_visitor(p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lg text := 'v' || encode(extensions.gen_random_bytes(6), 'hex');
begin
  if not exists (select 1 from mu.records where property = p_property and coll = 'units') then return mu.err('Объект не найден'); end if;
  insert into mu.members (property, login, role) values (p_property, lg, 'guest');
  perform mu.put_user(p_property, lg, jsonb_build_object('login', lg, 'name', 'Гость', 'role', 'guest', 'title', 'Гость', 'phone', '',
                                                          'points', 0, 'bonus', 0, 'visitor', true));
  return mu.open_session(p_property, lg, 'guest');
end $$;

-- QR на столе в доме: ссылка содержит секретный ключ объекта
create or replace function public.mu_qr(p_property text, p_unit text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lg text := 'qr-' || p_unit; unit jsonb;
begin
  if not exists (select 1 from mu.qr_keys where property = p_property and unit_id = p_unit and key = coalesce(p_key, '')) then
    perform pg_sleep(0.4);
    return mu.err('QR-код устарел. Попросите у администратора новый');
  end if;
  select data into unit from mu.records where property = p_property and coll = 'units' and rid = p_unit and not deleted;
  if unit is null then return mu.err('Такого объекта больше нет'); end if;
  insert into mu.members (property, login, role) values (p_property, lg, 'guest') on conflict do nothing;
  if not exists (select 1 from mu.records where property = p_property and coll = 'users' and rid = lg and not deleted) then
    perform mu.put_user(p_property, lg, jsonb_build_object('login', lg, 'name', 'Гость, ' || coalesce(unit->>'short', p_unit), 'role', 'guest',
                                                            'title', 'Гость', 'phone', '', 'points', 0, 'bonus', 0, 'unitId', p_unit, 'qr', true));
  end if;
  return mu.open_session(p_property, lg, 'guest');
end $$;

-- Друг по ссылке-приглашению в бронь компании
create or replace function public.mu_join(p_property text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b mu.records; n int; lg text;
begin
  select * into b from mu.records where property = p_property and coll = 'bookings' and not deleted
    and data->'group'->>'code' = upper(trim(coalesce(p_code, ''))) limit 1 for update;
  if not found then perform pg_sleep(0.4); return mu.err('Приглашение не найдено или бронь уже закрыта'); end if;
  n := jsonb_array_length(coalesce(b.data->'group'->'members', '[]'));
  loop
    n := n + 1; lg := 'grp-' || upper(trim(p_code)) || '-' || n;
    exit when not mu.login_taken(p_property, lg);
  end loop;
  insert into mu.members (property, login, role) values (p_property, lg, 'guest');
  update mu.records set data = jsonb_set(data, '{group,members}', coalesce(data->'group'->'members', '[]') || to_jsonb(lg))
    where property = b.property and coll = b.coll and rid = b.rid;
  perform mu.put_user(p_property, lg, jsonb_build_object('login', lg, 'name', 'Друг из компании', 'role', 'guest', 'title', 'Гость',
                                                          'phone', '', 'points', 0, 'bonus', 0, 'groupOf', b.data->'id'));
  return mu.open_session(p_property, lg, 'guest');
end $$;

create or replace function public.mu_logout(p_token text) returns jsonb
language sql security definer set search_path = '' as $$
  delete from mu.sessions where token_hash = mu.sha(coalesce(p_token, ''));
  select jsonb_build_object('ok', true);
$$;

create or replace function public.mu_password(p_token text, p_property text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property); m mu.members;
begin
  select * into m from mu.members where property = w.mprop and login = w.login;
  if m.pass_hash is null or m.pass_hash <> extensions.crypt(coalesce(p_old, ''), m.pass_hash) then return mu.err('Старый пароль не подошёл'); end if;
  if length(coalesce(p_new, '')) < (case when m.role = 'admin' then 8 else 6 end) then
    return mu.err('Новый пароль слишком короткий');
  end if;
  update mu.members set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where property = m.property and login = m.login;
  delete from mu.sessions where property = m.property and login = m.login and token_hash <> mu.sha(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- Управляющий: список доступов персонала
create or replace function public.mu_members(p_token text, p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform mu.need_admin(p_token, p_property);
  return jsonb_build_object('ok', true, 'members', coalesce((select jsonb_agg(jsonb_build_object('login', login, 'role', role, 'active', active,
           'hasPass', pass_hash is not null, 'lastLogin', floor(extract(epoch from last_login) * 1000)::bigint) order by login)
    from mu.members where property in (p_property, '*') and role <> 'guest'), '[]'));
end $$;

-- Управляющий: выдать доступ сотруднику, сменить ему пароль или роль, отключить
create or replace function public.mu_member_set(p_token text, p_property text, p_login text, p_role text, p_password text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.need_admin(p_token, p_property); m mu.members; lg text := trim(coalesce(p_login, ''));
begin
  if p_role not in ('staff', 'instructor', 'admin') then return mu.err('Неизвестная роль'); end if;
  if p_password is not null and length(p_password) < 6 then return mu.err('Пароль — минимум 6 символов'); end if;
  select * into m from mu.members where property in (p_property, '*') and lower(login) = lower(lg) limit 1;
  if found then
    if m.role = 'guest' then return mu.err('Этот логин занят гостем'); end if;
    if m.login = w.login and (p_role <> 'admin' or p_active is false) then return mu.err('Себя отключить или понизить нельзя'); end if;
    update mu.members set role = p_role, active = coalesce(p_active, active), fails = 0, locked_until = null,
      pass_hash = case when p_password is not null then extensions.crypt(p_password, extensions.gen_salt('bf', 10)) else pass_hash end
      where property = m.property and login = m.login;
    if p_password is not null or p_active is false or p_role <> m.role then
      delete from mu.sessions where property = m.property and login = m.login;   -- со старым паролем больше не войти
    end if;
  else
    if lg !~ '^[A-Za-z0-9._-]{3,32}$' then return mu.err('Логин: от 3 до 32 латинских букв или цифр'); end if;
    if p_password is null then return mu.err('Задайте пароль'); end if;
    if exists (select 1 from mu.records where property = p_property and coll = 'users' and lower(rid) = lower(lg) and not deleted
               and data->>'role' = 'guest') then return mu.err('Этот логин занят гостем'); end if;
    insert into mu.members (property, login, role, pass_hash, active)
      values (p_property, lg, p_role, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), coalesce(p_active, true));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Управляющий: ключи для QR-кодов на столах. p_rotate — объект, которому выдать новый ключ (старый QR перестанет работать)
create or replace function public.mu_qr_keys(p_token text, p_property text, p_rotate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform mu.need_admin(p_token, p_property);
  if p_rotate is not null then delete from mu.qr_keys where property = p_property and unit_id = p_rotate; end if;
  insert into mu.qr_keys (property, unit_id, key)
    select p_property, rid, encode(extensions.gen_random_bytes(6), 'hex') from mu.records
    where property = p_property and coll = 'units' and not deleted
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'keys', coalesce((select jsonb_object_agg(unit_id, key) from mu.qr_keys where property = p_property), '{}'));
end $$;

-- Забрать записи, изменившиеся после p_since. Каждая роль получает только то, что ей можно видеть
create or replace function public.mu_pull(p_token text, p_property text, p_since timestamptz, p_limit int, p_offset int)
returns table (coll text, rid text, data jsonb, deleted boolean, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare w mu.who_t := mu.who(p_token, p_property); own text[] := '{}';
begin
  if w.role = 'guest' then own := mu.own_ids(p_property, w.login); end if;
  return query
    select r.coll, r.rid, case when r.deleted then null else v.d end, r.deleted, r.updated_at
    from mu.records r
    cross join lateral (select mu.view(w.role, w.login, r.coll, r.rid, r.data, own) as d) v
    where r.property = p_property and (p_since is null or r.updated_at > p_since) and v.d is not null
    order by r.updated_at, r.coll, r.rid
    limit least(greatest(coalesce(p_limit, 500), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Отправить изменения. Запрещённое не сохраняется: в ответе — как запись выглядит на сервере, телефон вернёт её назад
create or replace function public.mu_push(p_token text, p_property text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w mu.who_t := mu.who(p_token, p_property);
  own text[] := '{}'; x jsonb; c text; r text; nd jsonb; del boolean; o mu.records; od jsonb; ok boolean;
  saved int := 0; rejected jsonb := '[]';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'bad rows' using errcode = '22023'; end if;
  if w.role = 'guest' then
    own := mu.own_ids(p_property, w.login) || coalesce((select array_agg(e->'data'->>'id') from jsonb_array_elements(p_rows) e
      where e->>'coll' in ('bookings', 'rides', 'rentals') and e->'data'->>'login' = w.login), '{}');
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    c := x->>'coll'; r := x->>'rid'; nd := x->'data'; del := coalesce((x->>'deleted')::boolean, false);
    if c is null or r is null or (not del and (nd is null or jsonb_typeof(nd) = 'null')) then continue; end if;
    if c = 'users' and not del then nd := nd - 'pass'; end if;
    select * into o from mu.records t where t.property = p_property and t.coll = c and t.rid = r for update;
    od := case when found and not o.deleted then o.data end;

    -- Гость записывается на событие: к списку на сервере добавляются только его места
    if w.role = 'guest' and c = 'events' and not del and od is not null then
      nd := jsonb_set(od, '{going}', coalesce(od->'going', '[]') || coalesce((select jsonb_agg(g) from jsonb_array_elements(coalesce(nd->'going', '[]')) g
              where g->>'login' = w.login and not exists (select 1 from jsonb_array_elements(coalesce(od->'going', '[]')) h where h->>'login' = w.login)), '[]'));
      ok := mu.same_except(od, nd, array['going']) and jsonb_array_length(nd->'going') > jsonb_array_length(coalesce(od->'going', '[]'))
            and (select coalesce(sum((g->>'n')::int), 0) from jsonb_array_elements(nd->'going') g) <= coalesce((od->>'places')::int, 0);
    else
      ok := mu.can_write(p_property, w.role, w.login, c, r, od, nd, del, own);
    end if;

    if ok then
      if del then
        if od is not null then update mu.records t set deleted = true where t.property = p_property and t.coll = c and t.rid = r; end if;
      else
        insert into mu.records (property, coll, rid, data, deleted) values (p_property, c, r, nd, false)
          on conflict (property, coll, rid) do update set data = excluded.data, deleted = false;
      end if;
      saved := saved + 1;
    else
      rejected := rejected || jsonb_build_array(jsonb_build_object('coll', c, 'rid', r, 'data', mu.view(w.role, w.login, c, r, od, own)));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', saved, 'rejected', rejected);
end $$;

-- Подарочный сертификат: проверить по коду (p_amount = 0) или списать сумму. Код знает только тот, кому его подарили
create or replace function public.mu_cert(p_token text, p_property text, p_code text, p_amount int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property); c mu.records; bal int; take int;
begin
  select * into c from mu.records where property = p_property and coll = 'certs' and rid = upper(trim(coalesce(p_code, ''))) and not deleted for update;
  bal := coalesce((c.data->>'balance')::int, 0);
  if not found or bal <= 0 then perform pg_sleep(0.4); return mu.err('Сертификат не найден или уже потрачен'); end if;
  if coalesce(p_amount, 0) <= 0 then return jsonb_build_object('ok', true, 'code', c.rid, 'balance', bal); end if;
  take := least(bal, p_amount);
  update mu.records set data = jsonb_set(data, '{balance}', to_jsonb(bal - take)) where property = c.property and coll = c.coll and rid = c.rid;
  return jsonb_build_object('ok', true, 'code', c.rid, 'taken', take, 'balance', bal - take);
end $$;

-- Из интернета вызываются только функции выше
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all functions in schema mu from public, anon, authenticated;
    revoke all on all tables in schema mu from anon, authenticated;
    foreach f in array array['mu_status(text)', 'mu_setup(text,text,text,text)', 'mu_login(text,text,text)',
      'mu_register(text,text,text,text,text,text)', 'mu_visitor(text)', 'mu_qr(text,text,text)', 'mu_join(text,text)',
      'mu_logout(text)', 'mu_password(text,text,text,text)', 'mu_members(text,text)', 'mu_member_set(text,text,text,text,text,boolean)',
      'mu_qr_keys(text,text,text)', 'mu_cert(text,text,text,int)', 'mu_pull(text,text,timestamptz,int,int)', 'mu_push(text,text,jsonb)'] loop
      execute format('revoke all on function public.%s from public', f);
      execute format('grant execute on function public.%s to anon, authenticated', f);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
