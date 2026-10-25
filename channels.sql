-- channels.sql — брони с площадок через менеджер каналов (RealtyCalendar и подобные).
-- Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run.
-- Запускать после auth.sql, payments.sql и push.sql. Повторный запуск ничего не ломает.
--
-- Как это работает:
--   • менеджер каналов при каждой новой, изменённой или отменённой брони отправляет её на функцию channels (Edge Function);
--   • функция убирает имя, телефон и почту гостя и передаёт сюда только даты, дом, сумму и площадку (152-ФЗ:
--     пока база за границей, контакты гостей остаются в менеджере каналов);
--   • бронь записывается в общую базу, сразу появляется в шахматке у всех телефонов, управляющему приходит уведомление;
--   • если такая же бронь (тот же дом и даты) уже заведена в приложении вручную, она привязывается, а не дублируется;
--   • сторож пересечений: если на один дом попали две брони на одно время — с площадок, из приложения или вручную, —
--     управляющему сразу приходит срочное уведомление «Овербукинг».

-- ---------- Настройки и журнал ----------
create table if not exists mu.channel_config (
  property   text primary key,
  secret     text not null default encode(extensions.gen_random_bytes(16), 'hex'),  -- ключ в ссылке для менеджера каналов
  units      jsonb not null default '{}'::jsonb,                                     -- № лота в менеджере каналов → дом в приложении
  fn_url     text,                                                                   -- адрес функции channels в Supabase
  created_at timestamptz not null default now()
);

create table if not exists mu.channel_events (
  id          bigserial primary key,
  property    text not null,
  received_at timestamptz not null default now(),
  kind        text not null default 'new',   -- new, change, cancel, test
  sys         text,                           -- какой менеджер каналов прислал
  ext_id      text,                           -- номер брони в менеджере каналов
  lot         text,                           -- № лота (дома) в менеджере каналов
  lot_title   text,                           -- как дом назван там
  start_date  date,
  end_date    date,
  amount      numeric,
  guests      int,
  source      text,                           -- площадка: Авито, Яндекс Путешествия…
  status      text not null default 'new',    -- applied, linked, unmapped, cancelled, skipped, test, error
  note        text,
  booking_rid text,
  raw         jsonb                           -- что прислали, но без имён, телефонов и почты
);
create index if not exists channel_events_recent on mu.channel_events (property, received_at desc);
create index if not exists channel_events_ext on mu.channel_events (property, ext_id);
create index if not exists records_ext on mu.records (property, coll, (data->'ext'->>'id'));

-- О каждой паре пересекающихся броней предупреждаем один раз
create table if not exists mu.overbook_alerts (
  property   text not null,
  a          text not null,
  b          text not null,
  created_at timestamptz not null default now(),
  primary key (property, a, b)
);

alter table mu.channel_config enable row level security;
alter table mu.channel_events enable row level security;
alter table mu.overbook_alerts enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on mu.channel_config, mu.channel_events, mu.overbook_alerts from anon, authenticated';
  end if;
end $$;

-- ---------- Помощники ----------
-- Номер записи как в приложении: время в миллисекундах × 1000 плюс случайное число
create or replace function mu.new_id() returns bigint language sql volatile as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint * 1000 + floor(random() * 1000)::bigint
$$;

create or replace function mu.try_date(t text) returns date language plpgsql immutable as $$
begin return t::date; exception when others then return null; end $$;

create or replace function mu.try_num(t text) returns numeric language plpgsql immutable as $$
begin return round(t::numeric); exception when others then return null; end $$;

-- «12 ноя»
create or replace function mu.dm(t text) returns text language plpgsql immutable as $$
declare d date := mu.try_date(t);
begin
  if d is null then return coalesce(t, ''); end if;
  return extract(day from d)::int || ' ' || (array['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'])[extract(month from d)::int];
end $$;

-- Когда: «12 ноя – 14 ноя» для домов или «12 ноя, 18:00–21:00» для бани и беседок
create or replace function mu.when_txt(d jsonb) returns text language plpgsql immutable as $$
declare f int; t int;
begin
  if d->>'start' is not null then return mu.dm(d->>'start') || ' – ' || mu.dm(d->>'end'); end if;
  f := (d->>'from')::int; t := (d->>'to')::int;
  return mu.dm(d->>'date') || ', ' || lpad((f / 60)::text, 2, '0') || ':' || lpad((f % 60)::text, 2, '0')
         || '–' || lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0');
exception when others then return '';
end $$;

create or replace function mu.unit_name(p_property text, p_unit text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(data->>'short', data->>'name') from mu.records
                   where property = p_property and coll = 'units' and rid = p_unit and not deleted), p_unit, 'дом')
