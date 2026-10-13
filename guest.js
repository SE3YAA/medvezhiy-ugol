// guest.js — консьерж гостя: дом, услуги, чат, брони, профиль.
// Общие помощники (S, DB, T, CAT, sheet, field, ic, paySheet, mapSheet …) объявлены в app.js.

const myStay = () => DB.stayOf(S.user.login);
const myUnit = () => { const s = myStay(); return S.user.unitId ? DB.unit(S.user.unitId) : s ? DB.unit(s.unitId) : null; };
const cap = s => s[0].toUpperCase() + s.slice(1);
const dayOpts = (n, cur, fn) => `<div class="opts">${Array.from({ length: n }, (_, i) => { const ds = T.addDays(T.today(), i); return `<button class="opt ${cur === ds ? 'on' : ''}" onclick="${fn}('${ds}')">${i < 2 ? cap(T.rel(ds)) : T.dm(ds)}</button>`; }).join('')}</div>`;
// Оплата «в счёт дома» складывается в общий счёт и закрывается при выезде
const folioOf = m => m === 'В счёт проживания' && myStay() ? { folio: myStay().id, paid: false } : {};
function payFor(title, amount, onPaid) { paySheet({ title, amount, folioId: myStay() && myStay().start <= T.today() ? myStay().id : undefined, onPaid }); }
// Посетитель без аккаунта сначала оставляет имя и телефон
function needContact(next) {
  const u = S.user;
  if (!u.visitor && u.phone) return next();
  sheet(sheetHead('Как к вам обращаться?', 'Имя и телефон нужны, чтобы подтвердить заказ') + `<div class="form">
    ${field('Имя', `<input id="nc-n" class="inp" autocomplete="name" value="${esc(u.visitor ? '' : u.name)}">`)}${field('Телефон', `<input id="nc-p" class="inp" type="tel" placeholder="+7" autocomplete="tel" value="${esc(u.phone || '')}">`)}
    ${consentBox('nc-ok')}<button class="btn block" id="nc-go">Продолжить</button></div>`);
  $('#nc-go').onclick = () => {
    if (!val('nc-n') || DB.digits(val('nc-p')).length < 11) return toast('Укажите имя и телефон полностью');
    if (!$('#nc-ok').checked) return toast('Нужно согласие на обработку данных');
    DB.updateUser(u.login, { name: val('nc-n'), phone: val('nc-p'), visitor: false, consent: Date.now(), ref: u.ref || 'G' + DB.digits(val('nc-p')).slice(-5) });
    S.user = DB.user(u.login); closeSheet(); next();
  };
}

