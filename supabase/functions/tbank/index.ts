// Edge Function «tbank» — принимает уведомления Т-Банка о статусе онлайн-оплаты.
//
// Банк при каждой смене статуса платежа (оплачен, отклонён, отменён, возврат) отправляет сюда POST.
// Адрес передаётся банку сам в каждом платеже (NotificationURL в payments.sql), в кабинете банка ничего настраивать не нужно.
// Функция передаёт уведомление в базу (mu_pay_notify): там подпись проверяется паролем терминала,
// статус платежа обновляется, а управляющему приходит уведомление. Банку нужно ответить ровно «OK», иначе он будет повторять.
//
// Как установить: Supabase → Edge Functions → Deploy a new function → Via Editor.
// Имя функции сменить на tbank (в поле вверху редактора, до Deploy), вставить этот файл целиком → Deploy.
// Затем в настройках функции выключить «Verify JWT»: банк не умеет присылать токен, защищает подпись.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://xrzzbxnwijqberrrzuow.supabase.co';
// Публичный ключ, тот же, что в config.js приложения. Он не секретный: проверку делает mu_pay_notify по подписи банка
const PUBLIC_KEY = 'sb_publishable_TUAxmn06mkqN28ArYc50dQ_hcseeUDL';

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method === 'GET') return text('Приёмник уведомлений Т-Банка «Медвежьего угла» работает');
  if (req.method !== 'POST') return text('Только POST', 405);

  const raw = (await req.text()).slice(0, 100000);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch {
    // На всякий случай понимаем и форму: TerminalKey=...&OrderId=...
    const o: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(raw)) o[k] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) && k !== 'OrderId' ? Number(v) : v;
    body = o;
  }

  const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/mu_pay_notify`, {
    method: 'POST',
    headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_body: body }),
  }).catch(() => null);
  if (!r) return text('ERROR: база не отвечает', 502);
  const answer = await r.json().catch(() => null);
  if (r.ok && answer === 'OK') return text('OK');
  return text(typeof answer === 'string' ? answer : 'ERROR', r.ok ? 400 : 502);
});
