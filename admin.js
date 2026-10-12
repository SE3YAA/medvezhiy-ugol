// admin.js — кабинет управляющего: пульт, шахматка, приёмка, касса и модули базы.
// Общие помощники (S, DB, T, CAT, sheet, field, ic …) объявлены в app.js.
// =====================================================================
//  4. Управляющий
// =====================================================================
V.today = () => {
  const d = DB.d, t = T.today();
  const houses = d.units.filter(u => u.kind === 'house');
  const occ = houses.filter(h => d.bookings.some(b => b.unitId === h.id && b.start && b.start <= t && t < b.end)).length;
  const ins = d.bookings.filter(b => b.start === t), outs = d.bookings.filter(b => b.start && b.end === t);
  const day = d.tx.filter(x => T.iso(new Date(x.ts)) === t);
  const inc = day.filter(x => x.type === 'in'), total = sum(inc);
  const cats = Object.keys(CAT.cats).map(k => [k, sum(inc.filter(x => x.cat === k))]).filter(c => c[1] > 0);
  const cash = sum(inc.filter(x => x.method === 'Наличные')), out = sum(day.filter(x => x.type === 'out'));

  // Что требует внимания прямо сейчас
  const att = [];
  ins.forEach(b => { const u = DB.unit(b.unitId); if (u.status !== 'ready') att.push(['alert', `${u.short}: заезд сегодня, дом не готов`, `${b.guest}, с ${CAT.checkIn}`, "go('accept')"]); });
  d.units.filter(u => u.status === 'rework').forEach(u => att.push(['camera', `${u.short}: возвращён на переделку`, 'Ждём новые фото', "go('accept')"]));
  d.quads.forEach(q => {
    if (q.toService <= 0) att.push(['wrench', `Квадроцикл №${q.num} стоит на ТО`, q.defects, "go('m_quads')"]);
    else if (q.toService <= 5) att.push(['wrench', `Квадроцикл №${q.num}: до ТО ${plural(Math.round(q.toService), 'моточас', 'моточаса', 'моточасов')}`, 'Замена масла и шприцевание подвески', "go('m_quads')"]);
  });
  d.stock.filter(x => x.qty <= x.min).length && att.push(['box', `На складе заканчивается: ${d.stock.filter(x => x.qty <= x.min).length} позиции`, d.stock.filter(x => x.qty <= x.min).map(x => x.name).join(', '), "go('m_stock')"]);
  d.upkeep.filter(x => T.addDays(x.last, x.every) <= t).forEach(x => att.push(['shield', `Просрочено: ${x.title.toLowerCase()}`, x.place, "go('m_upkeep')"]));
  d.tickets.filter(x => x.status === 'new').forEach(x => att.push(['wrench', `Ремонт: ${x.title}`, `${x.place}, ${x.by}`, "go('m_tickets')"]));
  d.rides.filter(r => r.alarm && r.status === 'riding').forEach(r => att.push(['alert', `Квадроцикл №${DB.quad(r.quadId).num} не вернулся вовремя`, r.guest, "go('m_quads')"]));
  d.leads.filter(l => l.status === 'new').forEach(l => att.push(['users', `Заявка: ${l.text}`, l.name, "go('m_leads')"]));
  d.reviews.filter(r => r.routed === 'admin' && r.ts > Date.now() - 3 * 864e5).forEach(r => att.push(['star', `Недоволен гость, ${r.stars} из 5`, r.text || r.name, "go('m_reviews')"]));
  const unread = d.messages.filter(m => m.from === 'guest' && !m.read);
  if (unread.length) att.push(['chat', `${plural(unread.length, 'новое сообщение', 'новых сообщения', 'новых сообщений')} от гостей`, unread[unread.length - 1].text, 'threads()']);

  // Выручка за неделю
  const week = []; let max = 1;
  for (let i = 6; i >= 0; i--) { const ds = T.addDays(t, -i), v = sum(d.tx.filter(x => x.type === 'in' && T.iso(new Date(x.ts)) === ds)); week.push([ds, v]); max = Math.max(max, v); }

  const tasks = d.tasks.filter(x => x.status !== 'done');
  const TS = { todo: ['warn', 'Ждёт'], doing: ['plain', 'В работе'], done: ['ok', 'Сделано'] };

  return head(T.long(t), 'Сегодня', `<button class="iconbtn" aria-label="Сводка на утро" onclick="morningSheet()">${ic('send', 'sm')}</button>`) + sosBlock() + `
  <section class="hero wide"><div class="hero-img">${scene('base', 3)}</div><div class="hero-in">
    <div class="hero-row"><span class="glass">Заезды <b>${ins.length}</b></span><span class="glass">Выезды <b>${outs.length}</b></span></div>
    <div><h2>Занято ${occ} из ${houses.length} домов</h2><p>${d.bookings.filter(b => b.date === t).length ? plural(d.bookings.filter(b => b.date === t).length, 'почасовая бронь', 'почасовые брони', 'почасовых броней') + ' на беседки и баню' : 'Беседки и баня сегодня свободны'}</p></div>
  </div></section>

  <section class="card">
    <div class="card-h"><span class="muted">Выручка за день</span><button class="link" onclick="go('cash')">Касса</button></div>
    <div class="num big">${money(total)}</div>
    ${cats.length ? `<div class="split">${cats.map(([k, v]) => `<i style="flex:${v};background:var(${CATC[k]})"></i>`).join('')}</div>
    <div class="legend">${cats.map(([k, v]) => `<div><i style="background:var(${CATC[k]})"></i><span>${CAT.cats[k]}</span><b>${money(v)}</b></div>`).join('')}</div>` : '<p class="muted">Сегодня платежей ещё не было.</p>'}
    <div class="stats"><div class="stat"><b>${money(cash)}</b><span>наличные</span></div><div class="stat"><b>${money(total - cash)}</b><span>безнал</span></div><div class="stat"><b>${money(out)}</b><span>расходы</span></div></div>
  </section>

  <section class="card flat"><div class="list">${att.length ? att.map(([i, a, b, fn]) => `<button class="li" onclick="${fn}"><span class="li-ic hot">${ic(i)}</span><span class="li-main"><span class="li-t">${esc(a)}</span><br><span class="li-s">${esc(b)}</span></span>${ic('right', 'sm')}</button>`).join('')
      : `<div class="li"><span class="li-ic">${ic('check')}</span><span class="li-main"><span class="li-t">Всё спокойно</span><br><span class="li-s">Нет объектов и техники, которые требуют внимания</span></span></div>`}</div></section>

  <section class="card">
    <div class="card-h"><span class="h2">Неделя</span><span class="muted small">выручка, тыс. ₽</span></div>
    <div class="week">${week.map(([ds, v]) => `<div class="${ds === t ? 'now' : ''}"><b>${v ? Math.round(v / 1000) : ''}</b><i style="height:${Math.round(v / max * 84)}px"></i>${T.DOW[T.parse(ds).getDay()]}</div>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-h"><span class="h2">Задачи персонала</span><button class="btn sm" onclick="taskSheet()">${ic('plus', 'sm')} Задача</button></div>
    <div class="list">${tasks.length ? tasks.map(x => `<div class="li"><span class="li-main"><span class="li-t">${esc(x.title)}</span><br><span class="li-s">${esc(x.place)}, ${esc(x.due)}</span></span><span class="li-end"><span class="chip ${TS[x.status][0]}">${TS[x.status][1]}</span><button class="iconbtn" aria-label="Удалить задачу" onclick="delTask(${x.id})">${ic('trash', 'sm')}</button></span></div>`).join('') : '<p class="empty">Все задачи закрыты.</p>'}</div>
  </section>`;
};

function taskSheet() {
  const presets = [['house_clean', 'Уборка дома'], ['sauna_prep', 'Подготовка бани'], ['gazebo_clean', 'Уборка беседки'], ['delivery', 'Доставка заказа'], ['generic', 'Другое поручение']];
  sheet(sheetHead('Новая задача', 'Сотрудник увидит её сразу, вместе с чек-листом') + `<div class="form">
    ${field('Что сделать', `<select id="t-tpl" class="inp" onchange="document.getElementById('t-title').value=this.value==='generic'?'':this.options[this.selectedIndex].text">${options(presets)}</select>`)}
    ${field('Название', `<input id="t-title" class="inp" value="Уборка дома">`)}
    ${field('Где', `<select id="t-unit" class="inp">${options(DB.d.units.map(u => [u.id, u.short]).concat([['', 'Территория базы']]))}</select>`)}
    ${field('Срок', `<input id="t-due" class="inp" value="до 14:00">`)}
    ${field('Комментарий', `<input id="t-note" class="inp" placeholder="Необязательно">`)}
    <button class="btn block" onclick="saveTask()">Поставить задачу</button></div>`);
}
function saveTask() {
  const title = val('t-title'), unitId = val('t-unit'); if (!title) return toast('Напишите, что нужно сделать');
  const u = unitId && DB.unit(unitId);
  DB.addTask({ title, unitId: unitId || null, place: u ? u.short : 'Территория базы', tpl: val('t-tpl'), due: val('t-due') || 'сегодня', note: val('t-note'), guest: 'Поручил управляющий' });
  closeSheet(); render(); toast('Задача поставлена');
}
function delTask(id) { ask('Удалить задачу?', 'Сотрудник перестанет её видеть.', 'Удалить', () => { DB.deleteTask(id); render(); }, true); }

// --- Шахматка ---
V.chess = () => head('Дома по суткам, беседки и баня по часам', 'Шахматка', `<button class="btn sm" onclick="${S.chess === 'day' ? 'staySheet()' : 'hourSheet()'}">${ic('plus', 'sm')} Бронь</button>`) + `
  <div class="seg"><button class="${S.chess === 'day' ? 'on' : ''}" onclick="S.chess='day';render()">По суткам</button><button class="${S.chess === 'hour' ? 'on' : ''}" onclick="S.chess='hour';render()">По часам</button></div>
  ${S.chess === 'day' ? chessDay() : chessHour()}`;

function shiftMonth(n) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); render(); }
function shiftDay(n) { S.hourDate = T.addDays(S.hourDate, n); render(); }

function chessDay() {
  const d = DB.d, y = S.month.getFullYear(), m = S.month.getMonth(), n = new Date(y, m + 1, 0).getDate(), t = T.today();
  const after = T.iso(new Date(y, m + 1, 1));
  let h = '<table class="chess"><thead><tr><th class="cu">Дом</th>';
  for (let i = 1; i <= n; i++) { const dt = new Date(y, m, i), ds = T.iso(dt), we = dt.getDay() % 6 === 0; h += `<th class="${we ? 'we' : ''} ${ds === t ? 'tdy' : ''}"><b>${i}</b><i>${T.DOW[dt.getDay()]}</i></th>`; }
  h += '</tr></thead><tbody>';
  d.units.filter(u => u.mode === 'day').forEach(u => {
    h += `<tr><th class="cu">${esc(u.short)}</th>`;
    let i = 1;
    while (i <= n) {
      const ds = T.iso(new Date(y, m, i));
      const b = d.bookings.find(x => x.unitId === u.id && x.start && x.start <= ds && ds < x.end);
      if (b) {
        const last = b.end < after ? T.parse(b.end).getDate() - 1 : n, span = Math.max(1, last - i + 1);
        h += `<td colspan="${span}"><button class="bk ${srcClass(b.source)}" onclick="bookingSheet(${b.id})">${esc(b.guest)}</button></td>`; i += span;
      } else { h += `<td class="${ds === t ? 'tdy' : ''}"><button class="free" aria-label="Свободно, ${i}" onclick="staySheet('${u.id}','${ds}')"></button></td>`; i++; }
    }
    h += '</tr>';
  });
  h += '</tbody></table>';
  const next = d.bookings.filter(b => b.start && !b.closed && b.end >= t).sort((a, b) => a.start < b.start ? -1 : 1).slice(0, 6);
  return `<section class="card">
    <div class="card-h"><div class="nav"><button class="iconbtn" aria-label="Предыдущий месяц" onclick="shiftMonth(-1)">${ic('left', 'sm')}</button><b>${T.MONTHS[m]} ${y}</b><button class="iconbtn" aria-label="Следующий месяц" onclick="shiftMonth(1)">${ic('right', 'sm')}</button></div></div>
    <div class="keys"><span><i style="background:var(--c1)"></i>Прямая</span><span><i style="background:var(--c3)"></i>Яндекс</span><span><i style="background:var(--c4)"></i>Авито</span><span><i style="background:var(--c5)"></i>Сайт</span></div>
    <div class="scroller" id="chess-scroll">${h}</div></section>
  <div class="sec"><span class="h2">Заезды и проживающие</span></div>
  <section class="card flat"><div class="list">${next.length ? next.map(b => { const u = DB.unit(b.unitId); return `<button class="li" onclick="bookingSheet(${b.id})"><span class="thumb">${unitScene(u)}</span><span class="li-main"><span class="li-t">${esc(b.guest)}</span><br><span class="li-s">${esc(u.short)}, ${T.dm(b.start)} – ${T.dm(b.end)}, ${plural(b.guests || 2, 'гость', 'гостя', 'гостей')}</span></span><span class="li-end"><b>${b.start <= t ? 'живут' : T.rel(b.start)}</b></span></button>`; }).join('') : '<p class="empty">Броней пока нет. Нажмите на свободную клетку в шахматке.</p>'}</div></section>`;
}

const H0 = 8, H1 = 24, PX = 54;
function chessHour() {
  const d = DB.d, date = S.hourDate, isToday = date === T.today();
  const left = min => (min - H0 * 60) / 60 * PX;
  let rows = '';
  d.units.filter(u => u.mode === 'hour').forEach(u => {
    const bs = d.bookings.filter(b => b.unitId === u.id && b.date === date);
    rows += `<div><span class="tl-name">${esc(u.short)} <small>${money(u.price)} в час${u.buffer ? `, перерыв ${u.buffer} мин` : ''}</small></span></div>
      <div class="tl-track" style="width:${(H1 - H0) * PX}px;background-image:repeating-linear-gradient(90deg,var(--line) 0 1px,transparent 1px ${PX}px)" onclick="tlClick(event,'${u.id}')">
      ${bs.map(b => `<button class="hb" style="left:${left(b.from)}px;width:${left(b.to) - left(b.from) - 2}px" onclick="event.stopPropagation();bookingSheet(${b.id})">${esc(b.guest)}<small>${T.hm(b.from)}–${T.hm(b.to)}</small></button>${u.buffer ? `<span class="buf" style="left:${left(b.to)}px;width:${u.buffer / 60 * PX - 2}px">уборка и растопка</span>` : ''}`).join('')}</div>`;
  });
  let hours = '';
  for (let i = H0; i < H1; i++) hours += `<span style="width:${PX}px">${T.pad(i)}:00</span>`;
  const now = T.nowMin();
  return `<section class="card">
    <div class="card-h"><div class="nav"><button class="iconbtn" aria-label="Предыдущий день" onclick="shiftDay(-1)">${ic('left', 'sm')}</button><b>${T.long(date)}</b><button class="iconbtn" aria-label="Следующий день" onclick="shiftDay(1)">${ic('right', 'sm')}</button></div></div>
    <p class="small muted">Нажмите на свободное время, чтобы создать бронь. После бани 90 минут закрыты автоматически: на уборку и растопку.</p>
    <div class="scroller" id="tl-scroll"><div class="tl-in" style="width:${(H1 - H0) * PX + 36}px"><div class="tl-hours">${hours}</div>${rows}${isToday && now > H0 * 60 ? `<i class="tl-now" style="left:${18 + left(now)}px"></i>` : ''}</div></div>
  </section>`;
}
function tlClick(e, unitId) {
  const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
  hourSheet(unitId, S.hourDate, (H0 + Math.floor(x / PX)) * 60);
}

const METHODS = ['Карта', 'Наличные', 'Перевод', 'Не оплачено'];
function staySheet(unitId, date) {
  const houses = DB.d.units.filter(u => u.mode === 'day'), start = date || T.today();
  sheet(sheetHead('Новая бронь', 'Проживание по суткам') + `<div class="form">
    ${field('Дом', `<select id="b-unit" class="inp" onchange="calcStay()">${options(houses.map(u => [u.id, `${u.short}, ${money(u.price)} за ночь`]), unitId)}</select>`)}
    ${field('Гость', `<input id="b-guest" class="inp" placeholder="Имя и фамилия" autocomplete="off">`)}
    <div class="row2">${field('Телефон', `<input id="b-phone" class="inp" type="tel" placeholder="+7">`)}${field('Гостей', `<input id="b-count" class="inp" type="number" min="1" value="2">`)}</div>
    <div class="row2">${field('Заезд', `<input id="b-start" class="inp" type="date" value="${start}" onchange="calcStay()">`)}${field('Выезд', `<input id="b-end" class="inp" type="date" value="${T.addDays(start, 2)}" onchange="calcStay()">`)}</div>
    <div class="row2">${field('Откуда бронь', `<select id="b-src" class="inp">${options(['Прямая', 'Яндекс Путешествия', 'Авито', 'Островок', 'Сайт'])}</select>`)}${field('Оплата', `<select id="b-method" class="inp">${options(METHODS)}</select>`)}</div>
    <div class="row2">${field('Промокод', `<input id="b-promo" class="inp" placeholder="Если есть" onchange="calcStay()">`)}${field('Сумма без налога, ₽', `<input id="b-amount" class="inp" type="number" min="0" oninput="calcStay(true)">`)}</div>
    <p class="small muted" id="b-hint"></p>
    <button class="btn block" onclick="saveStay()">Создать бронь</button></div>`);
  calcStay();
}
function calcStay(manual) {
  const u = DB.unit(val('b-unit')), s = val('b-start'), e = val('b-end'); if (!u || !s || !e) return;
  const q = DB.quote(u.id, s, e, val('b-promo'));
  if (!manual) $('#b-amount').value = q.nights.length ? q.base - q.discount : '';
  const base = Number(val('b-amount')) || 0, tax = Math.round(base * DB.S.taxRate / 100);
  const tags = [...new Set(q.nights.map(x => x.tag).filter(Boolean))];
  $('#b-hint').textContent = !q.ok ? q.msg : `${plural(q.nights.length, 'ночь', 'ночи', 'ночей')}${tags.length ? ' (' + tags.join(', ') + ')' : ''}${q.promo ? `, ${q.promo.label} −${q.promo.pct}%` : ''}. Туристический налог ${DB.S.taxRate}%: ${money(tax)}, итого ${money(base + tax)}.`;
}
function saveStay() {
  const guest = val('b-guest'); if (!guest) return toast('Укажите имя гостя');
  const r = DB.addStay({ unitId: val('b-unit'), guest, login: 'direct', phone: val('b-phone'), guests: Number(val('b-count')) || 2, start: val('b-start'), end: val('b-end'), source: val('b-src'), amount: Number(val('b-amount')) || 0, promo: val('b-promo'), method: val('b-method') });
  if (!r.ok) return toast(r.msg);
  closeSheet(); render(); toast('Бронь создана');
}

function hourSheet(unitId, date, from) {
  const units = DB.d.units.filter(u => u.mode === 'hour');
  const u = DB.unit(unitId) || units[0];
  const starts = []; for (let i = H0; i < H1; i++) starts.push([i * 60, `${T.pad(i)}:00`]);
  sheet(sheetHead('Бронь по часам', 'Беседка или баня') + `<div class="form">
    ${field('Объект', `<select id="hb-unit" class="inp" onchange="calcHour()">${options(units.map(x => [x.id, `${x.short}, ${money(x.price)} в час`]), u.id)}</select>`)}
    ${field('День', `<input id="hb-date" class="inp" type="date" value="${date || S.hourDate}" onchange="calcHour()">`)}
    <div class="row2">${field('Начало', `<select id="hb-from" class="inp" onchange="calcHour()">${options(starts, from || 12 * 60)}</select>`)}${field('Часов', `<select id="hb-dur" class="inp" onchange="calcHour()">${options([1, 2, 3, 4, 5, 6, 8], u.minHours || 2)}</select>`)}</div>
    ${field('Гость', `<input id="hb-guest" class="inp" placeholder="Имя или компания" autocomplete="off">`)}
    <div class="row2">${field('Телефон', `<input id="hb-phone" class="inp" type="tel" placeholder="+7">`)}${field('Оплата', `<select id="hb-method" class="inp">${options(METHODS)}</select>`)}</div>
    ${field('Сумма, ₽', `<input id="hb-amount" class="inp" type="number" min="0">`)}
    <p class="small muted" id="hb-hint"></p>
    <button class="btn block" onclick="saveHour()">Создать бронь</button></div>`);
  calcHour();
}
function calcHour() {
  const u = DB.unit(val('hb-unit')), from = Number(val('hb-from')), dur = Number(val('hb-dur')), date = val('hb-date'); if (!u) return;
  $('#hb-amount').value = dur * u.price;
  const free = DB.hourFree(u.id, date, from, from + dur * 60);
  $('#hb-hint').textContent = free ? `${T.hm(from)}–${T.hm(from + dur * 60)} свободно.${u.buffer ? ` Затем ${u.buffer} минут на уборку и растопку.` : ''}` : u.buffer ? 'Время занято: учитываем 90 минут перерыва после каждой компании.' : 'Это время уже занято.';
}
function saveHour() {
  const guest = val('hb-guest'); if (!guest) return toast('Укажите, на кого бронь');
  const from = Number(val('hb-from')), dur = Number(val('hb-dur'));
  const r = DB.addHour({ unitId: val('hb-unit'), date: val('hb-date'), from, to: from + dur * 60, guest, login: 'direct', phone: val('hb-phone'), source: 'Прямая', amount: Number(val('hb-amount')) || 0, method: val('hb-method') });
  if (!r.ok) return toast(r.msg);
  S.hourDate = val('hb-date'); closeSheet(); render(); toast('Бронь создана');
}
function bookingSheet(id) {
  const b = DB.d.bookings.find(x => x.id === id); if (!b) return;
  const u = DB.unit(b.unitId);
  const when = b.start ? `${T.dm(b.start)} – ${T.dm(b.end)}, ${plural(T.nights(b.start, b.end), 'ночь', 'ночи', 'ночей')}` : `${T.rel(b.date)}, ${T.hm(b.from)}–${T.hm(b.to)}`;
  const rows = [['Объект', u.name], ['Когда', when], b.guests ? ['Гостей', b.guests] : null, ['Откуда', b.source || 'Прямая'], ['Сумма', money(b.amount)], b.tax ? ['В том числе налог', money(b.tax)] : null, b.start ? ['Код на дверь', DB.doorCode(b)] : null,
    b.start ? ['Онлайн-регистрация', b.checkin ? `пройдена, приедет к ${b.checkin.arrive}${b.checkin.car ? ', авто ' + b.checkin.car : ''}` : 'не пройдена'] : null, b.early ? ['Ранний заезд', 'с 10:00'] : null, b.late ? ['Поздний выезд', 'до 16:00'] : null,
    b.group && b.group.members.length > 1 ? ['В компании', plural(b.group.members.length, 'человек', 'человека', 'человек')] : null].filter(Boolean);
  const folio = b.start ? DB.folio(b.id) : [];
  sheet(sheetHead(esc(b.guest), `Бронь №${b.id}`) + `
    <div class="card flat"><div class="list">${rows.map(([k, v]) => `<div class="li"><span class="li-main li-s">${k}</span><b>${esc(v)}</b></div>`).join('')}
    ${b.phone ? `<div class="li"><span class="li-main li-s">Телефон</span><a class="link" href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">${esc(b.phone)}</a></div>` : ''}</div></div>
    ${folio.length ? `<button class="btn block" onclick="settleSheet(${b.id})">Общий счёт: ${money(sum(folio))}, принять оплату</button>` : ''}
    ${b.start ? `<div class="btns"><button class="btn ghost" onclick="toast('Новый код: '+DB.resetCode(${b.id}));bookingSheet(${b.id})">${ic('key', 'sm')} Сменить код</button><button class="btn ghost" onclick="incidentSheet(${b.id})">Ущерб</button></div>` : ''}
    <button class="btn block danger" onclick="cancelBooking(${b.id})">Отменить бронь</button>`);
}
function cancelBooking(id) {
  ask('Отменить бронь?', 'Вместе с ней удалятся платёж в кассе и незакрытые задачи по этой брони.', 'Отменить бронь', () => { DB.cancelBooking(id); closeSheet(); render(); toast('Бронь отменена'); }, true);
}

// --- Фотоприёмка ---
V.accept = () => {
  const d = DB.d, t = T.today(), order = { rework: 0, dirty: 1, cleaning: 2, ready: 3 };
  const units = [...d.units].sort((a, b) => order[a.status] - order[b.status]);
  const ready = d.units.filter(u => u.status === 'ready').length;
  return head(`Готово ${ready} из ${d.units.length} объектов`, 'Приёмка') + `
  <p class="muted small" style="padding:0 4px">Объект становится готовым, только когда сотрудник закрыл чек-лист и приложил контрольные фото.</p>` +
  units.map(u => {
    const a = d.accepts.find(x => x.unitId === u.id);
    const now = d.bookings.find(b => b.unitId === u.id && b.start && b.start < t && t < b.end);
    const nb = d.bookings.filter(b => b.unitId === u.id && ((b.start && b.start >= t) || b.date === t)).sort((x, y) => (x.start || x.date) < (y.start || y.date) ? -1 : 1)[0];
    const next = now ? `Сейчас живут: ${now.guest}, до ${T.dm(now.end)}` : !nb ? 'Ближайших гостей нет' : nb.start ? `Заезд ${T.rel(nb.start)}, ${nb.guest}` : `Сегодня с ${T.hm(nb.from)}, ${nb.guest}`;
    return `<section class="card">
      <div class="li" style="padding:0"><span class="thumb">${unitScene(u)}</span><span class="li-main"><span class="li-t">${esc(u.name)}</span><br><span class="li-s">${esc(next)}</span></span></div>
      <div class="card-h">${statusChip(u)}${a ? `<span class="small muted">${esc(a.by)}, ${T.stamp(a.ts)}</span>` : ''}</div>
      ${a && a.photos.length ? `<div class="photos">${a.photos.map((p, i) => `<button class="thumb sq" onclick="viewAccept(${a.id},${i})" aria-label="${esc(p.label)}">${shotHTML(p)}<span class="tag">${esc(p.label)}${p.demo ? ', пример' : ''}</span></button>`).join('')}</div>` : '<p class="small muted">Контрольных фото пока нет.</p>'}
      ${a && a.state === 'returned' ? `<p class="small" style="color:var(--bad)">Возвращено: ${esc(a.reason || 'есть замечания')}</p>` : ''}
      ${a && a.state === 'ok' && u.status === 'ready' ? `<button class="btn sm ghost" onclick="returnSheet(${a.id})">Вернуть на переделку</button>` : ''}
    </section>`;
  }).join('');
};
function viewAccept(id, i) { const a = DB.d.accepts.find(x => x.id === id), p = a.photos[i]; viewer(shotHTML(p), `${DB.unit(a.unitId).short}, ${p.label}. ${a.by}, ${T.stamp(a.ts)}`); }
function returnSheet(id) {
  const a = DB.d.accepts.find(x => x.id === id), u = DB.unit(a.unitId);
  sheet(sheetHead('Вернуть на переделку', esc(u.name)) + `<div class="form">
    <div class="opts">${['Постель', 'Санузел', 'Пол', 'Кухня', 'Запах', 'Терраса'].map(r => `<button class="opt" onclick="document.getElementById('rw').value=this.textContent">${r}</button>`).join('')}</div>
    ${field('Что не так', `<input id="rw" class="inp" placeholder="Например: разводы на зеркале">`)}
    <p class="small muted">Объект снова станет недоступен для заселения, у сотрудника появится задача, а с его счёта спишется 5 баллов.</p>
    <button class="btn block" onclick="DB.returnWork(${id},val('rw'));closeSheet();render();toast('Объект возвращён на переделку')">Вернуть</button></div>`);
}

// --- Касса ---
V.cash = () => {
  const list = DB.d.tx.filter(x => S.cash === 'all' || x.type === S.cash).sort((a, b) => b.ts - a.ts);
  const groups = [];
  list.forEach(x => { const ds = T.iso(new Date(x.ts)); let g = groups[groups.length - 1]; if (!g || g[0] !== ds) groups.push(g = [ds, []]); g[1].push(x); });
  return head('Все поступления и расходы', 'Касса', `<button class="btn sm" onclick="txSheet()">${ic('plus', 'sm')} Операция</button>`) + `
  <div class="seg">${[['all', 'Все'], ['in', 'Приход'], ['out', 'Расход']].map(([k, l]) => `<button class="${S.cash === k ? 'on' : ''}" onclick="S.cash='${k}';render()">${l}</button>`).join('')}</div>` +
  (groups.length ? groups.map(([ds, xs]) => `<div class="sec"><span class="h2">${T.rel(ds)[0].toUpperCase() + T.rel(ds).slice(1)}</span><span class="muted small">${money(sum(xs.filter(x => x.type === 'in')) - sum(xs.filter(x => x.type === 'out')))}</span></div>
    <section class="card flat"><div class="list">${xs.map(x => `<button class="li" onclick="txSheet(${x.id})"><span class="li-main"><span class="li-t">${esc(x.title)}</span><br><span class="li-s">${CAT.cats[x.cat] || 'Прочее'}, ${x.method.toLowerCase()}</span></span><b style="white-space:nowrap;${x.type === 'out' ? 'color:var(--bad)' : ''}">${x.type === 'in' ? '+' : '−'}${money(x.amount)}</b></button>`).join('')}</div></section>`).join('') : '<p class="empty">Операций пока нет.</p>');
};
function txSheet(id) {
  const x = id ? DB.d.tx.find(t => t.id === id) : { type: 'in', cat: 'stay', method: 'Наличные', title: '', amount: '' };
  sheet(sheetHead(id ? 'Операция' : 'Новая операция', id ? T.stamp(x.ts) : '') + `<div class="form">
    ${field('Назначение', `<input id="x-title" class="inp" value="${esc(x.title)}" placeholder="От кого или за что">`)}
    <div class="row2">${field('Сумма, ₽', `<input id="x-amount" class="inp" type="number" min="0" value="${x.amount}">`)}${field('Тип', `<select id="x-type" class="inp">${options([['in', 'Приход'], ['out', 'Расход']], x.type)}</select>`)}</div>
    <div class="row2">${field('Категория', `<select id="x-cat" class="inp">${options(Object.entries(CAT.cats), x.cat)}</select>`)}${field('Способ', `<select id="x-method" class="inp">${options(['Наличные', 'Карта', 'Перевод'], x.method)}</select>`)}</div>
    <button class="btn block" onclick="saveTx(${id || 0})">${id ? 'Сохранить' : 'Провести'}</button>
    ${id && x.type === 'in' ? `<button class="btn block ghost" onclick="receiptSheet(${id})">${ic('ticket', 'sm')} Кассовый чек</button>` : ''}
    ${id ? `<button class="btn block danger" onclick="delTx(${id})">Удалить операцию</button>` : ''}</div>`);
}
function saveTx(id) {
  const f = { title: val('x-title'), amount: Number(val('x-amount')), type: val('x-type'), cat: val('x-cat'), method: val('x-method') };
  if (!f.title || !(f.amount > 0)) return toast('Укажите назначение и сумму');
  if (id) DB.updateTx(id, f); else DB.addTx(f);
  closeSheet(); render(); toast(id ? 'Сохранено' : 'Операция проведена');
}
function delTx(id) { ask('Удалить операцию?', '', 'Удалить', () => { DB.deleteTx(id); closeSheet(); render(); }, true); }

// --- База: техника, продажи, QR, стандарты, команда ---
const MOODS = ['😣', '😕', '😐', '🙂', '😄'];
const QST = { park: ['ok', 'В парке'], tour: ['warn', 'На маршруте'], service: ['bad', 'На ТО'] };
const quadRow = q => `<button class="li" onclick="quadSheet(${q.id})"><span class="li-ic">${ic('quad')}</span><span class="li-main"><span class="li-t">№${q.num}, ${esc(q.name)}</span><br><span class="li-s">${q.totalHours} м/ч, до ТО ${q.toService} м/ч</span></span><span class="chip ${QST[q.status][0]}">${QST[q.status][1]}</span></button>`;

function quickSale(gid) {
  const g = CAT.goods.find(x => x.id === gid);
  ask(`${g.name}, ${money(g.price)}`, 'Продажа попадёт в кассу как наличные.', 'Продать', () => { DB.addTx({ type: 'in', amount: g.price, cat: 'goods', title: g.name, method: 'Наличные' }); render(); toast('Продажа в кассе'); });
}
function qrSheet(unitId) {
  const u = unitId === 'checkin' ? { name: 'Отметка прихода на смену' } : DB.unit(unitId), url = location.href.split('#')[0] + (unitId === 'checkin' ? '#checkin' : '#qr-' + unitId);
  let code = '';
  try { if (window.qrcode) { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); code = `<div class="qr">${q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div>`; } } catch (e) { code = ''; }
  sheet(sheetHead('QR-код', esc(u.name)) + `${code || '<p class="muted small">QR-код не загрузился, но ссылка ниже работает так же.</p>'}
    <div class="code" id="qr-url">${esc(url)}</div>
    <button class="btn block" onclick="copyText(document.getElementById('qr-url').textContent,'Ссылка скопирована')">${ic('copy', 'sm')} Скопировать ссылку</button>`);
}
function standardsSheet() {
  const d = DB.d;
  sheet(sheetHead('Стандарты', 'Эталонное фото сотрудник видит по кнопке «Как должно быть»') +
    Object.entries(CAT.standards).filter(([k]) => k !== 'generic').map(([k, tpl]) => `<div class="card"><span class="h2">${tpl.name}</span><div class="list">${tpl.steps.map((s, i) => {
      const ref = d.refs[k + ':' + i];
      return `<div class="li">${ref ? `<span class="thumb"><img src="${ref}" alt=""></span>` : `<span class="li-ic">${ic('camera')}</span>`}<span class="li-main"><span class="li-t">${s.t}</span><br><span class="li-s">${s.how.length} пункта стандарта</span></span><button class="btn sm ghost" onclick="setRef('${k}',${i})">${ref ? 'Заменить' : 'Фото'}</button></div>`;
    }).join('')}</div></div>`).join(''));
}
function setRef(k, i) { pickPhoto(src => { DB.d.refs[k + ':' + i] = src; DB.save(); standardsSheet(); toast('Эталонное фото сохранено'); }); }
function exportCSV() {
  let csv = '﻿Дата;Назначение;Категория;Тип;Сумма;Способ\n';
  DB.d.tx.forEach(x => { const dt = new Date(x.ts); csv += `${T.iso(dt)} ${T.pad(dt.getHours())}:${T.pad(dt.getMinutes())};"${x.title.replace(/"/g, '""')}";${CAT.cats[x.cat] || ''};${x.type === 'in' ? 'Приход' : 'Расход'};${x.amount};${x.method}\n`; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `kassa-medvezhiy-ugol-${T.today()}.csv`; a.click();
}
function resetDemo() { ask('Сбросить демо-данные?', 'Все брони, задачи, фото и операции вернутся к исходным.', 'Сбросить', () => { DB.reset(); logout(); toast('Данные сброшены'); }, true); }