// =====================================================================
//  Дом: ключ, до заезда, общий счёт, карта, SOS
// =====================================================================
V.g_home = () => {
  const u = S.user, d = DB.d, t = T.today(), stay = myStay(), unit = myUnit(), now = T.nowMin();
  const live = stay && stay.start <= t;
  const orders = d.tasks.filter(x => x.login === u.login && ['delivery', 'food', 'package'].includes(x.tpl)).slice(0, 5);
  const slots = d.bookings.filter(b => b.date && b.login === u.login && b.date >= t);
  const rides = d.rides.filter(r => r.login === u.login && r.status !== 'done');
  const rents = d.rentals.filter(r => r.login === u.login && r.status !== 'back');
  const events = d.events.filter(e => e.date >= t && e.going.some(g => g.login === u.login));
  const OS = { todo: ['plain', 'Принят'], doing: ['warn', 'Готовим'], done: ['ok', 'Готово'] };
  const folio = stay ? DB.folio(stay.id) : [];
  const lastStay = d.bookings.filter(b => b.start && b.login === u.login && b.closed).sort((a, b) => a.end < b.end ? 1 : -1)[0];
  const needReview = lastStay && !d.reviews.some(r => r.bookingId === lastStay.id);
  const nextEvent = d.events.filter(e => e.date >= t).sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1)[0];
  const codeOpen = live && (stay.start < t || now >= 14 * 60 || (stay.early && now >= 600));
  const sos = d.sos.find(s => s.login === u.login && s.status === 'open');

  const hero = unit ? `<section class="hero"><div class="hero-img">${unitScene(unit)}</div><div class="hero-in">
      <div class="hero-row">${stay ? `<span class="glass">${ic('calendar', 'sm')} ${T.dm(stay.start)} – ${T.dm(stay.end)}</span><span class="glass">${stay.start > t ? `Заезд с ${stay.early ? '10:00' : CAT.checkIn}` : `Выезд до ${stay.late ? '16:00' : CAT.checkOut}`}</span>` : `<span class="glass">${ic('gazebo', 'sm')} Вы здесь</span>`}</div>
      <div><h2>${esc(unit.name)}</h2><p>${stay ? (stay.start > t ? `Ждём вас ${T.rel(stay.start)}` : 'Хорошего отдыха') + `, ${plural(stay.guests || 2, 'гость', 'гостя', 'гостей')}` : esc(unit.desc)}</p></div></div></section>`
    : `<section class="hero"><div class="hero-img">${scene('base', 3)}</div><div class="hero-in"><div></div><div><h2>Тишина, сосны и своя баня</h2><p>Выберите дом и даты, остальное подготовим к приезду</p><button class="btn" style="margin-top:14px;background:#fff;color:#0a0c0b" onclick="go('g_book')">Выбрать дом</button></div></div></section>`;

  return head('Медвежий угол', `Здравствуйте, ${esc(u.qr || u.visitor ? 'гость' : u.name.split(' ')[0])}`, `<button class="iconbtn sosbtn" aria-label="Экстренная помощь" onclick="sosSheet()">SOS</button>`) +
  (sos ? `<section class="card sos"><span class="h2">Сигнал SOS отправлен</span><span>Администратор уже знает и свяжется с вами. При угрозе жизни звоните 112.</span></section>` : '') + hero +
  (stay && stay.start > t ? `<section class="card inv"><div class="card-h"><span class="muted">До заезда</span><b class="num" style="font-size:22px">${plural(T.nights(t, stay.start), 'день', 'дня', 'дней')}</b></div>
    <div class="list">
      <button class="li" onclick="roadSheet()"><span class="li-ic" style="background:rgba(128,128,128,.2)">${ic('route')}</span><span class="li-main"><span class="li-t">Как добраться</span><br><span class="li-s">Маршрут, шлагбаум и что взять с собой</span></span>${ic('right', 'sm')}</button>
      <button class="li" onclick="checkinSheet(${stay.id})"><span class="li-ic" style="background:rgba(128,128,128,.2)">${ic(stay.checkin ? 'check' : 'user')}</span><span class="li-main"><span class="li-t">${stay.checkin ? 'Регистрация пройдена' : 'Онлайн-регистрация'}</span><br><span class="li-s">${stay.checkin ? `Ждём к ${stay.checkin.arrive}` : 'Две минуты сейчас вместо бумаг на месте'}</span></span>${ic('right', 'sm')}</button>
      ${stay.early ? '' : `<button class="li" onclick="earlyLate(${stay.id},'early')"><span class="li-ic" style="background:rgba(128,128,128,.2)">${ic('clock')}</span><span class="li-main"><span class="li-t">Ранний заезд с 10:00</span><br><span class="li-s">${money(DB.S.earlyFee)}, если дом свободен накануне</span></span>${ic('right', 'sm')}</button>`}
    </div></section>` : '') +
  (live ? `<section class="card inv keycard"><div class="card-h"><span class="muted">${ic('key', 'sm')} Код от двери</span>${codeOpen ? '' : '<span class="muted small">откроется в 14:00</span>'}</div>
    <div class="num door">${codeOpen ? DB.doorCode(stay).split('').join(' ') : '• • • •'}</div>
    <span class="muted small">Демо: коды на дверь заработают с электронными замками. Пока ключ у администратора.</span>
    ${stay.late ? '<span class="small">Поздний выезд до 16:00 подтверждён</span>' : `<button class="btn sm" onclick="earlyLate(${stay.id},'late')">Поздний выезд до 16:00, ${money(DB.S.lateFee)}</button>`}</section>` : '') +
  (live || u.qr ? `<section class="card"><div class="li" style="padding:0"><span class="li-ic">${ic('wifi')}</span><span class="li-main"><span class="li-t">${CAT.wifi.net}</span><br><span class="li-s">Пароль: ${CAT.wifi.pass}</span></span><button class="btn sm" onclick="copyText('${CAT.wifi.pass}','Пароль скопирован')">${ic('copy', 'sm')} Пароль</button></div></section>` : '') + `
  <div class="quick"><button onclick="mapSheet('${unit ? unit.id : 'gate'}')">${ic('map')}<span>Карта</span></button><button onclick="go('g_shop')">${ic('flame')}<span>Баня и еда</span></button><button onclick="go('g_chat')">${ic('chat')}<span>Написать</span></button>${stay ? `<button onclick="groupSheet()">${ic('users')}<span>Компания</span></button>` : ''}</div>
  ${folio.length ? `<button class="card folio" onclick="folioSheet()"><div class="card-h"><span class="h2">Общий счёт дома</span><b class="num">${money(sum(folio))}</b></div><span class="small muted">${plural(folio.length, 'позиция', 'позиции', 'позиций')}${stay.group && stay.group.members.length > 1 ? `, по ${money(sum(folio) / stay.group.members.length)} на каждого из компании` : ''}. Оплатите сейчас или при выезде</span></button>` : ''}
  ${needReview ? `<section class="card"><span class="h2">Как вам отдых в ${esc(DB.unit(lastStay.unitId).short)}?</span><div class="rate">${[1, 2, 3, 4, 5].map(n => `<button aria-label="${n} из 5" onclick="reviewSheet(${lastStay.id},${n})">★</button>`).join('')}</div></section>` : ''}
  ${slots.length + rides.length + orders.length + rents.length + events.length ? `<div class="sec"><span class="h2">Ваши заказы</span></div><section class="card flat"><div class="list">
    ${slots.map(b => `<div class="li"><span class="li-ic">${ic(DB.unit(b.unitId).kind === 'sauna' ? 'flame' : 'gazebo')}</span><span class="li-main"><span class="li-t">${esc(DB.unit(b.unitId).short)}</span><br><span class="li-s">${T.rel(b.date)}, ${T.hm(b.from)}–${T.hm(b.to)}</span></span><span class="chip ok">Записаны</span></div>`).join('')}
    ${rides.map(r => `<div class="li"><span class="li-ic">${ic('quad')}</span><span class="li-main"><span class="li-t">Квадроцикл, ${r.dur / 60} ч</span><br><span class="li-s">${T.rel(r.date)}, ${T.hm(r.from)}. ${esc(r.route)}</span></span><span class="chip ${r.status === 'riding' ? 'warn' : 'ok'}">${r.status === 'riding' ? 'В пути' : 'Записаны'}</span></div>`).join('')}
    ${rents.map(r => `<div class="li"><span class="li-ic">${ic('bag')}</span><span class="li-main"><span class="li-t">${esc(CAT.rentals.find(x => x.id === r.itemId).name)}</span><br><span class="li-s">${T.rel(r.date)}, ${T.hm(r.from)}</span></span><span class="chip ${r.status === 'out' ? 'warn' : 'ok'}">${r.status === 'out' ? 'У вас' : 'Забронирован'}</span></div>`).join('')}
    ${events.map(e => `<div class="li"><span class="li-ic">${ic('calendar')}</span><span class="li-main"><span class="li-t">${esc(e.title)}</span><br><span class="li-s">${T.rel(e.date)}, ${T.hm(e.time)}</span></span><span class="chip ok">Идёте</span></div>`).join('')}
    ${orders.map(o => `<div class="li"><span class="li-ic">${ic(o.tpl === 'food' ? 'food' : o.tpl === 'package' ? 'gift' : 'bag')}</span><span class="li-main"><span class="li-t">${esc(o.title)}</span><br><span class="li-s">${esc(o.place)}, ${esc(o.due)}</span></span><span class="chip ${OS[o.status][0]}">${OS[o.status][1]}</span></div>`).join('')}
  </div></section>` : ''}
  ${nextEvent && !events.includes(nextEvent) ? `<button class="card" style="text-align:left" onclick="eventSheet2(${nextEvent.id})"><span class="muted small">Афиша, ${T.rel(nextEvent.date)} в ${T.hm(nextEvent.time)}</span><span class="h2">${esc(nextEvent.title)}</span><span class="small">${esc(nextEvent.desc)}</span></button>` : ''}
  <div class="sec"><span class="h2">Как тут всё устроено</span></div>
  <section class="card flat"><div class="list">${CAT.guides.map(g => `<button class="li" onclick="guide('${g.id}')"><span class="li-ic">${ic(g.icon)}</span><span class="li-main"><span class="li-t">${g.title}</span><br><span class="li-s">${g.lead}</span></span>${ic('right', 'sm')}</button>`).join('')}</div></section>`;
};
function guide(id) { const g = CAT.guides.find(x => x.id === id); sheet(sheetHead(g.title, g.lead) + `<div class="card flat"><div class="list">${g.steps.map(s => `<div class="li"><span class="li-main">${s}</span></div>`).join('')}</div></div><button class="btn block ghost" onclick="go('g_chat')">${ic('chat', 'sm')} Остались вопросы? Напишите нам</button>`); }

