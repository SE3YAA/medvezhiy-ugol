// staff.js — терминал персонала и инструктора квадропарка.
// Общие помощники (S, DB, T, CAT, sheet, field, ic …) объявлены в app.js.
// =====================================================================
//  5. Персонал: одна кнопка — одна задача
// =====================================================================
V.tasks = () => {
  const d = DB.d, u = S.user, tasks = d.tasks.filter(t => t.tpl !== 'ride');
  const open = tasks.filter(t => t.status !== 'done'), done = tasks.filter(t => t.status === 'done' && T.iso(new Date(t.doneAt || t.ts)) === T.today());
  const all = open.length + done.length;
  return head(T.long(T.today()), `${esc(u.name)}, ${open.length ? plural(open.length, 'задача', 'задачи', 'задач') : 'всё сделано'}`) + `
  ${DB.onShift(u.login) ? '' : `<section class="card" style="flex-direction:row;align-items:center"><span style="flex:1">Вы ещё не отметили приход на смену</span><button class="btn sm" onclick="DB.checkIn(S.user.login);render();toast('Приход отмечен')">Я на базе</button></section>`}
  <section class="card inv"><div class="card-h"><span>Сделано ${done.length} из ${all}</span><b>${u.points || 0} баллов</b></div><div class="meter"><i style="width:${all ? done.length / all * 100 : 0}%"></i></div></section>
  <div class="quick"><button onclick="ticketSheet()">${ic('wrench')}<span>Поломка</span></button><button onclick="lostSheet()">${ic('bag')}<span>Забытая вещь</span></button><button onclick="mapSheet()">${ic('map')}<span>Карта</span></button></div>` +
  (open.length ? open.map(t => { const left = DB.taskLeft(t), un = t.unitId && DB.unit(t.unitId); return `<section class="card">
      <div class="li" style="padding:0">${un ? `<span class="thumb">${unitScene(un)}</span>` : `<span class="li-ic">${ic('check')}</span>`}<span class="li-main"><span class="li-t" style="font-size:17px">${esc(t.title)}</span><br><span class="li-s">${esc(t.place)}, ${esc(t.due)}</span></span></div>
      ${t.note ? `<p class="small">${esc(t.note)}</p>` : ''}
      ${t.status === 'doing' ? `<div class="meter"><i style="width:${left.done / left.total * 100}%"></i></div>` : ''}
      ${t.tpl === 'sauna_prep' && !u.trained ? `<button class="btn block ghost" onclick="go('learn')">${ic('book', 'sm')} Сначала пройдите обучение по бане</button>` : `<button class="btn block" onclick="openTask(${t.id})">${t.status === 'doing' ? `Продолжить, шаг ${Math.min(left.done + 1, left.total)} из ${left.total}` : 'Начать'}</button>`}</section>`; }).join('')
    : `<p class="empty">Задач на сейчас нет. Новые появятся здесь сами.</p>`) +
  (done.length ? `<div class="sec"><span class="h2">Сделано сегодня</span></div><section class="card flat"><div class="list">${done.map(t => `<button class="li" onclick="openTask(${t.id})"><span class="li-ic" style="color:var(--ok)">${ic('check')}</span><span class="li-main"><span class="li-t">${esc(t.title)}</span><br><span class="li-s">${esc(t.place)}</span></span><b>+${CAT.standards[t.tpl].points}</b></button>`).join('')}</div></section>` : '');
};

