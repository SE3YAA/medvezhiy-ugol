-- schema.sql — база данных экосистемы «Медвежий угол» для Supabase (PostgreSQL).
-- Как применить: Supabase → SQL Editor → вставить файл целиком → Run.
--
-- Главный принцип: каждая запись принадлежит объекту сети (property_id).
-- Франчайзи видит только свой объект, владелец сети видит все. Это обеспечивают
-- политики Row Level Security внизу файла, а не код приложения.
-- Таблицы повторяют структуру db.js, поэтому перенос данных — механическая работа.

create extension if not exists "pgcrypto";

-- ---------- Объекты сети и люди ----------
create table properties (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,              -- 'mu', 'lg'
  name        text not null,
  place       text,
  settings    jsonb not null default '{}'::jsonb, -- наценки, налог, бонусы, ставка смены (DB.S в прототипе)
  created_at  timestamptz not null default now()
);

-- Профиль пользователя. Сам вход (телефон + SMS) делает Supabase Auth, id совпадает с auth.users
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  phone       text unique,
  birthday    date,
  ref_code    text unique,
  ref_by      uuid references profiles,
  bonus       integer not null default 0,         -- бонусы в рублях
  consent_at  timestamptz,                        -- согласие на обработку данных, 152-ФЗ
  created_at  timestamptz not null default now()
);

-- Роль человека на конкретном объекте. Один человек может быть гостем на одном объекте и сотрудником на другом
create type role_kind as enum ('owner', 'admin', 'staff', 'instructor', 'guest');
create table memberships (
  property_id uuid references properties on delete cascade,
  user_id     uuid references profiles on delete cascade,
  role        role_kind not null,
  title       text,
  points      integer not null default 0,
  trained     boolean not null default false,
  course      jsonb,
  primary key (property_id, user_id)
);

-- ---------- Объекты размещения и брони ----------
create type unit_kind as enum ('house', 'gazebo', 'sauna');
create table units (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  code        text not null,                     -- 'h1', 's1'
  kind        unit_kind not null,
  mode        text not null check (mode in ('day', 'hour')),
  name        text not null,
  short       text not null,
  price       integer not null,                  -- за ночь или за час
  capacity    integer not null,
  status      text not null default 'ready' check (status in ('ready', 'cleaning', 'dirty', 'rework')),
  open_min    integer, close_min integer, min_hours integer, buffer_min integer default 0,
  description text, story text, features text[], photos text[],
  map_x integer, map_y integer,
  unique (property_id, code)
);

create table bookings (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  unit_id     uuid not null references units,
  guest_id    uuid references profiles,
  guest_name  text not null,
  phone       text,
  guests      integer,
  start_date  date, end_date date,               -- посуточно: ночи [start, end)
  day         date, from_min integer, to_min integer, -- по часам
  source      text not null default 'Прямая',
  base        integer not null default 0,
  tax         integer not null default 0,
  amount      integer not null default 0,
  paid        boolean not null default false,
  closed      boolean not null default false,
  early       boolean not null default false,
  late        boolean not null default false,
  checkin     jsonb,                             -- онлайн-регистрация
  group_code  text unique,
  promo_code  text,
  created_at  timestamptz not null default now(),
  check ((start_date is not null and end_date > start_date) or (day is not null and to_min > from_min))
);
create index on bookings (property_id, unit_id, start_date);
create index on bookings (property_id, unit_id, day);
-- Одна и та же ночь в доме не может быть продана дважды — защищает база, а не интерфейс
create extension if not exists btree_gist;
alter table bookings add constraint no_double_nights
  exclude using gist (unit_id with =, daterange(start_date, end_date) with &&) where (start_date is not null);

create table group_members (booking_id uuid references bookings on delete cascade, user_id uuid references profiles, primary key (booking_id, user_id));
create table waitlist (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade,
  unit_id uuid references units, user_id uuid references profiles, name text, phone text,
  start_date date, end_date date, offered_at timestamptz, created_at timestamptz default now()
);

