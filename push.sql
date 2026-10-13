-- push.sql — уведомления на телефон прямо от приложения (Web Push), без Telegram.
-- Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run. Запускается после auth.sql.
-- Ещё нужна функция отправки: Edge Functions → push (файл supabase/functions/push/index.ts).
--
-- Как это работает:
--   1. Человек в приложении нажимает «Включить уведомления», телефон выдаёт адрес подписки — он сохраняется здесь.
--   2. Когда в базе появляется новое уведомление (новая бронь, SOS, задача, «кончается на складе»…),
--      база сама отправляет его в функцию push, а та — на телефоны тех, кому оно адресовано.
-- Ключ VAPID (подпись наших уведомлений) создаёт приложение управляющего при первом включении и хранит только здесь.

create extension if not exists pg_net with schema extensions;

create table if not exists mu.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  subject       text not null default 'https://se3yaa.github.io/medvezhiy-ugol/',
  fn_url        text not null default 'https://xrzzbxnwijqberrrzuow.supabase.co/functions/v1/push',
  site_url      text not null default 'https://se3yaa.github.io/medvezhiy-ugol/',
  enabled       boolean not null default true
);
insert into mu.push_config (id) values (1) on conflict do nothing;

create table if not exists mu.push_subs (
  endpoint   text primary key,
  property   text not null,
  login      text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_login on mu.push_subs (property, login);

alter table mu.push_config enable row level security;
alter table mu.push_subs enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on mu.push_config, mu.push_subs from anon, authenticated';
  end if;
end $$;

-- Открытый ключ VAPID: нужен телефону, чтобы подписаться
create or replace function public.mu_push_key(p_property text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'key', vapid_public) from mu.push_config where id = 1
$$;

-- Управляющий: сохранить ключ VAPID (создаётся в его телефоне при первом включении уведомлений)
create or replace function public.mu_push_setup(p_token text, p_property text, p_public text, p_private text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform mu.need_admin(p_token, p_property);
  if coalesce(p_public, '') !~ '^[A-Za-z0-9_-]{80,100}$' or coalesce(p_private, '') !~ '"d"' then return mu.err('Неверный ключ'); end if;
  update mu.push_config set vapid_public = p_public, vapid_private = p_private where id = 1 and vapid_public is null;
  select vapid_public into k from mu.push_config where id = 1;
  return jsonb_build_object('ok', true, 'key', k);   -- если ключ уже был, вернётся прежний
end $$;

-- Телефон подписался на уведомления (или обновил подписку)
create or replace function public.mu_push_sub(p_token text, p_property text, p_sub jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property); ep text := p_sub->>'endpoint';
begin
  if coalesce(ep, '') !~ '^https://' or length(ep) > 1000 or p_sub->'keys'->>'p256dh' is null or p_sub->'keys'->>'auth' is null then
    return mu.err('Неверная подписка');
  end if;
  insert into mu.push_subs (endpoint, property, login, p256dh, auth) values (ep, p_property, w.login, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth')
    on conflict (endpoint) do update set property = excluded.property, login = excluded.login, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- не больше 10 телефонов на человека: старые подписки убираем
  delete from mu.push_subs where property = p_property and login = w.login and endpoint not in
    (select endpoint from mu.push_subs where property = p_property and login = w.login order by created_at desc limit 10);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mu_push_unsub(p_token text, p_property text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property);
begin
  delete from mu.push_subs where endpoint = p_endpoint and login = w.login;
  return jsonb_build_object('ok', true);
end $$;

-- Новое уведомление в базе → отправка на телефоны адресатов
create or replace function mu.notes_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg mu.push_config; dest text; subs jsonb; go text;
begin
  if new.coll <> 'notes' or new.deleted or (tg_op = 'UPDATE' and not old.deleted) then return new; end if;
  -- только свежие: при первой загрузке старых данных телефоны не засыпаем уведомлениями
  if coalesce((new.data->>'ts')::bigint, 0) < floor(extract(epoch from now()) * 1000) - 600000 then return new; end if;
  select * into cfg from mu.push_config where id = 1;
  if not found or not cfg.enabled or cfg.vapid_private is null then return new; end if;
  dest := new.data->>'to';
  select jsonb_agg(distinct jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) into subs
  from mu.push_subs s
  left join mu.members m on m.login = s.login and m.property in (s.property, '*') and m.active
  where s.property = new.property
    and (s.login = dest or (dest in ('admin', 'staff', 'instructor') and m.role = dest)
         or (dest = 'all' and m.role in ('admin', 'staff', 'instructor')));
  if subs is null then return new; end if;
  go := coalesce(nullif(new.data->>'go', ''), '');
  begin
    perform net.http_post(
      url := cfg.fn_url,
      body := jsonb_build_object('title', 'Медвежий угол', 'body', new.data->>'text', 'tag', new.rid,
                                 'url', cfg.site_url || case when go <> '' then '#go-' || go else '' end,
                                 'subject', cfg.subject, 'subs', subs,
                                 'vapid', jsonb_build_object('publicKey', cfg.vapid_public, 'privateKey', cfg.vapid_private)),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 15000);
  exception when others then null;   -- уведомление не ушло — данные всё равно сохраняются
  end;
  return new;
end $$;
drop trigger if exists records_push on mu.records;
create trigger records_push after insert or update on mu.records for each row execute function mu.notes_push();

-- Уборка: телефоны, которые отписались или удалили приложение (сервис уведомлений ответил 404 или 410)
create or replace function mu.push_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from mu.push_subs where endpoint in (
    select r->>'endpoint' from net._http_response h, jsonb_array_elements(h.content::jsonb->'results') r
    where h.created > now() - interval '2 days' and h.content like '{%' and (r->>'status')::int in (404, 410));
exception when others then null;
end $$;

-- Телефон спрашивает: включены ли уведомления на этом устройстве, и заодно убирает мёртвые подписки
create or replace function public.mu_push_status(p_token text, p_property text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w mu.who_t := mu.who(p_token, p_property);
begin
  perform mu.push_cleanup();
  return jsonb_build_object('ok', true, 'on', exists (select 1 from mu.push_subs where endpoint = p_endpoint and login = w.login),
                            'ready', (select vapid_public is not null from mu.push_config where id = 1));
end $$;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all functions in schema mu from public, anon, authenticated;
    foreach f in array array['mu_push_key(text)', 'mu_push_setup(text,text,text,text)', 'mu_push_sub(text,text,jsonb)',
                             'mu_push_unsub(text,text,text)', 'mu_push_status(text,text,text)'] loop
      execute format('revoke all on function public.%s from public', f);
      execute format('grant execute on function public.%s to anon, authenticated', f);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