function openTask(id) {
  const t = DB.task(id); if (!t) return;
  if (t.tpl === 'sauna_prep' && S.user.role === 'staff' && !S.user.trained && t.status !== 'done') { toast('Баню можно доверить после обучения'); return go('learn'); }
  if (t.status === 'todo') { DB.startTask(id); render(); }
  const tpl = CAT.standards[t.tpl], left = DB.taskLeft(t), ro = t.status === 'done';
  const steps = tpl.steps.map((s, i) => {
    const st = t.steps[i], open = S.how === id + ':' + i, ref = DB.d.refs[t.tpl + ':' + i];
    const photo = !s.photo ? '' : typeof st.photo === 'string' ? `<div class="shot"><img src="${st.photo}" alt="Контрольное фото">${ro ? '' : `<button class="btn sm ghost" onclick="stepPhoto(${id},${i})">Переснять</button>`}</div>`
      : ro ? '' : `<button class="slot" onclick="stepPhoto(${id},${i})">${ic('camera')} Сделать фото: ${s.short.toLowerCase()}</button>`;
    return `<div class="step"><div class="step-h"><button class="tick ${st.done ? 'on' : ''}" aria-label="${st.done ? 'Сделано' : 'Отметить'}" ${ro ? 'disabled' : ''} onclick="toggleStep(${id},${i})">${ic('check', 'sm')}</button>
      <div class="step-t">${s.t}<br><button class="link" onclick="toggleHow(${id},${i})">${open ? 'Скрыть' : 'Как должно быть'}</button></div></div>
      ${open ? `<div class="how">${ref ? `<img src="${ref}" alt="Эталонное фото">` : ''}<ul>${s.how.map(h => `<li>${h}</li>`).join('')}</ul>${ref ? '' : '<p class="small muted">Эталонное фото добавит управляющий.</p>'}</div>` : ''}${photo}</div>`;
  }).join('');
  const rest = [left.todo ? plural(left.todo, 'шаг', 'шага', 'шагов') : '', left.photos ? plural(left.photos, 'фото', 'фото', 'фото') : ''].filter(Boolean).join(' и ');
  const label = t.tpl === 'delivery' ? 'Заказ доставлен' : t.tpl === 'generic' ? 'Готово' : 'Сдать объект';
  sheet(sheetHead(esc(t.title), `${esc(t.place)}, ${esc(t.due)}${t.guest ? '. ' + esc(t.guest) : ''}`) +
    (t.note ? `<div class="card"><p>${esc(t.note)}</p></div>` : '') + `<div class="card flat">${steps}</div>` +
    (ro ? `<p class="empty">Задача сдана, +${tpl.points} баллов.</p>` : `${rest ? `<p class="small muted" style="text-align:center">Осталось: ${rest}</p>` : ''}<button class="btn block" ${rest ? 'disabled' : ''} onclick="finishTask(${id})">${label}</button>`));
}
function toggleHow(id, i) { const k = id + ':' + i; S.how = S.how === k ? null : k; openTask(id); }
function toggleStep(id, i) {
  const t = DB.task(id), s = CAT.standards[t.tpl].steps[i], st = t.steps[i];
  if (s.photo && !st.photo) return toast('Сначала сделайте фото этого шага');
  st.done = !st.done; DB.save(); openTask(id);
}
function stepPhoto(id, i) { pickPhoto(src => { const st = DB.task(id).steps[i]; st.photo = src; st.done = true; DB.save(); openTask(id); }, true); }
function finishTask(id) {
  const r = DB.completeTask(id, S.user); if (!r.ok) return toast('Сначала закройте все шаги');
  closeSheet(); render(); toast(`Принято, +${r.points} баллов`);
}

V.units = () => head('Что готово, а что ждёт уборки', 'Объекты') + `<section class="card flat"><div class="list">${DB.d.units.map(u => `<div class="li"><span class="thumb">${unitScene(u)}</span><span class="li-main"><span class="li-t">${esc(u.short)}</span><br>${statusChip(u)}</span>${u.status === 'ready' ? `<button class="btn sm ghost" onclick="markDirty('${u.id}')">Грязно</button>` : ''}</div>`).join('')}</div></section>
  <p class="small muted" style="padding:0 4px">Статус «готов» появляется сам, когда вы сдаёте задачу с фото. Если нашли беспорядок, нажмите «Грязно», и уборка появится в задачах.</p>`;
function markDirty(id) { ask('Отметить объект грязным?', 'Заселять в него будет нельзя, пока уборку не сдадут с фото.', 'Отметить', () => { DB.markDirty(id); render(); toast('Уборка добавлена в задачи'); }); }

