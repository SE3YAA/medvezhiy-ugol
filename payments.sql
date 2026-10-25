-- payments.sql — настоящая онлайн-оплата через интернет-эквайринг Т-Банка.
-- Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run. Запускается после auth.sql.
-- Ключи терминала вставляются отдельно файлом pay-keys.sql — прямо в Supabase, никому не пересылая.
--
-- Как это работает:
--   1. Гость нажимает «Оплатить». Сервер сам обращается в Т-Банк (метод Init) и получает ссылку на страницу оплаты.
--   2. Гость платит картой или по СБП на странице банка.
--   3. Приложение спрашивает сервер о статусе, а сервер — банк (метод GetState).
--      Только когда банк ответил CONFIRMED, приложение оформляет бронь или заказ.
--   4. Гость больше не может записать в кассу оплату, которой не было: сервер проверяет номер платежа.
--   5. Банк сам присылает уведомления о статусе (NotificationURL → функция tbank → mu_pay_notify): статус обновляется,
--      даже если гость закрыл приложение, а управляющему приходит уведомление об оплате, отмене или возврате.
-- Пароль терминала хранится только здесь, в закрытой таблице. Приложение его не видит.
-- Файл можно запускать повторно (например, после обновления): ключи терминала и платежи сохраняются.

create extension if not exists http with schema extensions;

-- Ключи терминала по объектам сети
create table if not exists mu.pay_config (
  property     text primary key,
  terminal_key text not null,
  password     text not null,
  api_url      text not null default 'https://securepay.tinkoff.ru/v2/',
  receipts     boolean not null default false,          -- включить, когда к терминалу подключена онлайн-касса
  taxation     text not null default 'usn_income',      -- система налогообложения ИП: osn, usn_income, usn_income_outcome, patent
  tax          text not null default 'none',            -- НДС в чеке: none, vat0, vat10, vat20 …
  site_url     text not null default 'https://se3yaa.github.io/medvezhiy-ugol/',
  enabled      boolean not null default true
);

-- Платежи: по ним видно, что оплачено, и их нельзя использовать дважды
-- Куда банк присылает уведомления: функция tbank в Supabase (supabase/functions/tbank/index.ts)
alter table mu.pay_config add column if not exists notify_url text default 'https://xrzzbxnwijqberrrzuow.supabase.co/functions/v1/tbank';