// --- Чат с гостями (сторона управляющего) ---
function threads() {
  const by = {};
  DB.d.messages.forEach(m => { (by[m.login] = by[m.login] || []).push(m); });
  sheet(sheetHead('Сообщения гостей') + `<div class="card flat"><div class="list">${Object.entries(by).map(([login, ms]) => { const last = ms[ms.length - 1], n = ms.filter(m => m.from === 'guest' && !m.read).length; return `<button class="li" onclick="thread('${esc(login)}')"><span class="avatar">${esc(ms[0].name[0])}</span><span class="li-main"><span class="li-t">${esc(ms[0].name)}</span><br><span class="li-s">${esc(last.text)}</span></span>${n ? `<span class="chip warn">${n}</span>` : ''}</button>`; }).join('') || '<p class="empty">Гости пока не писали.</p>'}</div></div>`);
}
const bubbles = (ms, mine) => `<div class="chat">${ms.map(m => `<div class="bub ${m.from === mine ? 'me' : ''}">${esc(m.text)}<small>${T.stamp(m.ts)}</small></div>`).join('')}</div>`;
function thread(login) {
  const ms = DB.d.messages.filter(m => m.login === login);
  DB.markRead(login, 'guest');
  sheet(sheetHead(esc(ms[0] ? ms[0].name : 'Гость'), 'Чат с гостем') + bubbles(ms, 'admin') +
    `<form class="composer" onsubmit="event.preventDefault();reply('${esc(login)}')"><input id="rp" class="inp" placeholder="Ответ гостю" autocomplete="off" aria-label="Ответ гостю"><button class="iconbtn" aria-label="Отправить">${ic('send', 'sm')}</button></form>`);
  const s = $('#sheet .sheet'); s.scrollTop = s.scrollHeight; render();
}
function reply(login) { const text = val('rp'); if (!text) return; const m = DB.d.messages.find(x => x.login === login); DB.send(login, m ? m.name : 'Гость', 'admin', text); thread(login); }