V.shift = () => {
  const u = S.user, d = DB.d, t = T.today();
  const staff = u.role === 'staff';
  const doneToday = d.tasks.filter(x => x.by === u.login && x.status === 'done' && T.iso(new Date(x.doneAt)) === t).length;
  const rides = d.rides.filter(r => r.status === 'done' && r.endedAt && T.iso(new Date(r.endedAt)) === t);
  const on = DB.onShift(u.login), month = t.slice(0, 7), shifts = d.checkins.filter(c => c.login === u.login && c.date.startsWith(month)).length;
  const mon = T.addDays(t, -((T.parse(t).getDay() + 6) % 7)), week = Array.from({ length: 7 }, (_, i) => T.addDays(mon, i));
  const rentals = d.rentals.filter(r => r.status !== 'back' && r.date === t);
  return head(esc(u.title), esc(u.name)) + `
  <section class="card"><div class="card-h"><span class="h2">${on ? 'Вы на смене' : 'Смена не начата'}</span>${on ? `<span class="small muted">с ${T.stamp(on.in).split(', ')[1]}</span>` : ''}</div>
    <button class="btn block ${on ? 'ghost' : ''}" onclick="${on ? 'moodSheet()' : "DB.checkIn(S.user.login);render();toast('Приход отмечен')"}">${on ? 'Завершить смену' : `${ic('qrscan', 'sm')} Отметить приход`}</button>
    <p class="small muted">На базе это делается одним сканом QR-кода на воротах.</p>
    <div class="weekrow">${week.map(ds => `<span class="${d.shifts.some(x => x.date === ds && x.login === u.login) ? 'on' : ''} ${ds === t ? 'now' : ''}">${T.DOW[T.parse(ds).getDay()]}<b>${T.parse(ds).getDate()}</b></span>`).join('')}</div>
    <div class="card-h"><span class="muted">За месяц: ${plural(shifts, 'смена', 'смены', 'смен')} × ${money(DB.S.shiftPay)}${staff ? ' + баллы' : ''}</span><b>${money(shifts * DB.S.shiftPay + (staff ? (u.points || 0) * CAT.pointRate : 0))}</b></div></section>
  ${staff && rentals.length ? `<div class="sec"><span class="h2">Выдать прокат</span></div><section class="card flat"><div class="list">${rentals.map(r => `<div class="li"><span class="li-main"><span class="li-t">${esc(CAT.rentals.find(x => x.id === r.itemId).name)}</span><br><span class="li-s">${esc(r.guest)}, ${T.hm(r.from)}</span></span><button class="btn sm ghost" onclick="rentNext(${r.id})">${r.status === 'booked' ? 'Выдать' : 'Принять'}</button></div>`).join('')}</div></section>` : ''}
  ${staff ? `<div class="sec"><span class="h2">Забытые вещи</span><button class="btn sm ghost" onclick="lostSheet()">${ic('plus', 'sm')}</button></div><section class="card flat"><div class="list">${d.lost.map(l => `<div class="li">${l.photo ? `<span class="thumb"><img src="${l.photo}" alt=""></span>` : `<span class="li-ic">${ic('bag')}</span>`}<span class="li-main"><span class="li-t">${esc(l.title)}</span><br><span class="li-s">${esc(l.place)}, ${T.stamp(l.ts)}${l.guestName ? ', гость ' + esc(l.guestName) + ' уведомлён' : ''}</span></span>${l.status === 'stored' ? `<button class="btn sm ghost" onclick="DB.d.lost.find(x=>x.id===${l.id}).status='returned';DB.save();render()">Отдали</button>` : '<span class="chip ok">Вернули</span>'}</div>`).join('') || '<p class="empty">Ничего не забывали.</p>'}</div></section>` : ''}` + (staff ? `
  <section class="card inv"><span class="muted">Баллы за безупречно сданные объекты</span><div class="num big">${u.points || 0}</div>
    <div class="card-h"><span>Сдельная часть</span><b>${money((u.points || 0) * CAT.pointRate)}</b></div></section>
  <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>${doneToday}</b><span>задач сегодня</span></div><div class="stat"><b>${u.clean || 0}</b><span>объектов без переделок</span></div></div>
  <div class="sec"><span class="h2">Как считаются баллы</span></div>
  <section class="card flat"><div class="list">${[['Уборка дома', '+10'], ['Подготовка бани', '+8'], ['Уборка беседки', '+5'], ['Доставка заказа', '+3'], ['Возврат на переделку', '−5']].map(([a, b]) => `<div class="li"><span class="li-main">${a}</span><b>${b}</b></div>`).join('')}
    <div class="li"><span class="li-main li-s">Один балл равен ${money(CAT.pointRate)}</span></div></div></section>` : `
  <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>${rides.length}</b><span>выездов сегодня</span></div><div class="stat"><b>${Math.round(sum(rides, r => r.hours) * 10) / 10}</b><span>моточасов сегодня</span></div></div>`) + `
  ${notifCard()}
  <div class="sec"><span class="h2">Оформление</span></div>${themeSeg()}
  ${SRV() ? `<button class="btn block ghost" onclick="passSheet()">${ic('lock', 'sm')} Сменить пароль</button>` : ''}
  <button class="btn block line" onclick="logout()">${ic('logout', 'sm')} Выйти</button>`;
};
let moodPick = 0, moodTags = [];
function moodSheet(keep) {
  if (!keep) { moodPick = 0; moodTags = []; }
  const tags = ['Много тяжёлой работы', 'Сложный гость', 'Не хватило времени', 'Всё спокойно'];
  sheet(sheetHead('Как прошла смена?', 'Пять секунд. Ответ видит только управляющий') + `
    <div class="moods">${MOODS.map((m, i) => `<button class="${moodPick === i + 1 ? 'on' : ''}" aria-label="Оценка ${i + 1}" onclick="moodPick=${i + 1};moodSheet(1)">${m}</button>`).join('')}</div>
    <div class="opts">${tags.map((g, i) => `<button class="opt ${moodTags.includes(g) ? 'on' : ''}" onclick="moodTag(${i})">${g}</button>`).join('')}</div>
    <button class="btn block" ${moodPick ? '' : 'disabled'} onclick="saveMood()">Закрыть смену</button>`);
  moodSheet.tags = tags;
}
function moodTag(i) { const g = moodSheet.tags[i]; moodTags = moodTags.includes(g) ? moodTags.filter(x => x !== g) : moodTags.concat(g); moodSheet(1); }
function saveMood() { DB.addMood(S.user, moodPick, moodTags); DB.checkOut(S.user.login); logout(); toast('Смена закрыта. Спасибо за работу'); }