create table if not exists mu.payments (
  order_id   text primary key,
  property   text not null,
  login      text not null,
  title      text not null,
  amount     int not null,                              -- рубли
  payment_id text,
  url        text,
  status     text not null default 'NEW',
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_login on mu.payments (property, login, created_at desc);

alter table mu.pay_config enable row level security;
alter table mu.payments enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on mu.pay_config, mu.payments from anon, authenticated';
  end if;
end $$;

-- Подпись запроса по правилам Т-Банка: значения полей верхнего уровня и пароль, по алфавиту ключей, склеенные и захешированные SHA-256
create or replace function mu.tb_token(p jsonb, pass text) returns text language sql immutable as $$
  select encode(extensions.digest(string_agg(v, '' order by k), 'sha256'), 'hex')
  from (select key as k, case jsonb_typeof(value) when 'string' then value #>> '{}' else value::text end as v
        from jsonb_each(p) where jsonb_typeof(value) not in ('object', 'array', 'null')
        union all select 'Password', pass) s
$$;

-- Запрос в Т-Банк. Ошибки сети не роняют функцию, а возвращаются как ответ без Success
create or replace function mu.tbank(cfg mu.pay_config, method text, params jsonb) returns jsonb
language plpgsql as $$
declare body jsonb; r record;
begin
  body := params || jsonb_build_object('TerminalKey', cfg.terminal_key);
  body := body || jsonb_build_object('Token', mu.tb_token(body, cfg.password));
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
    select * into r from extensions.http_post(cfg.api_url || method, body::text, 'application/json');
    if r.status <> 200 then return jsonb_build_object('Success', false, 'Message', 'Банк ответил ' || r.status); end if;
    return r.content::jsonb;
  exception when others then
    return jsonb_build_object('Success', false, 'Message', 'Нет связи с банком: ' || left(sqlerrm, 200));
  end;
end $$;

-- Можно ли гостю записать эту операцию в кассу: настоящая оплата должна быть подтверждена банком
create or replace function mu.pay_allowed(p_property text, p_me text, new jsonb) returns boolean
language plpgsql stable as $$
begin
  if not exists (select 1 from mu.pay_config where property = p_property and enabled) then return true; end if;   -- онлайн-оплата не подключена: демо-режим
  if coalesce(new->>'paid', '') = 'false' then return true; end if;                                                  -- в общий счёт, оплата при выезде
  if new->>'method' in ('Бонусы', 'Сертификат') then return true; end if;
  return exists (select 1 from mu.payments where order_id = new->>'payId' and property = p_property and login = p_me
                 and status = 'CONFIRMED' and created_at > now() - interval '1 day');
end $$;

-- Правила записи с проверкой оплаты (та же функция, что в auth.sql, плюс mu.pay_allowed для гостя)
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
      if p_coll = 'tx' then
        return exists (select 1 from mu.records where property = p_property and coll = 'rides' and data->>'id' = old->>'bookingId');
      end if;
      return false;
    end if;
    if p_coll = 'tx' then return old is null; end if;
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

  oldmine := old is not null and old->>'login' = p_me;
  newmine := new is not null and new->>'login' = p_me;

  if del then
    if old is null then return true; end if;
    if p_coll in ('bookings', 'rides', 'rentals', 'tasks', 'waitlist') then return oldmine; end if;
    if p_coll = 'notes' then return old->>'to' = p_me; end if;
    if p_coll = 'tx' then return (old->>'bookingId') = any(own) and old->>'type' = 'in'; end if;
    return false;
  end if;

  if old is null then
    if p_coll in ('bookings', 'rides', 'rentals', 'sos', 'waitlist', 'passes', 'reviews', 'certs') then return newmine; end if;
    if p_coll = 'messages' then return newmine and new->>'from' = 'guest'; end if;
    if p_coll = 'tasks' then return newmine or new->>'login' is null; end if;
    if p_coll = 'notes' then return new->>'to' in ('admin', 'staff', 'instructor', p_me); end if;
    if p_coll = 'tx' then
      return new->>'type' = 'in' and (new->>'bookingId' is null or (new->>'bookingId') = any(own) or (new->>'folio') = any(own))
         and mu.pay_allowed(p_property, p_me, new);
    end if;
    if p_coll = 'leads' then return true; end if;
    if p_coll = 'users' then return p_rid = p_me and new->>'role' = 'guest'; end if;
    return false;
  end if;

  case p_coll
    when 'bookings', 'rides', 'rentals', 'sos', 'waitlist', 'passes', 'reviews', 'tasks' then
      return oldmine and newmine;
    when 'certs' then
      return oldmine and newmine and mu.same_except(old, new, array['balance']) and (new->>'balance')::numeric <= (old->>'balance')::numeric;
    when 'messages' then
      if not (oldmine and newmine) then return false; end if;
      return old->>'from' = 'guest' or mu.same_except(old, new, array['read']);
    when 'notes' then return old->>'to' = p_me and new->>'to' = p_me and mu.same_except(old, new, array['read']);
    when 'stock' then
      return mu.same_except(old, new, array['qty']) and (new->>'qty')::numeric <= (old->>'qty')::numeric;
    when 'promos' then
      return mu.same_except(old, new, array['used']) and (new->>'used')::int = (old->>'used')::int + 1;
    when 'tx' then
      return ((old->>'folio') = any(own) or (old->>'bookingId') = any(own))
         and mu.same_except(old, new, array['paid', 'method', 'receipt', 'payId'])
         and mu.pay_allowed(p_property, p_me, new);
    when 'users' then
      if p_rid = p_me then
        return old->>'role' = 'guest' and new->>'role' = 'guest'
           and coalesce(old->'points', '0') = coalesce(new->'points', '0')
           and (coalesce((new->>'refDiscount')::boolean, false) <= coalesce((old->>'refDiscount')::boolean, false));
      end if;
      return old->>'role' = 'staff' and mu.same_except(old, new, array['points'])
         and coalesce((new->>'points')::int, 0) = coalesce((old->>'points')::int, 0) + 5;
    else return false;
  end case;
end $$;

-- ---------- Функции для приложения ----------
create or replace function public.mu_pay_ready(p_property text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'ready', exists (select 1 from mu.pay_config where property = p_property and enabled))
$$;

-- Начать оплату: вернёт ссылку на страницу банка
create or replace function public.mu_pay_init(p_token text, p_property text, p_amount int, p_title text, p_contact text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w mu.who_t := mu.who(p_token, p_property); cfg mu.pay_config; ord text; title text := left(coalesce(nullif(trim(p_title), ''), 'Оплата'), 120);
  params jsonb; res jsonb; contact text := trim(coalesce(p_contact, ''));
begin
  select * into cfg from mu.pay_config where property = p_property and enabled;
  if not found then return mu.err('Онлайн-оплата ещё не подключена'); end if;
  if coalesce(p_amount, 0) < 1 or p_amount > 1000000 then return mu.err('Неверная сумма'); end if;
  if (select count(*) from mu.payments where property = p_property and login = w.login and created_at > now() - interval '1 hour') >= 20 then
    return mu.err('Слишком много попыток оплаты. Попробуйте через час');
  end if;
  ord := p_property || '-' || encode(extensions.gen_random_bytes(8), 'hex');
  params := jsonb_build_object('Amount', p_amount * 100, 'OrderId', ord, 'Description', left(title, 140),
    'SuccessURL', cfg.site_url || '#payok', 'FailURL', cfg.site_url || '#payfail', 'PayType', 'O');
  if coalesce(cfg.notify_url, '') ~ '^https://' then params := params || jsonb_build_object('NotificationURL', cfg.notify_url); end if;
  if cfg.receipts then
    if contact !~ '@' and regexp_replace(contact, '\D', '', 'g') !~ '^[78]?\d{10}$' then return mu.err('Для чека нужен телефон или почта'); end if;
    params := params || jsonb_build_object('Receipt', jsonb_build_object(
      'Taxation', cfg.taxation,
      'Items', jsonb_build_array(jsonb_build_object('Name', left(title, 128), 'Price', p_amount * 100, 'Quantity', 1,
                                                    'Amount', p_amount * 100, 'Tax', cfg.tax, 'PaymentMethod', 'full_payment', 'PaymentObject', 'service')))
      || case when contact ~ '@' then jsonb_build_object('Email', contact)
              else jsonb_build_object('Phone', '+7' || right(regexp_replace(contact, '\D', '', 'g'), 10)) end);
  end if;
  insert into mu.payments (order_id, property, login, title, amount) values (ord, p_property, w.login, title, p_amount);
  res := mu.tbank(cfg, 'Init', params);
  if coalesce((res->>'Success')::boolean, false) is not true or res->>'PaymentURL' is null then
    update mu.payments set status = 'ERROR', error = coalesce(res->>'Message', '') || ' ' || coalesce(res->>'Details', ''), updated_at = now() where order_id = ord;
    return mu.err('Банк не принял платёж: ' || coalesce(nullif(res->>'Message', ''), 'неизвестная ошибка'));
  end if;
  update mu.payments set payment_id = res->>'PaymentId', url = res->>'PaymentURL', status = coalesce(res->>'Status', 'NEW'), updated_at = now()
    where order_id = ord;
  return jsonb_build_object('ok', true, 'order', ord, 'url', res->>'PaymentURL');
end $$;

-- Узнать статус платежа (сервер спрашивает банк, если платёж ещё не завершён)
create or replace function mu.pay_refresh(p mu.payments) returns mu.payments
language plpgsql as $$
declare cfg mu.pay_config; res jsonb; out mu.payments;
begin
  if p.status in ('CONFIRMED', 'REJECTED', 'CANCELED', 'REVERSED', 'PARTIAL_REVERSED', 'REFUNDED', 'PARTIAL_REFUNDED', 'DEADLINE_EXPIRED', 'ERROR') or p.payment_id is null then return p; end if;
  select * into cfg from mu.pay_config where property = p.property;
  if not found then return p; end if;
  res := mu.tbank(cfg, 'GetState', jsonb_build_object('PaymentId', p.payment_id));
  if coalesce((res->>'Success')::boolean, false) and res->>'Status' is not null then
    -- сумму сверяем с банком: подтверждённым считается только платёж на ту же сумму
    if res->>'Status' = 'CONFIRMED' and coalesce((res->>'Amount')::bigint, p.amount * 100) <> p.amount * 100 then
      update mu.payments set status = 'ERROR', error = 'Сумма в банке не совпала', updated_at = now() where order_id = p.order_id returning * into out;
    else
      update mu.payments set status = res->>'Status', updated_at = now() where order_id = p.order_id returning * into out;
    end if;
    return out;
  end if;
  return p;
end $$;

create or replace function public.mu_pay_status(p_token text, p_property text, p_order text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property); p mu.payments;
begin
  select * into p from mu.payments where order_id = p_order and property = p_property and (login = w.login or w.role = 'admin') for update;
  if not found then return mu.err('Платёж не найден'); end if;
  p := mu.pay_refresh(p);
  return jsonb_build_object('ok', true, 'order', p.order_id, 'status', p.status, 'paid', p.status = 'CONFIRMED',
                            'failed', p.status in ('REJECTED', 'CANCELED', 'REVERSED', 'DEADLINE_EXPIRED', 'ERROR'), 'amount', p.amount);
end $$;

-- Управляющий: последние онлайн-платежи (незавершённые заодно сверяются с банком)
create or replace function public.mu_pay_list(p_token text, p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p mu.payments;
begin
  perform mu.need_admin(p_token, p_property);
  for p in select * from mu.payments where property = p_property and status not in ('CONFIRMED', 'REJECTED', 'CANCELED', 'REVERSED', 'PARTIAL_REVERSED', 'REFUNDED', 'PARTIAL_REFUNDED', 'ERROR', 'DEADLINE_EXPIRED')
           and payment_id is not null and created_at > now() - interval '3 days' order by created_at desc limit 10 loop
    perform mu.pay_refresh(p);
  end loop;
  return jsonb_build_object('ok', true, 'ready', exists (select 1 from mu.pay_config where property = p_property and enabled),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('order', order_id, 'login', login, 'title', title, 'amount', amount, 'status', status,
                 'error', error, 'ts', floor(extract(epoch from created_at) * 1000)::bigint) order by created_at desc)
               from (select * from mu.payments where property = p_property order by created_at desc limit 50) x), '[]'));