$$;

-- Уведомление в приложении. Пуш на телефон уходит сам (триггер из push.sql)
create or replace function mu.note(p_property text, p_to text, p_text text, p_icon text, p_go text) returns void
language plpgsql security definer set search_path = '' as $$
declare nid bigint := mu.new_id();
begin
  insert into mu.records (property, coll, rid, data)
  values (p_property, 'notes', nid::text, jsonb_build_object('id', nid, 'to', p_to, 'text', p_text, 'icon', coalesce(p_icon, 'info'),
          'go', coalesce(p_go, ''), 'ts', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'read', false));
end $$;

-- ---------- Сторож пересечений ----------
-- Срабатывает на любую новую или изменённую бронь, откуда бы она ни пришла
create or replace function mu.bookings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o record; d jsonb := new.data; a text; b text; inserted int;
begin
  if new.coll <> 'bookings' or new.deleted or d is null or coalesce(d->>'unitId', '') = '' then return new; end if;
  if tg_op = 'UPDATE' and not old.deleted and old.data->>'unitId' is not distinct from d->>'unitId'
     and old.data->>'start' is not distinct from d->>'start' and old.data->>'end' is not distinct from d->>'end'
     and old.data->>'date' is not distinct from d->>'date' and old.data->>'from' is not distinct from d->>'from'
     and old.data->>'to' is not distinct from d->>'to' then
    return new;   -- даты и дом не менялись
  end if;
  for o in
    select r.rid, r.data from mu.records r
    where r.property = new.property and r.coll = 'bookings' and not r.deleted and r.rid <> new.rid
      and r.data->>'unitId' = d->>'unitId'
      and ((d->>'start' is not null and r.data->>'start' is not null
            and r.data->>'start' < d->>'end' and d->>'start' < r.data->>'end')
        or (d->>'date' is not null and r.data->>'date' = d->>'date'
            and (r.data->>'from')::int < (d->>'to')::int and (d->>'from')::int < (r.data->>'to')::int))
  loop
    a := least(new.rid, o.rid); b := greatest(new.rid, o.rid);
    insert into mu.overbook_alerts (property, a, b) values (new.property, a, b) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      perform mu.note(new.property, 'admin',
        format('Овербукинг! %s: %s и %s — две брони на одно время (%s и %s). Откройте шахматку и решите, кого переселить',
               mu.unit_name(new.property, d->>'unitId'), mu.when_txt(d), mu.when_txt(o.data),
               coalesce(d->>'source', 'Прямая'), coalesce(o.data->>'source', 'Прямая')),
        'alert', 'chess');
    end if;
  end loop;
  return new;
exception when others then return new;   -- сторож никогда не мешает сохранить бронь
end $$;
drop trigger if exists records_guard on mu.records;
create trigger records_guard after insert or update on mu.records for each row execute function mu.bookings_guard();