// =====================================================================
//  6. Инструктор: парк, выезды, ТО
// =====================================================================
const serviceWarn = q => q.toService <= 0 ? `Квадроцикл №${q.num}: ресурс до ТО исчерпан, выезды закрыты` : `Квадроцикл №${q.num}: осталось ${plural(Math.round(q.toService), 'моточас', 'моточаса', 'моточасов')} до замены масла и шприцевания подвески`;

V.park = () => {
  const qs = DB.d.quads, warn = qs.filter(q => q.toService <= 5);
  return head(`${qs.filter(q => q.status === 'park').length} из ${qs.length} готовы к выезду`, 'Парк') + `
  <section class="hero wide"><div class="hero-img">${scene('quad', 5)}</div><div class="hero-in"><div class="hero-row"><span class="glass">${ic('route', 'sm')} ${plural(DB.d.rides.filter(r => r.date === T.today() && r.status !== 'done').length, 'выезд', 'выезда', 'выездов')} сегодня</span></div>
    <div><h2>Мотопарк</h2><p>Нажмите на квадроцикл, чтобы изменить статус и моточасы</p></div></div></section>
  ${warn.map(q => `<section class="card" style="flex-direction:row;align-items:center;color:var(--warn)">${ic('alert')}<span style="flex:1">${serviceWarn(q)}</span></section>`).join('')}` +
  qs.map(q => { const pct = Math.max(0, Math.min(100, q.toService / q.interval * 100)); return `<section class="card">
    <div class="card-h"><div><span class="h2">№${q.num}, ${esc(q.name)}</span><br><span class="small muted">${esc(q.defects)}</span></div><span class="chip ${QST[q.status][0]}">${QST[q.status][1]}</span></div>
    <div class="meter ${q.toService <= 0 ? 'bad' : q.toService <= 5 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
    <div class="card-h small"><span class="muted">Наработка ${q.totalHours} м/ч</span><span>До ТО ${q.toService} из ${q.interval} м/ч</span></div>
    <button class="btn sm ghost" onclick="quadSheet(${q.id})">Изменить</button></section>`; }).join('');
};

