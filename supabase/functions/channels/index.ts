// Edge Function «channels» — принимает брони от менеджера каналов (RealtyCalendar и подобных).
//
// Менеджер каналов при каждой новой, изменённой или отменённой брони отправляет её на адрес этой функции
// с ключом в ссылке: https://<проект>.supabase.co/functions/v1/channels?key=<ключ из приложения>.
// Функция:
//   1) понимает, что пришло: JSON или форма, любые распространённые названия полей;
//   2) находит даты, № лота (дом), сумму, число гостей, площадку и номер брони;
//   3) вырезает имя, телефон, почту и комментарии гостя (152-ФЗ: пока база за границей, контакты остаются в менеджере каналов);
//   4) передаёт результат в базу (функция mu_channel_in из channels.sql), а та записывает бронь и сообщает управляющему.
//
// Как установить: Supabase → Edge Functions → Deploy a new function → Via Editor, имя channels,
// вставить этот файл целиком → Deploy. Затем в настройках функции выключить «Verify JWT»
// (менеджер каналов не умеет присылать токен; защищает ключ в ссылке).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://xrzzbxnwijqberrrzuow.supabase.co';
// Публичный ключ, тот же, что в config.js приложения. Он не секретный: функция mu_channel_in сама проверяет ключ из ссылки
const PUBLIC_KEY = 'sb_publishable_TUAxmn06mkqN28ArYc50dQ_hcseeUDL';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = (k: string) => k.toLowerCase().replace(/[\s\-]+/g, '_');

// ---------- Разбор тела запроса ----------
function parseBody(text: string, type: string): unknown {
  const t = text.trim();
  if (!t) return {};
  if (/json/i.test(type) || /^[\[{]/.test(t)) {
    try { return JSON.parse(t); } catch { /* попробуем как форму */ }
  }
  const out: Obj = {};
  try {
    for (const [k, v] of new URLSearchParams(t)) {
      let val: unknown = v;
      if (/^[\[{]/.test(v.trim())) { try { val = JSON.parse(v); } catch { /* оставим строкой */ } }
      setPath(out, k, val);
    }
  } catch { return { text: t.slice(0, 2000) }; }
  return out;
}
// booking[begin_date]=... → { booking: { begin_date: ... } }
function setPath(o: Obj, key: string, val: unknown) {
  const parts = key.replace(/\]/g, '').split('[').filter(Boolean);
  let cur = o;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) { cur[p] = val; return; }
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p] as Obj;
  });
}

// ---------- Поиск полей ----------
const KEYS = {
  start: ['begin_date', 'start_date', 'date_from', 'datefrom', 'arrival_date', 'arrival', 'check_in', 'checkin', 'checkin_date', 'date_in', 'begin', 'start', 'from'],
  end: ['end_date', 'finish_date', 'date_to', 'dateto', 'departure_date', 'departure', 'check_out', 'checkout', 'checkout_date', 'date_out', 'end', 'finish', 'to'],
  id: ['booking_id', 'bookingid', 'reservation_id', 'reservationid', 'order_id', 'booking_number', 'number', 'id', 'uid'],
  lot: ['apartment_id', 'apartmentid', 'lot', 'lot_id', 'lot_number', 'lotnumber', 'object_id', 'realty_id', 'flat_id', 'room_id', 'unit_id', 'property_id', 'apartment', 'object', 'realty', 'flat', 'room', 'unit'],
  amount: ['amount', 'total_amount', 'total_price', 'total_sum', 'total', 'sum', 'price', 'cost'],
  guests: ['guests_count', 'guest_count', 'guests', 'persons', 'people', 'adults', 'visitors'],
  status: ['status', 'action', 'event', 'event_type', 'type', 'state', 'operation'],
  source: ['source', 'channel', 'platform', 'ota', 'booking_source', 'source_name', 'site', 'partner'],
};

