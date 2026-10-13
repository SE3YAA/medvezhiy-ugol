// db.js — данные и бизнес-правила экосистемы «Медвежий угол».
// Пока всё хранится в браузере (localStorage), у каждого объекта сети своё хранилище.
// Когда появится сервер (см. supabase/schema.sql), меняется только этот файл:
// app.js и экраны ролей обращаются к данным через объект DB и не знают, где они лежат.
(function () {
  const VER = 'mu_v11_';
  const SESSION_KEY = 'mu_session_v11';

  // ---------- Хранилище с запасным вариантом в памяти ----------
  const mem = {};
  const store = {
    get(k) { if (k in mem) return mem[k]; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); delete mem[k]; return true; } catch (e) { mem[k] = v; return false; } },
    del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* нет доступа, ничего страшного */ } }
  };

  // ---------- Даты и время (всё в местном времени, без сдвига UTC) ----------
  const pad = n => String(n).padStart(2, '0');
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const T = {
    pad,
    MONTHS: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    DOW: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
    DOW_FULL: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    iso: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    parse: s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
    today: () => T.iso(new Date()),
    nowMin: () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); },
    addDays: (s, n) => { const d = T.parse(s); d.setDate(d.getDate() + n); return T.iso(d); },
    nights: (a, b) => Math.round((T.parse(b) - T.parse(a)) / 864e5),
    hm: min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`,
    dm: s => { const d = T.parse(s); return `${d.getDate()} ${MON_S[d.getMonth()]}`; },
    long: s => { const d = T.parse(s); return `${T.DOW_FULL[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; },
    rel: s => { const t = T.today(); return s === t ? 'сегодня' : s === T.addDays(t, 1) ? 'завтра' : s === T.addDays(t, -1) ? 'вчера' : T.dm(s); },
    stamp: ts => { const d = new Date(ts); return `${T.rel(T.iso(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; },
    dayOf: ts => T.iso(new Date(ts))
  };

  const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const rng = seed => { let s = seed % 2147483647 || 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const code = (n, src) => { let h = 2166136261; String(src).split('').forEach(c => { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }); return String(Math.abs(h)).slice(-n).padStart(n, '7'); };

  // ---------- Стартовые данные: строятся от сегодняшнего дня ----------
  function seed(pid) {
    const full = pid === 'mu';
    const t = T.today();
    const day = n => T.addDays(t, n);
    const ts = (off, h, m) => { const d = T.parse(day(off)); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
    const r = rng(full ? 4242 : 777);
    let seq = 100;
    const id = () => ++seq;
    const blank = tpl => CAT.standards[tpl].steps.map(() => ({ done: false, photo: null }));
    const y = new Date().getFullYear();
    const hol = [];
    [y, y + 1].forEach(yy => ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-02', '05-09', '05-10', '06-12', '11-04', '12-31'].forEach(md => hol.push(`${yy}-${md}`)));

    const units = full ? [
      { id: 'h1', kind: 'house', mode: 'day', name: 'A-frame «Медвежий угол»', short: 'A-frame №1', scene: 'aframe', price: 12000, capacity: 4, status: 'ready', desc: 'Треугольный дом со вторым светом, террасой и видом на сосны.' },
      { id: 'h2', kind: 'house', mode: 'day', name: 'Barnhouse Loft', short: 'Barnhouse №2', scene: 'barn', price: 15000, capacity: 6, status: 'cleaning', desc: 'Просторный барнхаус с панорамной ванной, камином и виниловым проигрывателем.' },
      { id: 'h3', kind: 'house', mode: 'day', name: 'A-frame у ручья', short: 'A-frame №3', scene: 'creek', price: 12000, capacity: 4, status: 'dirty', desc: 'Уединённый дом у ручья со своей костровой чашей и мангалом.' },
      { id: 'h4', kind: 'house', mode: 'day', name: 'Лесной лодж', short: 'Лодж №4', scene: 'lodge', price: 18000, capacity: 8, status: 'ready', desc: 'Коттедж из кедрового бруса для большой семьи или компании.' },
      { id: 'g1', kind: 'gazebo', mode: 'hour', name: 'Беседка у дороги №1', short: 'Беседка №1', scene: 'gazebo', price: 600, capacity: 10, status: 'ready', open: 540, close: 1380, minHours: 2, buffer: 0, desc: 'Крытая беседка с мангалом на 10 человек.' },
      { id: 'g2', kind: 'gazebo', mode: 'hour', name: 'Беседка у дороги №2', short: 'Беседка №2', scene: 'gazebo', price: 900, capacity: 16, status: 'ready', open: 540, close: 1380, minHours: 2, buffer: 0, desc: 'Большая беседка с печью-барбекю на 16 человек.' },
      { id: 's1', kind: 'sauna', mode: 'hour', name: 'Финская баня', short: 'Баня', scene: 'sauna', price: 2000, capacity: 6, status: 'ready', open: 600, close: 1380, minHours: 2, buffer: 90, desc: 'Сухой пар, каминная зона и травяной чай.' }
    ] : [
      { id: 'h1', kind: 'house', mode: 'day', name: 'Шале «Ока»', short: 'Шале №1', scene: 'aframe', price: 9000, capacity: 4, status: 'ready', desc: 'Шале с видом на реку.' },
      { id: 'h2', kind: 'house', mode: 'day', name: 'Дом рыбака', short: 'Дом №2', scene: 'lodge', price: 11000, capacity: 6, status: 'ready', desc: 'Дом у причала с лодкой.' },
      { id: 'g1', kind: 'gazebo', mode: 'hour', name: 'Беседка на берегу', short: 'Беседка', scene: 'gazebo', price: 500, capacity: 12, status: 'ready', open: 540, close: 1380, minHours: 2, buffer: 0, desc: 'Беседка у воды.' },
      { id: 's1', kind: 'sauna', mode: 'hour', name: 'Баня на дровах', short: 'Баня', scene: 'sauna', price: 1800, capacity: 6, status: 'ready', open: 600, close: 1380, minHours: 2, buffer: 90, desc: 'Русская баня на дровах.' }
    ];

    const d = {
      pid, created: Date.now(),
      settings: { taxRate: 2, weekendK: 1.2, holidayK: 1.4, holidays: hol, minNightsHoliday: 2, hotDays: 4, hotPct: 15, earlyFee: 1500, lateFee: 1500, deposit: 5000, bonusPct: 5, refPct: 10, refBonus: 500, shiftPay: 2200, weatherStop: false, winter: true },
      users: [
        { login: 'admin', pass: 'admin', name: 'Отец', role: 'admin', title: 'Управляющий', phone: '+7 (999) 000-01-01', points: 0 },
        { login: 'elena', pass: '123', name: 'Елена', role: 'staff', title: 'Горничная', phone: '+7 (999) 111-22-33', points: 86, clean: 7, trained: true },
        { login: 'artem', pass: '123', name: 'Артём', role: 'staff', title: 'Практикант', phone: '+7 (999) 222-33-44', points: 12, clean: 1, trained: false },
        { login: 'dmitry', pass: '123', name: 'Дмитрий', role: 'instructor', title: 'Инструктор', phone: '+7 (999) 444-55-66', points: 0 },
        { login: 'guest', pass: '123', name: 'Константин', role: 'guest', title: 'Гость', phone: '+7 (999) 777-88-99', points: 0, bonus: 1240, ref: 'KOSTYA', birthday: '03-14' }
      ],
      units,
      bookings: [], tasks: [], accepts: [], rides: [], tx: [], messages: [], moods: [], refs: {},
      notes: [], tickets: [], stock: [], upkeep: [], heat: {}, projects: [], promos: [], certs: [], passes: [],
      events: [], rentals: [], reviews: [], waitlist: [], sos: [], lost: [], shifts: [], checkins: [], fuel: [],
      leads: [], incidents: [], crm: {}, daily: {},
      quads: [
        { id: 1, name: 'Loncin Xwolf 200', num: 1, status: 'park', totalHours: 186, toService: 14, interval: 50, defects: 'В норме' },
        { id: 2, name: 'Loncin Xwolf 200', num: 2, status: 'park', totalHours: 195, toService: 5, interval: 50, defects: 'Люфт правого зеркала' },
        { id: 3, name: 'CFMOTO 500', num: 3, status: 'service', totalHours: 320, toService: 0, interval: 100, defects: 'Замена масла и фильтра' }
      ]
    };
    if (!full) { d.users = d.users.filter(u => u.login !== 'artem'); d.quads = d.quads.slice(0, 1); }

    const tx = (off, h, m, type, amount, cat, title, method, bookingId, extra) =>
      d.tx.push(Object.assign({ id: id(), ts: ts(off, h, m), type, amount, cat, title, method, bookingId: bookingId || null }, extra || {}));
    const taxOf = base => Math.round(base * d.settings.taxRate / 100);

    // ---------- История за два с половиной месяца: брони, платежи, отзывы ----------
    const people = [['Иван Смирнов', '+7 (911) 234-56-78'], ['Мария Кузнецова', '+7 (916) 101-20-30'], ['Алексей Попов', '+7 (903) 555-66-77'], ['Ольга Васильева', '+7 (925) 880-11-22'], ['Дмитрий Новиков', '+7 (926) 404-50-60'],
      ['Екатерина Морозова', '+7 (915) 707-80-90'], ['Сергей Волков', '+7 (905) 212-34-56'], ['Анна Лебедева', '+7 (977) 616-17-18'], ['Павел Соколов', '+7 (999) 313-14-15'], ['Наталья Козлова', '+7 (965) 919-29-39'],
      ['Константин', '+7 (999) 777-88-99'], ['Марат Гайнуллин', '+7 (917) 800-10-20'], ['Юлия Орлова', '+7 (905) 300-40-50'], ['Артур Ким', '+7 (968) 515-25-35'], ['Виктория Белова', '+7 (912) 828-38-48']];
    const sources = ['Прямая', 'Прямая', 'Прямая', 'Яндекс Путешествия', 'Яндекс Путешествия', 'Авито', 'Сайт', 'Островок'];
    const praise = ['Очень чисто и уютно, вернёмся зимой', 'Баня огонь, спасибо Елене за порядок', 'Тишина, лес, всё как обещали', 'Дом тёплый, постель свежая', 'Отличное место для компании'];
    units.filter(u => u.kind === 'house').forEach(u => {
      let off = -76 + Math.floor(r() * 4);
      while (off < -5) {
        const n = 1 + Math.floor(r() * 3) + (r() > .8 ? 2 : 0);
        if (off + n > -4) break;
        const p = people[Math.floor(r() * people.length)], base = u.price * n, tax = taxOf(base);
        const src = sources[Math.floor(r() * sources.length)];
        const b = { id: id(), unitId: u.id, guest: p[0], login: p[0] === 'Константин' ? 'guest' : 'h' + code(4, p[1]), phone: p[1], guests: 2 + Math.floor(r() * (u.capacity - 1)), start: day(off), end: day(off + n), source: src, base, tax, amount: base + tax, paid: true, closed: true };
        d.bookings.push(b);
        tx(off, 10, 0, 'in', base, 'stay', `${p[0]}, ${u.short}`, src === 'Прямая' ? 'Карта' : 'Перевод', b.id);
        tx(off, 10, 1, 'in', tax, 'tax', `Туристический налог, ${p[0]}`, src === 'Прямая' ? 'Карта' : 'Перевод', b.id);
        if (r() > .45) {
          const stars = r() > .15 ? 5 : r() > .5 ? 4 : 3, txt = stars >= 4 ? praise[Math.floor(r() * praise.length)] : 'Долго грелась вода, в санузле было не до конца чисто';
          d.reviews.push({ id: id(), login: b.login, name: p[0], bookingId: b.id, unitId: u.id, stars, tags: stars >= 4 ? ['Чистота', 'Тишина'] : ['Чистота'], text: txt, ts: ts(off + n, 13, 0), routed: stars >= 4 ? 'yandex' : 'admin' });
        }
        off += n + Math.floor(r() * 4);
      }
    });
    // Допуслуги за прошлые 60 дней
    for (let off = -60; off < 0; off++) {
      const wk = T.parse(day(off)).getDay() % 6 === 0 || T.parse(day(off)).getDay() === 5;
      if (r() > .35 || wk) tx(off, 15, 0, 'in', 4000 * (wk && r() > .5 ? 2 : 1), 'sauna', 'Баня', 'Карта');
      if (r() > .4 || wk) tx(off, 12, 0, 'in', (wk ? 2 : 1) * (600 + Math.floor(r() * 3) * 900), 'gazebo', 'Аренда беседок', 'Наличные');
      if (full && (r() > .55 || wk)) tx(off, 16, 0, 'in', 3500 * (1 + Math.floor(r() * 2)), 'quad', 'Прокат квадроциклов', 'Карта');
      if (r() > .3) tx(off, 18, 0, 'in', 350 * (1 + Math.floor(r() * 4)), 'goods', 'Дрова и угли', 'Наличные');
      if (r() > .6) tx(off, 9, 0, 'in', 900 * (2 + Math.floor(r() * 3)), 'food', 'Завтраки', 'Карта');
      if (off % 7 === 0) tx(off, 11, 0, 'out', 4000 + Math.floor(r() * 5) * 1000, 'other', 'Хозтовары, бельё, продукты', 'Карта');
    }

    if (full) {
      const stay = (unitId, guest, login, phone, guests, s, e, source, closed, extra) => {
        const u = units.find(x => x.id === unitId), base = u.price * (e - s), tax = taxOf(base);
        const b = Object.assign({ id: id(), unitId, guest, login, phone, guests, start: day(s), end: day(e), source, base, tax, amount: base + tax, paid: true, closed: !!closed }, extra || {});
        d.bookings.push(b); return b;
      };
      const hour = (unitId, guest, login, phone, from, to, amount, date) => {
        const b = { id: id(), unitId, guest, login, phone, date: date || t, from: from * 60, to: to * 60, source: 'Прямая', amount, paid: true };
        d.bookings.push(b); return b;
      };
      stay('h3', 'Иван Смирнов', 'h' + code(4, '+7 (911) 234-56-78'), '+7 (911) 234-56-78', 4, -3, 0, 'Яндекс Путешествия', true);
      const bK = stay('h1', 'Константин', 'guest', '+7 (999) 777-88-99', 2, -1, 2, 'Прямая', false, { group: { code: 'LES' + code(3, 'kost'), members: ['guest'] } });
      const bA = stay('h3', 'Алина Воронова', 'alina', '+7 (921) 555-12-12', 3, 0, 3, 'Яндекс Путешествия');
      stay('h2', 'Семья Орловых', 'h' + code(4, '+7 (905) 300-40-50'), '+7 (905) 300-40-50', 5, 2, 5, 'Авито');
      stay('h4', 'Марат Гайнуллин', 'h' + code(4, '+7 (917) 800-10-20'), '+7 (917) 800-10-20', 6, -2, 1, 'Прямая');
      stay('h1', 'Мария Кузнецова', 'h' + code(4, '+7 (916) 101-20-30'), '+7 (916) 101-20-30', 2, 6, 8, 'Сайт');
      stay('h4', 'Корпоратив «Северстрой»', 'corp', '+7 (495) 100-00-00', 8, 9, 11, 'Прямая');
      const g1 = hour('g1', 'Пётр, день рождения', 'walkin', '+7 (900) 121-21-21', 12, 16, 2400);
      const g2 = hour('g2', 'Ольга, компания 12 человек', 'walkin', '+7 (900) 343-43-43', 15, 20, 4500);
      const s1 = hour('s1', 'Марат Гайнуллин', 'h' + code(4, '+7 (917) 800-10-20'), '+7 (917) 800-10-20', 14, 16, 4000);
      const s2 = hour('s1', 'Константин', 'guest', '+7 (999) 777-88-99', 19, 21, 4000);

      tx(0, 9, 12, 'in', bA.base, 'stay', 'Алина Воронова, A-frame №3', 'Перевод', bA.id);
      tx(0, 9, 13, 'in', bA.tax, 'tax', 'Туристический налог, Алина Воронова', 'Перевод', bA.id);
      tx(0, 10, 5, 'in', 2400, 'gazebo', 'Беседка №1, 12:00–16:00', 'Наличные', g1.id);
      tx(0, 10, 40, 'in', 4500, 'gazebo', 'Беседка №2, 15:00–20:00', 'Карта', g2.id);
      tx(0, 11, 15, 'in', 4000, 'sauna', 'Баня, Марат Гайнуллин', 'Карта', s1.id);
      tx(0, 11, 50, 'in', 4000, 'sauna', 'Баня, Константин', 'В счёт проживания', s2.id, { folio: bK.id, paid: false });
      tx(0, 12, 20, 'in', 3500, 'quad', 'Прокат квадроцикла, 1 час', 'Наличные');
      tx(0, 12, 45, 'in', 1100, 'goods', 'Дрова ×2 и уголь, беседка №1', 'Наличные');
      tx(0, 9, 30, 'in', 1800, 'food', 'Завтрак в корзине ×2, A-frame №1', 'В счёт проживания', null, { folio: bK.id, paid: false });
      tx(0, 8, 30, 'out', 2600, 'quad', 'АЗС, бензин для квадроциклов', 'Карта');
      tx(-1, 20, 0, 'in', bK.base, 'stay', 'Константин, A-frame №1', 'Карта', bK.id);
      tx(-1, 20, 1, 'in', bK.tax, 'tax', 'Туристический налог, Константин', 'Карта', bK.id);

      const t2 = { id: id(), title: 'Уборка перед заездом', unitId: 'h2', place: 'Barnhouse №2', tpl: 'house_clean', due: 'до ' + T.dm(day(2)), status: 'doing', steps: blank('house_clean'), guest: 'Семья Орловых', note: '', ts: ts(0, 9, 0) };
      t2.steps[0].done = true;
      d.tasks.push(
        { id: id(), title: 'Уборка после выезда', unitId: 'h3', place: 'A-frame №3', tpl: 'house_clean', due: 'до 14:00', status: 'todo', steps: blank('house_clean'), guest: 'Заезжает Алина Воронова', note: 'Гости приедут с ребёнком, поставить детский стул.', ts: ts(0, 12, 5) },
        t2,
        { id: id(), title: 'Баня к 19:00', unitId: 's1', place: 'Баня', tpl: 'sauna_prep', due: 'к 19:00', status: 'todo', steps: blank('sauna_prep'), guest: 'Константин', note: 'Веник берёзовый, 2 штуки.', bookingId: s2.id, login: 'guest', ts: ts(0, 11, 50) },
        { id: id(), title: 'Дрова ×2 и уголь', unitId: 'g1', place: 'Беседка №1', tpl: 'delivery', due: 'как можно скорее', status: 'todo', steps: blank('delivery'), guest: 'Пётр', note: '', ts: ts(0, 12, 45) }
      );
      d.accepts.push(
        { id: id(), unitId: 'h4', by: 'Елена', byLogin: 'elena', ts: ts(-2, 13, 10), state: 'ok', photos: [{ label: 'Постель', demo: 'bed' }, { label: 'Санузел', demo: 'bath' }, { label: 'Общий вид', demo: 'room' }] },
        { id: id(), unitId: 'h1', by: 'Елена', byLogin: 'elena', ts: ts(-1, 12, 40), state: 'ok', photos: [{ label: 'Постель', demo: 'bed' }, { label: 'Санузел', demo: 'bath' }, { label: 'Общий вид', demo: 'room' }] }
      );
      d.rides.push(
        { id: id(), guest: 'Марат Гайнуллин', login: 'h' + code(4, '+7 (917) 800-10-20'), quadId: 1, date: t, from: 16 * 60, dur: 60, route: 'Медвежья тропа', status: 'booked', signed: true, signedAs: 'Марат Гайнуллин', signedAt: ts(0, 10, 30), photos: {}, amount: 3500 },
        { id: id(), guest: 'Константин', login: 'guest', quadId: 1, date: day(1), from: 12 * 60, dur: 120, route: 'Тайга и скалы', status: 'booked', signed: true, signedAs: 'Константин', signedAt: ts(-1, 20, 0), photos: {}, amount: 7000 }
      );
      d.messages.push(
        { id: id(), login: 'guest', name: 'Константин', from: 'guest', text: 'Добрый вечер! Во сколько сегодня можно в баню?', ts: ts(-1, 19, 42), read: true },
        { id: id(), login: 'guest', name: 'Константин', from: 'admin', text: 'Здравствуйте! Завтра свободно с 19:00. Записаться можно во вкладке «Услуги».', ts: ts(-1, 19, 47), read: true },
        { id: id(), login: 'guest', name: 'Константин', from: 'guest', text: 'Записался на 19:00, спасибо. Можно ещё два берёзовых веника?', ts: ts(0, 11, 52), read: false }
      );
      d.moods.push({ id: id(), login: 'elena', name: 'Елена', date: day(-1), mood: 4, tags: ['Много тяжёлой работы'] });

      d.stock = [
        { id: 'linen', name: 'Комплекты постельного белья', unit: 'компл.', qty: 14, min: 8 },
        { id: 'towel', name: 'Полотенца', unit: 'шт.', qty: 38, min: 20 },
        { id: 'paper', name: 'Туалетная бумага', unit: 'рул.', qty: 22, min: 12 },
        { id: 'chem', name: 'Моющие средства', unit: 'фл.', qty: 6, min: 4 },
        { id: 'wood', name: 'Дрова берёзовые', unit: 'сетка', qty: 9, min: 10 },
        { id: 'coal', name: 'Уголь берёзовый', unit: 'мешок', qty: 15, min: 6 },
        { id: 'vb', name: 'Веники берёзовые', unit: 'шт.', qty: 7, min: 5 },
        { id: 'vo', name: 'Веники дубовые', unit: 'шт.', qty: 3, min: 5 },
        { id: 'fuel', name: 'Бензин АИ-92', unit: 'л', qty: 42, min: 30 }
      ];
      d.tickets = [
        { id: id(), title: 'Капает кран на кухне', place: 'Лодж №4', unitId: 'h4', by: 'Елена', ts: ts(-1, 15, 20), status: 'new', prio: 'normal', photo: null },
        { id: id(), title: 'Не горит фонарь на тропе к бане', place: 'Территория', unitId: null, by: 'Дмитрий', ts: ts(-3, 21, 0), status: 'work', prio: 'high', photo: null }
      ];
      d.upkeep = [
        { id: id(), title: 'Чистка дымохода в бане', place: 'Баня', every: 90, last: day(-95) },
        { id: id(), title: 'Проверка огнетушителей', place: 'Все объекты', every: 180, last: day(-40) },
        { id: id(), title: 'Откачка септика', place: 'Территория', every: 60, last: day(-52) },
        { id: id(), title: 'ТО генератора', place: 'Генераторная', every: 30, last: day(-12) },
        { id: id(), title: 'Покос травы', place: 'Территория', every: 14, last: day(-20) },
        { id: id(), title: 'Промывка скважинного фильтра', place: 'Скважина', every: 60, last: day(-8) }
      ];
      d.heat = { h1: { target: 22, eco: 12, auto: true }, h2: { target: 22, eco: 12, auto: true }, h3: { target: 23, eco: 12, auto: true }, h4: { target: 21, eco: 10, auto: true } };
      d.projects = [
        { id: id(), name: 'Новое здание кафе', budget: 2400000, stages: [{ t: 'Проект и смета', done: true }, { t: 'Фундамент', done: true }, { t: 'Каркас и кровля', done: false }, { t: 'Коммуникации', done: false }, { t: 'Отделка и мебель', done: false }], costs: [{ t: 'Проект', amount: 180000, ts: ts(-60, 12) }, { t: 'Фундамент, бетон и работа', amount: 520000, ts: ts(-30, 12) }], photos: [] },
        { id: id(), name: 'Дорожки к дальним домам', budget: 350000, stages: [{ t: 'Разметка', done: true }, { t: 'Отсыпка щебнем', done: false }, { t: 'Освещение', done: false }], costs: [{ t: 'Щебень, 20 т', amount: 64000, ts: ts(-10, 12) }], photos: [] }
      ];
      d.promos = [
        { code: 'LES10', pct: 10, used: 3, max: 50, until: day(60), note: 'Для подписчиков' },
        { code: 'WEEKDAY15', pct: 15, used: 1, max: 100, until: day(90), note: 'Будни, воскресенье–четверг' }
      ];
      d.certs = [{ code: 'GIFT-' + code(4, 'gift1'), amount: 15000, balance: 15000, buyer: 'Анна Лебедева', to: 'Маме на юбилей', ts: ts(-9, 14) }];
      d.events = [
        { id: id(), title: 'Вечер у костра с гитарой', date: day(0), time: 20 * 60, price: 0, places: 30, going: [{ login: 'guest', n: 2 }], desc: 'Глинтвейн, гитара и истории о лесе. Пледы дадим.' },
        { id: id(), title: 'Банная программа с пармастером', date: day(2), time: 18 * 60, price: 3500, places: 6, going: [], desc: 'Три захода с травами, вениками и скрабом, чай после.' },
        { id: id(), title: 'Мастер-класс по выпечке хлеба в печи', date: day(5), time: 12 * 60, price: 1500, places: 10, going: [], desc: 'Замешиваем тесто и печём хлеб в дровяной печи. Хлеб забираете с собой.' }
      ];
      d.rentals = [{ id: id(), itemId: 'sup', login: 'h0000', guest: 'Анна Лебедева', date: day(-20), from: 11 * 60, hours: 2, status: 'back', amount: 1600 }];
      d.waitlist = [{ id: id(), unitId: 'h2', start: day(2), end: day(4), login: 'guest', name: 'Константин', phone: '+7 (999) 777-88-99', ts: ts(-2, 12) }];
      d.lost = [{ id: id(), title: 'Зарядка для телефона', unitId: 'h3', place: 'A-frame №3', photo: null, ts: ts(0, 12, 30), status: 'stored', guestLogin: 'h' + code(4, '+7 (911) 234-56-78'), guestName: 'Иван Смирнов' }];
      d.passes = [{ id: id(), productId: 's5', code: 'PASS-' + code(4, 'p1'), login: 'local1', name: 'Виктор Ткачёв', phone: '+7 (901) 222-11-00', left: 3, total: 5, ts: ts(-25, 12) }];
      d.leads = [{ id: id(), kind: 'corp', name: 'Ирина, HR компании', phone: '+7 (926) 555-00-11', text: '25 человек, 2 ночи, баня и квадроциклы', amount: 210000, ts: ts(-1, 16), status: 'new' }];
      d.fuel = [{ id: id(), quadId: 1, liters: 12, cost: 660, ts: ts(-3, 10) }, { id: id(), quadId: 2, liters: 10, cost: 550, ts: ts(-1, 10) }];
      const mon = T.addDays(t, -((T.parse(t).getDay() + 6) % 7));
      for (let i = 0; i < 14; i++) { const ds = T.addDays(mon, i), dw = (i % 7); d.shifts.push({ date: ds, login: dw < 5 ? 'elena' : 'artem' }); if (dw >= 4) d.shifts.push({ date: ds, login: 'dmitry' }); }
      for (let i = -12; i <= 0; i++) { const ds = day(i); if (d.shifts.some(s => s.date === ds && s.login === 'elena')) d.checkins.push({ login: 'elena', date: ds, in: ts(i, 8, 52), out: i < 0 ? ts(i, 17, 10) : null }); }
      d.notes.push(
        { id: id(), to: 'admin', text: 'Новый отзыв 5 звёзд: «Очень чисто и уютно, вернёмся зимой»', icon: 'star', ts: ts(-1, 13), read: false },
        { id: id(), to: 'admin', text: 'Заявка на корпоратив: 25 человек, 2 ночи', icon: 'users', ts: ts(-1, 16), read: false },
        { id: id(), to: 'guest', text: 'Баня забронирована на 19:00. Растопим к вашему приходу', icon: 'flame', ts: ts(0, 11, 51), read: false }
      );
      d.crm['+79161012030'] = { birthday: '10-20', tags: ['Постоянный гость'], note: 'Любит A-frame №1, просит дополнительный плед' };
      d.crm['+79997778899'] = { birthday: '03-14', tags: ['Постоянный гость', 'Баня'], note: '' };
    } else {
      const b = { id: id(), unitId: 'h1', guest: 'Игорь Савельев', login: 'igor', phone: '+7 (900) 000-11-22', guests: 2, start: day(-1), end: day(1), source: 'Прямая', base: 18000, tax: 360, amount: 18360, paid: true, closed: false };
      d.bookings.push(b);
      tx(-1, 12, 0, 'in', 18000, 'stay', 'Игорь Савельев, Шале №1', 'Карта', b.id);
    }
    d.seq = seq;
    return d;
  }

  // =====================================================================
  //  API
  // =====================================================================
  const DB = {
    d: null,
    onFail: null, // app.js подставит показ ошибки, если память браузера закончилась
    onNotify: null,

    pid() { return store.get('mu_pid') || 'mu'; },
    key() { return VER + this.pid(); },
    load() {
      const raw = store.get(this.key());
      this.d = null;
      if (raw) { try { this.d = JSON.parse(raw); } catch (e) { this.d = null; } }
      if (!this.d || !this.d.units) { this.d = seed(this.pid()); this.save(); }
      return this.d;
    },
    save() {
      const ok = this.saveLocal();
      if (window.SYNC) window.SYNC.schedule(); // отправить изменения на сервер (sync.js)
      return ok;
    },
    saveLocal() {
      const ok = store.set(this.key(), JSON.stringify(this.d));
      if (!ok && this.onFail) this.onFail();
      return ok;
    },
    reset() { CAT.properties.forEach(p => store.del(VER + p.id)); store.del(SESSION_KEY); store.del('mu_pid'); this.load(); },
    // Выход с общей базой: стереть с телефона все данные и сессию
    wipe() { CAT.properties.forEach(p => store.del(VER + p.id)); store.del(SESSION_KEY); this.load(); },
    useProperty(pid) { store.set('mu_pid', pid); this.load(); if (window.SYNC && window.SYNC.enabled) return window.SYNC.restart(); },
    peek(pid) { // данные другого объекта сети, только для сводки владельца
      if (pid === this.pid()) return this.d;
      const raw = store.get(VER + pid);
      if (raw) { try { return JSON.parse(raw); } catch (e) { /* испорчено, пересоздадим */ } }
      const d = seed(pid); store.set(VER + pid, JSON.stringify(d)); return d;
    },
    // Номер записи уникален между телефонами: время в миллисекундах × 1000 плюс счётчик
    id() {
      const n = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      this._last = Math.max(n, (this._last || 0) + 1);
      return this._last;
    },
    get S() { return this.d.settings; },

    // --- Уведомления. to: логин, роль ('admin', 'staff', 'instructor') или 'all' ---
    notify(to, text, icon, go) {
      this.d.notes.unshift({ id: this.id(), to, text, icon: icon || 'info', go: go || '', ts: Date.now(), read: false });
      this.d.notes = this.d.notes.slice(0, 120);
      if (this.onNotify) this.onNotify(to, text);
    },
    notesFor(u) { return this.d.notes.filter(n => n.to === u.login || n.to === u.role || n.to === 'all'); },
    readNotes(u) { this.notesFor(u).forEach(n => { n.read = true; }); this.save(); },

    // --- Пользователи ---
    user(login) { return this.d.users.find(u => u.login === login); },
    me() { const l = store.get(SESSION_KEY); return l ? this.user(l) || null : null; },
    setSession(login) { store.set(SESSION_KEY, login); },
    auth(login, pass) {
      const u = this.d.users.find(x => x.login.toLowerCase() === login.trim().toLowerCase() && x.pass === pass);
      if (u) this.setSession(u.login);
      return u || null;
    },
    digits: p => String(p || '').replace(/\D/g, '').replace(/^8/, '7'),
    // Вход по номеру телефона. Код из SMS пока демо: 1234
    authPhone(phone, name) {
      const dg = this.digits(phone);
      let u = this.d.users.find(x => this.digits(x.phone) === dg);
      if (!u) {
        u = { login: 'p' + dg.slice(-7), pass: '', name: name || 'Гость', role: 'guest', title: 'Гость', phone, points: 0, bonus: 0, ref: 'G' + code(5, dg), consent: Date.now() };
        this.d.users.push(u); this.save();
      }
      this.setSession(u.login);
      return u;
    },
    register(name, login, pass, phone, ref) {
      login = login.trim();
      if (this.d.users.some(u => u.login.toLowerCase() === login.toLowerCase())) return { ok: false, msg: 'Такой логин уже занят, придумайте другой' };
      const u = { login, pass, name: name.trim(), role: 'guest', title: 'Гость', phone: phone || '', points: 0, bonus: 0, ref: 'G' + code(5, login), consent: Date.now() };
      const by = ref && this.d.users.find(x => x.ref && x.ref.toUpperCase() === ref.trim().toUpperCase());
      if (by) { u.refBy = by.login; u.refDiscount = true; }
      this.d.users.push(u); this.save(); this.setSession(u.login);
      return { ok: true, user: u, ref: !!by };
    },
    // Гость отсканировал QR на столе: входит без регистрации и сразу привязан к объекту
    qrLogin(unitId) {
      const unit = this.unit(unitId);
      if (!unit) return null;
      const login = 'qr-' + unitId;
      let u = this.user(login);
      if (!u) { u = { login, pass: '', name: 'Гость, ' + unit.short, role: 'guest', title: 'Гость', phone: '', points: 0, bonus: 0, unitId, qr: true }; this.d.users.push(u); this.save(); }
      this.setSession(login);
      return u;
    },
    // Друг пришёл по ссылке-приглашению в бронь компании
    joinGroup(gcode) {
      const b = this.d.bookings.find(x => x.group && x.group.code === gcode);
      if (!b) return null;
      const login = 'grp-' + gcode + '-' + (b.group.members.length + 1);
      const u = { login, pass: '', name: 'Друг из компании', role: 'guest', title: 'Гость', phone: '', points: 0, bonus: 0, groupOf: b.id };
      this.d.users.push(u); b.group.members.push(login); this.save(); this.setSession(login);
      return u;
    },
    visitor() {
      const login = 'v' + Date.now().toString(36);
      const u = { login, pass: '', name: 'Гость', role: 'guest', title: 'Гость', phone: '', points: 0, bonus: 0, visitor: true };
      this.d.users.push(u); this.save(); this.setSession(login);
      return u;
    },
    updateUser(login, f) { Object.assign(this.user(login), f); this.save(); },
    logout() { store.del(SESSION_KEY); },

    unit(id) { return this.d.units.find(u => u.id === id); },
    quad(id) { return this.d.quads.find(q => q.id === id); },

    // --- Цены: выходные и праздники дороже, пустые будни рядом с сегодняшним днём дешевле ---
    isHoliday(iso) { return this.S.holidays.includes(iso); },
    nightPrice(unit, iso) {
      const s = this.S, dw = T.parse(iso).getDay();
      let k = 1, tag = '';
      if (this.isHoliday(iso)) { k = s.holidayK; tag = 'праздник'; }
      else if (dw === 5 || dw === 6) { k = s.weekendK; tag = 'выходные'; }
      else if (T.nights(T.today(), iso) < s.hotDays && T.nights(T.today(), iso) >= 0) { k = 1 - s.hotPct / 100; tag = 'горящая дата'; }
      return { price: Math.round(unit.price * k / 100) * 100, tag };
    },
    promo(codeStr, login) {
      if (!codeStr) return null;
      const c = codeStr.trim().toUpperCase();
      const p = this.d.promos.find(x => x.code === c && x.used < x.max && x.until >= T.today());
      if (p) return { code: p.code, pct: p.pct, label: `Промокод ${p.code}` };
      const u = login && this.user(login);
      const ref = this.d.users.find(x => x.ref && x.ref.toUpperCase() === c && (!u || x.login !== u.login));
      if (ref) return { code: c, pct: this.S.refPct, label: `Приглашение от друга`, refBy: ref.login };
      return null;
    },
    quote(unitId, start, end, promoCode, login) {
      const u = this.unit(unitId), out = { nights: [], base: 0, discount: 0, tax: 0, total: 0, ok: true, msg: '' };
      const n = T.nights(start, end);
      if (n < 1) { out.ok = false; out.msg = 'Выезд должен быть позже заезда'; return out; }
      for (let i = 0; i < n; i++) { const ds = T.addDays(start, i), p = this.nightPrice(u, ds); out.nights.push(Object.assign({ date: ds }, p)); out.base += p.price; }
      if (out.nights.some(x => x.tag === 'праздник') && n < this.S.minNightsHoliday) { out.ok = false; out.msg = `В праздники бронь от ${this.S.minNightsHoliday} ночей`; }
      const me = login && this.user(login);
      const pr = this.promo(promoCode, login) || (me && me.refDiscount ? { code: '', pct: this.S.refPct, label: 'Скидка по приглашению' } : null);
      if (pr) { out.promo = pr; out.discount = Math.round(out.base * pr.pct / 100); }
      out.tax = Math.round((out.base - out.discount) * this.S.taxRate / 100);
      out.total = out.base - out.discount + out.tax;
      if (!this.dayFree(unitId, start, end)) { out.ok = false; out.msg = 'На эти даты дом уже занят'; }
      return out;
    },

    // --- Доступность ---
    // Посуточно: бронь занимает ночи [start, end). В день выезда дом можно заселять снова.
    dayFree(unitId, start, end, ignoreId) {
      return !this.d.bookings.some(b => b.unitId === unitId && b.start && b.id !== ignoreId && overlap(start, end, b.start, b.end));
    },
    // По часам: после каждой брони блокируется буфер объекта (баня — 90 минут на уборку и растопку)
    hourFree(unitId, date, from, to, ignoreId) {
      const buf = this.unit(unitId).buffer || 0;
      return !this.d.bookings.some(b => b.unitId === unitId && b.date === date && b.id !== ignoreId && overlap(from, to + buf, b.from, b.to + buf));
    },
    freeStarts(unitId, date, durMin) {
      const u = this.unit(unitId), out = [], now = date === T.today() ? T.nowMin() + 30 : 0;
      if (!u) return out;
      for (let s = u.open; s + durMin <= u.close; s += 60) if (s >= now && this.hourFree(unitId, date, s, s + durMin)) out.push(s);
      return out;
    },
    freeQuad(date, from, dur) {
      if (this.S.weatherStop) return null;
      const q = this.d.quads.find(q => q.status !== 'service' && q.toService > 0 &&
        !this.d.rides.some(r => r.quadId === q.id && r.date === date && r.status !== 'done' && overlap(from, from + dur, r.from, r.from + r.dur + 30)));
      return q ? q.id : null;
    },
    rentalLeft(itemId, date) {
      const it = CAT.rentals.find(x => x.id === itemId);
      return it.qty - this.d.rentals.filter(r => r.itemId === itemId && r.date === date && r.status !== 'back').length;
    },

    // --- Брони ---
    stayOf(login) {
      const t = T.today(), u = this.user(login);
      if (u && u.groupOf) return this.d.bookings.find(b => b.id === u.groupOf) || null;
      const mine = this.d.bookings.filter(b => b.start && b.login === login && b.end >= t && !(b.end === t && b.closed)).sort((a, b) => a.start < b.start ? -1 : 1);
      return mine.find(b => b.start <= t) || mine[0] || null;
    },
    addStay(b) {
      if (b.end <= b.start) return { ok: false, msg: 'Дата выезда должна быть позже даты заезда' };
      if (!this.dayFree(b.unitId, b.start, b.end)) return { ok: false, msg: 'На эти даты дом уже занят' };
      const u = this.unit(b.unitId);
      const q = this.quote(b.unitId, b.start, b.end, b.promo, b.login);
      const base = b.amount != null ? b.amount : q.base - q.discount;
      const tax = Math.round(base * this.S.taxRate / 100);
      const paid = b.method && b.method !== 'Не оплачено';
      const nb = Object.assign({ id: this.id(), closed: false }, b, { base, tax, amount: base + tax, paid, group: { code: 'G' + code(4, Date.now() + b.guest), members: [b.login] } });
      delete nb.method; delete nb.promo;
      this.d.bookings.push(nb);
      if (paid && base > 0) {
        this.addTx({ type: 'in', amount: base, cat: 'stay', title: `${nb.guest}, ${u.short}`, method: b.method, bookingId: nb.id }, true);
        if (tax) this.addTx({ type: 'in', amount: tax, cat: 'tax', title: `Туристический налог, ${nb.guest}`, method: b.method, bookingId: nb.id }, true);
      }
      if (q.promo && q.promo.code) { const p = this.d.promos.find(x => x.code === q.promo.code); if (p) p.used++; }
      const g = this.user(b.login);
      if (g && g.role === 'guest') {
        if (paid) g.bonus = (g.bonus || 0) + Math.round(base * this.S.bonusPct / 100);
        if (g.refBy && g.refDiscount) { g.refDiscount = false; const by = this.user(g.refBy); if (by) { by.bonus = (by.bonus || 0) + this.S.refBonus; this.notify(by.login, `Друг забронировал дом по вашему приглашению: +${this.S.refBonus} бонусов`, 'star'); } }
      }
      if (nb.start <= T.addDays(T.today(), 1) && u.status !== 'ready') this.ensureCleanTask(u, 'Уборка перед заездом', 'к 14:00, ' + T.rel(nb.start), 'Заезжает ' + nb.guest);
      this.notify('admin', `Новая бронь: ${nb.guest}, ${u.short}, ${T.dm(nb.start)} – ${T.dm(nb.end)}`, 'calendar', 'chess');
      this.save();
      return { ok: true, booking: nb, quote: q };
    },
    addHour(b) {
      const u = this.unit(b.unitId);
      if (b.to <= b.from) return { ok: false, msg: 'Проверьте время окончания' };
      if (!this.hourFree(b.unitId, b.date, b.from, b.to))
        return { ok: false, msg: u.buffer ? `Время занято. После каждой компании ${u.buffer} минут уходит на уборку и растопку` : 'Это время уже занято' };
      const nb = Object.assign({ id: this.id(), paid: b.method !== 'Не оплачено' }, b);
      const method = nb.method; delete nb.method;
      this.d.bookings.push(nb);
      const span = `${T.hm(nb.from)}–${T.hm(nb.to)}`;
      if (nb.amount > 0 && method !== 'Не оплачено' && method !== 'Абонемент')
        this.addTx(Object.assign({ type: 'in', amount: nb.amount, cat: u.kind, title: `${u.short}, ${span}, ${nb.guest}`, method: method || 'Карта', bookingId: nb.id }, b.folio ? { folio: b.folio, paid: false } : {}), true);
      if (u.kind === 'sauna')
        this.addTask({ title: `Баня к ${T.hm(nb.from)}`, unitId: u.id, place: u.short, tpl: 'sauna_prep', due: `к ${T.hm(nb.from)}, ${T.rel(nb.date)}`, guest: nb.guest, note: b.note || '', bookingId: nb.id, login: nb.login }, true);
      this.save();
      return { ok: true, booking: nb };
    },
    cancelBooking(id) {
      const b = this.d.bookings.find(x => x.id === id);
      this.d.bookings = this.d.bookings.filter(x => x.id !== id);
      this.d.tx = this.d.tx.filter(x => x.bookingId !== id);
      this.d.tasks = this.d.tasks.filter(x => !(x.bookingId === id && x.status !== 'done'));
      // Освободились даты — первым узнаёт тот, кто стоял в листе ожидания
      if (b && b.start) this.d.waitlist.filter(w => w.unitId === b.unitId && overlap(w.start, w.end, b.start, b.end) && this.dayFree(w.unitId, w.start, w.end)).forEach(w => {
        w.offered = Date.now();
        this.notify(w.login, `Освободился ${this.unit(w.unitId).short} на ${T.dm(w.start)} – ${T.dm(w.end)}. Успейте забронировать`, 'calendar', 'g_book');
      });
      this.save();
    },
    setEarlyLate(stayId, kind) {
      const b = this.d.bookings.find(x => x.id === stayId), u = this.unit(b.unitId);
      const free = kind === 'early' ? this.dayFree(u.id, T.addDays(b.start, -1), b.start, b.id) : this.dayFree(u.id, b.end, T.addDays(b.end, 1), b.id);
      if (!free) return { ok: false, msg: kind === 'early' ? 'Накануне в доме живут другие гости, ранний заезд невозможен' : 'В день выезда заезжают следующие гости, поздний выезд невозможен' };
      b[kind] = true;
      const fee = kind === 'early' ? this.S.earlyFee : this.S.lateFee;
      this.addTx({ type: 'in', amount: fee, cat: 'stay', title: `${kind === 'early' ? 'Ранний заезд с 10:00' : 'Поздний выезд до 16:00'}, ${u.short}`, method: 'В счёт проживания', folio: b.id, paid: false }, true);
      this.notify('staff', `${u.short}: ${kind === 'early' ? 'ранний заезд в 10:00, подготовить дом к утру' : 'поздний выезд в 16:00, уборку сдвинуть'}`, 'clock');
      this.save();
      return { ok: true, fee };
    },
    onlineCheckin(stayId, data) {
      const b = this.d.bookings.find(x => x.id === stayId);
      b.checkin = Object.assign({ ts: Date.now() }, data);
      this.notify('admin', `${b.guest} прошёл онлайн-регистрацию: приедет к ${data.arrive}`, 'check', 'chess');
      this.save();
    },
    doorCode(b) { return b.codeSalt ? code(4, b.id + b.codeSalt) : code(4, 'door' + b.id); },
    resetCode(stayId) { const b = this.d.bookings.find(x => x.id === stayId); b.codeSalt = Date.now(); this.save(); return this.doorCode(b); },
    // Раз в запуск: выезды, просроченные выезды на квадроциклах, склад, хозяйство
    tick() {
      const t = T.today(), late = T.nowMin() >= 12 * 60, d = this.d;
      d.daily = d.daily || {};
      d.bookings.forEach(b => {
        if (!b.start || b.closed) return;
        if (b.end < t || (b.end === t && late && !b.late)) {
          b.closed = true;
          const u = this.unit(b.unitId);
          if (u) { u.status = 'dirty'; this.ensureCleanTask(u, 'Уборка после выезда', 'до 14:00', 'Выехал ' + b.guest); }
          this.notify(b.login, 'Спасибо, что были у нас! Оцените отдых, это займёт полминуты', 'star', 'g_me');
        }
      });
      d.rides.filter(r => r.status === 'riding' && !r.alarm && Date.now() > r.startedAt + (r.dur + 20) * 60000).forEach(r => {
        r.alarm = true;
        const q = this.quad(r.quadId);
        this.notify('admin', `Тревога: квадроцикл №${q.num} (${r.guest}) не вернулся вовремя`, 'alert', 'base');
        this.notify('instructor', `Квадроцикл №${q.num} опаздывает больше чем на 20 минут`, 'alert', 'rides');
      });
      if (d.daily.date !== t) {
        d.daily = { date: t };
        const low = d.stock.filter(s => s.qty <= s.min);
        if (low.length) this.notify('admin', `Заканчивается на складе: ${low.map(s => s.name.toLowerCase()).join(', ')}`, 'bag', 'm_stock');
        const due = d.upkeep.filter(x => T.addDays(x.last, x.every) <= T.addDays(t, 3));
        if (due.length) this.notify('admin', `Пора по хозяйству: ${due.map(x => x.title.toLowerCase()).join(', ')}`, 'wrench', 'm_upkeep');
      }
      this.save();
    },
    ensureCleanTask(u, title, due, guest) {
      if (this.d.tasks.some(x => x.unitId === u.id && x.status !== 'done' && x.tpl !== 'delivery' && x.tpl !== 'food')) return;
      this.addTask({ title, unitId: u.id, place: u.short, tpl: u.kind === 'house' ? 'house_clean' : u.kind === 'sauna' ? 'sauna_prep' : 'gazebo_clean', due, guest }, true);
    },

    // --- Касса и общий счёт гостя ---
    addTx(x, silent) {
      const n = Object.assign({ id: this.id(), ts: Date.now(), cat: 'other', method: 'Наличные', bookingId: null }, x);
      if (this.curPay && n.type === 'in' && n.paid !== false) n.payId = this.curPay;   // номер онлайн-платежа: сервер сверит его с банком
      if (n.type === 'in' && n.paid !== false) n.receipt = n.id % 1000000;
      this.d.tx.unshift(n);
      if (!silent) this.save();
      return n;
    },
    updateTx(id, f) { const x = this.d.tx.find(t => t.id === id); if (x) { Object.assign(x, f); this.save(); } },
    deleteTx(id) { this.d.tx = this.d.tx.filter(t => t.id !== id); this.save(); },
    folio(stayId) { return this.d.tx.filter(x => x.folio === stayId && x.paid === false); },
    settleFolio(stayId, method) {
      this.folio(stayId).forEach(x => { x.paid = true; x.method = method; x.receipt = this.id() % 1000000; if (this.curPay) x.payId = this.curPay; });
      this.save();
    },

    // --- Задачи и фотоприёмка ---
    addTask(t, silent) {
      const tpl = CAT.standards[t.tpl] ? t.tpl : 'generic';
      const nt = Object.assign({ id: this.id(), status: 'todo', ts: Date.now(), note: '', guest: '' }, t, { tpl, steps: CAT.standards[tpl].steps.map(() => ({ done: false, photo: null })) });
      this.d.tasks.unshift(nt);
      this.notify('staff', `Новая задача: ${nt.title}, ${nt.place}`, 'check', 'tasks');
      if (!silent) this.save();
      return nt;
    },
    task(id) { return this.d.tasks.find(t => t.id === id); },
    deleteTask(id) { this.d.tasks = this.d.tasks.filter(t => t.id !== id); this.save(); },
    startTask(id) {
      const t = this.task(id); if (!t || t.status !== 'todo') return;
      t.status = 'doing';
      const u = t.unitId && this.unit(t.unitId);
      if (u && !['delivery', 'food', 'generic'].includes(t.tpl) && u.status !== 'ready') u.status = 'cleaning';
      this.save();
    },
    taskLeft(t) {
      const steps = CAT.standards[t.tpl].steps;
      let todo = 0, photos = 0;
      steps.forEach((s, i) => { if (s.photo && !t.steps[i].photo) photos++; if (!t.steps[i].done) todo++; });
      return { todo, photos, total: steps.length, done: steps.length - todo };
    },
    // Объект становится «Готов» только здесь — когда закрыты все шаги и приложены все контрольные фото
    completeTask(id, user) {
      const t = this.task(id), left = this.taskLeft(t);
      if (left.todo || left.photos) return { ok: false };
      const tpl = CAT.standards[t.tpl];
      const photos = tpl.steps.map((s, i) => s.photo ? { label: s.short || s.t, src: t.steps[i].photo } : null).filter(Boolean);
      t.status = 'done'; t.doneAt = Date.now(); t.by = user.login;
      t.steps.forEach(s => { if (s.photo) s.photo = true; }); // сами снимки храним один раз — в ленте приёмки
      const u = t.unitId && this.unit(t.unitId);
      if (u && !['delivery', 'food', 'generic'].includes(t.tpl)) {
        u.status = 'ready';
        this.d.accepts.unshift({ id: this.id(), unitId: u.id, taskId: t.id, by: user.name, byLogin: user.login, ts: Date.now(), state: 'ok', photos });
        // Снимки в памяти телефона (без общей базы) храним только для последних 14 приёмок. Ссылки на облако — навсегда
        this.d.accepts.slice(14).forEach(a => { a.photos = (a.photos || []).filter(p => !/^data:/.test(p.src || '')); });
        user.clean = (user.clean || 0) + 1;
        this.notify('admin', `${u.short} сдан: ${user.name} приложила фото, посмотрите`, 'camera', 'accept');
        // Расход со склада: бельё и полотенца на каждую уборку дома, веники и дрова на баню
        if (t.tpl === 'house_clean') { this.stockAdjust('linen', -Math.ceil(u.capacity / 2), true); this.stockAdjust('towel', -u.capacity * 2, true); this.stockAdjust('paper', -2, true); }
        if (t.tpl === 'sauna_prep') { this.stockAdjust('wood', -1, true); const b = this.d.bookings.find(x => x.id === t.bookingId); if (b) this.notify(b.login, 'Баня растоплена и ждёт вас', 'flame', 'g_home'); }
      }
      if (['delivery', 'food'].includes(t.tpl) && t.login) this.notify(t.login, `Заказ «${t.title}» доставлен`, 'bag', 'g_home');
      user.points = (user.points || 0) + tpl.points;
      this.save();
      return { ok: true, points: tpl.points };
    },
    returnWork(acceptId, reason) {
      const a = this.d.accepts.find(x => x.id === acceptId); if (!a) return;
      a.state = 'returned'; a.reason = reason;
      const u = this.unit(a.unitId);
      u.status = 'rework';
      const worker = this.user(a.byLogin);
      if (worker) { worker.points = Math.max(0, (worker.points || 0) - 5); worker.clean = Math.max(0, (worker.clean || 0) - 1); this.notify(worker.login, `${u.short} вернули на переделку: ${reason || 'есть замечания'}`, 'alert', 'tasks'); }
      this.addTask({ title: 'Переделать: ' + (reason || 'замечания управляющего'), unitId: u.id, place: u.short, tpl: u.kind === 'house' ? 'house_clean' : u.kind === 'sauna' ? 'sauna_prep' : 'gazebo_clean', due: 'как можно скорее', guest: 'Вернул управляющий', note: reason || '' }, true);
      this.save();
    },
    markDirty(unitId) {
      const u = this.unit(unitId); u.status = 'dirty';
      this.ensureCleanTask(u, 'Уборка', 'сегодня', '');
      this.save();
    },

    // --- Склад ---
    stockAdjust(id, delta, silent) {
      const s = this.d.stock.find(x => x.id === id); if (!s) return;
      const was = s.qty; s.qty = Math.max(0, Math.round((s.qty + delta) * 10) / 10);
      if (was > s.min && s.qty <= s.min) this.notify('admin', `На складе заканчивается: ${s.name.toLowerCase()}, осталось ${s.qty} ${s.unit}`, 'bag', 'm_stock');
      if (!silent) this.save();
    },

    // --- Квадроциклы ---
    addRide(r) {
      const nr = Object.assign({ id: this.id(), status: 'booked', signed: false, photos: {} }, r);
      const method = nr.method; delete nr.method;
      this.d.rides.push(nr);
      if (nr.amount > 0 && method !== 'Не оплачено')
        this.addTx(Object.assign({ type: 'in', amount: nr.amount, cat: 'quad', title: `Квадроцикл, ${nr.guest}`, method: method || 'Карта', bookingId: nr.id }, r.folio ? { folio: r.folio, paid: false } : {}), true);
      this.notify('instructor', `Новый выезд: ${nr.guest}, ${T.rel(nr.date)} в ${T.hm(nr.from)}`, 'route', 'rides');
      this.save();
      return nr;
    },
    ride(id) { return this.d.rides.find(r => r.id === id); },
    startRide(id) {
      const r = this.ride(id), q = this.quad(r.quadId);
      r.status = 'riding'; r.startedAt = Date.now(); q.status = 'tour';
      this.save();
    },
    finishRide(id, hours, defects) {
      const r = this.ride(id), q = this.quad(r.quadId);
      r.status = 'done'; r.endedAt = Date.now(); r.hours = hours;
      q.totalHours = Math.round((q.totalHours + hours) * 10) / 10;
      q.toService = Math.max(0, Math.round((q.toService - hours) * 10) / 10);
      q.status = q.toService <= 0 ? 'service' : 'park';
      if (defects) q.defects = defects;
      this.stockAdjust('fuel', -Math.round(hours * 4), true);
      this.d.rides.filter(x => x.status === 'done').slice(0, -4).forEach(x => { Object.keys(x.photos || {}).forEach(k => { if (/^data:/.test(x.photos[k])) delete x.photos[k]; }); });
      this.save();
      return q;
    },
    cancelRide(id) { this.d.rides = this.d.rides.filter(r => r.id !== id); this.d.tx = this.d.tx.filter(x => x.bookingId !== id); this.save(); },
    serviceDone(quadId, cost) {
      const q = this.quad(quadId);
      q.toService = q.interval; q.status = 'park'; q.defects = 'В норме'; q.lastService = Date.now();
      if (cost > 0) this.addTx({ type: 'out', amount: cost, cat: 'quad', title: `ТО, квадроцикл №${q.num}`, method: 'Карта' }, true);
      this.save();
    },
    updateQuad(id, f) { Object.assign(this.quad(id), f); this.save(); },
    setWeatherStop(on) {
      this.S.weatherStop = on;
      if (on) this.d.rides.filter(r => r.status === 'booked' && r.date === T.today()).forEach(r => this.notify(r.login, `Выезд на квадроциклах в ${T.hm(r.from)} отменён из-за погоды. Напишите нам, подберём другое время`, 'alert', 'g_chat'));
      this.save();
    },
    addFuel(quadId, liters, cost) {
      this.d.fuel.unshift({ id: this.id(), quadId, liters, cost, ts: Date.now() });
      if (cost > 0) this.addTx({ type: 'out', amount: cost, cat: 'quad', title: `Бензин ${liters} л, квадроцикл №${this.quad(quadId).num}`, method: 'Карта' }, true);
      this.save();
    },

    // --- Чат и настроение ---
    send(login, name, from, text) {
      this.d.messages.push({ id: this.id(), login, name, from, text, ts: Date.now(), read: false });
      if (from === 'guest') this.notify('admin', `${name}: ${text}`, 'chat', 'threads');
      else this.notify(login, `Ответ администратора: ${text}`, 'chat', 'g_chat');
      this.save();
    },
    markRead(login, from) {
      let ch = false;
      this.d.messages.forEach(m => { if (m.login === login && m.from === from && !m.read) { m.read = true; ch = true; } });
      if (ch) this.save();
    },
    addMood(user, mood, tags) {
      this.d.moods.unshift({ id: this.id(), login: user.login, name: user.name, date: T.today(), mood, tags });
      this.save();
    },

    // --- Отзывы: хорошие ведём на Яндекс Карты, плохие сразу управляющему ---
    addReview(user, stay, stars, tags, text) {
      const rv = { id: this.id(), login: user.login, name: user.name, bookingId: stay ? stay.id : null, unitId: stay ? stay.unitId : null, stars, tags, text, ts: Date.now(), routed: stars >= 4 ? 'yandex' : 'admin' };
      this.d.reviews.unshift(rv);
      if (stars >= 4 && tags.includes('Чистота') && stay) {
        const acc = this.d.accepts.find(a => a.unitId === stay.unitId);
        const w = acc && this.user(acc.byLogin);
        if (w) { w.points = (w.points || 0) + 5; this.notify(w.login, `Гость похвалил чистоту в ${this.unit(stay.unitId).short}: +5 баллов`, 'star', 'shift'); }
      }
      this.notify('admin', stars >= 4 ? `Новый отзыв ${stars} звёзд от ${user.name}` : `Недовольный гость, ${stars} из 5: ${text || 'без комментария'}`, stars >= 4 ? 'star' : 'alert', 'm_reviews');
      this.save();
      return rv;
    },

    // --- Заявки на ремонт, хозяйство, стройка ---
    addTicket(t) { const n = Object.assign({ id: this.id(), ts: Date.now(), status: 'new', prio: 'normal' }, t); this.d.tickets.unshift(n); this.notify('admin', `Заявка на ремонт: ${n.title}, ${n.place}`, 'wrench', 'm_tickets'); this.save(); return n; },
    setTicket(id, f) { Object.assign(this.d.tickets.find(x => x.id === id), f); this.save(); },
    upkeepDone(id) { this.d.upkeep.find(x => x.id === id).last = T.today(); this.save(); },

    // --- Гости: SOS, забытые вещи, лист ожидания, события, прокат ---
    addSos(user, kind, unitId) {
      const s = { id: this.id(), login: user.login, name: user.name, phone: user.phone, kind, unitId, ts: Date.now(), status: 'open' };
      this.d.sos.unshift(s);
      this.notify('admin', `SOS: ${kind}. ${user.name}${unitId ? ', ' + this.unit(unitId).short : ''}`, 'alert', 'today');
      this.notify('staff', `SOS от гостя: ${kind}`, 'alert', 'tasks'); this.notify('instructor', `SOS от гостя: ${kind}`, 'alert', 'rides');
      this.save(); return s;
    },
    resolveSos(id) { const s = this.d.sos.find(x => x.id === id); s.status = 'done'; this.notify(s.login, 'Администратор принял ваш сигнал и уже идёт к вам', 'check', 'g_home'); this.save(); },
    addLost(item) {
      const lastStay = this.d.bookings.filter(b => b.unitId === item.unitId && b.start && b.start <= T.today()).sort((a, b) => a.end < b.end ? 1 : -1)[0];
      const n = Object.assign({ id: this.id(), ts: Date.now(), status: 'stored', guestLogin: lastStay ? lastStay.login : '', guestName: lastStay ? lastStay.guest : '' }, item);
      this.d.lost.unshift(n);
      if (n.guestLogin) this.notify(n.guestLogin, `Вы забыли у нас: ${n.title}. Напишите в чат, как удобнее вернуть`, 'bag', 'g_chat');
      this.save(); return n;
    },
    addWait(w) { this.d.waitlist.unshift(Object.assign({ id: this.id(), ts: Date.now() }, w)); this.notify('admin', `Лист ожидания: ${w.name} ждёт ${this.unit(w.unitId).short} на ${T.dm(w.start)}`, 'calendar'); this.save(); },
    joinEvent(id, user, n) {
      const e = this.d.events.find(x => x.id === id), taken = e.going.reduce((a, g) => a + g.n, 0);
      if (taken + n > e.places) return { ok: false, msg: 'Мест не осталось' };
      e.going.push({ login: user.login, name: user.name, n });
      if (e.price) this.addTx({ type: 'in', amount: e.price * n, cat: 'extra', title: `${e.title}, ${user.name} ×${n}`, method: 'Карта' }, true);
      this.save(); return { ok: true };
    },
    addRental(r) {
      if (this.rentalLeft(r.itemId, r.date) < 1) return { ok: false, msg: 'На этот день всё разобрали' };
      const n = Object.assign({ id: this.id(), status: 'booked' }, r);
      const method = n.method; delete n.method;
      this.d.rentals.unshift(n);
      if (n.amount > 0) this.addTx(Object.assign({ type: 'in', amount: n.amount, cat: 'rent', title: `Прокат: ${CAT.rentals.find(x => x.id === n.itemId).name}, ${n.guest}`, method }, r.folio ? { folio: r.folio, paid: false } : {}), true);
      this.notify('staff', `Выдать прокат: ${CAT.rentals.find(x => x.id === n.itemId).name}, ${T.rel(n.date)} в ${T.hm(n.from)}`, 'bag', 'shift');
      this.save(); return { ok: true, rental: n };
    },

    // --- Сертификаты, абонементы, заявки ---
    buyCert(amount, buyer, to, login) { const c = { code: 'GIFT-' + code(4, Date.now()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(), amount, balance: amount, buyer, to, login: login || '', ts: Date.now() }; this.d.certs.unshift(c); this.addTx({ type: 'in', amount, cat: 'pass', title: `Сертификат ${c.code}, ${buyer}`, method: 'Карта' }, true); this.save(); return c; },
    cert(codeStr) { return this.d.certs.find(c => c.code === String(codeStr || '').trim().toUpperCase() && c.balance > 0); },
    useCert(codeStr, amount) { const c = this.cert(codeStr); if (!c) return 0; const take = Math.min(c.balance, amount); c.balance -= take; this.save(); return take; },
    buyPass(productId, user) {
      const p = CAT.passes.find(x => x.id === productId);
      const n = { id: this.id(), productId, code: 'PASS-' + code(4, Date.now()), login: user.login, name: user.name, phone: user.phone, left: p.visits, total: p.visits, ts: Date.now() };
      this.d.passes.unshift(n); this.addTx({ type: 'in', amount: p.price, cat: 'pass', title: `${p.name}, ${user.name}`, method: 'Карта' }, true); this.save(); return n;
    },
    addLead(l) { const n = Object.assign({ id: this.id(), ts: Date.now(), status: 'new' }, l); this.d.leads.unshift(n); this.notify('admin', `Заявка: ${n.text}`, 'users', 'm_leads'); this.save(); return n; },
    addIncident(x) {
      const n = Object.assign({ id: this.id(), ts: Date.now(), status: 'billed' }, x); this.d.incidents.unshift(n);
      const b = this.d.bookings.find(y => y.id === x.bookingId);
      this.addTx({ type: 'in', amount: x.amount, cat: 'other', title: `Возмещение ущерба: ${x.text}`, method: 'В счёт проживания', folio: x.bookingId, paid: false }, true);
      if (b) this.notify(b.login, `Выставлен счёт за ущерб: ${x.text}. Подробности у администратора`, 'alert', 'g_home');
      this.save(); return n;
    },

    // --- Персонал: обучение, смены ---
    passCourse(login, score) { const u = this.user(login); u.course = { score, ts: Date.now() }; if (score >= CAT.course.pass) { u.trained = true; this.notify('admin', `${u.name} прошёл обучение: ${score} из ${CAT.course.quiz.length}`, 'check', 'm_team'); } this.save(); },
    checkIn(login) { this.d.checkins.unshift({ login, date: T.today(), in: Date.now(), out: null }); this.save(); },
    checkOut(login) { const c = this.d.checkins.find(x => x.login === login && x.date === T.today() && !x.out); if (c) { c.out = Date.now(); this.save(); } },
    onShift(login) { return this.d.checkins.find(x => x.login === login && x.date === T.today() && !x.out); },

    // --- CRM: гости собираются из броней, заметки хранятся отдельно ---
    guests() {
      const map = {};
      this.d.bookings.filter(b => b.phone && b.login !== 'walkin').forEach(b => {
        const k = '+' + this.digits(b.phone);
        const g = map[k] = map[k] || { key: k, name: b.guest, phone: b.phone, stays: 0, nights: 0, spend: 0, last: '', logins: new Set() };
        g.logins.add(b.login);
        if (b.start) { g.stays++; g.nights += T.nights(b.start, b.end); if (b.start > g.last) { g.last = b.start; g.name = b.guest; } }
        g.spend += b.amount || 0;
      });
      return Object.values(map).map(g => Object.assign(g, this.d.crm[g.key.replace('+', '+')] || {}, { logins: [...g.logins] })).sort((a, b) => b.spend - a.spend);
    },
    crmSet(key, f) { this.d.crm[key] = Object.assign(this.d.crm[key] || {}, f); this.save(); },

    prefGet(k) { return store.get('mu_pref_' + k); },
    prefSet(k, v) { store.set('mu_pref_' + k, v); }
  };

  window.DB = DB;
  window.T = T;
})();