-- ---------- Деньги ----------
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  type        text not null check (type in ('in', 'out')),
  amount      integer not null check (amount >= 0),
  category    text not null,                     -- stay, gazebo, sauna, quad, goods, food, rent, extra, pass, tax, other
  title       text not null,
  method      text not null,                     -- Наличные, Карта, СБП, Перевод, В счёт проживания
  booking_id  uuid references bookings on delete set null,
  folio_id    uuid references bookings,          -- общий счёт дома
  paid        boolean not null default true,
  receipt     jsonb,                             -- ответ онлайн-кассы: ФН, ФД, ФП
  payment_id  text,                              -- id платежа в эквайринге
  created_at  timestamptz not null default now()
);
create index on transactions (property_id, created_at desc);

create table promos (property_id uuid references properties on delete cascade, code text, pct integer not null, used integer not null default 0, max_uses integer, until date, note text, primary key (property_id, code));
create table certificates (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, code text unique not null, amount integer not null, balance integer not null, buyer text, recipient text, created_at timestamptz default now());
create table passes (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, product text not null, code text unique not null, user_id uuid references profiles, name text, phone text, visits_left integer not null, visits_total integer not null, created_at timestamptz default now());
create table incidents (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, booking_id uuid references bookings, text text not null, amount integer not null, photo text, status text default 'billed', created_at timestamptz default now());

-- ---------- Работа персонала ----------
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  unit_id     uuid references units,
  title       text not null, place text, template text not null, due text,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  steps       jsonb not null default '[]'::jsonb, -- [{done, photo_path}]
  guest       text, note text,
  booking_id  uuid references bookings on delete cascade,
  for_user    uuid references profiles,          -- гость, которому сообщить о готовности
  done_by     uuid references profiles, done_at timestamptz,
  created_at  timestamptz not null default now()
);
create table acceptances (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade,
  unit_id uuid references units, task_id uuid references tasks, by_user uuid references profiles,
  photos jsonb not null default '[]'::jsonb,       -- пути к файлам в Storage, а не сами снимки
  state text not null default 'ok', reason text, created_at timestamptz default now()
);
create table standard_refs (property_id uuid references properties on delete cascade, template text, step integer, photo text, primary key (property_id, template, step));
create table shifts (property_id uuid references properties on delete cascade, user_id uuid references profiles, day date, primary key (property_id, user_id, day));
create table checkins (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, user_id uuid references profiles, day date not null, time_in timestamptz not null, time_out timestamptz);
create table moods (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, user_id uuid references profiles, day date, mood smallint check (mood between 1 and 5), tags text[]);
create table lost_items (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, unit_id uuid references units, title text, photo text, guest_id uuid references profiles, status text default 'stored', created_at timestamptz default now());

-- ---------- Хозяйство ----------
create table stock (property_id uuid references properties on delete cascade, code text, name text, unit text, qty numeric not null default 0, min_qty numeric not null default 0, primary key (property_id, code));
create table tickets (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, unit_id uuid references units, place text, title text not null, photo text, priority text default 'normal', status text default 'new', by_user uuid references profiles, created_at timestamptz default now());
create table upkeep (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, title text, place text, every_days integer, last_done date);
create table projects (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, name text, budget integer, stages jsonb default '[]', costs jsonb default '[]', photos text[]);
create table heating (unit_id uuid primary key references units on delete cascade, target smallint default 22, eco smallint default 12, auto boolean default true);

-- ---------- Квадроциклы ----------
create table quads (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, num integer, name text, status text default 'park', total_hours numeric default 0, to_service numeric default 0, interval_hours numeric default 50, defects text, last_service timestamptz);
create table rides (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade,
  quad_id uuid references quads, guest_id uuid references profiles, guest_name text, day date, from_min integer, dur_min integer, route text,
  status text default 'booked', signed_as text, signed_at timestamptz, briefed boolean default false,
  photos jsonb default '{}', started_at timestamptz, ended_at timestamptz, hours numeric, amount integer, alarm boolean default false,
  track jsonb                                     -- точки GPS-трекера
);
create table fuel (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, quad_id uuid references quads, liters numeric, cost integer, created_at timestamptz default now());