// --- Квадроцикл: правка вручную (управляющий и инструктор) ---
function quadSheet(id) {
  const q = DB.quad(id);
  sheet(sheetHead(`Квадроцикл №${q.num}`, esc(q.name)) + `<div class="form">
    ${field('Где сейчас', `<select id="q-status" class="inp">${options([['park', 'В парке, готов'], ['tour', 'На маршруте'], ['service', 'На ТО или в ремонте']], q.status)}</select>`)}
    <div class="row2">${field('Наработка, м/ч', `<input id="q-total" class="inp" type="number" step="0.1" value="${q.totalHours}">`)}${field('До ТО, м/ч', `<input id="q-left" class="inp" type="number" step="0.1" value="${q.toService}">`)}</div>
    ${field('Замечания', `<input id="q-def" class="inp" value="${esc(q.defects)}">`)}
    <button class="btn block" onclick="saveQuad(${id})">Сохранить</button></div>`);
}
function saveQuad(id) { DB.updateQuad(id, { status: val('q-status'), totalHours: Number(val('q-total')) || 0, toService: Number(val('q-left')) || 0, defects: val('q-def') || 'В норме' }); closeSheet(); render(); toast('Сохранено'); }


// =====================================================================
//  Модули базы. Каждый открывается отдельной страницей со стрелкой назад
// =====================================================================
const MODULES = [
  ['Гости и продажи', [
    ['m_guests', 'users', 'Гости', () => `${DB.guests().length} в базе`],
    ['m_reviews', 'star', 'Отзывы', () => { const r = DB.d.reviews; return r.length ? `средняя ${(sum(r, x => x.stars) / r.length).toFixed(1)}` : 'пока нет'; }],
    ['m_prices', 'tag', 'Цены и налог', () => `выходные +${Math.round((DB.S.weekendK - 1) * 100)}%`],
    ['m_promo', 'gift', 'Промокоды и бонусы', () => `${DB.d.promos.length} кода`],
    ['m_certs', 'ticket', 'Сертификаты и абонементы', () => `${DB.d.certs.filter(c => c.balance > 0).length + DB.d.passes.filter(p => p.left > 0).length} активных`],
    ['m_events', 'calendar', 'Афиша', () => `${DB.d.events.filter(e => e.date >= T.today()).length} событий`],
    ['m_leads', 'handshake', 'Заявки и корпоративы', () => { const n = DB.d.leads.filter(l => l.status === 'new').length; return n ? `${n} новых` : 'новых нет'; }],
    ['m_partners', 'route', 'Партнёры рядом', () => `${CAT.partners.length} партнёра`]
  ]],
  ['Хозяйство', [
    ['m_stock', 'box', 'Склад', () => { const n = DB.d.stock.filter(s => s.qty <= s.min).length; return n ? `${n} заканчиваются` : 'всё есть'; }],
    ['m_tickets', 'wrench', 'Ремонт', () => { const n = DB.d.tickets.filter(t => t.status !== 'done').length; return n ? `${n} открытых` : 'заявок нет'; }],
    ['m_upkeep', 'shield', 'Обслуживание', () => { const n = DB.d.upkeep.filter(x => T.addDays(x.last, x.every) <= T.today()).length; return n ? `${n} просрочено` : 'по графику'; }],
    ['m_heat', 'thermo', 'Отопление', () => DB.S.winter ? 'зимний режим' : 'выключено'],
    ['m_build', 'crane', 'Стройка', () => `${DB.d.projects.length} проекта`],
    ['m_quads', 'quad', 'Квадроциклы', () => DB.S.weatherStop ? 'стоп по погоде' : `${DB.d.quads.filter(q => q.status === 'park').length} готовы`],
    ['m_rent', 'bag', 'Прокат и продажи', () => `${DB.d.rentals.filter(r => r.status !== 'back').length} выдано`]
  ]],
  ['Команда и бизнес', [
    ['m_team', 'users', 'Персонал и зарплата', () => `${DB.d.users.filter(u => u.role === 'staff' || u.role === 'instructor').length} человека`],
    ['m_stats', 'chart', 'Аналитика', () => 'загрузка, ADR, RevPAR'],
    ['m_network', 'layers', 'Сеть объектов', () => `${CAT.properties.length} объекта`],
    ['m_settings', 'qr', 'Настройки и QR', () => 'подключения, тема']
  ]]
];
MODULES.forEach(([, items]) => items.forEach(([id]) => { PARENT[id] = 'base'; }));