-- ---------- Разбор одного события от менеджера каналов ----------
create or replace function mu.channel_apply(ev_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  e mu.channel_events; cfg mu.channel_config; r mu.records; unit text; d jsonb; bid bigint;
  src text; linked boolean := false; moved boolean;
begin
  select * into e from mu.channel_events where id = ev_id;
  select * into cfg from mu.channel_config where property = e.property;
  src := coalesce(nullif(e.source, ''), 'менеджер каналов');

  if e.kind = 'test' then
    perform mu.note(e.property, 'admin', 'Связь с менеджером каналов работает: проверочная бронь дошла до приложения', 'check', 'm_settings');
    update mu.channel_events set status = 'test' where id = ev_id;
    return 'test';
  end if;

  -- Эта бронь уже есть в приложении?
  if e.ext_id is not null then
    select * into r from mu.records
    where property = e.property and coll = 'bookings' and not deleted and data->'ext'->>'id' = e.ext_id limit 1;
  end if;

  if e.kind = 'cancel' then
    if r.rid is null then
      update mu.channel_events set status = 'skipped', note = 'Отмена брони, которой нет в приложении' where id = ev_id;
      return 'skipped';
    end if;
    update mu.records set deleted = true where property = r.property and coll = 'bookings' and rid = r.rid;
    perform mu.note(e.property, 'admin', format('Отмена брони: %s, %s (%s). Даты снова свободны',
                    mu.unit_name(e.property, r.data->>'unitId'), mu.when_txt(r.data), src), 'calendar', 'chess');
    update mu.channel_events set status = 'cancelled', note = null, booking_rid = r.rid where id = ev_id;
    return 'cancelled';
  end if;

  unit := cfg.units->>e.lot;
  if unit is null and r.rid is not null then unit := r.data->>'unitId'; end if;   -- в изменении брони лот могли не прислать
  if unit is null then
    update mu.channel_events set status = 'unmapped', note = 'Лот не привязан к дому' where id = ev_id;
    perform mu.note(e.property, 'admin', format('Пришла бронь (%s, %s – %s), но лот №%s не привязан к дому. Привяжите его: Ещё → Настройки и QR → Менеджер каналов',
                    src, mu.dm(e.start_date::text), mu.dm(e.end_date::text), coalesce(e.lot, '?')), 'alert', 'm_settings');
    return 'unmapped';
  end if;
  if e.start_date is null or e.end_date is null or e.end_date <= e.start_date then
    update mu.channel_events set status = 'error', note = 'Не удалось понять даты брони' where id = ev_id;
    perform mu.note(e.property, 'admin', format('Пришла бронь (%s), но в ней не удалось понять даты. Проверьте её в менеджере каналов', src), 'alert', 'm_settings');
    return 'error';
  end if;

  -- Та же бронь, уже заведённая в приложении вручную (заявка гостя, звонок): привязываем, а не создаём вторую
  if r.rid is null then
    select * into r from mu.records
    where property = e.property and coll = 'bookings' and not deleted and data->>'unitId' = unit
      and data->>'start' = e.start_date::text and data->>'end' = e.end_date::text and data->'ext' is null
    limit 1;
    linked := r.rid is not null;
  end if;

  if r.rid is not null then
    moved := r.data->>'unitId' is distinct from unit or r.data->>'start' is distinct from e.start_date::text
             or r.data->>'end' is distinct from e.end_date::text;
    d := r.data || jsonb_build_object('unitId', unit, 'start', e.start_date::text, 'end', e.end_date::text,
                                      'ext', jsonb_strip_nulls(jsonb_build_object('sys', e.sys, 'id', e.ext_id, 'lot', e.lot)));
    if not linked then   -- бронь с площадки: сумму, гостей и площадку берём из менеджера каналов
      d := d || jsonb_strip_nulls(jsonb_build_object('guests', e.guests, 'amount', e.amount, 'base', e.amount, 'source', e.source));
    end if;
    update mu.records set data = d where property = r.property and coll = 'bookings' and rid = r.rid;
    if moved then
      perform mu.note(e.property, 'admin', format('Бронь изменена (%s): теперь %s, %s', src, mu.unit_name(e.property, unit), mu.when_txt(d)), 'calendar', 'chess');
    end if;
    update mu.channel_events set status = case when linked then 'linked' else 'applied' end, note = null, booking_rid = r.rid where id = ev_id;
    return case when linked then 'linked' else 'applied' end;
  end if;

  bid := mu.new_id();
  d := jsonb_strip_nulls(jsonb_build_object(
    'id', bid, 'unitId', unit, 'guest', 'Гость · ' || coalesce(nullif(e.source, ''), 'площадка'), 'guests', e.guests,
    'start', e.start_date::text, 'end', e.end_date::text, 'source', coalesce(nullif(e.source, ''), 'Менеджер каналов'),
    'base', coalesce(e.amount, 0), 'tax', 0, 'amount', coalesce(e.amount, 0), 'paid', false, 'closed', false, 'channel', true,
    'ext', jsonb_strip_nulls(jsonb_build_object('sys', e.sys, 'id', e.ext_id, 'lot', e.lot))));
  -- сначала уведомление о брони, потом (если даты заняты) сработает сторож и придёт «Овербукинг»
  perform mu.note(e.property, 'admin', format('Новая бронь (%s): %s, %s, %s ноч.%s', src, mu.unit_name(e.property, unit), mu.when_txt(d),
                  e.end_date - e.start_date, case when coalesce(e.amount, 0) > 0 then ', ' || btrim(to_char(e.amount, '999 999 999')) || ' ₽' else '' end),
                  'calendar', 'chess');
  insert into mu.records (property, coll, rid, data) values (e.property, 'bookings', bid::text, d);
  update mu.channel_events set status = 'applied', note = null, booking_rid = bid::text where id = ev_id;
  return 'applied';
end $$;

-- ---------- Вход для функции channels ----------
-- Функция присылает событие уже без личных данных гостя. Ключ из ссылки определяет объект
create or replace function public.mu_channel_in(p_key text, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg mu.channel_config; eid bigint; st text; n int; raw jsonb := p_event->'raw';
begin
  if coalesce(p_key, '') = '' then return mu.err('В ссылке нет ключа'); end if;
  select * into cfg from mu.channel_config where secret = p_key;
  if not found then return mu.err('Неверный ключ'); end if;
  select count(*) into n from mu.channel_events where property = cfg.property and received_at > now() - interval '1 hour';
  if n >= 500 then return mu.err('Слишком много событий за час'); end if;
  if raw is not null and length(raw::text) > 30000 then raw := jsonb_build_object('note', 'слишком большое сообщение'); end if;

  insert into mu.channel_events (property, kind, sys, ext_id, lot, lot_title, start_date, end_date, amount, guests, source, raw)
  values (cfg.property,
          case when p_event->>'kind' in ('new', 'change', 'cancel', 'test') then p_event->>'kind' else 'new' end,
          left(p_event->>'sys', 20), left(p_event->>'ext_id', 80), left(p_event->>'lot', 80), left(p_event->>'lot_title', 120),
          mu.try_date(p_event->>'start'), mu.try_date(p_event->>'end'),
          mu.try_num(p_event->>'amount'), mu.try_num(p_event->>'guests')::int, left(p_event->>'source', 60), raw)
  returning id into eid;

  begin
    st := mu.channel_apply(eid);
  exception when others then
    update mu.channel_events set status = 'error', note = left(sqlerrm, 300) where id = eid;
    st := 'error';
  end;

  delete from mu.channel_events where property = cfg.property and received_at < now() - interval '180 days';
  return jsonb_build_object('ok', true, 'status', st, 'event', eid);
end $$;

-- ---------- Для экрана «Менеджер каналов» у управляющего ----------
create or replace function public.mu_channel_get(p_token text, p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg mu.channel_config;
begin
  perform mu.need_admin(p_token, p_property);
  insert into mu.channel_config (property) values (p_property) on conflict do nothing;
  select * into cfg from mu.channel_config where property = p_property;
  return jsonb_build_object('ok', true, 'key', cfg.secret, 'units', cfg.units, 'url', cfg.fn_url,
    'total', (select count(*) from mu.channel_events where property = p_property and status not in ('test', 'error')),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'ts', floor(extract(epoch from received_at) * 1000)::bigint, 'kind', kind, 'source', source, 'lot', lot,
        'lotTitle', lot_title, 'start', start_date, 'end', end_date, 'amount', amount, 'guests', guests, 'status', status,
        'note', note, 'raw', raw) order by received_at desc)
      from (select * from mu.channel_events where property = p_property order by received_at desc limit 30) x), '[]'::jsonb));