const RST = { booked: ['plain', 'Ждёт выезда'], riding: ['warn', 'На маршруте'], done: ['ok', 'Вернулся'] };
V.rides = () => {
  const rs = [...DB.d.rides].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.date + T.hm(a.from) < b.date + T.hm(b.from) ? -1 : 1));
  const riding = DB.d.rides.filter(r => r.status === 'riding');
  return head('Договор, фотоосмотр, моточасы', 'Выезды', `<button class="btn sm" onclick="rideSheet()">${ic('plus', 'sm')} Выезд</button>`) + `
  <label class="check"><input type="checkbox" ${DB.S.weatherStop ? 'checked' : ''} onchange="DB.setWeatherStop(this.checked);render();toast(this.checked?'Выезды закрыты, гостям отправлено сообщение':'Выезды снова открыты')"><span>Стоп по погоде: гроза или ливень, закрыть выезды на сегодня</span></label>
  ${riding.length ? `<section class="card"><div class="card-h"><span class="h2">На маршруте</span><span class="small muted">демо, без GPS-трекера</span></div>${mapSVG({ trail: true, rides: riding })}</section>` : ''}` +
  (rs.length ? rs.map(r => { const q = DB.quad(r.quadId); return `<section class="card" ${r.status === 'done' ? 'style="opacity:.6"' : ''}>
    <div class="card-h"><div><span class="h2">${esc(r.guest)}</span><br><span class="small muted">${T.rel(r.date)}, ${T.hm(r.from)}, ${r.dur / 60} ч. ${esc(r.route)}</span></div><span class="chip ${RST[r.status][0]}">${RST[r.status][1]}</span></div>
    <div class="list"><div class="li"><span class="li-ic">${ic('quad')}</span><span class="li-main"><span class="li-t">№${q.num}, ${esc(q.name)}</span><br><span class="li-s">До ТО ${q.toService} м/ч</span></span></div>
    <div class="li"><span class="li-ic" ${r.signed ? '' : 'style="color:var(--bad)"'}>${ic('shield')}</span><span class="li-main"><span class="li-t">${r.signed ? 'Согласие подписано' : 'Согласие не подписано'}</span><br><span class="li-s">${r.signed ? `${esc(r.signedAs || r.guest)}, ${T.stamp(r.signedAt)}` : 'Подпишите с гостем перед выездом'}</span></span></div></div>
    ${r.status === 'booked' ? `<div class="btns"><button class="btn" onclick="rideStart(${r.id})">Осмотр и старт</button><button class="btn ghost" style="flex:0 0 auto" aria-label="Отменить выезд" onclick="rideCancel(${r.id})">${ic('trash', 'sm')}</button></div>` : ''}
    ${r.status === 'riding' ? `<p class="small ${Date.now() > r.startedAt + (r.dur + 20) * 60000 ? '' : 'muted'}" ${Date.now() > r.startedAt + (r.dur + 20) * 60000 ? 'style="color:var(--bad);font-weight:600"' : ''}>Выехал ${T.stamp(r.startedAt)}, вернуться к ${T.hm(Math.round((new Date(r.startedAt).getHours() * 60 + new Date(r.startedAt).getMinutes() + r.dur)))}${Date.now() > r.startedAt + (r.dur + 20) * 60000 ? '. Опаздывает, тревога отправлена управляющему' : ''}</p><button class="btn block" onclick="rideBack(${r.id})">Принять возврат</button>` : ''}
    ${r.status === 'done' ? `<p class="small muted">Накатано ${r.hours} м/ч${Object.keys(r.photos || {}).length ? '' : ', фото осмотра в архиве'}</p>` : ''}</section>`; }).join('') : '<p class="empty">Выездов пока нет.</p>');
};
const SIDES = [['front', 'Спереди'], ['back', 'Сзади'], ['left', 'Слева'], ['right', 'Справа']];
function rideStart(id) {
  briefTarget = () => DB.ride(id);
  const r = DB.ride(id), q = DB.quad(r.quadId), n = SIDES.filter(([k]) => r.photos[k]).length;
  sheet(sheetHead('Осмотр перед выездом', `№${q.num}, ${esc(q.name)}. ${esc(r.guest)}`) + `
    <p class="small muted">Четыре фото с каждой стороны. Все царапины и вмятины останутся в акте, спорить после поездки будет не о чем.</p>
    <div class="photos four">${SIDES.map(([k, l]) => r.photos[k] ? `<button class="cell" onclick="ridePhoto(${id},'${k}')" aria-label="${l}, переснять"><img src="${r.photos[k]}" alt="${l}"></button>` : `<button class="slot sq" onclick="ridePhoto(${id},'${k}')">${ic('camera')}${l}</button>`).join('')}</div>
    ${r.signed ? `<div class="card" style="flex-direction:row;align-items:center">${ic('shield')}<span>Согласие подписано: ${esc(r.signedAs || r.guest)}</span></div>` : `
    ${briefingHTML(r, `rideStart(${id})`)}
    <div class="card"><span class="h2">Техника безопасности</span><ul style="margin:0;padding-left:18px" class="small">${CAT.safety.map(s => `<li>${s}</li>`).join('')}</ul><p class="small muted">${CAT.offer}</p></div>
    <label class="check"><input type="checkbox" id="rs-sign" ${r.briefed ? '' : 'disabled'} onchange="rideSign(${id},this.checked)"><span>Гость посмотрел инструктаж, прочитал правила и согласен с ответственностью за технику</span></label>`}
    <button class="btn block" ${n === 4 && r.signed ? '' : 'disabled'} onclick="rideGo(${id})">Выпустить на маршрут</button>
    ${n === 4 && r.signed ? '' : `<p class="small muted" style="text-align:center">Нужно: ${[n < 4 ? `ещё ${4 - n} фото` : '', r.signed ? '' : 'согласие гостя'].filter(Boolean).join(' и ')}</p>`}`);
}
function ridePhoto(id, side) { pickPhoto(src => { DB.ride(id).photos[side] = src; DB.save(); rideStart(id); }, true); }
function rideSign(id, on) { const r = DB.ride(id); if (on) { r.signed = true; r.signedAs = r.guest + ', при инструкторе'; r.signedAt = Date.now(); DB.save(); rideStart(id); } }
function rideGo(id) { DB.startRide(id); closeSheet(); render(); toast('Выезд начат, время пошло'); }
function rideCancel(id) { ask('Отменить выезд?', 'Платёж за него тоже удалится из кассы.', 'Отменить выезд', () => { DB.cancelRide(id); render(); }, true); }
function rideBack(id) {
  const r = DB.ride(id), q = DB.quad(r.quadId);
  const fact = Math.max(.1, Math.round((Date.now() - r.startedAt) / 36e4) / 10);
  sheet(sheetHead('Возврат техники', `№${q.num}, ${esc(q.name)}. ${esc(r.guest)}`) + `<div class="form">
    ${field('Накатано моточасов', `<input id="rb-h" class="inp" type="number" step="0.1" min="0.1" value="${fact < .3 ? r.dur / 60 : fact}">`)}
    ${field('Новые замечания', `<input id="rb-d" class="inp" placeholder="Если всё в порядке, оставьте пустым">`)}
    <p class="small muted">Моточасы спишутся с ресурса до ТО. Сейчас осталось ${q.toService} м/ч.</p>
    <button class="btn block" onclick="rideFinish(${id})">Принять технику</button></div>`);
}
function rideFinish(id) {
  const h = Number(val('rb-h')); if (!(h > 0)) return toast('Укажите моточасы');
  const q = DB.finishRide(id, h, val('rb-d'));
  closeSheet(); render(); toast(q.toService <= 5 ? serviceWarn(q) : 'Техника принята');
}
function rideSheet() {
  const qs = DB.d.quads.filter(q => q.status !== 'service');
  sheet(sheetHead('Новый выезд', 'Для гостя, который записался на месте') + `<div class="form">
    ${field('Гость', `<input id="nr-guest" class="inp" placeholder="Имя и фамилия">`)}
    ${field('Квадроцикл', `<select id="nr-quad" class="inp">${options(qs.map(q => [q.id, `№${q.num}, ${q.name}`]))}</select>`)}
    <div class="row2">${field('День', `<input id="nr-date" class="inp" type="date" value="${T.today()}">`)}${field('Время', `<input id="nr-time" class="inp" type="time" value="${T.pad(Math.min(21, new Date().getHours() + 1))}:00">`)}</div>
    <div class="row2">${field('Длительность', `<select id="nr-dur" class="inp">${options([[60, '1 час'], [90, '1,5 часа'], [120, '2 часа']])}</select>`)}${field('Оплата', `<select id="nr-method" class="inp">${options(METHODS)}</select>`)}</div>
    ${field('Маршрут', `<select id="nr-route" class="inp">${options(CAT.quad.routes)}</select>`)}
    <button class="btn block" onclick="saveRide()">Записать</button></div>`);
}
function saveRide() {
  const guest = val('nr-guest'); if (!guest) return toast('Укажите имя гостя');
  if (!val('nr-quad')) return toast('Свободной техники нет');
  const [h, m] = val('nr-time').split(':').map(Number), dur = Number(val('nr-dur'));
  DB.addRide({ guest, login: 'walkin', quadId: Number(val('nr-quad')), date: val('nr-date'), from: h * 60 + (m || 0), dur, route: val('nr-route'), amount: CAT.quad.pricePerHour * dur / 60, method: val('nr-method') });
  closeSheet(); render(); toast('Выезд записан');
}

