-- pay-keys.sql — ключи терминала Т-Банка. Заполняется прямо в Supabase и никому не пересылается.
-- Где взять: Т-Бизнес → Интернет-эквайринг → Магазины → ваш магазин → Терминалы.
--   Для проверки берите тестовый терминал (его ключ заканчивается на DEMO), для настоящих денег — боевой.
--   TerminalKey и пароль — в настройках терминала.
-- Как применить: Supabase → SQL Editor → New query → вставить → заменить значения в кавычках → Run.
-- Потом этот запрос лучше не сохранять, а закрыть: пароль останется только в базе.

insert into mu.pay_config (property, terminal_key, password, receipts, taxation, tax)
values (
  'mu',
  'ВСТАВЬТЕ_TerminalKey',
  'ВСТАВЬТЕ_ПАРОЛЬ',
  false,          -- true, когда к терминалу подключите онлайн-кассу: тогда гостю будет приходить чек
  'usn_income',   -- система налогообложения ИП: usn_income (УСН «доходы»), usn_income_outcome (УСН «доходы минус расходы»), patent, osn
  'none'          -- НДС в чеке: none (без НДС), vat0, vat5, vat7, vat10, vat20
)
on conflict (property) do update set terminal_key = excluded.terminal_key, password = excluded.password,
  receipts = excluded.receipts, taxation = excluded.taxation, tax = excluded.tax, enabled = true;

-- Выключить онлайн-оплату (приложение вернётся к демо-оплате):
-- update mu.pay_config set enabled = false where property = 'mu';