end $$;

-- ---------- Уведомления от банка ----------
-- Банк присылает их на NotificationURL при каждой смене статуса. Функция tbank передаёт тело сюда как есть.
-- Подпись проверяется паролем терминала, поэтому подделать уведомление нельзя. Ответ «OK» банк считает доставкой
create or replace function mu.pay_note(p_property text, p_text text, p_icon text) returns void
language plpgsql security definer set search_path = '' as $$
declare nid bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint * 1000 + floor(random() * 1000)::bigint;
begin
  insert into mu.records (property, coll, rid, data)
  values (p_property, 'notes', nid::text, jsonb_build_object('id', nid, 'to', 'admin', 'text', p_text, 'icon', p_icon, 'go', 'cash',
          'ts', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'read', false));
end $$;

create or replace function public.mu_pay_notify(p_body jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare p mu.payments; cfg mu.pay_config; st text := p_body->>'Status'; old text; amt text;
begin
  if p_body is null or p_body->>'OrderId' is null or p_body->>'Token' is null then return 'ERROR: нет данных'; end if;
  select * into p from mu.payments where order_id = p_body->>'OrderId' for update;
  if not found then return 'OK'; end if;   -- не наш заказ (например, тест из кабинета банка): подтверждаем, чтобы банк не повторял
  select * into cfg from mu.pay_config where property = p.property;
  if not found or p_body->>'TerminalKey' is distinct from cfg.terminal_key
     or lower(p_body->>'Token') <> mu.tb_token(p_body - 'Token', cfg.password) then
    return 'ERROR: подпись не совпала';
  end if;
  old := p.status;
  -- сумму сверяем с банком: подтверждённым считается только платёж на ту же сумму
  if st = 'CONFIRMED' and coalesce((p_body->>'Amount')::bigint, p.amount * 100) <> p.amount * 100 then
    update mu.payments set status = 'ERROR', error = 'Сумма в банке не совпала', payment_id = coalesce(payment_id, p_body->>'PaymentId'), updated_at = now()
      where order_id = p.order_id;
    perform mu.pay_note(p.property, format('Онлайн-оплата «%s»: сумма в банке не совпала с заказом. Проверьте в кабинете Т-Банка', p.title), 'alert');
    return 'OK';
  end if;
  -- Промежуточные статусы не перетирают итоговые (уведомления могут прийти не по порядку)
  if st is null or (old in ('CONFIRMED', 'REJECTED', 'REFUNDED', 'REVERSED', 'CANCELED', 'DEADLINE_EXPIRED')
                    and st not in ('REFUNDED', 'PARTIAL_REFUNDED', 'REVERSED', 'PARTIAL_REVERSED', 'CANCELED')) then
    return 'OK';
  end if;
  update mu.payments set status = st, payment_id = coalesce(payment_id, p_body->>'PaymentId'),
         error = case when coalesce((p_body->>'Success')::boolean, true) then error else coalesce(p_body->>'Message', p_body->>'ErrorCode') end,
         updated_at = now()
    where order_id = p.order_id;
  if st is distinct from old then
    amt := btrim(to_char(p.amount, '999 999 999')) || ' ₽';
    if st = 'CONFIRMED' then
      perform mu.pay_note(p.property, format('Онлайн-оплата %s прошла: %s', amt, p.title), 'wallet');
    elsif st in ('REFUNDED', 'PARTIAL_REFUNDED', 'REVERSED', 'PARTIAL_REVERSED') and old = 'CONFIRMED' then
      perform mu.pay_note(p.property, format('Возврат по онлайн-оплате %s: %s. Если это бронь или заказ — отмените их в приложении', amt, p.title), 'alert');
    end if;
  end if;
  return 'OK';
end $$;

-- Управляющий: связь Supabase с банком и состояние ключей (можно проверить ещё до получения ключей)
create or replace function public.mu_pay_check(p_token text, p_property text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg mu.pay_config; r record; reached boolean := false; msg text; url text := 'https://securepay.tinkoff.ru/v2/'; has_cfg boolean;
begin
  perform mu.need_admin(p_token, p_property);
  select * into cfg from mu.pay_config where property = p_property;
  has_cfg := found;
  if has_cfg then url := cfg.api_url; end if;
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
    -- Нарочно неверный запрос: банк отвечает ошибкой, и этого достаточно, чтобы понять, что связь есть
    select * into r from extensions.http_post(url || 'GetState', '{"TerminalKey":"CHECK","PaymentId":"1","Token":"0"}', 'application/json');
    reached := r.status between 200 and 499 and r.content like '{%';
    msg := case when reached then coalesce(r.content::jsonb->>'Message', 'банк ответил') else 'ответ ' || r.status end;
  exception when others then
    msg := left(sqlerrm, 200);
  end;
  return jsonb_build_object('ok', true, 'reached', reached, 'answer', msg,
    'keys', has_cfg, 'enabled', coalesce(cfg.enabled, false), 'demo', coalesce(cfg.terminal_key ~* 'demo$', false),
    'receipts', coalesce(cfg.receipts, false), 'notify', cfg.notify_url,
    'last', (select jsonb_build_object('status', status, 'title', title, 'ts', floor(extract(epoch from created_at) * 1000)::bigint)
             from mu.payments where property = p_property order by created_at desc limit 1));
end $$;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all functions in schema mu from public, anon, authenticated;
    foreach f in array array['mu_pay_ready(text)', 'mu_pay_init(text,text,int,text,text)', 'mu_pay_status(text,text,text)', 'mu_pay_list(text,text)',
                             'mu_pay_notify(jsonb)', 'mu_pay_check(text,text)'] loop
      execute format('revoke all on function public.%s from public', f);
      execute format('grant execute on function public.%s to anon, authenticated', f);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