V.service = () => head('Регламент по моточасам', 'ТО') + DB.d.quads.map(q => `<section class="card">
  <div class="card-h"><span class="h2">№${q.num}, ${esc(q.name)}</span><span class="chip ${q.toService <= 0 ? 'bad' : q.toService <= 5 ? 'warn' : 'ok'}">${q.toService <= 0 ? 'Нужно ТО' : q.toService <= 5 ? 'Скоро ТО' : 'В порядке'}</span></div>
  <div class="list"><div class="li"><span class="li-main">Замена масла и фильтра</span><b>каждые ${q.interval} м/ч</b></div><div class="li"><span class="li-main">Шприцевание подвески</span><b>каждые ${q.interval} м/ч</b></div>
  <div class="li"><span class="li-main">Осталось до ТО</span><b>${q.toService} м/ч</b></div><div class="li"><span class="li-main">Замечания</span><b style="text-align:right;max-width:55%">${esc(q.defects)}</b></div>
  ${q.lastService ? `<div class="li"><span class="li-main">Последнее ТО</span><b>${T.stamp(q.lastService)}</b></div>` : ''}</div>
  <div class="btns"><button class="btn ${q.toService <= 5 ? '' : 'ghost'}" onclick="serviceSheet(${q.id})">Отметить ТО</button><button class="btn ghost" onclick="fuelSheet(${q.id})">Заправка</button></div></section>`).join('');