// Все объекты внутри сообщения с глубиной и путём
function objects(v: unknown, path: string[] = [], out: { o: Obj; path: string[] }[] = []) {
  if (Array.isArray(v)) v.forEach((x, i) => objects(x, [...path, String(i)], out));
  else if (isObj(v)) { out.push({ o: v, path }); Object.entries(v).forEach(([k, x]) => objects(x, [...path, k], out)); }
  return out;
}
function pick(o: Obj, names: string[]): unknown {
  const m: Record<string, unknown> = {};
  Object.entries(o).forEach(([k, v]) => { m[norm(k)] = v; });
  for (const n of names) if (m[n] !== undefined && m[n] !== null && m[n] !== '') return m[n];
  return undefined;
}
// Сначала ищем в самой брони, потом во всём сообщении от верхнего уровня вглубь
function find(book: Obj | null, all: { o: Obj }[], names: string[]): unknown {
  if (book) { const v = pick(book, names); if (v !== undefined) return v; }
  for (const { o } of all) { const v = pick(o, names); if (v !== undefined) return v; }
  return undefined;
}

// Дата → ГГГГ-ММ-ДД
function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v), ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms + 3 * 3600 * 1000);   // по Москве
    return isNaN(+d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/\s| /g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function idOf(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (isObj(v)) return idOf(pick(v, ['id', 'lot', 'lot_id', 'number', 'uid']));
  return String(v).slice(0, 80);
}
function titleOf(v: unknown): string | null {
  return isObj(v) ? (pick(v, ['title', 'name', 'address']) as string | undefined)?.toString().slice(0, 120) ?? null : null;
}

const SOURCES: [RegExp, string][] = [
  [/avito|авито/i, 'Авито'], [/yandex|яндекс/i, 'Яндекс Путешествия'], [/ostrovok|островок|emerging|\betg\b/i, 'Островок'],
  [/ozon|озон/i, 'Ozon Travel'], [/sutochno|суточно/i, 'Суточно'], [/airbnb/i, 'Airbnb'], [/booking\.com|\bbooking\b/i, 'Booking'],
  [/t-?travel|т-путешеств|tbank|tinkoff/i, 'Т-Путешествия'], [/glamping|глэмпинг/i, 'Глэмпинги.рф'], [/tvil|твил/i, 'Твил'],
  [/101hotels/i, '101Hotels'], [/cian|циан/i, 'Циан'], [/domclick|домклик/i, 'Домклик'], [/tutu/i, 'Туту'],
];
function sourceOf(v: unknown, texts: string): string | null {
  const s = v == null ? '' : isObj(v) ? JSON.stringify(v) : String(v);
  for (const [re, name] of SOURCES) if (re.test(s)) return name;
  if (s && s.length <= 40 && !/^\d+$/.test(s)) return s;
  // Площадку не прислали отдельным полем: ищем её название в текстах сообщения (не в названиях полей).
  // Слово booking здесь не считается: оно часто просто означает «бронь»
  for (const [re, name] of SOURCES) if (name !== 'Booking' && re.test(texts)) return name;
  return /booking\.com/i.test(texts) ? 'Booking' : null;
}
// Все строки сообщения одной строкой, без названий полей
function texts(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(texts).join(' ');
  if (isObj(v)) return Object.values(v).map(texts).join(' ');
  return '';
}
function kindOf(status: unknown, root: unknown, test: boolean): string {
  if (test) return 'test';
  const s = String(status ?? '').toLowerCase();
  const flags = objects(root).some(({ o }) => ['deleted', 'is_deleted', 'canceled', 'cancelled', 'is_canceled', 'is_cancelled']
    .some(k => { const v = pick(o, [k]); return v === true || v === 1 || v === '1' || v === 'true'; }));
  if (flags || /cancel|delet|remov|annul|отмен|удал|аннул/.test(s)) return 'cancel';
  if (/updat|chang|modif|edit|измен/.test(s)) return 'change';
  return 'new';
}

// ---------- Убираем личные данные гостя ----------
const PII_KEY = /(^|_)(fio|phone|phones|tel|telephone|mobile|email|e_mail|mail|passport|birth|birthday|birth_date|address|document|documents|first_?name|last_?name|middle_?name|surname|patronymic|full_?name|client_?name|guest_?name|customer_?name|comment|comments|note|notes|wishes|message|whatsapp|telegram|contact|contacts)($|_)/i;
const PERSON = /(^|_)(client|guest|customer|person|tenant|renter|user|contact|buyer|payer)s?($|_)/i;
const PLACE = /(apartment|object|realty|flat|room|lot|unit|property|channel|source|status|tariff|rate)/i;
const PHONE = /(\+7|\b8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}\b/g;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/gi;
function scrub(v: unknown, path: string[] = []): unknown {
  const key = norm(path[path.length - 1] || '');
  const parents = path.slice(0, -1);   // внутри объекта гостя (client: {...}) прячем всё, кроме счётчиков
  const inPerson = parents.some(p => PERSON.test(norm(p)));
  const inPlace = parents.some(p => PLACE.test(norm(p)));
  if (Array.isArray(v)) return v.map((x, i) => scrub(x, [...path, String(i)]));
  if (isObj(v)) {
    const o: Obj = {};
    Object.entries(v).forEach(([k, x]) => { o[k] = scrub(x, [...path, k]); });
    return o;
  }
  if (typeof v === 'string') {
    if (PII_KEY.test(key) || (key === 'name' && !inPlace) || (inPerson && !/^(id|count|guests|adults|children)$/.test(key))) return v ? '•••' : v;
    return v.replace(PHONE, '•••').replace(EMAIL, '•••');
  }
  if (typeof v === 'number' && PII_KEY.test(key)) return 0;   // телефон, присланный числом
  return v;
}

// ---------- Главное ----------
function normalize(body: unknown, test: boolean) {
  const all = objects(body).sort((a, b) => a.path.length - b.path.length);
  // Бронь — объект, где есть и дата заезда, и дата выезда. Если таких несколько, берём самый глубокий
  const books = all.filter(({ o }) => pick(o, KEYS.start) !== undefined && pick(o, KEYS.end) !== undefined && toDate(pick(o, KEYS.start)));
  const book = books.length ? books[books.length - 1].o : null;
  const whole = texts(body).slice(0, 20000);
  const lotRaw = find(book, all, KEYS.lot);
  return {
    sys: 'rc',
    kind: kindOf(find(book, all, KEYS.status), body, test),
    ext_id: idOf(book ? pick(book, KEYS.id) : find(null, all, KEYS.id)),
    lot: idOf(lotRaw),
    lot_title: titleOf(lotRaw),
    start: toDate(find(book, all, KEYS.start)),
    end: toDate(find(book, all, KEYS.end)),
    amount: toNum(find(book, all, KEYS.amount)),
    guests: toNum(find(book, all, KEYS.guests)),
    source: sourceOf(find(book, all, KEYS.source), whole),
    raw: scrub(body),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  if (req.method === 'GET') return reply({ ok: true, info: 'Приёмник броней «Медвежьего угла» работает. Менеджер каналов отправляет сюда брони методом POST.' });
  if (req.method !== 'POST') return reply({ ok: false, error: 'Только POST' }, 405);

  const text = (await req.text()).slice(0, 300000);
  const body = parseBody(text, req.headers.get('content-type') || '');
  const test = url.searchParams.get('test') === '1' || (isObj(body) && (body.test === true || body.test === 'true'));
  const event = normalize(body, test);

  const headers: Record<string, string> = { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' };
  const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/mu_channel_in`, {
    method: 'POST', headers, body: JSON.stringify({ p_key: key, p_event: event }),
  }).catch(() => null);
  if (!r) return reply({ ok: false, error: 'База не отвечает' }, 502);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return reply({ ok: false, error: j.message || 'Ошибка базы ' + r.status }, 502);
  if (j && j.ok === false && /ключ/i.test(j.error || '')) return reply(j, 403);
  // Возвращаем, что поняли, без личных данных: удобно проверять в журнале менеджера каналов
  return reply({ ...j, parsed: { kind: event.kind, lot: event.lot, start: event.start, end: event.end, source: event.source } });
});