V.base = () => head(esc(S.user.title), 'База') + MODULES.map(([group, items]) => `<div class="sec"><span class="h2">${group}</span></div>
  <div class="tiles">${items.map(([id, icon, title, sub]) => `<button class="tile" onclick="go('${id}')"><span class="li-ic">${ic(icon)}</span><b>${title}</b><span>${esc(sub())}</span></button>`).join('')}</div>`).join('') +
  `<button class="btn block line" onclick="logout()">${ic('logout', 'sm')} Выйти</button>`;

// --- Утренняя сводка: то, что в 8:00 будет приходить отцу в Telegram ---
function morningText() {
  const d = DB.d, t = T.today();
  const ins = d.bookings.filter(b => b.start === t), outs = d.bookings.filter(b => b.end === t);
  const hours = d.bookings.filter(b => b.date === t).sort((a, b) => a.from - b.from);
  const notReady = ins.filter(b => DB.unit(b.unitId).status !== 'ready');
  const low = d.stock.filter(s => s.qty <= s.min), rides = d.rides.filter(r => r.date === t && r.status !== 'done');
  const due = d.upkeep.filter(x => T.addDays(x.last, x.every) <= t);
  const yest = sum(d.tx.filter(x => x.type === 'in' && T.dayOf(x.ts) === T.addDays(t, -1)));
  const lines = [`Доброе утро! ${T.long(t)[0].toUpperCase() + T.long(t).slice(1)}.`, ''];
  lines.push(`Заезды: ${ins.length ? ins.map(b => `${DB.unit(b.unitId).short} (${b.guest})`).join(', ') : 'нет'}`);
  lines.push(`Выезды: ${outs.length ? outs.map(b => `${DB.unit(b.unitId).short} (${b.guest})`).join(', ') : 'нет'}`);
  if (hours.length) lines.push(`Беседки и баня: ${hours.map(b => `${DB.unit(b.unitId).short} ${T.hm(b.from)}`).join(', ')}`);
  if (rides.length) lines.push(`Квадроциклы: ${rides.map(r => T.hm(r.from)).join(', ')}`);
  lines.push('');
  if (notReady.length) lines.push(`Не готовы к заезду: ${notReady.map(b => DB.unit(b.unitId).short).join(', ')}`);
  if (low.length) lines.push(`Заканчивается: ${low.map(s => s.name.toLowerCase()).join(', ')}`);
  if (due.length) lines.push(`По хозяйству: ${due.map(x => x.title.toLowerCase()).join(', ')}`);
  lines.push(`Выручка вчера: ${money(yest)}`);
  return lines.join('\n');
}
function morningSheet() {
  sheet(sheetHead('Сводка на утро', 'Так она будет приходить в Telegram каждый день в 8:00') + `
    <div class="tg"><div class="tg-h">${ic('send', 'sm')} Бот «${esc(CAT.properties.find(p => p.id === DB.pid()).name)}»</div><div class="tg-b">${esc(morningText()).replace(/\n/g, '<br>')}<small>08:00</small></div></div>
    <button class="btn block" disabled>Отправить в Telegram</button>
    <p class="small muted" style="text-align:center">Кнопка заработает после подключения сервера и бота. Текст собирается из данных базы автоматически.</p>`);
}
function sosBlock() {
  const open = DB.d.sos.filter(s => s.status === 'open');
  return open.map(s => `<section class="card sos"><div class="card-h"><span class="h2">${ic('sos')} SOS: ${esc(s.kind)}</span><span class="small">${T.stamp(s.ts)}</span></div>
    <span>${esc(s.name)}${s.unitId ? ', ' + esc(DB.unit(s.unitId).short) : ''}${s.phone ? `, <span style="user-select:all">${esc(s.phone)}</span>` : ''}</span>
    <div class="btns"><button class="btn" onclick="DB.resolveSos(${s.id});render();toast('Гость получил ответ: администратор идёт')">Иду к гостю</button><button class="btn ghost" onclick="mapSheet('${s.unitId || 'gate'}')">${ic('map', 'sm')} На карте</button></div></section>`).join('');
}

// --- Гости (CRM) ---
V.m_guests = () => {
  const q = (S.gq2 || '').toLowerCase(), all = DB.guests();
  const list = all.filter(g => !q || g.name.toLowerCase().includes(q) || g.phone.includes(q));
  const soon = all.filter(g => g.birthday && (() => { const [m, dd] = g.birthday.split('-').map(Number); const n = new Date(); let b = new Date(n.getFullYear(), m - 1, dd); if (b < new Date(n.toDateString())) b.setFullYear(n.getFullYear() + 1); return (b - n) / 864e5 < 21; })());
  return subhead('Гости', `${all.length} человек, ${all.filter(g => g.stays > 1).length} возвращались`) + `
  <input class="inp" id="crm-q" placeholder="Поиск по имени или телефону" value="${esc(S.gq2 || '')}" oninput="S.gq2=this.value;render();const i=document.getElementById('crm-q');i.focus();i.setSelectionRange(i.value.length,i.value.length)" aria-label="Поиск гостя">
  ${soon.length ? `<section class="card inv"><span class="muted">Скоро день рождения</span>${soon.map(g => `<span>${esc(g.name)}, ${g.birthday.split('-').reverse().join('.')}</span>`).join('')}<span class="muted small">Отправьте поздравление и промокод, это лучший повод вернуться.</span></section>` : ''}
  <section class="card flat"><div class="list">${list.slice(0, 40).map(g => `<button class="li" onclick="guestSheet('${g.key}')"><span class="avatar">${esc(g.name[0])}</span><span class="li-main"><span class="li-t">${esc(g.name)}</span><br><span class="li-s">${plural(g.stays, 'приезд', 'приезда', 'приездов')}, последний ${g.last ? T.dm(g.last) : '—'}</span></span><b>${money(g.spend)}</b></button>`).join('') || '<p class="empty">Никого не нашли.</p>'}</div></section>`;
};
function guestSheet(key) {
  const g = DB.guests().find(x => x.key === key); if (!g) return;
  const bs = DB.d.bookings.filter(b => b.phone && '+' + DB.digits(b.phone) === key && b.start).sort((a, b) => a.start < b.start ? 1 : -1);
  const tags = ['Постоянный гость', 'VIP', 'С детьми', 'С собакой', 'Баня', 'Квадроциклы', 'Корпоратив'];
  sheet(sheetHead(esc(g.name), `<span style="user-select:all">${esc(g.phone)}</span>`) + `
    <div class="stats"><div class="stat"><b>${g.stays}</b><span>приездов</span></div><div class="stat"><b>${g.nights}</b><span>ночей</span></div><div class="stat"><b>${money(g.spend)}</b><span>всего</span></div></div>
    <div class="opts">${tags.map(t => `<button class="opt ${(g.tags || []).includes(t) ? 'on' : ''}" onclick="crmTag('${key}','${t}')">${t}</button>`).join('')}</div>
    <div class="form">${field('День рождения', `<input id="crm-bd" class="inp" type="date" value="${g.birthday ? '2000-' + g.birthday : ''}">`)}
    ${field('Заметка для команды', `<textarea id="crm-note" class="inp" placeholder="Что важно помнить об этом госте">${esc(g.note || '')}</textarea>`)}
    <button class="btn block" onclick="DB.crmSet('${key}',{birthday:val('crm-bd').slice(5)||'',note:val('crm-note')});closeSheet();render();toast('Сохранено')">Сохранить</button></div>
    <div class="sec"><span class="h2">История</span></div>
    <div class="card flat"><div class="list">${bs.map(b => `<div class="li"><span class="li-main"><span class="li-t">${esc(DB.unit(b.unitId).short)}</span><br><span class="li-s">${T.dm(b.start)} – ${T.dm(b.end)}, ${esc(b.source)}</span></span><b>${money(b.amount)}</b></div>`).join('')}</div></div>`);
}
function crmTag(key, t) { const c = DB.d.crm[key] || {}, tags = c.tags || []; DB.crmSet(key, { tags: tags.includes(t) ? tags.filter(x => x !== t) : tags.concat(t) }); guestSheet(key); }