end $$;

-- Сохранить привязку лотов к домам и адрес функции. Брони, пришедшие на непривязанный лот, разбираются заново
create or replace function public.mu_channel_set(p_token text, p_property text, p_units jsonb, p_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text; v text; ev record; clean jsonb := '{}'::jsonb;
begin
  perform mu.need_admin(p_token, p_property);
  if jsonb_typeof(coalesce(p_units, '{}'::jsonb)) <> 'object' then return mu.err('Неверная привязка'); end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_units, '{}'::jsonb)) loop
    k := btrim(k);
    if k = '' or v is null or v = '' then continue; end if;
    if length(k) > 80 or length(v) > 40 then return mu.err('Слишком длинный номер лота'); end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  if p_url is not null and p_url <> '' and (p_url !~ '^https://' or length(p_url) > 300) then return mu.err('Адрес функции должен начинаться с https://'); end if;
  insert into mu.channel_config (property) values (p_property) on conflict do nothing;
  update mu.channel_config set units = clean, fn_url = coalesce(nullif(p_url, ''), fn_url) where property = p_property;

  for ev in select id from mu.channel_events
            where property = p_property and status = 'unmapped' and clean ? lot and received_at > now() - interval '60 days'
            order by id loop
    begin
      perform mu.channel_apply(ev.id);
    exception when others then
      update mu.channel_events set status = 'error', note = left(sqlerrm, 300) where id = ev.id;
    end;
  end loop;
  return public.mu_channel_get(p_token, p_property);
end $$;

-- Новый ключ: старая ссылка перестаёт работать (если её увидели посторонние)
create or replace function public.mu_channel_rotate(p_token text, p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform mu.need_admin(p_token, p_property);
  insert into mu.channel_config (property) values (p_property) on conflict do nothing;
  update mu.channel_config set secret = encode(extensions.gen_random_bytes(16), 'hex') where property = p_property;
  return public.mu_channel_get(p_token, p_property);
end $$;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all functions in schema mu from public, anon, authenticated;
    foreach f in array array['mu_channel_in(text,jsonb)', 'mu_channel_get(text,text)', 'mu_channel_set(text,text,jsonb,text)',
                             'mu_channel_rotate(text,text)'] loop
      execute format('revoke all on function public.%s from public', f);
      execute format('grant execute on function public.%s to anon, authenticated', f);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