function serviceSheet(id) {
  const q = DB.quad(id);
  sheet(sheetHead('ТО выполнено', `№${q.num}, ${esc(q.name)}`) + `<div class="form">
    <p class="small muted">Счётчик до следующего ТО вернётся к ${q.interval} м/ч, замечания сбросятся, квадроцикл вернётся в парк.</p>
    ${field('Расход на ТО, ₽', `<input id="sv-cost" class="inp" type="number" min="0" placeholder="Попадёт в расходы кассы">`)}
    <button class="btn block" onclick="DB.serviceDone(${id},Number(val('sv-cost'))||0);closeSheet();render();toast('ТО отмечено')">Сохранить</button></div>`);
}


function fuelSheet(id) {
  const q = DB.quad(id);
  sheet(sheetHead('Заправка', `№${q.num}, ${esc(q.name)}`) + `<div class="form"><div class="row2">${field('Литров', '<input id="fl-l" class="inp" type="number" step="0.5" value="10">')}${field('Стоимость, ₽', '<input id="fl-c" class="inp" type="number" value="550">')}</div>
    <button class="btn block" onclick="DB.addFuel(${id},Number(val('fl-l'))||0,Number(val('fl-c'))||0);closeSheet();render();toast('Заправка записана')">Записать</button></div>`);
}

// --- Видеоинструктаж: гость смотрит до подписи согласия ---
function briefingHTML(obj, rerender) {
  const B = CAT.briefing, i = obj.briefStep || 0, st = B.steps[i];
  if (obj.briefed) return `<div class="card" style="flex-direction:row;align-items:center;color:var(--ok)">${ic('check')}<span>Инструктаж просмотрен</span></div>`;
  if (B.video) return `<div class="card"><span class="h2">Видеоинструктаж</span><video src="${esc(B.video)}" controls playsinline style="width:100%;border-radius:16px" onended="__brief('${rerender}',true)"></video><button class="btn sm ghost" onclick="__brief('${rerender}',true)">Я посмотрел</button></div>`;
  return `<div class="card brief"><div class="card-h"><span class="h2">Инструктаж, ${i + 1} из ${B.steps.length}</span><span class="small muted">≈ 2 минуты</span></div>
    <div class="brief-bars">${B.steps.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    <b>${esc(st.t)}</b><p>${esc(st.text)}</p>
    <button class="btn sm" onclick="__brief('${rerender}')">${i < B.steps.length - 1 ? 'Дальше' : 'Понятно, всё посмотрел'}</button>
    <p class="small muted">Когда снимете видео, впишите путь к нему в catalog.js, и здесь будет плеер.</p></div>`;
}
// Состояние инструктажа хранится в объекте выезда или черновике записи гостя
let briefTarget = null;
function __brief(rerender, done) {
  const obj = briefTarget(); if (!obj) return;
  const n = CAT.briefing.steps.length;
  if (done || (obj.briefStep || 0) >= n - 1) obj.briefed = true; else obj.briefStep = (obj.briefStep || 0) + 1;
  if (obj.id && DB.ride(obj.id)) DB.save();
  (new Function(rerender))();
}