// --- Отзывы ---
const stars = n => `<span class="stars" aria-label="${n} из 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
V.m_reviews = () => {
  const r = [...DB.d.reviews].sort((a, b) => b.ts - a.ts), avg = r.length ? sum(r, x => x.stars) / r.length : 0;
  return subhead('Отзывы', 'Хорошие ведём на Яндекс Карты, плохие сразу к вам') + `
  <section class="card inv"><div class="card-h"><div class="num big">${avg.toFixed(1)}</div><div style="text-align:right">${stars(Math.round(avg))}<br><span class="muted small">${plural(r.length, 'отзыв', 'отзыва', 'отзывов')}</span></div></div>
  <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>${r.filter(x => x.routed === 'yandex').length}</b><span>отправлены на Яндекс Карты</span></div><div class="stat"><b>${r.filter(x => x.routed === 'admin').length}</b><span>пришли только вам</span></div></div></section>
  <section class="card flat"><div class="list">${r.slice(0, 30).map(x => `<div class="li" style="align-items:flex-start"><span class="li-main"><span class="li-t">${esc(x.name)}</span> ${stars(x.stars)}<br><span class="li-s">${x.text ? esc(x.text) + '. ' : ''}${x.unitId ? esc(DB.unit(x.unitId).short) + ', ' : ''}${T.stamp(x.ts)}</span></span>${x.routed === 'admin' ? '<span class="chip bad">Разобраться</span>' : ''}</div>`).join('') || '<p class="empty">Отзывов пока нет.</p>'}</div></section>`;
};

// --- Цены, налог, правила ---
const SETTING_FIELDS = [
  ['weekendK', 'Наценка на пятницу и субботу, %', 'k'], ['holidayK', 'Наценка в праздники, %', 'k'], ['minNightsHoliday', 'Минимум ночей в праздники', 'n'],
  ['hotDays', 'Горящие даты: ближайшие дней', 'n'], ['hotPct', 'Скидка на горящие будни, %', 'n'], ['taxRate', 'Туристический налог, %', 'n'],
  ['earlyFee', 'Ранний заезд с 10:00, ₽', 'n'], ['lateFee', 'Поздний выезд до 16:00, ₽', 'n'], ['deposit', 'Залог за дом, ₽', 'n']
];
V.m_prices = () => {
  const s = DB.S, houses = DB.d.units.filter(u => u.kind === 'house');
  let cal = '<table class="pcal"><thead><tr><th></th>';
  for (let i = 0; i < 14; i++) { const ds = T.addDays(T.today(), i); cal += `<th class="${DB.isHoliday(ds) ? 'hol' : ''}">${T.parse(ds).getDate()}<i>${T.DOW[T.parse(ds).getDay()]}</i></th>`; }
  cal += '</tr></thead><tbody>' + houses.map(u => `<tr><th>${esc(u.short)}</th>${Array.from({ length: 14 }, (_, i) => { const ds = T.addDays(T.today(), i), p = DB.nightPrice(u, ds), busy = !DB.dayFree(u.id, ds, T.addDays(ds, 1)); return `<td class="${p.tag === 'горящая дата' ? 'hot' : p.tag ? 'up' : ''} ${busy ? 'busy' : ''}">${busy ? '·' : Math.round(p.price / 100) / 10}</td>`; }).join('')}</tr>`).join('') + '</tbody></table>';
  return subhead('Цены и налог', 'Цена ночи меняется сама по этим правилам') + `
  <section class="card"><span class="h2">Цены на 14 дней, тыс. ₽</span><div class="keys"><span><i style="background:var(--ember)"></i>выходные и праздники</span><span><i style="background:var(--ok)"></i>горящие будни</span><span>· занято</span></div><div class="scroller">${cal}</div></section>
  <section class="card"><span class="h2">Правила</span><div class="form">${SETTING_FIELDS.map(([k, l, t]) => field(l, `<input id="st-${k}" class="inp" type="number" min="0" step="1" value="${t === 'k' ? Math.round((s[k] - 1) * 100) : s[k]}">`)).join('')}
  <label class="check"><input type="checkbox" id="st-tax-on" checked disabled><span class="small">Налог считается от стоимости проживания после скидок и показывается гостю отдельной строкой. Ставку для вашего муниципалитета уточните у бухгалтера.</span></label>
  <button class="btn block" onclick="savePrices()">Сохранить правила</button></div></section>
  <section class="card"><span class="h2">Базовые цены за ночь</span><div class="form">${houses.map(u => field(esc(u.short), `<input id="pr-${u.id}" class="inp" type="number" min="0" step="500" value="${u.price}">`)).join('')}<button class="btn block ghost" onclick="saveBasePrices()">Сохранить цены</button></div></section>`;
};
function savePrices() { SETTING_FIELDS.forEach(([k, , t]) => { const v = Number(val('st-' + k)) || 0; DB.S[k] = t === 'k' ? 1 + v / 100 : v; }); DB.save(); render(); toast('Правила сохранены'); }
function saveBasePrices() { DB.d.units.filter(u => u.kind === 'house').forEach(u => { u.price = Number(val('pr-' + u.id)) || u.price; }); DB.save(); render(); toast('Цены сохранены'); }

// --- Промокоды, бонусы, рефералы ---
V.m_promo = () => {
  const refs = DB.d.users.filter(u => u.refBy);
  return subhead('Промокоды и бонусы', `Кешбэк ${DB.S.bonusPct}% бонусами, приглашённому ${DB.S.refPct}% скидки`) + `
  <section class="card flat"><div class="list">${DB.d.promos.map(p => `<div class="li"><span class="li-ic">${ic('tag')}</span><span class="li-main"><span class="li-t" style="font-family:var(--display);font-weight:500">${esc(p.code)}</span><br><span class="li-s">−${p.pct}%, использован ${p.used} из ${p.max}, до ${T.dm(p.until)}. ${esc(p.note || '')}</span></span><button class="iconbtn" aria-label="Удалить промокод" onclick="DB.d.promos=DB.d.promos.filter(x=>x.code!=='${p.code}');DB.save();render()">${ic('trash', 'sm')}</button></div>`).join('')}</div></section>
  <section class="card"><span class="h2">Новый промокод</span><div class="form"><div class="row2">${field('Код', '<input id="pc-code" class="inp" placeholder="ZIMA20">')}${field('Скидка, %', '<input id="pc-pct" class="inp" type="number" min="1" max="90" value="10">')}</div>
    <div class="row2">${field('Сколько раз', '<input id="pc-max" class="inp" type="number" min="1" value="50">')}${field('Действует до', `<input id="pc-until" class="inp" type="date" value="${T.addDays(T.today(), 30)}">`)}</div>
    ${field('Для кого', '<input id="pc-note" class="inp" placeholder="Например: блогер Маша">')}<button class="btn block" onclick="addPromo()">Создать</button></div></section>
  <section class="card"><span class="h2">Бонусы и приглашения</span><div class="form">
    ${field('Кешбэк бонусами с проживания, %', `<input id="st-bonusPct" class="inp" type="number" value="${DB.S.bonusPct}">`)}
    ${field('Скидка приглашённому другу, %', `<input id="st-refPct" class="inp" type="number" value="${DB.S.refPct}">`)}
    ${field('Бонус тому, кто пригласил, ₽', `<input id="st-refBonus" class="inp" type="number" value="${DB.S.refBonus}">`)}
    <button class="btn block ghost" onclick="['bonusPct','refPct','refBonus'].forEach(k=>DB.S[k]=Number(val('st-'+k))||0);DB.save();toast('Сохранено')">Сохранить</button></div>
    <p class="small muted">Пришли по приглашению: ${refs.length ? refs.map(u => esc(u.name)).join(', ') : 'пока никто'}.</p></section>`;
};
function addPromo() {
  const c = val('pc-code').toUpperCase().replace(/\s/g, ''); if (!c) return toast('Придумайте код');
  if (DB.d.promos.some(p => p.code === c)) return toast('Такой код уже есть');
  DB.d.promos.unshift({ code: c, pct: Number(val('pc-pct')) || 10, used: 0, max: Number(val('pc-max')) || 50, until: val('pc-until'), note: val('pc-note') }); DB.save(); render(); toast('Промокод создан');
}

// --- Сертификаты и абонементы ---
V.m_certs = () => subhead('Сертификаты и абонементы', 'Подарки и пакеты посещений для местных') + `
  <div class="sec"><span class="h2">Подарочные сертификаты</span><button class="btn sm" onclick="certSell()">${ic('plus', 'sm')} Продать</button></div>
  <section class="card flat"><div class="list">${DB.d.certs.map(c => `<div class="li"><span class="li-ic">${ic('gift')}</span><span class="li-main"><span class="li-t" style="user-select:all">${c.code}</span><br><span class="li-s">${esc(c.buyer)} → ${esc(c.to || 'получателю')}, ${T.stamp(c.ts)}</span></span><b>${money(c.balance)}</b></div>`).join('') || '<p class="empty">Сертификатов пока нет.</p>'}</div></section>
  <div class="sec"><span class="h2">Абонементы</span><button class="btn sm" onclick="passSell()">${ic('plus', 'sm')} Продать</button></div>
  <section class="card flat"><div class="list">${DB.d.passes.map(p => { const pr = CAT.passes.find(x => x.id === p.productId); return `<div class="li"><span class="li-ic">${ic('ticket')}</span><span class="li-main"><span class="li-t">${esc(p.name)}</span><br><span class="li-s">${esc(pr.name)}, <span style="user-select:all">${p.code}</span></span></span><b>${p.left} из ${p.total}</b></div>`; }).join('') || '<p class="empty">Абонементов пока нет.</p>'}</div></section>`;
function certSell() {
  sheet(sheetHead('Продать сертификат') + `<div class="form"><div class="opts">${[5000, 10000, 15000, 25000].map(a => `<button class="opt" onclick="document.getElementById('ct-a').value=${a}">${money(a)}</button>`).join('')}</div>
    ${field('Сумма, ₽', '<input id="ct-a" class="inp" type="number" value="10000">')}${field('Покупатель', '<input id="ct-b" class="inp">')}${field('Кому и по какому поводу', '<input id="ct-t" class="inp" placeholder="Например: родителям на годовщину">')}
    <button class="btn block" onclick="const c=DB.buyCert(Number(val('ct-a')),val('ct-b')||'Гость',val('ct-t'));closeSheet();render();toast('Сертификат '+c.code+' продан')">Продать</button></div>`);
}
function passSell() {
  sheet(sheetHead('Продать абонемент', 'Для дневных гостей: баня и беседки по пакету') + `<div class="form">${field('Абонемент', `<select id="ps-p" class="inp">${options(CAT.passes.map(p => [p.id, `${p.name}, ${money(p.price)}`]))}</select>`)}
    ${field('Имя', '<input id="ps-n" class="inp">')}${field('Телефон', '<input id="ps-ph" class="inp" type="tel" placeholder="+7">')}
    <button class="btn block" onclick="if(!val('ps-n'))return toast('Укажите имя');const p=DB.buyPass(val('ps-p'),{login:'pass'+Date.now().toString(36),name:val('ps-n'),phone:val('ps-ph')});closeSheet();render();toast('Абонемент '+p.code+' продан')">Продать</button></div>`);
}

// --- Афиша ---
V.m_events = () => subhead('Афиша', 'Гости записываются из приложения', `<button class="btn sm" onclick="eventSheet()">${ic('plus', 'sm')}</button>`) +
  [...DB.d.events].sort((a, b) => a.date < b.date ? -1 : 1).map(e => { const n = e.going.reduce((a, g) => a + g.n, 0); return `<section class="card"><div class="card-h"><div><span class="h2">${esc(e.title)}</span><br><span class="small muted">${T.rel(e.date)}, ${T.hm(e.time)}, ${e.price ? money(e.price) : 'бесплатно'}</span></div><span class="chip ${n >= e.places ? 'bad' : 'ok'}">${n} из ${e.places}</span></div>
    <p class="small">${esc(e.desc)}</p>${e.going.length ? `<p class="small muted">Идут: ${e.going.map(g => `${esc(g.name || 'гость')} ×${g.n}`).join(', ')}</p>` : ''}
    <button class="btn sm ghost" onclick="ask('Удалить событие?','','Удалить',()=>{DB.d.events=DB.d.events.filter(x=>x.id!==${e.id});DB.save();render()},true)">Удалить</button></section>`; }).join('');
function eventSheet() {
  sheet(sheetHead('Новое событие') + `<div class="form">${field('Название', '<input id="ev-t" class="inp" placeholder="Вечер у костра">')}
    <div class="row2">${field('День', `<input id="ev-d" class="inp" type="date" value="${T.addDays(T.today(), 1)}">`)}${field('Время', '<input id="ev-h" class="inp" type="time" value="19:00">')}</div>
    <div class="row2">${field('Цена, ₽', '<input id="ev-p" class="inp" type="number" value="0">')}${field('Мест', '<input id="ev-n" class="inp" type="number" value="20">')}</div>
    ${field('Описание', '<textarea id="ev-x" class="inp"></textarea>')}
    <button class="btn block" onclick="saveEvent()">Опубликовать</button></div>`);
}
function saveEvent() {
  if (!val('ev-t')) return toast('Назовите событие');
  const [h, m] = val('ev-h').split(':').map(Number);
  DB.d.events.push({ id: DB.id(), title: val('ev-t'), date: val('ev-d'), time: h * 60 + (m || 0), price: Number(val('ev-p')) || 0, places: Number(val('ev-n')) || 20, going: [], desc: val('ev-x') });
  DB.notify('all', `В афише: ${val('ev-t')}, ${T.rel(val('ev-d'))}`, 'calendar', 'g_shop'); DB.save(); closeSheet(); render(); toast('Событие в афише');
}

// --- Заявки и корпоративы ---
const LST = { new: ['warn', 'Новая'], work: ['plain', 'В работе'], done: ['ok', 'Закрыта'] };
V.m_leads = () => subhead('Заявки и корпоративы', 'Корпоративы, праздники и заказы у партнёров', `<button class="btn sm" onclick="corpSheet()">Смета</button>`) + `
  <section class="card flat"><div class="list">${DB.d.leads.map(l => `<div class="li" style="align-items:flex-start"><span class="li-ic">${ic(l.kind === 'partner' ? 'route' : 'users')}</span><span class="li-main"><span class="li-t">${esc(l.text)}</span><br><span class="li-s">${esc(l.name)}, <span style="user-select:all">${esc(l.phone || '')}</span>, ${T.stamp(l.ts)}${l.amount ? ', ' + money(l.amount) : ''}${l.commission ? `, комиссия ${money(l.commission)}` : ''}</span></span><button class="chip ${LST[l.status][0]}" onclick="leadNext(${l.id})">${LST[l.status][1]}</button></div>`).join('') || '<p class="empty">Заявок пока нет.</p>'}</div></section>
  <p class="small muted" style="padding:0 4px">Нажмите на статус, чтобы перевести заявку дальше.</p>`;
function leadNext(id) { const l = DB.d.leads.find(x => x.id === id); l.status = { new: 'work', work: 'done', done: 'new' }[l.status]; DB.save(); render(); }
// Калькулятор корпоратива: им пользуются и управляющий, и гость
let corp = { people: 20, nights: 2, sauna: 3, gazebo: 4, quads: 2, food: true };
function corpCalc() {
  const houses = DB.d.units.filter(u => u.kind === 'house').sort((a, b) => b.capacity - a.capacity);
  let left = corp.people; const pick = [];
  houses.forEach(h => { if (left > 0) { pick.push(h); left -= h.capacity; } });
  const stay = sum(pick, h => h.price) * corp.nights, sauna = corp.sauna * (DB.unit('s1') ? DB.unit('s1').price : 0);
  const gaz = corp.gazebo * (DB.d.units.find(u => u.kind === 'gazebo') || { price: 0 }).price * 1.5, quads = corp.quads * CAT.quad.pricePerHour * Math.min(3, Math.ceil(corp.people / 6));
  const food = corp.food ? corp.people * corp.nights * 900 : 0;
  const total = stay + sauna + gaz + quads + food;
  return { pick, left, rows: [['Проживание: ' + pick.map(h => h.short).join(', '), stay], [`Баня, ${corp.sauna} ч`, sauna], [`Беседки, ${corp.gazebo} ч`, gaz], [`Квадроциклы, ${corp.quads} ч`, quads], ['Завтраки', food]].filter(r => r[1]), total };
}
function corpSheet(fromGuest) {
  const c = corpCalc(), stp = (k, step = 1, min = 0) => `<span class="stepper"><button aria-label="Меньше" onclick="corp.${k}=Math.max(${min},corp.${k}-${step});corpSheet(${!!fromGuest})">−</button><b>${corp[k]}</b><button class="add" aria-label="Больше" onclick="corp.${k}+=${step};corpSheet(${!!fromGuest})">+</button></span>`;
  sheet(sheetHead('Корпоратив или праздник', 'Смета считается сразу') + `<div class="card flat"><div class="list">
    <div class="li"><span class="li-main">Человек</span>${stp('people', 2, 2)}</div><div class="li"><span class="li-main">Ночей</span>${stp('nights', 1, 0)}</div>
    <div class="li"><span class="li-main">Баня, часов</span>${stp('sauna')}</div><div class="li"><span class="li-main">Беседки, часов</span>${stp('gazebo')}</div><div class="li"><span class="li-main">Квадроциклы, часов</span>${stp('quads')}</div>
    <label class="li"><span class="li-main">Завтраки для всех</span><input type="checkbox" ${corp.food ? 'checked' : ''} onchange="corp.food=this.checked;corpSheet(${!!fromGuest})" style="width:22px;height:22px;accent-color:var(--ember)"></label></div></div>
    ${c.left > 0 && corp.nights ? `<p class="small" style="color:var(--warn)">Все дома вмещают на ${c.left} человек меньше. Остальных разместим в соседних гостиницах или предложим без ночёвки.</p>` : ''}
    <div class="card flat"><div class="list">${c.rows.map(([k, v]) => `<div class="li"><span class="li-main small">${esc(k)}</span><b>${money(v)}</b></div>`).join('')}</div></div>
    <div class="total"><span class="muted">Итого, примерно</span><b>${money(c.total)}</b></div>
    <div class="form">${field('Имя', `<input id="cp-n" class="inp" value="${fromGuest ? esc(S.user.visitor ? '' : S.user.name) : ''}">`)}${field('Телефон', `<input id="cp-p" class="inp" type="tel" value="${fromGuest ? esc(S.user.phone || '') : ''}" placeholder="+7">`)}
    <button class="btn block" onclick="corpSend()">${fromGuest ? 'Отправить заявку' : 'Сохранить как заявку'}</button></div>`);
}
function corpSend() {
  if (!val('cp-n') || !val('cp-p')) return toast('Оставьте имя и телефон');
  const c = corpCalc();
  DB.addLead({ kind: 'corp', name: val('cp-n'), phone: val('cp-p'), text: `${corp.people} человек, ${plural(corp.nights, 'ночь', 'ночи', 'ночей')}${corp.sauna ? ', баня' : ''}${corp.quads ? ', квадроциклы' : ''}`, amount: c.total });
  closeSheet(); render(); toast('Заявка отправлена, свяжемся в течение часа');
}

// --- Партнёры ---
V.m_partners = () => subhead('Партнёры рядом', 'Гости заказывают у них через приложение, вы получаете комиссию') + CAT.partners.map(p => {
  const ls = DB.d.leads.filter(l => l.partnerId === p.id);
  return `<section class="card"><div class="card-h"><div><span class="h2">${esc(p.name)}</span><br><span class="small muted">${esc(p.service)}, ${esc(p.distance)}</span></div><b>${money(p.price)}</b></div>
    <div class="stats"><div class="stat"><b>${p.commission}%</b><span>комиссия</span></div><div class="stat"><b>${ls.length}</b><span>заказов</span></div><div class="stat"><b>${money(sum(ls, l => l.commission || 0))}</b><span>заработано</span></div></div></section>`;
}).join('') + '<p class="small muted" style="padding:0 4px">Названия, цены и процент меняются в catalog.js, раздел partners.</p>';

// --- Склад ---
V.m_stock = () => {
  const st = DB.d.stock, low = st.filter(s => s.qty <= s.min);
  return subhead('Склад', 'Списывается само после уборок, бани и продаж') + `
  ${low.length ? `<section class="card inv"><span class="muted">Купить</span>${low.map(s => `<span>${esc(s.name)}: ${Math.max(1, s.min * 2 - s.qty)} ${s.unit}</span>`).join('')}<button class="btn sm" onclick="copyText(DB.d.stock.filter(s=>s.qty<=s.min).map(s=>s.name+': '+Math.max(1,s.min*2-s.qty)+' '+s.unit).join('\\n'),'Список закупки скопирован')">${ic('copy', 'sm')} Скопировать список</button></section>` : ''}
  <section class="card flat"><div class="list">${st.map(s => `<div class="li"><span class="li-main"><span class="li-t">${esc(s.name)}</span><br><span class="li-s">минимум ${s.min} ${s.unit}</span><div class="meter ${s.qty <= s.min ? 'warn' : ''}" style="margin-top:6px"><i style="width:${Math.min(100, s.qty / (s.min * 2.5) * 100)}%"></i></div></span>
    <span class="stepper"><button aria-label="Списать" onclick="DB.stockAdjust('${s.id}',-1);render()">−</button><b style="min-width:44px">${s.qty}</b><button class="add" aria-label="Добавить" onclick="stockIn('${s.id}')">+</button></span></div>`).join('')}</div></section>`;
};
function stockIn(id) {
  const s = DB.d.stock.find(x => x.id === id);
  sheet(sheetHead('Приход на склад', esc(s.name)) + `<div class="form"><div class="row2">${field(`Количество, ${s.unit}`, '<input id="si-q" class="inp" type="number" min="1" value="10">')}${field('Потрачено, ₽', '<input id="si-c" class="inp" type="number" min="0" placeholder="Попадёт в расходы">')}</div>
    <button class="btn block" onclick="DB.stockAdjust('${id}',Number(val('si-q'))||0,true);if(Number(val('si-c')))DB.addTx({type:'out',amount:Number(val('si-c')),cat:'other',title:'Закупка: ${esc(s.name)}',method:'Карта'},true);DB.save();closeSheet();render();toast('Приход записан')">Записать</button></div>`);
}

// --- Ремонт ---
const TKS = { new: ['bad', 'Новая'], work: ['warn', 'В работе'], done: ['ok', 'Готово'] };
V.m_tickets = () => subhead('Ремонт', 'Заявки от персонала и гостей', `<button class="btn sm" onclick="ticketSheet()">${ic('plus', 'sm')}</button>`) +
  ['new', 'work', 'done'].map(st => { const ts = DB.d.tickets.filter(t => t.status === st); return ts.length ? `<div class="sec"><span class="h2">${TKS[st][1]}</span></div><section class="card flat"><div class="list">${ts.map(t => `<div class="li" style="align-items:flex-start">${t.photo ? `<button class="thumb" onclick="viewer('<img src=&quot;${t.photo}&quot;>','${esc(t.title)}')"><img src="${t.photo}" alt=""></button>` : `<span class="li-ic ${t.prio === 'high' ? 'hot' : ''}">${ic('wrench')}</span>`}<span class="li-main"><span class="li-t">${esc(t.title)}</span><br><span class="li-s">${esc(t.place)}, ${esc(t.by)}, ${T.stamp(t.ts)}${t.prio === 'high' ? ', срочно' : ''}</span></span>${st !== 'done' ? `<button class="btn sm ghost" onclick="DB.setTicket(${t.id},{status:'${st === 'new' ? 'work' : 'done'}'});render()">${st === 'new' ? 'В работу' : 'Готово'}</button>` : ''}</div>`).join('')}</div></section>` : ''; }).join('');
function ticketSheet(photo) {
  S.tkPhoto = photo || null;
  sheet(sheetHead('Заявка на ремонт', 'Сфотографируйте поломку, мастер сразу поймёт, что брать с собой') + `<div class="form">
    ${S.tkPhoto ? `<div class="shot"><img src="${S.tkPhoto}" alt=""><button class="btn sm ghost" onclick="pickPhoto(ticketSheet,true)">Переснять</button></div>` : `<button class="slot" onclick="pickPhoto(ticketSheet,true)">${ic('camera')} Фото поломки</button>`}
    ${field('Что случилось', '<input id="tk-t" class="inp" placeholder="Например: не работает розетка у кровати">')}
    ${field('Где', `<select id="tk-p" class="inp">${options(DB.d.units.map(u => [u.id, u.short]).concat([['', 'Территория']]))}</select>`)}
    <label class="check"><input type="checkbox" id="tk-h"><span>Срочно, мешает гостям</span></label>
    <button class="btn block" onclick="saveTicket()">Отправить</button></div>`);
}
function saveTicket() {
  if (!val('tk-t')) return toast('Опишите, что случилось');
  const u = DB.unit(val('tk-p'));
  DB.addTicket({ title: val('tk-t'), unitId: u ? u.id : null, place: u ? u.short : 'Территория', by: S.user.name, prio: $('#tk-h').checked ? 'high' : 'normal', photo: S.tkPhoto });
  closeSheet(); render(); toast('Заявка отправлена');
}

// --- Обслуживание по графику ---
V.m_upkeep = () => {
  const t = T.today(), list = [...DB.d.upkeep].sort((a, b) => T.addDays(a.last, a.every) < T.addDays(b.last, b.every) ? -1 : 1);
  return subhead('Обслуживание', 'Регулярные работы, которые нельзя пропускать', `<button class="btn sm" onclick="upkeepSheet()">${ic('plus', 'sm')}</button>`) + `
  <section class="card flat"><div class="list">${list.map(x => { const due = T.addDays(x.last, x.every), left = T.nights(t, due); return `<div class="li"><span class="li-ic ${left < 0 ? 'hot' : ''}">${ic('shield')}</span><span class="li-main"><span class="li-t">${esc(x.title)}</span><br><span class="li-s">${esc(x.place)}, раз в ${x.every} дн., было ${T.dm(x.last)}</span><br><span class="chip ${left < 0 ? 'bad' : left <= 7 ? 'warn' : 'ok'}" style="margin-top:6px">${left < 0 ? `просрочено на ${plural(-left, 'день', 'дня', 'дней')}` : left === 0 ? 'сегодня' : `через ${plural(left, 'день', 'дня', 'дней')}`}</span></span><button class="btn sm ghost" onclick="DB.upkeepDone(${x.id});render();toast('Отмечено, следующий раз через ${x.every} дн.')">Сделано</button></div>`; }).join('')}</div></section>`;
};
function upkeepSheet() {
  sheet(sheetHead('Новая регулярная работа') + `<div class="form">${field('Что делать', '<input id="uk-t" class="inp" placeholder="Например: проверка газовых баллонов">')}${field('Где', '<input id="uk-p" class="inp" value="Территория">')}${field('Как часто, дней', '<input id="uk-e" class="inp" type="number" value="30">')}
    <button class="btn block" onclick="if(!val('uk-t'))return toast('Опишите работу');DB.d.upkeep.push({id:DB.id(),title:val('uk-t'),place:val('uk-p'),every:Number(val('uk-e'))||30,last:T.today()});DB.save();closeSheet();render()">Добавить</button></div>`);
}

// --- Отопление: прогрев к заезду и экономия, пока дом пустой ---
function heatState(u) {
  const h = DB.d.heat[u.id] || { target: 22, eco: 12, auto: true }, t = T.today();
  const now = DB.d.bookings.find(b => b.unitId === u.id && b.start && b.start <= t && t < b.end);
  const next = DB.d.bookings.filter(b => b.unitId === u.id && b.start && b.start > t).sort((a, b) => a.start < b.start ? -1 : 1)[0];
  const soon = DB.d.bookings.find(b => b.unitId === u.id && b.start === t);
  if (!DB.S.winter) return { h, mode: 'off', text: 'Отопление выключено' };
  if (now) return { h, mode: 'comfort', text: `Живут гости, держим ${h.target} °C` };
  if (soon || (next && next.start === T.addDays(t, 1) && T.nowMin() > 23 * 60)) return { h, mode: 'warm', text: `Заезд в ${CAT.checkIn}: прогрев до ${h.target} °C начнётся в 11:00` };
  return { h, mode: 'eco', text: `Пусто, экономим: ${h.eco} °C${next ? `. Прогреем к ${T.dm(next.start)}` : ''}` };
}
V.m_heat = () => subhead('Отопление', 'Демо-режим: управление заработает с умными термостатами') + `
  <label class="check"><input type="checkbox" ${DB.S.winter ? 'checked' : ''} onchange="DB.S.winter=this.checked;DB.save();render()"><span>Зимний режим: дома прогреваются за три часа до заезда и держат минимум, пока пустые</span></label>` +
  DB.d.units.filter(u => u.kind === 'house').map(u => { const s = heatState(u); DB.d.heat[u.id] = s.h; return `<section class="card"><div class="card-h"><span class="h2">${esc(u.short)}</span><span class="chip ${s.mode === 'comfort' || s.mode === 'warm' ? 'warn' : s.mode === 'eco' ? 'ok' : ''}">${{ comfort: 'Комфорт', warm: 'Прогрев', eco: 'Эконом', off: 'Выкл.' }[s.mode]}</span></div>
    <span class="small muted">${s.text}</span>
    <div class="li" style="padding:0;border:0"><span class="li-main">Для гостей</span><span class="stepper"><button aria-label="Холоднее" onclick="DB.d.heat['${u.id}'].target--;DB.save();render()">−</button><b style="min-width:44px">${s.h.target}°</b><button class="add" aria-label="Теплее" onclick="DB.d.heat['${u.id}'].target++;DB.save();render()">+</button></span></div>
    <div class="li" style="padding:0;border:0"><span class="li-main">Пустой дом</span><span class="stepper"><button aria-label="Холоднее" onclick="DB.d.heat['${u.id}'].eco--;DB.save();render()">−</button><b style="min-width:44px">${s.h.eco}°</b><button class="add" aria-label="Теплее" onclick="DB.d.heat['${u.id}'].eco++;DB.save();render()">+</button></span></div></section>`; }).join('');

// --- Стройка и благоустройство ---
V.m_build = () => subhead('Стройка', 'Этапы, расходы и фото прогресса', `<button class="btn sm" onclick="projSheet()">${ic('plus', 'sm')}</button>`) + DB.d.projects.map(p => {
  const spent = sum(p.costs), done = p.stages.filter(s => s.done).length;
  return `<section class="card"><div class="card-h"><span class="h2">${esc(p.name)}</span><span class="small muted">${done} из ${p.stages.length} этапов</span></div>
    <div class="meter ${spent > p.budget ? 'bad' : ''}"><i style="width:${Math.min(100, spent / p.budget * 100)}%"></i></div>
    <div class="card-h small"><span>Потрачено ${money(spent)}</span><span class="muted">бюджет ${money(p.budget)}</span></div>
    <div class="list">${p.stages.map((s, i) => `<button class="li" onclick="DB.d.projects.find(x=>x.id===${p.id}).stages[${i}].done=${!s.done};DB.save();render()"><span class="tick ${s.done ? 'on' : ''}" style="width:28px;height:28px">${ic('check', 'sm')}</span><span class="li-main">${esc(s.t)}</span></button>`).join('')}</div>
    ${p.photos.length ? `<div class="photos">${p.photos.map(ph => `<div class="cell"><img src="${ph}" alt="Фото стройки"></div>`).join('')}</div>` : ''}
    <div class="btns"><button class="btn sm ghost" onclick="costSheet(${p.id})">Расход</button><button class="btn sm ghost" onclick="pickPhoto(src=>{const p=DB.d.projects.find(x=>x.id===${p.id});p.photos=[src].concat(p.photos).slice(0,6);DB.save();render()},true)">${ic('camera', 'sm')} Фото</button></div></section>`;
}).join('');
function costSheet(id) {
  sheet(sheetHead('Расход по стройке') + `<div class="form">${field('На что', '<input id="cs-t" class="inp" placeholder="Например: брус 15 м³">')}${field('Сумма, ₽', '<input id="cs-a" class="inp" type="number">')}
    <button class="btn block" onclick="const a=Number(val('cs-a'));if(!val('cs-t')||!a)return toast('Укажите, на что и сколько');const p=DB.d.projects.find(x=>x.id===${id});p.costs.push({t:val('cs-t'),amount:a,ts:Date.now()});DB.addTx({type:'out',amount:a,cat:'other',title:'Стройка: '+val('cs-t'),method:'Перевод'},true);DB.save();closeSheet();render()">Записать</button></div>`);
}
function projSheet() {
  sheet(sheetHead('Новый проект') + `<div class="form">${field('Название', '<input id="pj-n" class="inp" placeholder="Например: детская площадка">')}${field('Бюджет, ₽', '<input id="pj-b" class="inp" type="number">')}${field('Этапы через запятую', '<input id="pj-s" class="inp" placeholder="Проект, закупка, монтаж">')}
    <button class="btn block" onclick="if(!val('pj-n'))return toast('Назовите проект');DB.d.projects.push({id:DB.id(),name:val('pj-n'),budget:Number(val('pj-b'))||0,stages:val('pj-s').split(',').map(s=>s.trim()).filter(Boolean).map(t=>({t,done:false})),costs:[],photos:[]});DB.save();closeSheet();render()">Создать</button></div>`);
}

// --- Квадроциклы (управляющий) ---
V.m_quads = () => {
  const f = DB.d.fuel, rides = DB.d.rides.filter(r => r.status === 'done' && r.hours);
  const perH = sum(rides, r => r.hours) ? sum(f, x => x.cost) / Math.max(1, sum(rides, r => r.hours)) : 0;
  return subhead('Квадроциклы', 'Парк, топливо, стоп по погоде') + `
  <label class="check"><input type="checkbox" ${DB.S.weatherStop ? 'checked' : ''} onchange="DB.setWeatherStop(this.checked);render();toast(this.checked?'Выезды закрыты, гостям отправлено сообщение':'Выезды снова открыты')"><span>Стоп по погоде: закрыть выезды на сегодня и предупредить гостей</span></label>
  ${DB.d.rides.filter(r => r.status === 'riding').length ? `<section class="card"><span class="h2">Сейчас на маршруте</span>${mapSVG({ trail: true, rides: DB.d.rides.filter(r => r.status === 'riding') })}</section>` : ''}
  <section class="card flat"><div class="list">${DB.d.quads.map(quadRow).join('')}</div></section>
  <section class="card"><div class="card-h"><span class="h2">Топливо</span><span class="small muted">${perH ? `≈ ${money(perH)} на моточас` : ''}</span></div><div class="list">${f.slice(0, 6).map(x => `<div class="li"><span class="li-main">№${DB.quad(x.quadId).num}, ${x.liters} л</span><span class="li-s">${T.stamp(x.ts)}</span><b>${money(x.cost)}</b></div>`).join('')}</div></section>`;
};

// --- Прокат и быстрые продажи ---
V.m_rent = () => {
  const t = T.today(), RS = { booked: ['plain', 'Забронирован'], out: ['warn', 'Выдан'], back: ['ok', 'Вернули'] };
  const act = DB.d.rentals.filter(r => r.status !== 'back' || r.date === t);
  return subhead('Прокат и продажи', 'Инвентарь, дрова и угли') + `
  <div class="sec"><span class="h2">Прокат сегодня</span></div>
  <section class="card flat"><div class="list">${act.map(r => { const it = CAT.rentals.find(x => x.id === r.itemId); return `<div class="li"><span class="li-main"><span class="li-t">${esc(it.name)}</span><br><span class="li-s">${esc(r.guest)}, ${T.rel(r.date)} ${T.hm(r.from)}, ${r.hours} ${it.unit === 'час' ? 'ч' : 'дн.'}</span></span>${r.status === 'back' ? `<span class="chip ok">Вернули</span>` : `<button class="btn sm ghost" onclick="rentNext(${r.id})">${r.status === 'booked' ? 'Выдать' : 'Принять'}</button>`}</div>`; }).join('') || '<p class="empty">Сегодня ничего не выдано.</p>'}</div></section>
  <div class="sec"><span class="h2">Остатки на сегодня</span></div>
  <div class="tiles">${CAT.rentals.map(it => `<div class="tile"><b>${esc(it.name)}</b><span>${DB.rentalLeft(it.id, t)} из ${it.qty}, ${it.season.toLowerCase()}</span></div>`).join('')}</div>
  <div class="sec"><span class="h2">Быстрая продажа</span><span class="muted small">сразу в кассу</span></div>
  <section class="card flat"><div class="list">${CAT.goods.map(g => `<div class="li"><span class="li-main"><span class="li-t">${g.name}</span><br><span class="li-s">${g.unit}, ${money(g.price)}</span></span><button class="btn sm ghost" onclick="quickSale('${g.id}')">Продать</button></div>`).join('')}</div></section>`;
};
function rentNext(id) { const r = DB.d.rentals.find(x => x.id === id); r.status = r.status === 'booked' ? 'out' : 'back'; DB.save(); render(); }

// --- Персонал: смены, обучение, зарплата ---
V.m_team = () => {
  const d = DB.d, t = T.today(), team = d.users.filter(u => u.role === 'staff' || u.role === 'instructor');
  const mon = T.addDays(t, -((T.parse(t).getDay() + 6) % 7)), days = Array.from({ length: 7 }, (_, i) => T.addDays(mon, i));
  const month = t.slice(0, 7);
  return subhead('Персонал и зарплата', `Ставка за смену ${money(DB.S.shiftPay)}, балл ${money(CAT.pointRate)}`) + `
  <section class="card"><span class="h2">График на неделю</span><div class="scroller"><table class="pcal sched"><thead><tr><th></th>${days.map(ds => `<th class="${ds === t ? 'hol' : ''}">${T.parse(ds).getDate()}<i>${T.DOW[T.parse(ds).getDay()]}</i></th>`).join('')}</tr></thead><tbody>
    ${team.map(u => `<tr><th>${esc(u.name)}</th>${days.map(ds => { const on = d.shifts.some(s => s.date === ds && s.login === u.login); return `<td><button class="cellb ${on ? 'on' : ''}" aria-label="${esc(u.name)}, ${ds}" onclick="toggleShift('${u.login}','${ds}')">${on ? '●' : ''}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">Нажмите на клетку, чтобы поставить или снять смену.</p></section>` +
  team.map(u => {
    const shifts = d.checkins.filter(c => c.login === u.login && c.date.startsWith(month)).length, pay = shifts * DB.S.shiftPay + (u.points || 0) * CAT.pointRate * (u.role === 'staff' ? 1 : 0);
    const m = d.moods.find(x => x.login === u.login), on = DB.onShift(u.login);
    return `<section class="card"><div class="card-h"><div class="li" style="padding:0;border:0"><span class="avatar">${esc(u.name[0])}</span><span class="li-main"><span class="li-t">${esc(u.name)}</span><br><span class="li-s">${esc(u.title)}${on ? ', на базе с ' + T.stamp(on.in).split(', ')[1] : ''}</span></span></div>${m ? `<span style="font-size:26px" title="${esc(m.tags.join(', '))}">${MOODS[m.mood - 1]}</span>` : ''}</div>
      <div class="stats"><div class="stat"><b>${shifts}</b><span>смен в месяце</span></div><div class="stat"><b>${u.role === 'staff' ? u.points || 0 : '—'}</b><span>баллов</span></div><div class="stat"><b>${money(pay)}</b><span>к выплате</span></div></div>
      ${u.role === 'staff' ? `<span class="chip ${u.trained ? 'ok' : 'warn'}">${u.trained ? `Обучение пройдено${u.course ? `, ${u.course.score} из ${CAT.course.quiz.length}` : ''}` : 'Ещё не прошёл обучение: баня ему не назначается'}</span>` : ''}
      ${m && m.tags.length ? `<span class="small muted">Последняя смена: ${esc(m.tags.join(', ').toLowerCase())}</span>` : ''}</section>`;
  }).join('') + `<button class="btn block ghost" onclick="standardsSheet()">${ic('book', 'sm')} Стандарты и эталонные фото</button>`;
};
function toggleShift(login, ds) { const i = DB.d.shifts.findIndex(s => s.login === login && s.date === ds); if (i >= 0) DB.d.shifts.splice(i, 1); else DB.d.shifts.push({ login, date: ds }); DB.save(); render(); }

// --- Аналитика ---
V.m_stats = () => {
  const P = S.statP || 30, d = DB.d, t = T.today(), from = T.addDays(t, -P);
  const houses = d.units.filter(u => u.kind === 'house'), cap = houses.length * P;
  let sold = 0, roomRev = 0;
  d.bookings.filter(b => b.start && b.start < t && b.end > from).forEach(b => {
    const n = T.nights(b.start, b.end), a = b.start > from ? b.start : from, e = b.end < t ? b.end : t, k = Math.max(0, T.nights(a, e));
    sold += k; roomRev += (b.base || b.amount) / n * k;
  });
  const inc = d.tx.filter(x => x.type === 'in' && T.dayOf(x.ts) >= from && T.dayOf(x.ts) < t), total = sum(inc);
  const stays = d.bookings.filter(b => b.start && b.start >= from && b.start < t);
  const extras = sum(inc.filter(x => !['stay', 'tax'].includes(x.cat)));
  const cats = Object.keys(CAT.cats).map(k => [k, sum(inc.filter(x => x.cat === k))]).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
  const src = {}; stays.forEach(b => { const k = (b.source || 'Прямая').replace(' Путешествия', ''); src[k] = (src[k] || 0) + 1; });
  let ahead = 0; for (let i = 0; i < 30; i++) { const ds = T.addDays(t, i); ahead += houses.filter(h => !DB.dayFree(h.id, ds, T.addDays(ds, 1))).length; }
  // Выручка по неделям или дням
  const step = P <= 7 ? 1 : 7, bars = [];
  for (let i = P; i > 0; i -= step) { const a = T.addDays(t, -i), b = T.addDays(a, step); bars.push([a, sum(inc.filter(x => T.dayOf(x.ts) >= a && T.dayOf(x.ts) < b))]); }
  const mx = Math.max(1, ...bars.map(b => b[1]));
  return subhead('Аналитика', 'Показатели, на языке которых говорят с инвесторами и франчайзи') + `
  <div class="seg">${[[7, '7 дней'], [30, '30 дней'], [60, '60 дней']].map(([k, l]) => `<button class="${P === k ? 'on' : ''}" onclick="S.statP=${k};render()">${l}</button>`).join('')}</div>
  <div class="tiles kpi">
    <div class="tile"><span>Загрузка домов</span><b class="num">${Math.round(sold / cap * 100)}%</b><span>${sold} из ${cap} ночей</span></div>
    <div class="tile"><span>ADR, средняя цена ночи</span><b class="num">${money(sold ? roomRev / sold : 0)}</b><span>без налога</span></div>
    <div class="tile"><span>RevPAR</span><b class="num">${money(roomRev / cap)}</b><span>выручка на дом в сутки</span></div>
    <div class="tile"><span>Допродажи на бронь</span><b class="num">${money(stays.length ? extras / stays.length : 0)}</b><span>${plural(stays.length, 'заезд', 'заезда', 'заездов')}</span></div>
  </div>
  <section class="card"><div class="card-h"><span class="h2">Выручка ${money(total)}</span><span class="small muted">по ${step === 1 ? 'дням' : 'неделям'}</span></div>
    <div class="week" style="grid-template-columns:repeat(${bars.length},1fr)">${bars.map(([a, v]) => `<div><b>${v ? Math.round(v / 1000) : ''}</b><i style="height:${Math.round(v / mx * 84)}px"></i>${T.parse(a).getDate()}</div>`).join('')}</div></section>
  <section class="card"><span class="h2">Из чего выручка</span><div class="split">${cats.map(([k, v]) => `<i style="flex:${v};background:var(${CATC[k] || '--faint'})"></i>`).join('')}</div>
    <div class="legend">${cats.map(([k, v]) => `<div><i style="background:var(${CATC[k] || '--faint'})"></i><span>${CAT.cats[k]}</span><b>${Math.round(v / total * 100)}%, ${money(v)}</b></div>`).join('')}</div></section>
  <section class="card"><span class="h2">Откуда брони</span><div class="legend">${Object.entries(src).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><i style="background:var(--ink)"></i><span>${esc(k)}</span><b>${Math.round(v / stays.length * 100)}%</b></div>`).join('') || '<span class="muted">Нет заездов за период</span>'}</div>
    <p class="small muted">Каждая бронь с площадки стоит 15–20% комиссии. Прямые брони через сайт и приложение выгоднее всего.</p></section>
  <section class="card inv"><span class="muted">Забронировано на 30 дней вперёд</span><div class="num big">${Math.round(ahead / (houses.length * 30) * 100)}%</div><span class="muted small">${ahead} из ${houses.length * 30} ночей уже проданы</span></section>`;
};

// --- Сеть объектов (франшиза) ---
V.m_network = () => subhead('Сеть объектов', 'У каждого объекта свои дома, цены, стандарты и команда') + CAT.properties.map(p => {
  const d = DB.peek(p.id), t = T.today(), houses = d.units.filter(u => u.kind === 'house');
  const occ = houses.filter(h => d.bookings.some(b => b.unitId === h.id && b.start && b.start <= t && t < b.end)).length;
  const rev = sum(d.tx.filter(x => x.type === 'in' && T.dayOf(x.ts) >= T.addDays(t, -30)));
  const cur = p.id === DB.pid();
  return `<section class="card ${cur ? 'inv' : ''}"><div class="card-h"><div><span class="h2">${esc(p.name)}</span><br><span class="small muted">${esc(p.place)}</span></div>${cur ? '<span class="chip plain">Открыт</span>' : `<button class="btn sm" onclick="switchProperty('${p.id}')">Перейти</button>`}</div>
    <div class="stats"><div class="stat"><b>${occ} из ${houses.length}</b><span>занято сегодня</span></div><div class="stat"><b>${d.units.length}</b><span>объектов</span></div><div class="stat"><b>${money(rev)}</b><span>за 30 дней</span></div></div></section>`;
}).join('') + '<p class="small muted" style="padding:0 4px">Новый объект сети добавляется в catalog.js, раздел properties. На сервере у каждого франчайзи будет свой вход и доступ только к своим данным.</p>';
async function switchProperty(pid) { await DB.useProperty(pid); const u = DB.user('admin'); DB.setSession('admin'); S.user = u; DB.tick(); go('today'); toast('Открыт объект «' + CAT.properties.find(p => p.id === pid).name + '»'); }

// --- Настройки ---
V.m_settings = () => {
  const base = location.href.split('#')[0];
  return subhead('Настройки и QR', '') + `
  <div class="sec"><span class="h2">QR-коды для гостей</span></div>
  <section class="card"><p class="small muted">Распечатайте код и поставьте на стол в доме или беседке. Гость наводит камеру и сразу попадает в консьерж, без установки и регистрации.</p>
    <div class="opts">${DB.d.units.map(x => `<button class="opt" onclick="qrSheet('${x.id}')">${esc(x.short)}</button>`).join('')}</div></section>
  <section class="card"><span class="h2">QR на воротах для персонала</span><p class="small muted">Сотрудник сканирует код, когда приходит на смену, и приход отмечается сам.</p><button class="btn sm ghost" onclick="qrSheet('checkin')">${ic('qr', 'sm')} Показать код</button></section>
  <div class="sec"><span class="h2">Общая база</span></div>
  <section class="card"><div class="card-h"><span class="h2">${!window.SYNC || !SYNC.enabled ? 'Только этот телефон' : SYNC.online ? 'Подключена' : 'Нет связи'}</span><span class="chip ${window.SYNC && SYNC.enabled ? (SYNC.online ? 'ok' : 'bad') : ''}">${window.SYNC && SYNC.enabled ? (SYNC.online ? 'онлайн' : 'офлайн') : 'выключена'}</span></div>
    <span class="small muted">${!window.SYNC || !SYNC.enabled ? 'Данные хранятся только в памяти этого телефона. Адрес сервера задаётся в config.js.' : SYNC.online ? `Все телефоны видят одни и те же данные. Последняя сверка с сервером: ${T.stamp(SYNC.lastOk)}.` : `Изменения сохраняются в телефоне и уйдут на сервер, когда появится связь.${SYNC.error ? ' Ошибка: ' + esc(SYNC.error) : ''}`}</span>
    ${window.SYNC && SYNC.enabled ? `<button class="btn sm ghost" onclick="SYNC.cycle(true).then(()=>{render();toast(SYNC.online?'Данные сверены с сервером':'Сервер не отвечает')})">Сверить сейчас</button>` : ''}</section>
  <div class="sec"><span class="h2">Подключения</span></div>
  <section class="card flat"><div class="list">${[['Telegram-бот', 'Уведомления и утренняя сводка'], ['Онлайн-оплата', 'СБП и карты через эквайринг'], ['Онлайн-касса 54-ФЗ', 'Чеки гостям автоматически'], ['Менеджер каналов', 'Яндекс Путешествия, Авито, Островок'], ['Электронные замки', 'Коды на дверь в день заезда'], ['GPS-трекеры', 'Квадроциклы на карте']].map(([n, s]) => `<div class="li"><span class="li-main"><span class="li-t">${n}</span><br><span class="li-s">${s}</span></span><span class="chip plain">Не подключено</span></div>`).join('')}</div></section>
  <div class="sec"><span class="h2">Оформление</span></div>${themeSeg()}
  <div class="btns"><button class="btn ghost" onclick="exportCSV()">${ic('download', 'sm')} Отчёт CSV</button><button class="btn ghost" onclick="resetDemo()">Сбросить демо</button></div>`;
};

// --- Ущерб и общий счёт из карточки брони ---
function incidentSheet(bookingId, photo) {
  S.incPhoto = photo || S.incPhoto || null;
  sheet(sheetHead('Ущерб', 'Счёт добавится в общий счёт гостя') + `<div class="form">
    ${S.incPhoto ? `<div class="shot"><img src="${S.incPhoto}" alt=""><button class="btn sm ghost" onclick="pickPhoto(p=>incidentSheet(${bookingId},p),true)">Переснять</button></div>` : `<button class="slot" onclick="pickPhoto(p=>incidentSheet(${bookingId},p),true)">${ic('camera')} Фото повреждения</button>`}
    ${field('Что повреждено', '<input id="in-t" class="inp" placeholder="Например: прожжён плед">')}${field('Сумма, ₽', '<input id="in-a" class="inp" type="number">')}
    <button class="btn block" onclick="if(!val('in-t')||!Number(val('in-a')))return toast('Опишите ущерб и сумму');DB.addIncident({bookingId:${bookingId},text:val('in-t'),amount:Number(val('in-a')),photo:S.incPhoto});S.incPhoto=null;closeSheet();render();toast('Счёт выставлен гостю')">Выставить счёт</button>
    <p class="small muted">Залог ${money(DB.S.deposit)} будет блокироваться на карте гостя при заезде, когда подключим эквайринг. Сейчас сумма уходит в общий счёт.</p></div>`);
}
function settleSheet(bookingId) {
  const f = DB.folio(bookingId);
  sheet(sheetHead('Общий счёт', 'Оплата при выезде') + `<div class="card flat"><div class="list">${f.map(x => `<div class="li"><span class="li-main small">${esc(x.title)}</span><b>${money(x.amount)}</b></div>`).join('')}</div></div>
    <div class="total"><span class="muted">Итого</span><b>${money(sum(f))}</b></div>
    <div class="btns">${['Карта', 'Наличные', 'СБП'].map(m => `<button class="btn ghost" onclick="DB.settleFolio(${bookingId},'${m}');closeSheet();render();toast('Счёт оплачен')">${m}</button>`).join('')}</div>`);
}
