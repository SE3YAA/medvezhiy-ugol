-- sync.sql — общая база для приложения «Медвежий угол», тестовый этап.
-- Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run.
-- Если Supabase спросит про RLS, выбирайте «Run and enable RLS».
--
-- Каждая запись приложения (бронь, задача, платёж, фото приёмки…) хранится строкой в таблице records.
-- Приложение раз в несколько секунд забирает свежие строки и отправляет свои изменения.
--
-- ВАЖНО: на тестовом этапе читать и писать может любой, у кого есть сайт приложения.
-- Поэтому здесь только демо-данные, без паспортов и телефонов настоящих гостей.
-- Перед запуском для реальных гостей доступ закроем: вход по паролю и права по ролям.

create table if not exists public.records (
  property   text not null,              -- объект сети: 'mu' — Медвежий угол
  coll       text not null,              -- раздел: bookings, tasks, tx, users…
  rid        text not null,              -- номер записи внутри раздела
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (property, coll, rid)
);
create index if not exists records_property_updated on public.records (property, updated_at);

-- Время изменения ставит сервер: по нему телефоны понимают, что появилось нового
create or replace function public.records_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

alter table public.records enable row level security;
drop policy if exists records_test_access on public.records;
create policy records_test_access on public.records
  for all to anon, authenticated
  using (property in ('mu', 'lg'))
  with check (property in ('mu', 'lg'));

-- Удалять строки нельзя: удаление в приложении помечает запись deleted = true
grant select, insert, update on public.records to anon, authenticated;