function roadSheet() {
  const R = CAT.road;
  sheet(sheetHead('Как добраться', esc(R.address)) + `<div class="card"><p>${esc(R.hint)}</p><a class="btn block" href="${R.mapUrl}" target="_blank" rel="noopener">${ic('map', 'sm')} Открыть в Яндекс Картах</a></div>
    <div class="sec"><span class="h2">Что взять с собой</span></div><div class="card flat"><div class="list">${R.bring.map(b => `<div class="li"><span class="li-main">${esc(b)}</span></div>`).join('')}</div></div>
    <p class="small muted">Телефон администратора: <span style="user-select:all">${CAT.adminPhone}</span></p>`);
}
function checkinSheet(stayId) {
  const b = DB.d.bookings.find(x => x.id === stayId), c = b.checkin || {};
  sheet(sheetHead('Онлайн-регистрация', 'Заполните сейчас, и на месте сразу получите ключ') + `<div class="form">
    ${field('Фамилия, имя, отчество', `<input id="ci-n" class="inp" autocomplete="name" value="${esc(c.name || b.guest)}">`)}
    <div class="row2">${field('Дата рождения', `<input id="ci-b" class="inp" type="date" value="${esc(c.birth || '')}">`)}${field('Паспорт, серия и номер', `<input id="ci-p" class="inp" inputmode="numeric" placeholder="0000 000000" value="${esc(c.passport || '')}">`)}</div>
    <div class="row2">${field('Приедем к', `<select id="ci-a" class="inp">${options(['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', 'позже 21:00'], c.arrive || '14:00')}</select>`)}${field('Номер машины', `<input id="ci-c" class="inp" placeholder="А123ВС 77" value="${esc(c.car || '')}">`)}</div>
    ${consentBox('ci-ok')}
    <button class="btn block" onclick="saveCheckin(${stayId})">Отправить</button>
    <p class="small muted">Паспортные данные нужны для регистрации гостей по закону и хранятся только у базы.</p></div>`);
}
function saveCheckin(id) {
  if (!val('ci-n') || !val('ci-p')) return toast('Укажите ФИО и паспорт');
  if (!$('#ci-ok').checked) return toast('Нужно согласие на обработку данных');
  DB.onlineCheckin(id, { name: val('ci-n'), birth: val('ci-b'), passport: val('ci-p'), arrive: val('ci-a'), car: val('ci-c') });
  closeSheet(); render(); toast('Регистрация пройдена, ждём вас');
}
function earlyLate(id, kind) {
  const fee = kind === 'early' ? DB.S.earlyFee : DB.S.lateFee;
  ask(kind === 'early' ? 'Ранний заезд с 10:00?' : 'Поздний выезд до 16:00?', `${money(fee)} добавятся в общий счёт дома.`, 'Подтвердить', () => { const r = DB.setEarlyLate(id, kind); toast(r.ok ? 'Готово, ждём вас' : r.msg); render(); });
}
function folioSheet() {
  const stay = myStay(), f = DB.folio(stay.id), total = sum(f), n = stay.group ? stay.group.members.length : 1;
  sheet(sheetHead('Общий счёт дома', esc(DB.unit(stay.unitId).name)) + `<div class="card flat"><div class="list">${f.map(x => `<div class="li"><span class="li-main small">${esc(x.title)}</span><b>${money(x.amount)}</b></div>`).join('')}</div></div>
    <div class="total"><span class="muted">Итого${n > 1 ? `, по ${money(total / n)} на ${plural(n, 'человека', 'человек', 'человек')}` : ''}</span><b>${money(total)}</b></div>
    <button class="btn block" onclick="paySheet({title:'Общий счёт дома',amount:${total},onPaid:(m)=>{DB.settleFolio(${stay.id},m);render();toast('Счёт оплачен, чек отправлен')}})">Оплатить сейчас</button>
    <p class="small muted" style="text-align:center">Можно оплатить и при выезде у администратора.</p>`);
}
function groupSheet() {
  const stay = myStay(), url = location.href.split('#')[0] + '#join-' + stay.group.code;
  sheet(sheetHead('Компания', 'Друзья по ссылке видят Wi-Fi, правила, заказы и общий счёт') + `
    <div class="code" id="grp-url">${esc(url)}</div>
    <button class="btn block" onclick="copyText(document.getElementById('grp-url').textContent,'Ссылка скопирована, отправьте её друзьям')">${ic('copy', 'sm')} Скопировать приглашение</button>
    <div class="card"><span class="h2">Уже в компании: ${stay.group.members.length}</span><span class="small muted">Общий счёт делится поровну на всех, кто присоединился. Каждый может оплатить свою часть.</span></div>`);
}
function reviewSheet(stayId, starsN, keep) {
  if (!keep) S.rv = { stars: starsN, tags: [] };
  const r = S.rv, tags = ['Чистота', 'Тишина', 'Баня', 'Персонал', 'Еда', 'Квадроциклы'];
  sheet(sheetHead('Ваш отзыв', 'Полминуты, а нам очень важно') + `<div class="rate big">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= r.stars ? 'on' : ''}" aria-label="${n} из 5" onclick="S.rv.stars=${n};reviewSheet(${stayId},0,1)">★</button>`).join('')}</div>
    <span class="small muted">${r.stars >= 4 ? 'Что понравилось больше всего?' : 'Что пошло не так?'}</span>
    <div class="opts">${tags.map(t => `<button class="opt ${r.tags.includes(t) ? 'on' : ''}" onclick="S.rv.tags=S.rv.tags.includes('${t}')?S.rv.tags.filter(x=>x!=='${t}'):S.rv.tags.concat('${t}');reviewSheet(${stayId},0,1)">${t}</button>`).join('')}</div>
    <textarea id="rv-t" class="inp" placeholder="Пара слов своими словами">${esc(r.text || '')}</textarea>
    <button class="btn block" onclick="sendReview(${stayId})">Отправить</button>`);
  $('#rv-t').oninput = e => { S.rv.text = e.target.value; };
}
function sendReview(stayId) {
  const r = S.rv, stay = DB.d.bookings.find(b => b.id === stayId);
  DB.addReview(S.user, stay, r.stars, r.tags, val('rv-t'));
  if (r.stars >= 4) sheet(sheetHead('Спасибо!', 'Нам очень приятно') + `<p>Если не сложно, оставьте этот же отзыв на Яндекс Картах. Так нас найдут другие любители леса.</p>
    <a class="btn block" href="${CAT.road.mapUrl}" target="_blank" rel="noopener">${ic('star', 'sm')} Оставить на Яндекс Картах</a><button class="btn block ghost" onclick="closeSheet();render()">Не сейчас</button>`);
  else { closeSheet(); render(); toast('Спасибо. Управляющий уже видит ваш отзыв и свяжется с вами'); }
}
function sosSheet() {
  sheet(sheetHead('Экстренная помощь', 'Сигнал сразу получат администратор и персонал на смене') +
    `<div class="list">${[['Заблудился в лесу', 'map'], ['Плохо с самочувствием', 'alert'], ['Пожар или дым', 'flame'], ['Нужна помощь', 'sos']].map(([k, i]) => `<button class="check sosopt" onclick="DB.addSos(S.user,'${k}','${myUnit() ? myUnit().id : ''}');closeSheet();render();toast('Сигнал отправлен, к вам уже идут')">${ic(i)}<span>${k}</span></button>`).join('')}</div>
    <a class="btn block danger" href="tel:112">При угрозе жизни звоните 112</a><p class="small muted" style="text-align:center">Телефон администратора: <span style="user-select:all">${CAT.adminPhone}</span></p>`);
}

// =====================================================================
//  Услуги: главное, еда, прокат, ещё
// =====================================================================
V.g_shop = () => {
  const tab = S.shopTab || 'main';
  const body = { main: shopMain, food: shopFood, rent: shopRent, more: shopMore }[tab]();
  return head('Всё, что можно заказать к дому', 'Услуги') + `<div class="seg">${[['main', 'Главное'], ['food', 'Еда'], ['rent', 'Прокат'], ['more', 'Ещё']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="S.shopTab='${k}';render()">${l}</button>`).join('')}</div>` + body;
};
function shopMain() {
  const sauna = DB.unit('s1'), n = sum(Object.values(S.cart), x => x), total = sum(CAT.goods, g => (S.cart[g.id] || 0) * g.price);
  const freeToday = sauna ? DB.freeStarts('s1', T.today(), 120) : [];
  return (sauna ? `<section class="hero wide"><div class="hero-img">${unitScene(sauna)}</div><div class="hero-in"><div class="hero-row"><span class="glass"><b>${money(sauna.price)}</b> в час</span><span class="glass">${freeToday.length ? `Сегодня свободно с ${T.hm(freeToday[0])}` : 'Сегодня всё занято'}</span></div>
    <div><h2>${esc(sauna.name)}</h2><p>${esc(sauna.desc)} Растопим к вашему приходу.</p><button class="btn" style="margin-top:14px;background:#fff;color:#0a0c0b" onclick="saunaSheet()">Выбрать время</button></div></div></section>` : '') + `
  <section class="hero wide"><div class="hero-img">${scene('quad', 5)}</div><div class="hero-in"><div class="hero-row"><span class="glass"><b>${money(CAT.quad.pricePerHour)}</b> в час</span>${DB.S.weatherStop ? '<span class="glass">Сегодня закрыто из-за погоды</span>' : ''}</div>
    <div><h2>Квадроциклы</h2><p>Лесные маршруты с инструктором, шлем и экипировка включены.</p><button class="btn" style="margin-top:14px;background:#fff;color:#0a0c0b" onclick="gQuadSheet()">Записаться</button></div></div></section>
  <div class="sec"><span class="h2">Принесём к дому или беседке</span></div>
  <section class="card flat"><div class="list">${CAT.goods.map(g => { const c = S.cart[g.id] || 0; return `<div class="li"><span class="li-main"><span class="li-t">${g.name}</span><br><span class="li-s">${g.unit}, ${money(g.price)}</span></span><span class="stepper">${c ? `<button aria-label="Меньше" onclick="cart('${g.id}',-1)">−</button><b>${c}</b>` : ''}<button class="add" aria-label="Добавить ${g.name}" onclick="cart('${g.id}',1)">+</button></span></div>`; }).join('')}</div></section>
  ${n ? `<button class="btn block" onclick="orderSheet('goods')">Заказать, ${money(total)}</button>` : ''}`;
}
function shopFood() {
  const f = S.food || {}, n = sum(Object.values(f), x => x), total = sum(CAT.menu, m => (f[m.id] || 0) * m.price);
  const cats = [...new Set(CAT.menu.map(m => m.cat))];
  return cats.map(c => `<div class="sec"><span class="h2">${c}</span></div><section class="card flat"><div class="list">${CAT.menu.filter(m => m.cat === c).map(m => { const k = f[m.id] || 0; return `<div class="li"><span class="li-main"><span class="li-t">${esc(m.name)}</span><br><span class="li-s">${esc(m.desc)}. ${money(m.price)} ${esc(m.per)}${m.when ? ', ' + m.when : ''}</span></span><span class="stepper">${k ? `<button aria-label="Меньше" onclick="foodAdd('${m.id}',-1)">−</button><b>${k}</b>` : ''}<button class="add" aria-label="Добавить" onclick="foodAdd('${m.id}',1)">+</button></span></div>`; }).join('')}</div></section>`).join('') +
    (n ? `<button class="btn block" onclick="orderSheet('food')">Заказать, ${money(total)}</button>` : '<p class="small muted" style="padding:0 4px">Завтрак привезём в корзине к дому, мясо для мангала замаринуем заранее.</p>');
}
function shopRent() {
  const t = T.today();
  return ['Лето', 'Зима', 'Круглый год'].map(sn => { const items = CAT.rentals.filter(r => r.season === sn); return items.length ? `<div class="sec"><span class="h2">${sn}</span></div><section class="card flat"><div class="list">${items.map(it => { const left = DB.rentalLeft(it.id, t); return `<div class="li"><span class="li-main"><span class="li-t">${esc(it.name)}</span><br><span class="li-s">${it.price ? `${money(it.price)} за ${it.unit === 'час' ? 'час' : it.unit === 'день' ? 'день' : 'всё проживание'}` : 'бесплатно'}, сегодня свободно ${left} из ${it.qty}</span></span><button class="btn sm ghost" onclick="rentSheet('${it.id}')">Взять</button></div>`; }).join('')}</div></section>` : ''; }).join('');
}
function shopMore() {
  const t = T.today(), evs = DB.d.events.filter(e => e.date >= t).sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
  return `<div class="sec"><span class="h2">Афиша</span></div>` + (evs.map(e => { const n = e.going.reduce((a, g) => a + g.n, 0); return `<button class="card" style="text-align:left" onclick="eventSheet2(${e.id})"><div class="card-h"><span class="small muted">${cap(T.rel(e.date))}, ${T.hm(e.time)}</span><span class="small">${e.price ? money(e.price) : 'бесплатно'}</span></div><span class="h2">${esc(e.title)}</span><span class="small muted">${esc(e.desc)} Осталось мест: ${e.places - n}.</span></button>`; }).join('') || '<p class="empty">Скоро здесь появятся события.</p>') + `
  <div class="sec"><span class="h2">Поводы и сюрпризы</span></div>
  ${CAT.packages.map(p => `<section class="card"><div class="card-h"><span class="h2">${esc(p.name)}</span><b>${money(p.price)}</b></div><span class="small">${esc(p.desc)}</span><button class="btn sm ghost" onclick="pkgSheet('${p.id}')">Заказать</button></section>`).join('')}
  <div class="sec"><span class="h2">Рядом с нами</span></div>
  <section class="card flat"><div class="list">${CAT.partners.map(p => `<div class="li"><span class="li-ic">${ic('route')}</span><span class="li-main"><span class="li-t">${esc(p.service)}</span><br><span class="li-s">${esc(p.name)}, ${esc(p.distance)}, ${money(p.price)}</span></span><button class="btn sm ghost" onclick="partnerSheet('${p.id}')">Записаться</button></div>`).join('')}</div></section>
  <div class="sec"><span class="h2">Подарки и абонементы</span></div>
  <div class="tiles"><button class="tile" onclick="certBuySheet()"><span class="li-ic">${ic('gift')}</span><b>Подарочный сертификат</b><span>на любую сумму, на дом, баню и услуги</span></button>
  ${CAT.passes.map(p => `<button class="tile" onclick="passBuy('${p.id}')"><span class="li-ic">${ic('ticket')}</span><b>${esc(p.name)}</b><span>${money(p.price)}, ${esc(p.note)}</span></button>`).join('')}
  <button class="tile" onclick="corpSheet(true)"><span class="li-ic">${ic('users')}</span><b>Корпоратив или праздник</b><span>посчитаем смету за минуту</span></button></div>`;
}

function cart(id, n) { S.cart[id] = Math.max(0, (S.cart[id] || 0) + n); if (!S.cart[id]) delete S.cart[id]; render(); }
function foodAdd(id, n) { S.food = S.food || {}; S.food[id] = Math.max(0, (S.food[id] || 0) + n); if (!S.food[id]) delete S.food[id]; render(); }
// Заказ дров, углей или еды: куда, когда, оплата
function orderSheet(kind) {
  const isFood = kind === 'food', src = isFood ? CAT.menu : CAT.goods, bag = isFood ? (S.food || {}) : S.cart;
  const unit = myUnit(), now = new Date().getHours(), items = src.filter(g => bag[g.id]);
  const times = [['как можно скорее', 'Как можно скорее']]; for (let h = Math.max(isFood ? 8 : 9, now + 1); h <= 22; h++) times.push([`к ${T.pad(h)}:00`, `К ${T.pad(h)}:00`]);
  if (isFood) for (let h = 8; h <= 11; h++) times.push([`завтра к ${T.pad(h)}:00`, `Завтра к ${T.pad(h)}:00`]);
  sheet(sheetHead(isFood ? 'Заказ еды' : 'Ваш заказ') + `<div class="card flat"><div class="list">${items.map(g => `<div class="li"><span class="li-main">${esc(g.name)} × ${bag[g.id]}</span><b>${money(g.price * bag[g.id])}</b></div>`).join('')}</div></div><div class="form">
    ${field('Куда принести', `<select id="o-unit" class="inp">${options(DB.d.units.map(u => [u.id, u.short]), unit ? unit.id : 'g1')}</select>`)}
    ${field('Когда', `<select id="o-time" class="inp">${options(times)}</select>`)}
    ${field('Комментарий', `<input id="o-note" class="inp" placeholder="Необязательно">`)}
    <div class="total"><span class="muted">Итого</span><b>${money(sum(items, g => g.price * bag[g.id]))}</b></div>
    <button class="btn block" onclick="placeOrder('${kind}')">Перейти к оплате</button></div>`);
}
function placeOrder(kind) {
  const isFood = kind === 'food', src = isFood ? CAT.menu : CAT.goods, bag = isFood ? S.food : S.cart;
  const items = src.filter(g => bag[g.id]), u = DB.unit(val('o-unit')), total = sum(items, g => g.price * bag[g.id]);
  const title = items.map(g => `${g.name.split(',')[0]} ×${bag[g.id]}`).join(', '), due = val('o-time'), note = val('o-note');
  needContact(() => payFor(title, total, (m) => {
    DB.addTask({ title, unitId: u.id, place: u.short, tpl: isFood ? 'food' : 'delivery', due, guest: S.user.name, login: S.user.login, note }, true);
    DB.addTx(Object.assign({ type: 'in', amount: total, cat: isFood ? 'food' : 'goods', title: `${title}, ${u.short}`, method: m }, folioOf(m)));
    if (!isFood) items.forEach(g => { if (['wood', 'coal', 'vb', 'vo'].includes(g.id)) DB.stockAdjust(g.id, -bag[g.id]); });
    if (isFood) S.food = {}; else S.cart = {};
    go('g_home'); toast('Заказ принят, уже собираем');
  }));
}

function saunaSheet(keep) {
  if (!keep) S.gs = { date: T.today(), dur: 2, start: null, vb: 0, vo: 0 };
  const g = S.gs, u = DB.unit('s1'), starts = DB.freeStarts('s1', g.date, g.dur * 60);
  if (!starts.includes(g.start)) g.start = null;
  const vb = CAT.goods.find(x => x.id === 'vb'), vo = CAT.goods.find(x => x.id === 'vo');
  const total = g.dur * u.price + g.vb * vb.price + g.vo * vo.price;
  const pass = DB.d.passes.find(p => p.login === S.user.login && p.left > 0 && CAT.passes.find(x => x.id === p.productId).kind === 'sauna');
  const stepper = (k, c) => `<span class="stepper">${c ? `<button aria-label="Меньше" onclick="S.gs.${k}--;saunaSheet(1)">−</button><b>${c}</b>` : ''}<button class="add" aria-label="Добавить" onclick="S.gs.${k}++;saunaSheet(1)">+</button></span>`;
  sheet(sheetHead(esc(u.name), `${money(u.price)} в час, до ${u.capacity} человек`) + `<div class="form">
    ${dayOpts(4, g.date, "(d=>{S.gs.date=d;saunaSheet(1)})")}
    <div class="seg in">${[2, 3, 4].map(h => `<button class="${g.dur === h ? 'on' : ''}" onclick="S.gs.dur=${h};saunaSheet(1)">${h} часа</button>`).join('')}</div>
    <span class="small muted" style="padding-left:4px">Свободное время. После каждой компании 90 минут на уборку и растопку</span>
    <div class="opts">${starts.length ? starts.map(s => `<button class="opt ${g.start === s ? 'on' : ''}" onclick="S.gs.start=${s};saunaSheet(1)">${T.hm(s)}</button>`).join('') : '<p class="muted">На этот день всё занято, попробуйте другой.</p>'}</div>
    <div class="card flat"><div class="list"><div class="li"><span class="li-main"><span class="li-t">${vb.name}</span><br><span class="li-s">${money(vb.price)}</span></span>${stepper('vb', g.vb)}</div><div class="li"><span class="li-main"><span class="li-t">${vo.name}</span><br><span class="li-s">${money(vo.price)}</span></span>${stepper('vo', g.vo)}</div></div></div>
    <div class="total"><span class="muted">${g.start ? `${T.rel(g.date)}, ${T.hm(g.start)}–${T.hm(g.start + g.dur * 60)}` : 'Выберите время'}</span><b>${money(total)}</b></div>
    <button class="btn block" ${g.start ? '' : 'disabled'} onclick="bookSauna()">Забронировать</button>
    ${pass && g.start ? `<button class="btn block ghost" onclick="bookSauna(true)">${ic('ticket', 'sm')} По абонементу, осталось ${pass.left}</button>` : ''}</div>`);
}
function bookSauna(byPass) {
  const g = S.gs, u = DB.unit('s1'), me = S.user;
  const ven = [g.vb ? `веник берёзовый ×${g.vb}` : '', g.vo ? `веник дубовый ×${g.vo}` : ''].filter(Boolean).join(', ');
  const venSum = g.vb * 450 + g.vo * 550;
  const done = (m) => {
    const r = DB.addHour(Object.assign({ unitId: 's1', date: g.date, from: g.start, to: g.start + g.dur * 60, guest: me.name, login: me.login, phone: me.phone, source: 'Приложение', amount: byPass ? 0 : g.dur * u.price, method: byPass ? 'Абонемент' : m, note: ven ? cap(ven) : '' }, folioOf(m)));
    if (!r.ok) { toast(r.msg); return saunaSheet(1); }
    if (byPass) { const p = DB.d.passes.find(x => x.login === me.login && x.left > 0); p.left--; DB.save(); }
    if (ven) { DB.addTx(Object.assign({ type: 'in', amount: venSum, cat: 'goods', title: `${ven}, ${me.name}`, method: m || 'Карта' }, folioOf(m))); DB.stockAdjust('vb', -g.vb); DB.stockAdjust('vo', -g.vo); }
    DB.notify(me.login, `Баня забронирована на ${T.rel(g.date)}, ${T.hm(g.start)}. Растопим к вашему приходу`, 'flame', 'g_home');
    go('g_home'); toast(`Баня ваша: ${T.rel(g.date)} в ${T.hm(g.start)}`);
  };
  needContact(() => byPass ? (venSum ? payFor('Веники', venSum, done) : done('Абонемент')) : payFor(`Баня, ${T.rel(g.date)} ${T.hm(g.start)}`, g.dur * u.price + venSum, done));
}

function gQuadSheet(keep) {
  if (!keep) S.gq = { date: T.today(), slot: null, dur: 1, ok1: false, ok2: false, sign: S.user.qr || S.user.visitor ? '' : S.user.name, briefed: false, briefStep: 0 };
  briefTarget = () => S.gq;
  const g = S.gq, now = g.date === T.today() ? new Date().getHours() : 0;
  const slots = CAT.quad.slots.filter(h => h > now && DB.freeQuad(g.date, h * 60, g.dur * 60));
  if (!slots.includes(g.slot)) g.slot = null;
  const ready = g.slot && g.ok1 && g.ok2 && g.briefed && g.sign.trim().length > 1;
  sheet(sheetHead('Квадроциклы', `${money(CAT.quad.pricePerHour)} в час, с инструктором`) + `<div class="form">
    ${dayOpts(3, g.date, "(d=>{S.gq.date=d;gQuadSheet(1)})")}
    <div class="seg in">${[1, 2].map(h => `<button class="${g.dur === h ? 'on' : ''}" onclick="S.gq.dur=${h};gQuadSheet(1)">${h === 1 ? '1 час' : '2 часа'}</button>`).join('')}</div>
    <div class="opts">${DB.S.weatherStop ? '<p class="muted">Сегодня выезды закрыты из-за погоды. Выберите другой день.</p>' : slots.length ? slots.map(h => `<button class="opt ${g.slot === h ? 'on' : ''}" onclick="S.gq.slot=${h};gQuadSheet(1)">${T.pad(h)}:00</button>`).join('') : '<p class="muted">На этот день свободной техники нет.</p>'}</div>
    ${briefingHTML(g, 'gQuadSheet(1)')}
    <div class="card"><span class="h2">Техника безопасности</span><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px" class="small">${CAT.safety.map(s => `<li>${s}</li>`).join('')}</ul></div>
    <label class="check"><input type="checkbox" id="gq-1" ${g.ok1 ? 'checked' : ''} ${g.briefed ? '' : 'disabled'} onchange="S.gq.ok1=this.checked;gQuadSheet(1)"><span>Посмотрел инструктаж, прочитал правила и буду их соблюдать</span></label>
    <label class="check"><input type="checkbox" id="gq-2" ${g.ok2 ? 'checked' : ''} onchange="S.gq.ok2=this.checked;gQuadSheet(1)"><span>${CAT.offer}</span></label>
    ${field('Подпись: имя и фамилия', `<input id="gq-sign" class="inp" value="${esc(g.sign)}" oninput="S.gq.sign=this.value;gqReady()" autocomplete="name">`)}
    <div class="total"><span class="muted">${g.slot ? `${T.rel(g.date)}, ${T.pad(g.slot)}:00` : 'Выберите время'}</span><b>${money(CAT.quad.pricePerHour * g.dur)}</b></div>
    <button class="btn block" id="gq-go" ${ready ? '' : 'disabled'} onclick="bookQuad()">Подписать и оплатить</button></div>`);
}
function gqReady() { const g = S.gq; $('#gq-go').disabled = !(g.slot && g.ok1 && g.ok2 && g.briefed && g.sign.trim().length > 1); }
function bookQuad() {
  const g = S.gq, me = S.user;
  needContact(() => payFor(`Квадроцикл, ${g.dur} ч`, CAT.quad.pricePerHour * g.dur, (m) => {
    const quadId = DB.freeQuad(g.date, g.slot * 60, g.dur * 60);
    if (!quadId) { toast('Это время только что заняли'); return gQuadSheet(1); }
    DB.addRide(Object.assign({ guest: g.sign.trim(), login: me.login, quadId, date: g.date, from: g.slot * 60, dur: g.dur * 60, route: CAT.quad.routes[g.dur - 1], amount: CAT.quad.pricePerHour * g.dur, method: m, signed: true, briefed: true, signedAs: g.sign.trim(), signedAt: Date.now() }, folioOf(m)));
    go('g_home'); toast(`Записали: ${T.rel(g.date)} в ${T.pad(g.slot)}:00. Инструктор встретит у квадропарка`);
  }));
}

function rentSheet(id, keep) {
  const it = CAT.rentals.find(x => x.id === id);
  if (!keep) S.gr = { date: T.today(), from: Math.min(20, Math.max(9, new Date().getHours() + 1)) * 60, hours: 1 };
  const g = S.gr, left = DB.rentalLeft(id, g.date), perHour = it.unit === 'час', price = it.price * (perHour ? g.hours : it.unit === 'день' ? g.hours : 1);
  sheet(sheetHead(esc(it.name), it.price ? `${money(it.price)} за ${it.unit === 'проживание' ? 'всё проживание' : it.unit}` : 'Бесплатно') + `<div class="form">
    ${dayOpts(4, g.date, "(d=>{S.gr.date=d;rentSheet('" + id + "',1)})")}
    ${it.unit !== 'проживание' ? `<div class="row2">${field('Во сколько', `<select id="rt-f" class="inp" onchange="S.gr.from=Number(this.value)">${options(Array.from({ length: 13 }, (_, i) => [(9 + i) * 60, `${T.pad(9 + i)}:00`]), g.from)}</select>`)}${field(perHour ? 'Часов' : 'Дней', `<select id="rt-h" class="inp" onchange="S.gr.hours=Number(this.value);rentSheet('${id}',1)">${options([1, 2, 3, 4], g.hours)}</select>`)}</div>` : ''}
    <p class="small muted">${left > 0 ? `Свободно ${left} из ${it.qty}. Выдадим у администратора, сфотографируем состояние при выдаче.` : 'На этот день всё разобрали.'}</p>
    <div class="total"><span class="muted">К оплате</span><b>${money(price)}</b></div>
    <button class="btn block" ${left > 0 ? '' : 'disabled'} onclick="bookRent('${id}',${price})">${price ? 'Забронировать' : 'Попросить'}</button></div>`);
}
function bookRent(id, price) {
  const g = S.gr, me = S.user, done = m => {
    const r = DB.addRental(Object.assign({ itemId: id, login: me.login, guest: me.name, date: g.date, from: g.from, hours: g.hours, amount: price, method: m }, folioOf(m)));
    if (!r.ok) return toast(r.msg);
    go('g_home'); toast('Забронировали, заберите у администратора');
  };
  needContact(() => price ? payFor(`Прокат: ${CAT.rentals.find(x => x.id === id).name}`, price, done) : done('Бесплатно'));
}
function pkgSheet(id) {
  const p = CAT.packages.find(x => x.id === id), unit = myUnit();
  sheet(sheetHead(esc(p.name), money(p.price)) + `<p>${esc(p.desc)}</p><div class="form">
    ${field('Когда подготовить', `<input id="pk-d" class="inp" type="date" min="${T.today()}" value="${myStay() && myStay().start > T.today() ? myStay().start : T.today()}">`)}
    ${field('Где', `<select id="pk-u" class="inp">${options(DB.d.units.map(u => [u.id, u.short]), unit ? unit.id : 'h1')}</select>`)}
    ${field('Пожелания', '<textarea id="pk-n" class="inp" placeholder="Имя, возраст, любимые цвета, аллергии"></textarea>')}
    <button class="btn block" onclick="bookPkg('${id}')">Заказать</button></div>`);
}
function bookPkg(id) {
  const p = CAT.packages.find(x => x.id === id), u = DB.unit(val('pk-u')), date = val('pk-d'), note = val('pk-n');
  needContact(() => payFor(p.name, p.price, (m) => {
    DB.addTask({ title: `Подготовить «${p.name}»`, unitId: u.id, place: u.short, tpl: 'package', due: `к ${T.rel(date)}`, guest: S.user.name, login: S.user.login, note: [p.desc, note].filter(Boolean).join(' Пожелания: ') }, true);
    DB.addTx(Object.assign({ type: 'in', amount: p.price, cat: 'extra', title: `${p.name}, ${S.user.name}`, method: m }, folioOf(m)));
    go('g_home'); toast('Принято, всё подготовим');
  }));
}
function eventSheet2(id) {
  const e = DB.d.events.find(x => x.id === id), left = e.places - e.going.reduce((a, g) => a + g.n, 0);
  S.evN = S.evN || 2;
  sheet(sheetHead(esc(e.title), `${cap(T.rel(e.date))}, ${T.hm(e.time)}. ${e.price ? money(e.price) + ' с человека' : 'Бесплатно'}`) + `<p>${esc(e.desc)}</p>
    <div class="li" style="border:0"><span class="li-main">Сколько вас</span><span class="stepper"><button aria-label="Меньше" onclick="S.evN=Math.max(1,S.evN-1);eventSheet2(${id})">−</button><b>${S.evN}</b><button class="add" aria-label="Больше" onclick="S.evN=Math.min(${left},S.evN+1);eventSheet2(${id})">+</button></span></div>
    <p class="small muted">Осталось мест: ${left}</p>
    <button class="btn block" ${left > 0 ? '' : 'disabled'} onclick="joinEv(${id})">${e.price ? `Записаться, ${money(e.price * S.evN)}` : 'Записаться'}</button>`);
}
function joinEv(id) {
  const e = DB.d.events.find(x => x.id === id), n = S.evN;
  const done = () => { const r = DB.joinEvent(id, S.user, n); if (!r.ok) return toast(r.msg); go('g_home'); toast('Записали, ждём вас'); };
  needContact(() => e.price ? payFor(e.title, e.price * n, () => done()) : done());
}
function partnerSheet(id) {
  const p = CAT.partners.find(x => x.id === id);
  sheet(sheetHead(esc(p.service), `${esc(p.name)}, ${esc(p.distance)}`) + `<div class="form">
    <div class="row2">${field('День', `<input id="pt-d" class="inp" type="date" min="${T.today()}" value="${T.addDays(T.today(), 1)}">`)}${field('Человек', '<input id="pt-n" class="inp" type="number" min="1" value="2">')}</div>
    <div class="total"><span class="muted">Оплата на месте у партнёра</span><b>${money(p.price)} с человека</b></div>
    <button class="btn block" onclick="bookPartner('${id}')">Отправить заявку</button><p class="small muted" style="text-align:center">Администратор согласует время с партнёром и напишет вам в чат.</p></div>`);
}
function bookPartner(id) {
  const p = CAT.partners.find(x => x.id === id), n = Number(val('pt-n')) || 1, date = val('pt-d');
  needContact(() => { DB.addLead({ kind: 'partner', partnerId: id, name: S.user.name, phone: S.user.phone, text: `${p.service}, ${p.name}: ${n} чел., ${T.dm(date)}`, amount: p.price * n, commission: Math.round(p.price * n * p.commission / 100) }); closeSheet(); toast('Заявка отправлена, ответим в чате'); });
}
function certBuySheet() {
  sheet(sheetHead('Подарочный сертификат', 'Действует год на любые дома и услуги') + `<div class="form"><div class="opts">${[5000, 10000, 15000, 25000].map(a => `<button class="opt" onclick="document.getElementById('gc-a').value=${a}">${money(a)}</button>`).join('')}</div>
    ${field('Сумма, ₽', '<input id="gc-a" class="inp" type="number" min="1000" step="500" value="10000">')}${field('Кому и с чем поздравляете', '<input id="gc-t" class="inp" placeholder="Например: маме на юбилей">')}
    <button class="btn block" onclick="buyCert()">Оплатить</button></div>`);
}
function buyCert() {
  const a = Number(val('gc-a')), to = val('gc-t'); if (!(a >= 1000)) return toast('Минимум 1 000 ₽');
  needContact(() => paySheet({ title: 'Подарочный сертификат', amount: a, allowBonus: false, onPaid: () => {
    const c = DB.buyCert(a, S.user.name, to, S.user.login);
    sheet(sheetHead('Сертификат готов', money(a)) + `<div class="certcard"><span>Медвежий угол</span><b>${money(a)}</b><span class="num" style="user-select:all">${c.code}</span><small>${esc(to || 'Подарок')}</small></div>
      <button class="btn block" onclick="copyText('${c.code}','Код скопирован')">${ic('copy', 'sm')} Скопировать код</button><p class="small muted" style="text-align:center">Получатель вводит код при оплате в приложении.</p>`);
  } }));
}
function passBuy(id) {
  const p = CAT.passes.find(x => x.id === id);
  needContact(() => paySheet({ title: p.name, amount: p.price, allowBonus: false, onPaid: () => { const ps = DB.buyPass(id, S.user); go('g_me'); toast(`Абонемент ${ps.code} ваш`); } }));
}

// =====================================================================
//  Чат
// =====================================================================
V.g_chat = () => {
  const ms = DB.d.messages.filter(m => m.login === S.user.login);
  return head('Отвечаем с 8:00 до 23:00', 'Чат с администратором') + (ms.length ? bubbles(ms, 'guest') : '<p class="empty">Напишите, если что-то нужно: подскажем, принесём, починим.</p>') + `
  <p class="small muted" style="text-align:center;padding-bottom:64px">Срочно? Позвоните: <span style="user-select:all">${CAT.adminPhone}</span></p>
  <form class="composer fixed" onsubmit="event.preventDefault();sendMsg()"><input id="msg" class="inp" placeholder="Сообщение" autocomplete="off" aria-label="Сообщение"><button class="iconbtn" aria-label="Отправить">${ic('send', 'sm')}</button></form>`;
};
function sendMsg() { const text = val('msg'); if (!text) return; DB.send(S.user.login, S.user.name, 'guest', text); render(); $('#msg').focus(); }

// =====================================================================
//  Брони и каталог домов
// =====================================================================
V.g_book = () => {
  const d = DB.d, u = S.user, t = T.today();
  const mine = d.bookings.filter(b => b.start && b.login === u.login).sort((a, b) => a.start < b.start ? 1 : -1);
  const waits = d.waitlist.filter(w => w.login === u.login && w.end >= t);
  return head('Ваши поездки и свободные дома', 'Брони') +
  (mine.length ? `<section class="card flat"><div class="list">${mine.map(b => { const un = DB.unit(b.unitId); return `<div class="li"><span class="thumb">${unitScene(un)}</span><span class="li-main"><span class="li-t">${esc(un.name)}</span><br><span class="li-s">${T.dm(b.start)} – ${T.dm(b.end)}, ${money(b.amount)}</span></span><span class="chip ${b.end < t || b.closed ? '' : 'ok'}">${b.end < t || b.closed ? 'Прошла' : b.paid ? 'Оплачена' : 'Подтверждена'}</span></div>`; }).join('')}</div></section>` : '') +
  (waits.length ? `<section class="card"><span class="h2">Лист ожидания</span>${waits.map(w => `<span class="small">${esc(DB.unit(w.unitId).short)}, ${T.dm(w.start)} – ${T.dm(w.end)}${w.offered ? '. <b style="color:var(--ok)">Освободилось, бронируйте!</b>' : '. Сообщим, если освободится'}</span>`).join('')}</section>` : '') + `
  <div class="sec"><span class="h2">Дома</span><span class="small muted">выходные дороже, будни рядом дешевле</span></div>` +
  d.units.filter(x => x.kind === 'house').map(x => { const from = Math.min(...Array.from({ length: 14 }, (_, i) => DB.nightPrice(x, T.addDays(t, i)).price)); return `<section class="hero wide"><div class="hero-img">${unitScene(x)}</div><div class="hero-in"><div class="hero-row"><span class="glass">от <b>${money(from)}</b> за ночь</span><span class="glass">${ic('users', 'sm')} до ${x.capacity}</span></div>
    <div><h2>${esc(x.name)}</h2><p>${esc(x.desc)}</p><button class="btn sm" style="margin-top:12px;background:#fff;color:#0a0c0b" onclick="gStaySheet('${x.id}')">Забронировать</button></div></div></section>`; }).join('');
};
function gStaySheet(unitId) {
  const u = DB.unit(unitId), me = S.user, t = T.today();
  const info = CAT.houses[u.id] || {}, seed = u.id.charCodeAt(1);
  // Свои фото: перечислите файлы в catalog.js, раздел houses → photos. Пока их нет, показываем три рисунка
  const frames = info.photos && info.photos.length ? info.photos.map(p => [scene('', 0, p), ''])
    : [[scene(u.scene, seed, '', 'aframe'), 'Вечер'], [scene(u.scene, seed, '', 'barn'), 'Ночь'], [scene(u.scene, seed + 2, '', 'creek'), 'Утро']];
  sheet(sheetHead(esc(u.name), `от ${money(u.price)} за ночь, до ${u.capacity} гостей`) + `
    <div class="gal" aria-label="Фотографии дома">${frames.map(([h, c], i) => `<figure class="gal-i">${h}<figcaption class="glass">${c ? c + ', ' : ''}${i + 1} из ${frames.length}</figcaption></figure>`).join('')}</div>
    <p class="story">${esc(info.story || u.desc)}</p>
    <div class="opts">${(info.features || []).concat([`До ${u.capacity} гостей`, `Заезд с ${CAT.checkIn}`]).map(f => `<span class="chip plain">${esc(f)}</span>`).join('')}</div>
    <div class="sec" style="padding-top:4px"><span class="h2">Даты и гости</span></div>
    <div class="form"><input type="hidden" id="gb-unit" value="${u.id}">
    <div class="row2">${field('Заезд', `<input id="gb-start" class="inp" type="date" min="${t}" value="${T.addDays(t, 1)}" onchange="gCalc()">`)}${field('Выезд', `<input id="gb-end" class="inp" type="date" min="${t}" value="${T.addDays(t, 3)}" onchange="gCalc()">`)}</div>
    <div class="row2">${field('Гостей', `<input id="gb-count" class="inp" type="number" min="1" max="${u.capacity}" value="2">`)}${field('Промокод', `<input id="gb-promo" class="inp" placeholder="Если есть" onchange="gCalc()">`)}</div>
    <div class="card flat" id="gb-sum"></div>
    <button class="btn block" id="gb-go" onclick="gBook()">Оплатить и забронировать</button>
    <button class="btn block ghost" id="gb-wait" hidden onclick="gWait()">Встать в лист ожидания</button>
    <p class="small muted" style="text-align:center">Заезд с ${CAT.checkIn}, выезд до ${CAT.checkOut}. Бесплатная отмена за 7 дней до заезда.</p></div>`);
  gCalc();
}
function gCalc() {
  const u = DB.unit(val('gb-unit')), s = val('gb-start'), e = val('gb-end');
  const q = DB.quote(u.id, s, e, val('gb-promo'), S.user.login);
  const groups = {}; q.nights.forEach(n => { const k = n.price + '|' + n.tag; groups[k] = (groups[k] || 0) + 1; });
  $('#gb-sum').innerHTML = q.nights.length ? `<div class="list">${Object.entries(groups).map(([k, c]) => { const [p, tag] = k.split('|'); return `<div class="li"><span class="li-main small">${plural(c, 'ночь', 'ночи', 'ночей')} × ${money(p)}${tag ? `, ${tag}` : ''}</span><b>${money(p * c)}</b></div>`; }).join('')}
    ${q.discount ? `<div class="li"><span class="li-main small" style="color:var(--ok)">${esc(q.promo.label)}, −${q.promo.pct}%</span><b style="color:var(--ok)">−${money(q.discount)}</b></div>` : ''}
    <div class="li"><span class="li-main small">Туристический налог ${DB.S.taxRate}%</span><b>${money(q.tax)}</b></div>
    <div class="li"><span class="li-main"><b>Итого</b>${q.ok ? '' : `<br><span class="small" style="color:var(--bad)">${esc(q.msg)}</span>`}</span><b class="num" style="font-size:20px">${money(q.total)}</b></div></div>` : `<p class="small" style="color:var(--bad);padding:12px 0">${esc(q.msg)}</p>`;
  $('#gb-go').disabled = !q.ok;
  $('#gb-wait').hidden = q.ok || !q.nights.length || DB.dayFree(u.id, s, e);
  return q;
}
function gBook() {
  const q = gCalc(); if (!q.ok) return;
  const u = DB.unit(val('gb-unit')), s = val('gb-start'), e = val('gb-end'), promo = val('gb-promo'), guests = Number(val('gb-count')) || 2;
  needContact(() => paySheet({ title: `${u.short}, ${T.dm(s)} – ${T.dm(e)}`, amount: q.total, onPaid: (m) => {
    const r = DB.addStay({ unitId: u.id, guest: S.user.name, login: S.user.login, phone: S.user.phone, guests, start: s, end: e, source: 'Приложение', promo, method: m === 'СБП' ? 'Перевод' : 'Карта' });
    if (!r.ok) {
      if (DB.curPay) { DB.notify('admin', `Гость ${S.user.name} оплатил онлайн ${u.short} на ${T.dm(s)} – ${T.dm(e)}, но даты успели занять. Верните деньги или предложите другой дом`, 'alert', 'cash'); return ask('Даты успели занять', 'Пока шла оплата, этот дом забронировали. Деньги не пропадут: администратор свяжется с вами, вернёт оплату или предложит другой дом.', 'Понятно', () => {}); }
      return toast(r.msg);
    }
    go('g_home'); toast(`Дом за вами. Начислено ${money(Math.round(r.booking.base * DB.S.bonusPct / 100))} бонусов`);
  } }));
}
function gWait() {
  const u = DB.unit(val('gb-unit'));
  needContact(() => { DB.addWait({ unitId: u.id, start: val('gb-start'), end: val('gb-end'), login: S.user.login, name: S.user.name, phone: S.user.phone }); closeSheet(); render(); toast('Сообщим первым, если даты освободятся'); });
}

// =====================================================================
//  Профиль: карта гостя, бонусы, приглашения, итог поездки
// =====================================================================
V.g_me = () => {
  const u = S.user, d = DB.d;
  const stays = d.bookings.filter(b => b.start && b.login === u.login);
  const nights = sum(stays, b => T.nights(b.start, b.end));
  const extras = d.bookings.filter(b => b.date && b.login === u.login).length + d.rides.filter(r => r.login === u.login).length + d.tasks.filter(t => t.login === u.login).length;
  const last = stays.filter(b => b.closed).sort((a, b) => a.end < b.end ? 1 : -1)[0];
  const passes = d.passes.filter(p => p.login === u.login), refUrl = location.href.split('#')[0] + '#ref-' + (u.ref || '');
  return head('Гость', esc(u.visitor ? 'Гость' : u.name)) + `
  <section class="glowcard"><div class="beam"></div><div class="glow-in">
    <div class="hero-row"><span class="glass">Клубная карта</span><span class="glass">${ic('star', 'sm')} ${stays.length > 1 ? 'Постоянный гость' : 'Гость базы'}</span></div>
    <div><div class="num glow-num">${money(u.bonus || 0)}</div><h2>бонусов на счету</h2><p>${DB.S.bonusPct}% с каждого проживания возвращаются бонусами. Оплачивайте ими до 30% заказа</p></div>
  </div></section>
  <div class="stats"><div class="stat"><b>${stays.length}</b><span>${plural(stays.length, 'приезд', 'приезда', 'приездов').split(' ')[1]}</span></div><div class="stat"><b>${nights}</b><span>${plural(nights, 'ночь', 'ночи', 'ночей').split(' ')[1]} в лесу</span></div><div class="stat"><b>${extras}</b><span>${plural(extras, 'услуга', 'услуги', 'услуг').split(' ')[1]}</span></div></div>
  ${last ? `<section class="card trip"><span class="muted small">Ваша поездка, ${T.dm(last.start)} – ${T.dm(last.end)}</span><span class="h2">${esc(DB.unit(last.unitId).name)}</span>
    <span>${plural(T.nights(last.start, last.end), 'ночь', 'ночи', 'ночей')} в лесу${d.bookings.some(b => b.date && b.login === u.login && DB.unit(b.unitId).kind === 'sauna') ? ', баня' : ''}${d.rides.some(r => r.login === u.login) ? ', квадроциклы' : ''}. Спасибо, что были у нас.</span>
    <span class="small muted">Промокод на следующий приезд: <b style="user-select:all">LES10</b>, скидка 10%</span>${d.reviews.some(r => r.bookingId === last.id) ? '' : `<button class="btn sm ghost" onclick="reviewSheet(${last.id},5)">Оценить отдых</button>`}</section>` : ''}
  ${u.ref ? `<section class="card"><span class="h2">Приглашайте друзей</span><span class="small muted">Друг получит ${DB.S.refPct}% скидки на первую бронь, а вы ${money(DB.S.refBonus)} бонусами, когда он приедет.</span><div class="code" id="ref-url">${esc(refUrl)}</div><button class="btn sm" onclick="copyText(document.getElementById('ref-url').textContent,'Ссылка скопирована')">${ic('copy', 'sm')} Скопировать ссылку</button></section>` : ''}
  ${passes.length ? `<section class="card flat"><div class="list">${passes.map(p => `<div class="li"><span class="li-ic">${ic('ticket')}</span><span class="li-main"><span class="li-t">${esc(CAT.passes.find(x => x.id === p.productId).name)}</span><br><span class="li-s" style="user-select:all">${p.code}</span></span><b>${p.left} из ${p.total}</b></div>`).join('')}</div></section>` : ''}
  <section class="card flat"><div class="list">
    ${u.phone ? `<div class="li"><span class="li-ic">${ic('phone')}</span><span class="li-main"><span class="li-s">Ваш телефон</span><br><span class="li-t">${esc(u.phone)}</span></span></div>` : ''}
    <div class="li"><span class="li-ic">${ic('phone')}</span><span class="li-main"><span class="li-s">Администратор</span><br><span class="li-t" style="user-select:all">${CAT.adminPhone}</span></span><button class="btn sm ghost" aria-label="Скопировать номер" onclick="copyText('${CAT.adminPhone}','Номер скопирован')">${ic('copy', 'sm')}</button></div>
    <button class="li" onclick="corpSheet(true)"><span class="li-ic">${ic('users')}</span><span class="li-main"><span class="li-t">Корпоратив или праздник</span><br><span class="li-s">Посчитаем смету за минуту</span></span>${ic('right', 'sm')}</button>
    <button class="li" onclick="certBuySheet()"><span class="li-ic">${ic('gift')}</span><span class="li-main"><span class="li-t">Подарить сертификат</span><br><span class="li-s">На дом, баню и любые услуги</span></span>${ic('right', 'sm')}</button>
  </div></section>
  ${notifCard()}
  <div class="sec"><span class="h2">Оформление</span></div>${themeSeg()}
  ${SRV() && !S.user.visitor && !S.user.qr && !S.user.groupOf ? `<button class="btn block ghost" onclick="passSheet()">${ic('lock', 'sm')} Сменить пароль</button>` : ''}
  <button class="btn block line" onclick="logout()">${ic('logout', 'sm')} Выйти</button>`;
};