// --- Обучение новичков ---
V.learn = () => {
  const u = S.user, C = CAT.course, seen = u.lessons || [];
  return head(u.trained ? 'Пройдено, можно освежить в памяти' : 'Четыре коротких урока и тест', 'Обучение') + `
  <section class="card inv"><div class="card-h"><span>${u.trained ? `Тест сдан${u.course ? `: ${u.course.score} из ${C.quiz.length}` : ''}` : `Уроков пройдено: ${seen.length} из ${C.lessons.length}`}</span><b>${u.trained ? 'Допуск есть' : 'Нет допуска к бане'}</b></div><div class="meter"><i style="width:${u.trained ? 100 : seen.length / (C.lessons.length + 1) * 100}%"></i></div></section>
  <section class="card flat"><div class="list">${C.lessons.map((l, i) => `<button class="li" onclick="lessonSheet(${i})"><span class="tick ${seen.includes(i) || u.trained ? 'on' : ''}" style="width:30px;height:30px">${ic('check', 'sm')}</span><span class="li-main"><span class="li-t">${esc(l.t)}</span><br><span class="li-s">${plural(l.text.length, 'пункт', 'пункта', 'пунктов')}</span></span>${ic('right', 'sm')}</button>`).join('')}</div></section>
  <button class="btn block" ${seen.length < C.lessons.length && !u.trained ? 'disabled' : ''} onclick="quizStart()">${u.trained ? 'Пройти тест ещё раз' : 'Пройти тест'}</button>
  ${seen.length < C.lessons.length && !u.trained ? '<p class="small muted" style="text-align:center">Тест откроется после всех уроков.</p>' : ''}
  <button class="btn block ghost" onclick="standardsView()">${ic('book', 'sm')} Все стандарты с эталонными фото</button>`;
};
function lessonSheet(i) {
  const l = CAT.course.lessons[i], u = S.user;
  sheet(sheetHead(esc(l.t), `Урок ${i + 1} из ${CAT.course.lessons.length}`) + `<div class="card flat"><div class="list">${l.text.map(t => `<div class="li"><span class="li-main">${esc(t)}</span></div>`).join('')}</div></div>
    <button class="btn block" onclick="DB.updateUser(S.user.login,{lessons:[...new Set((S.user.lessons||[]).concat(${i}))]});${i < CAT.course.lessons.length - 1 ? `lessonSheet(${i + 1})` : 'closeSheet()'};render()">${i < CAT.course.lessons.length - 1 ? 'Понятно, следующий урок' : 'Понятно'}</button>`);
}
let quiz = null;
function quizStart() { quiz = { i: 0, score: 0, pick: null }; quizSheet(); }
function quizSheet() {
  const Q = CAT.course.quiz, q = Q[quiz.i];
  if (!q) {
    const ok = quiz.score >= CAT.course.pass;
    DB.passCourse(S.user.login, quiz.score);
    return sheet(sheetHead(ok ? 'Тест сдан' : 'Пока не получилось', `${quiz.score} из ${Q.length} правильных`) + `<p>${ok ? 'Теперь вам можно доверить баню. Задачи по ней появятся в общем списке.' : `Нужно хотя бы ${CAT.course.pass}. Перечитайте уроки и попробуйте ещё раз.`}</p><button class="btn block" onclick="closeSheet();render()">Готово</button>`);
  }
  sheet(sheetHead(`Вопрос ${quiz.i + 1} из ${Q.length}`) + `<span class="h2">${esc(q.q)}</span><div class="list">${q.o.map((o, k) => {
    const st = quiz.pick == null ? '' : k === q.a ? 'ok' : k === quiz.pick ? 'bad' : '';
    return `<button class="check ans ${st}" ${quiz.pick != null ? 'disabled' : ''} onclick="quiz.pick=${k};if(${k}===${q.a})quiz.score++;quizSheet()"><span>${esc(o)}</span></button>`;
  }).join('')}</div>${quiz.pick != null ? `<button class="btn block" onclick="quiz.i++;quiz.pick=null;quizSheet()">${quiz.i < Q.length - 1 ? 'Следующий вопрос' : 'Результат'}</button>` : ''}`);
}
function standardsView() {
  sheet(sheetHead('Стандарты', 'Как должно быть') + Object.entries(CAT.standards).filter(([k]) => k !== 'generic').map(([k, tpl]) => `<div class="card"><span class="h2">${tpl.name}</span>${tpl.steps.map((s, i) => { const ref = DB.d.refs[k + ':' + i]; return `<div class="how"><b>${esc(s.t)}</b>${ref ? `<img src="${ref}" alt="Эталонное фото">` : ''}<ul>${s.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>`; }).join('')}</div>`).join(''));
}

// --- Забытые вещи ---
function lostSheet(photo) {
  S.lostPhoto = photo || null;
  sheet(sheetHead('Забытая вещь', 'Гость, который жил последним, сразу получит сообщение') + `<div class="form">
    ${S.lostPhoto ? `<div class="shot"><img src="${S.lostPhoto}" alt=""><button class="btn sm ghost" onclick="pickPhoto(lostSheet,true)">Переснять</button></div>` : `<button class="slot" onclick="pickPhoto(lostSheet,true)">${ic('camera')} Фото вещи</button>`}
    ${field('Что нашли', '<input id="lf-t" class="inp" placeholder="Например: зарядка, детская шапка">')}
    ${field('Где', `<select id="lf-u" class="inp">${options(DB.d.units.map(u => [u.id, u.short]))}</select>`)}
    <button class="btn block" onclick="if(!val('lf-t'))return toast('Напишите, что нашли');const n=DB.addLost({title:val('lf-t'),unitId:val('lf-u'),place:DB.unit(val('lf-u')).short,photo:S.lostPhoto});closeSheet();render();toast(n.guestName?'Сообщили гостю: '+n.guestName:'Вещь записана')">Записать</button></div>`);
}

// Раз в минуту проверяем просроченные выезды и обновляем живые экраны
setInterval(() => {
  if (!S.user || !DB.d) return;
  DB.tick();
  if ($('#sheet').hidden && ['rides', 'today', 'm_quads', 'park'].includes(S.tab)) render();
}, 60000);