-- ---------- Гости: допуслуги и обратная связь ----------
create table rentals (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, item text, user_id uuid references profiles, guest_name text, day date, from_min integer, hours integer, status text default 'booked', amount integer);
create table events (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, title text, day date, time_min integer, price integer default 0, places integer, description text);
create table event_guests (event_id uuid references events on delete cascade, user_id uuid references profiles, people integer default 1, primary key (event_id, user_id));
create table reviews (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, booking_id uuid references bookings, user_id uuid references profiles, unit_id uuid references units, stars smallint check (stars between 1 and 5), tags text[], text text, routed text, created_at timestamptz default now());
create table leads (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, kind text, partner text, name text, phone text, text text, amount integer, commission integer, status text default 'new', created_at timestamptz default now());
create table sos (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, user_id uuid references profiles, kind text, unit_id uuid references units, status text default 'open', created_at timestamptz default now());
create table messages (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, guest_id uuid references profiles, author text check (author in ('guest', 'admin')), text text not null, read boolean default false, created_at timestamptz default now());
create table notifications (id uuid primary key default gen_random_uuid(), property_id uuid not null references properties on delete cascade, to_user uuid references profiles, to_role role_kind, text text, icon text, link text, read boolean default false, sent_telegram boolean default false, created_at timestamptz default now());
create table guest_notes (property_id uuid references properties on delete cascade, phone text, tags text[], note text, primary key (property_id, phone));

-- =====================================================================
--  Права доступа (Row Level Security)
-- =====================================================================
-- Помощники: какая роль у текущего пользователя на объекте
create or replace function my_role(p uuid) returns role_kind language sql stable security definer as $$
  select role from memberships where property_id = p and user_id = auth.uid()
$$;
create or replace function is_team(p uuid) returns boolean language sql stable security definer as $$
  select coalesce(my_role(p) in ('owner', 'admin', 'staff', 'instructor'), false)
$$;
create or replace function is_admin(p uuid) returns boolean language sql stable security definer as $$
  select coalesce(my_role(p) in ('owner', 'admin'), false)
$$;

-- Включаем RLS на всех таблицах с property_id и даём команде объекта полный доступ к своему объекту
do $$
declare t text;
begin
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'property_id' group by table_name loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy team_all on %I for all using (is_team(property_id)) with check (is_team(property_id))', t);
  end loop;
end $$;

-- Деньги, цены, промокоды и аналитику меняет только управляющий
drop policy team_all on transactions;
create policy admin_money on transactions for all using (is_admin(property_id)) with check (is_admin(property_id));
create policy staff_read_money on transactions for select using (is_team(property_id) and category in ('goods', 'rent'));
drop policy team_all on promos;
create policy admin_promos on promos for all using (is_admin(property_id)) with check (is_admin(property_id));

-- Гость видит каталог объекта и только свои записи
create policy guest_units on units for select using (true);
create policy guest_events on events for select using (true);
create policy guest_own_bookings on bookings for select using (guest_id = auth.uid() or exists (select 1 from group_members g where g.booking_id = id and g.user_id = auth.uid()));
create policy guest_new_booking on bookings for insert with check (guest_id = auth.uid());
create policy guest_messages on messages for all using (guest_id = auth.uid()) with check (guest_id = auth.uid() and author = 'guest');
create policy guest_reviews on reviews for insert with check (user_id = auth.uid());
create policy guest_sos on sos for insert with check (user_id = auth.uid());
create policy guest_notes_read on notifications for select using (to_user = auth.uid());
create policy guest_rides on rides for select using (guest_id = auth.uid());
create policy guest_rentals on rentals for select using (user_id = auth.uid());
create policy guest_tasks on tasks for select using (for_user = auth.uid());
create policy guest_folio on transactions for select using (folio_id in (select id from bookings where guest_id = auth.uid()));

alter table profiles enable row level security;
create policy own_profile on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy team_sees_guests on profiles for select using (exists (select 1 from memberships m where m.user_id = profiles.id and is_team(m.property_id)));
alter table memberships enable row level security;
create policy own_membership on memberships for select using (user_id = auth.uid() or is_admin(property_id));
create policy admin_memberships on memberships for all using (is_admin(property_id)) with check (is_admin(property_id));

-- Владелец сети: роль owner на каждом объекте даёт сводку по всей сети (экран «Сеть объектов»)

-- Фото (приёмка, ремонт, осмотр квадроциклов) храните в Supabase Storage, бакет 'photos',
-- путь вида {property_id}/{таблица}/{id}.jpg. В таблицах лежит только путь к файлу.
