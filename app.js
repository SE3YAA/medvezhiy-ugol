// app.js — интерфейс «Медвежьего угла»: четыре роли, один экран, шторки с формами.
// Данные и правила лежат в db.js (объекты DB, T, CAT).

// =====================================================================
//  0. Помощники
// =====================================================================
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const sum = (arr, f = x => x.amount) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return `${n} ${m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c}`; };
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

const S = {
  user: null, tab: null,
  chess: 'day', month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), hourDate: T.today(),
  cash: 'all', how: null, cart: {},
  gs: null, gq: null
};

// --- Иконки (контур, 24×24) ---
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l11-4v4M17 13.5h.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  check: 'M5 12.5l4.5 4.5L19 7',
  user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  quad: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 16h6l3-6h3M9 10h4M15 10l-1-3h-2',
  route: 'M5 21V4M5 4h11l-2 4 2 4H5',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
  chat: 'M4 5h16v11H9l-5 4z',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  aframe: 'M3 20h18M5 20L12 4l7 16M10 20v-5h4v5',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7',
  x: 'M6 6l12 12M18 6L6 18',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  send: 'M4 12l16-8-6 16-3-6z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  snow: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9',
  book: 'M5 4h13v16H5zM9 8h5M9 12h5',
  logout: 'M9 4H5v16h4M15 8l4 4-4 4M19 12H9',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.8M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  gazebo: 'M3 11l9-6 9 6M5 11v9M19 11v9M3 20h18',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  star: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H3V17l6.5-6.5A4 4 0 0 0 14 10zM15.5 8.5h.01',
  sos: 'M12 3l9 4v5c0 5-4 8-9 9-5-1-9-4-9-9V7zM12 8v5M12 16h.01',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  thermo: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 10v7',
  crane: 'M4 21V7l9-4v18M4 7h16M17 7v6M15 13h4M2 21h20',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  ticket: 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v16',
  food: 'M7 3v8a2 2 0 0 1-2 2v8M5 3v6M9 3v6M17 21V3c-2 0-3 3-3 7h3',
  handshake: 'M2 12l4-4 4 2 4-3 4 3 4 2-5 5-3-2-3 3-3-3z',
  qrscan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ''}"/></svg>`;

// =====================================================================
//  1. Сцены: лес рисуется кодом, пока нет настоящих фотографий.
//     Чтобы поставить фото, добавьте объекту в db.js поле photo: 'img/aframe.jpg'.
// =====================================================================
const SKY = {
  aframe: ['#141c26', '#42505c', '#d9a987'], barn: ['#070b11', '#16212c', '#40515c'], creek: ['#27323a', '#74807f', '#e3cbb0'],
  lodge: ['#2c3533', '#7a8580', '#cfd3cb'], gazebo: ['#30373c', '#8a8f8c', '#ecd2b4'], sauna: ['#080c12', '#1a2530', '#4a5560'],
  quad: ['#333c38', '#848d86', '#d5d8cf'], base: ['#121a24', '#3a4854', '#cf9f7f']
};
const DARKF = '#0b0f10', LIT = '#ffb469';
const OBJ = {
  aframe: n => `<circle cy="-30" r="74" fill="url(#gl${n})"/><path d="M-48 0L0-84L48 0Z" fill="${DARKF}"/><path d="M-20 0L0-46L20 0Z" fill="${LIT}"/><path d="M0-46V0M-11-22H11" stroke="${DARKF}" stroke-width="2"/><rect x="-62" width="124" height="4" fill="${DARKF}"/>`,
  barn: n => `<circle cx="-14" cy="-20" r="70" fill="url(#gl${n})"/><path d="M-66 0V-42L0-72L66-42V0Z" fill="${DARKF}"/><rect x="-42" y="-36" width="52" height="36" fill="${LIT}"/><path d="M-16-36V0M-42-18H10" stroke="${DARKF}" stroke-width="2"/><rect x="28" y="-30" width="18" height="18" fill="${LIT}" opacity=".8"/>`,
  lodge: n => `<circle cy="-20" r="80" fill="url(#gl${n})"/><rect x="30" y="-80" width="10" height="24" fill="${DARKF}"/><path d="M-84 0V-34L-40-62H52L88-34V0Z" fill="${DARKF}"/><rect x="-62" y="-28" width="22" height="20" fill="${LIT}"/><rect x="-12" y="-28" width="26" height="28" fill="${LIT}"/><rect x="40" y="-28" width="22" height="20" fill="${LIT}" opacity=".8"/>`,
  gazebo: n => `<circle cy="-30" r="56" fill="url(#gl${n})"/><path d="M-64-44L0-72L64-44Z" fill="${DARKF}"/><path d="M-52-44V0M-18-44V0M18-44V0M52-44V0" stroke="${DARKF}" stroke-width="4"/><rect x="-54" y="-15" width="108" height="3" fill="${DARKF}"/><circle cy="-34" r="4" fill="${LIT}"/>`,
  sauna: n => `<g filter="url(#bl${n})" fill="#fff"><circle cx="24" cy="-86" r="9" opacity=".26"/><circle cx="32" cy="-108" r="13" opacity=".2"/><circle cx="46" cy="-134" r="18" opacity=".13"/></g><circle cx="-10" cy="-18" r="56" fill="url(#gl${n})"/><rect x="18" y="-72" width="8" height="24" fill="${DARKF}"/><path d="M-46 0V-34L0-58L46-34V0Z" fill="${DARKF}"/><rect x="-24" y="-28" width="20" height="16" fill="${LIT}"/><rect x="12" y="-30" width="16" height="30" fill="#1b2022"/>`,
  quad: n => `<path d="M38-24L150-40V4Z" fill="${LIT}" opacity=".2"/><circle cx="-26" cy="-13" r="13" fill="${DARKF}"/><circle cx="26" cy="-13" r="13" fill="${DARKF}"/><path d="M-36-22H-10L-2-35H14L30-25H40V-16H-36Z" fill="${DARKF}"/><path d="M10-35L4-48M-3-48H11" stroke="${DARKF}" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="-22" r="3" fill="${LIT}"/>`,
  base: n => `<g transform="translate(-92 0) scale(.62)">${OBJ.aframe(n)}</g><g transform="translate(8 0) scale(.5)">${OBJ.aframe(n)}</g><g transform="translate(104 0) scale(.6)">${OBJ.barn(n)}</g>`
};
OBJ.creek = OBJ.aframe;
const rnd = seed => { let s = (seed * 9301 + 49297) % 233280 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
let sceneN = 0;

const sceneCache = {};
// sky — чужое небо для того же дома (вечер, ночь, утро): так получается галерея из трёх кадров
function scene(kind, seed = 1, photo = '', sky = '') {
  if (photo) return `<img src="${esc(photo)}" alt="" loading="eager">`;
  const key = kind + '|' + seed + '|' + sky;
  if (!sceneCache[key]) sceneCache[key] = drawScene(kind, seed, sky || kind);
  return sceneCache[key].replace(/§/g, ++sceneN); // у каждой копии свои id градиентов
}
function drawScene(kind, seed, sk) {
  const n = '§', r = rnd(seed * 131 + 7);
  const [a, b, c] = SKY[sk] || SKY.base;
  const dark = sk === 'barn' || sk === 'sauna';
  const ridge = (base, lo, hi, step, wob, ph) => {
    let d = `M0 300V${base}`, x = 0;
    while (x < 400) {
      const w = step * (.7 + r() * .7), h = lo + r() * (hi - lo), y = base + Math.sin(x / 70 + ph) * wob;
      d += `L${x.toFixed(1)} ${y.toFixed(1)}L${(x + w / 2).toFixed(1)} ${(y - h).toFixed(1)}L${(x + w).toFixed(1)} ${y.toFixed(1)}`; x += w;
    }
    return d + 'V300Z';
  };
  let stars = '';
  if (dark) for (let i = 0; i < 28; i++) stars += `<circle cx="${(r() * 400).toFixed(0)}" cy="${(r() * 130).toFixed(0)}" r="${(.5 + r()).toFixed(1)}" fill="#fff" opacity="${(.25 + r() * .6).toFixed(2)}"/>`;
  const ox = kind === 'base' ? 200 : kind === 'quad' ? 170 : 258;
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
<linearGradient id="sk${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
<linearGradient id="fg${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset="1" stop-color="${c}" stop-opacity=".6"/></linearGradient>
<radialGradient id="gl${n}"><stop offset="0" stop-color="#ffb066" stop-opacity=".5"/><stop offset="1" stop-color="#ffb066" stop-opacity="0"/></radialGradient>
<filter id="bl${n}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>
<rect width="400" height="300" fill="url(#sk${n})"/>${stars}
<circle cx="${dark ? 96 : 318}" cy="${dark ? 58 : 150}" r="${dark ? 13 : 24}" fill="${dark ? '#e6ecef' : c}" opacity="${dark ? .9 : .55}"/>
<path d="${ridge(170, 14, 34, 11, 10, 1)}" fill="#1a2428" opacity=".5"/><rect y="118" width="400" height="84" fill="url(#fg${n})"/>
<path d="${ridge(206, 22, 54, 15, 8, 3)}" fill="#111a1c" opacity=".84"/><rect y="176" width="400" height="72" fill="url(#fg${n})" opacity=".7"/>
<rect y="247" width="400" height="53" fill="#0a0f0f"/><g transform="translate(${ox} 248)">${(OBJ[kind] || OBJ.base)(n)}</g>
<path d="${ridge(288, 18, 48, 22, 4, 5)}" fill="#050808"/></svg>`;
}
const unitScene = u => scene(u.scene, u.id.charCodeAt(1), u.photo);

// Условные кадры для ленты приёмки, пока сотрудники не сняли настоящие
function demoShot(k) {
  const body = {
    bed: '<rect width="120" height="120" fill="#b9b2a6"/><rect y="78" width="120" height="42" fill="#8d8478"/><rect x="14" y="56" width="92" height="40" rx="6" fill="#e9e5dc"/><rect x="14" y="38" width="92" height="24" rx="5" fill="#6f665b"/><rect x="24" y="48" width="30" height="16" rx="5" fill="#fff"/><rect x="66" y="48" width="30" height="16" rx="5" fill="#fff"/>',
    bath: '<rect width="120" height="120" fill="#c9d0cf"/><path d="M0 40H120M0 80H120M40 0V120M80 0V120" stroke="#b3bcbb" fill="none"/><rect x="38" y="16" width="44" height="40" rx="6" fill="#eef3f3"/><rect x="28" y="70" width="64" height="16" rx="8" fill="#fff"/><rect x="52" y="86" width="16" height="34" fill="#9ea7a6"/>',
    room: '<rect width="120" height="120" fill="#bfb7a8"/><rect y="84" width="120" height="36" fill="#7c6f5e"/><path d="M60 8L98 70H22Z" fill="#dfe9ee"/><path d="M60 8V70M41 40H79" stroke="#7c6f5e" stroke-width="2" fill="none"/><rect x="18" y="72" width="60" height="22" rx="6" fill="#4e5a55"/>'
  }[k] || '';
  return `<svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
}
const shotHTML = p => p.src ? `<img src="${p.src}" alt="${esc(p.label)}">` : demoShot(p.demo);

// =====================================================================
//  2. Слои: уведомление, подтверждение, шторка, просмотр фото
// =====================================================================
let toastT = 0;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200);
}
DB.onFail = () => toast('Память браузера заполнена. Удалите старые фото или сбросьте демо-данные');

let askFn = null;
function ask(title, text, okLabel, fn, danger) {
  askFn = fn;
  const el = $('#ask');
  el.innerHTML = `<div class="scrim" onclick="closeAsk()"></div><div class="dialog" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}
    <div class="btns"><button class="btn ghost" onclick="closeAsk()">Назад</button><button class="btn ${danger ? 'danger' : ''}" onclick="askOk()">${esc(okLabel)}</button></div></div>`;
  el.hidden = false;
}
function closeAsk() { $('#ask').hidden = true; $('#ask').innerHTML = ''; askFn = null; if (S.dirtyRemote && $('#sheet').hidden) { S.dirtyRemote = false; render(); } }
function askOk() { const f = askFn; closeAsk(); if (f) f(); }
function viewer(html, caption) {
  const el = $('#ask');
  el.innerHTML = `<div class="scrim" onclick="closeAsk()"></div><div class="viewer" onclick="closeAsk()">${PH.fix(html)}<p>${esc(caption || '')}</p></div>`;
  el.hidden = false; PH.hydrate(el);
}

function sheet(html) {
  const el = $('#sheet'), was = el.hidden, old = $('.sheet', el), y = old ? old.scrollTop : 0;
  el.innerHTML = `<div class="scrim" onclick="closeSheet()"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${PH.fix(html)}</div>`;
  el.classList.toggle('in', was); el.hidden = false; document.body.classList.add('lock'); PH.hydrate(el);
  if (!was) $('.sheet', el).scrollTop = y;
}
function closeSheet() { const el = $('#sheet'); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('lock'); S.how = null; if (S.dirtyRemote) { S.dirtyRemote = false; render(); } }
const sheetHead = (title, sub = '') => `<div class="sheet-h"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="iconbtn" aria-label="Закрыть" onclick="closeSheet()">${ic('x')}</button></div>`;
const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
const options = (list, cur) => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`; }).join('');

// Фото с камеры или из галереи: уменьшаем, чтобы сотни снимков не переполнили память телефона
function pickPhoto(cb, camera) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  if (camera) inp.capture = 'environment';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        // С общей базой фото уходит в облако, поэтому можно чётче: 1280 точек вместо 720
        const cloud = SRV() && SYNC.signedIn, side = cloud ? 1280 : 720;
        const k = Math.min(1, side / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', cloud ? .7 : .6);
        cb(cloud ? PH.add(url) : url);
      };
      im.onerror = () => toast('Не получилось открыть фото, попробуйте другое');
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  inp.click();
}
function copyText(text, okMsg) {
  const done = () => toast(okMsg || 'Скопировано');
  try { navigator.clipboard.writeText(text).then(done, () => toast(text)); } catch (e) { toast(text); }
}

// =====================================================================
//  3. Каркас: вход, навигация, тема
// =====================================================================
const NAV = {
  admin: [['today', 'home', 'Сегодня'], ['chess', 'grid', 'Шахматка'], ['accept', 'camera', 'Приёмка'], ['cash', 'wallet', 'Касса'], ['base', 'layers', 'База']],
  staff: [['tasks', 'check', 'Задачи'], ['units', 'aframe', 'Объекты'], ['learn', 'book', 'Обучение'], ['shift', 'user', 'Смена']],
  instructor: [['park', 'quad', 'Парк'], ['rides', 'route', 'Выезды'], ['service', 'wrench', 'ТО'], ['shift', 'user', 'Смена']],
  guest: [['g_home', 'aframe', 'Дом'], ['g_shop', 'bag', 'Услуги'], ['g_chat', 'chat', 'Чат'], ['g_book', 'calendar', 'Брони'], ['g_me', 'user', 'Профиль']]
};
const V = {}; // экраны: имя вкладки → функция, возвращающая HTML. Вложенные страницы начинаются с m_
const PARENT = {}; // вложенная страница → вкладка дока, которая подсвечивается

function applyTheme() {
  const t = DB.prefGet('theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}
function setTheme(t) { DB.prefSet('theme', t); applyTheme(); render(); }
const themeSeg = () => { const t = DB.prefGet('theme') || 'auto'; return `<div class="seg in">${[['auto', 'Как в телефоне'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([k, l]) => `<button class="${t === k ? 'on' : ''}" onclick="setTheme('${k}')">${l}</button>`).join('')}</div>`; };
const consentBox = id => `<label class="check"><input type="checkbox" id="${id}"><span class="small">Согласен на обработку персональных данных по 152-ФЗ: имя и телефон нужны только для брони и связи со мной</span></label>`;

let phoneStep = 0;
const SRV = () => !!(window.SYNC && SYNC.enabled);   // есть общая база: вход и права проверяет сервер
function renderAuth(mode = 'login') {
  $('#app').hidden = true; $('#auth').hidden = false;
  if (mode !== 'phone') phoneStep = 0;
  if (SRV()) return renderAuthServer(mode);
  const demo = [['admin', 'admin', 'Управляющий', 'пульт базы'], ['elena', '123', 'Горничная', 'чек-листы и фото'], ['dmitry', '123', 'Инструктор', 'квадроциклы'], ['guest', '123', 'Гость', 'консьерж']];
  const prop = CAT.properties.find(p => p.id === DB.pid()) || CAT.properties[0];
  $('#auth').innerHTML = `<div class="auth-bg">${scene('base', 3)}</div><div class="auth-in">
    <div><div class="brand">${esc(prop.name)}</div><p class="brand-sub">База отдыха в сосновом лесу. Дома, баня, беседки и квадроциклы.</p></div>
    <div class="auth-panel">
      <div class="seg in">${[['login', 'Вход'], ['phone', 'По телефону'], ['reg', 'Регистрация']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" onclick="renderAuth('${k}')">${l}</button>`).join('')}</div>
      ${mode === 'login' ? `
        <form class="form" onsubmit="event.preventDefault();doLogin()">
          <input id="a-login" class="inp" placeholder="Логин" autocomplete="username" aria-label="Логин">
          <input id="a-pass" class="inp" type="password" placeholder="Пароль" autocomplete="current-password" aria-label="Пароль">
          <button class="btn block">Войти</button>
        </form>
        <p class="hint">Демо-доступ: откройте приложение за любую роль</p>
        <div class="demo">${demo.map(([l, p, t, s]) => `<button onclick="quickLogin('${l}','${p}')"><span class="avatar">${t[0]}</span><span>${t}<small>${s}</small></span></button>`).join('')}</div>`
      : mode === 'phone' ? `
        <form class="form" onsubmit="event.preventDefault();doPhone()">
          <input id="ph-num" class="inp" type="tel" placeholder="+7 (___) ___-__-__" autocomplete="tel" aria-label="Телефон" value="${esc(S.phone || '')}" ${phoneStep ? 'readonly' : ''}>
          ${phoneStep ? `<input id="ph-code" class="inp" inputmode="numeric" maxlength="4" placeholder="Код из SMS" aria-label="Код из SMS" autocomplete="one-time-code">
            <p class="hint">Демо-режим: SMS не отправляется, введите 1234. Настоящие коды придут после подключения сервера.</p>` : consentBox('ph-ok')}
          <button class="btn block">${phoneStep ? 'Войти' : 'Получить код'}</button>
        </form>` : `
        <form class="form" onsubmit="event.preventDefault();doRegister()">
          <input id="r-name" class="inp" placeholder="Имя и фамилия" autocomplete="name" aria-label="Имя и фамилия">
          <input id="r-phone" class="inp" type="tel" placeholder="Телефон" autocomplete="tel" aria-label="Телефон">
          <input id="r-login" class="inp" placeholder="Логин" autocomplete="username" aria-label="Логин">
          <input id="r-pass" class="inp" type="password" placeholder="Пароль" autocomplete="new-password" aria-label="Пароль">
          <input id="r-ref" class="inp" placeholder="Код друга, если есть" aria-label="Код приглашения" value="${esc(S.ref || '')}">
          ${consentBox('r-ok')}
          <button class="btn block">Создать аккаунт гостя</button>
        </form>`}
    </div>
    <div class="btns" style="justify-content:center"><button class="link" style="color:rgba(255,255,255,.8);flex:none" onclick="browseVisitor()">Смотреть дома без входа</button><button class="link" style="color:rgba(255,255,255,.6);flex:none" onclick="renderIntro(0)">Про базу</button></div></div>`;
}
// Вход с общей базой: без демо-кнопок, пароль проверяет сервер. Пока управляющего нет — экран первого запуска
function renderAuthServer(mode) {
  if (S.srvReady === undefined) {
    S.srvReady = null;
    SYNC.status().then(r => { S.srvReady = r.ok ? r.ready : undefined; if (!$('#auth').hidden && $('.auth-panel')) renderAuth(mode); });
  }
  const prop = CAT.properties.find(p => p.id === DB.pid()) || CAT.properties[0];
  const setup = S.srvReady === false;
  $('#auth').innerHTML = `<div class="auth-bg">${scene('base', 3)}</div><div class="auth-in">
    <div><div class="brand">${esc(prop.name)}</div><p class="brand-sub">${setup ? 'Первый запуск: создайте вход управляющего. Пароль знаете только вы.' : 'База отдыха в сосновом лесу. Дома, баня, беседки и квадроциклы.'}</p></div>
    <div class="auth-panel">
      ${setup ? `
        <form class="form" onsubmit="event.preventDefault();doSetup()">
          <input id="s-name" class="inp" placeholder="Ваше имя" autocomplete="name" aria-label="Имя">
          <input id="s-login" class="inp" placeholder="Логин" value="admin" autocomplete="username" aria-label="Логин" autocapitalize="off">
          <input id="s-pass" class="inp" type="password" placeholder="Пароль, минимум 8 символов" autocomplete="new-password" aria-label="Пароль">
          <input id="s-pass2" class="inp" type="password" placeholder="Пароль ещё раз" autocomplete="new-password" aria-label="Пароль ещё раз">
          <button class="btn block" id="auth-go">Создать и войти</button>
        </form>
        <p class="hint">Потом в разделе «Персонал» вы выдадите пароли сотрудникам.</p>` : `
      <div class="seg in">${[['login', 'Вход'], ['reg', 'Регистрация']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" onclick="renderAuth('${k}')">${l}</button>`).join('')}</div>
      ${mode !== 'reg' ? `
        <form class="form" onsubmit="event.preventDefault();doLogin()">
          <input id="a-login" class="inp" placeholder="Логин" autocomplete="username" aria-label="Логин" autocapitalize="off">
          <input id="a-pass" class="inp" type="password" placeholder="Пароль" autocomplete="current-password" aria-label="Пароль">
          <button class="btn block" id="auth-go">Войти</button>
        </form>
        <p class="hint">Сотрудникам логин и пароль выдаёт управляющий. Гости регистрируются сами.</p>` : `
        <form class="form" onsubmit="event.preventDefault();doRegister()">
          <input id="r-name" class="inp" placeholder="Имя и фамилия" autocomplete="name" aria-label="Имя и фамилия">
          <input id="r-phone" class="inp" type="tel" placeholder="Телефон" autocomplete="tel" aria-label="Телефон">
          <input id="r-login" class="inp" placeholder="Логин латиницей" autocomplete="username" aria-label="Логин" autocapitalize="off">
          <input id="r-pass" class="inp" type="password" placeholder="Пароль, минимум 6 символов" autocomplete="new-password" aria-label="Пароль">
          <input id="r-ref" class="inp" placeholder="Код друга, если есть" aria-label="Код приглашения" value="${esc(S.ref || '')}">
          ${consentBox('r-ok')}
          <button class="btn block" id="auth-go">Создать аккаунт гостя</button>
        </form>`}`}
    </div>
    ${setup ? '' : `<div class="btns" style="justify-content:center"><button class="link" style="color:rgba(255,255,255,.8);flex:none" onclick="browseVisitor()">Смотреть дома без входа</button><button class="link" style="color:rgba(255,255,255,.6);flex:none" onclick="renderIntro(0)">Про базу</button></div>`}</div>`;
}
// Кнопка входа на время запроса к серверу
async function busy(fn) {
  const b = $('#auth-go'), t = b && b.textContent;
  if (b) { if (b.disabled) return; b.disabled = true; b.textContent = 'Секунду…'; }
  try { return await fn(); } finally { if (b && b.isConnected) { b.disabled = false; b.textContent = t; } }
}
async function serverIn(fn, args, after) {
  const r = await busy(() => SYNC.signIn(fn, args));
  if (!r || !r.ok) return toast(r && r.error || 'Не получилось, попробуйте ещё раз');
  S.srvReady = true;
  launch(r.user); if (after) after(r);
}
function doSetup() {
  const pass = $('#s-pass').value;
  if (pass !== $('#s-pass2').value) return toast('Пароли не совпадают');
  serverIn('mu_setup', { p_login: val('s-login'), p_password: pass, p_name: val('s-name') }, () => toast('Готово. Теперь выдайте пароли персоналу в разделе «Персонал»'));
}
function doLogin() {
  if (!SRV()) return quickLogin(val('a-login'), $('#a-pass').value);
  if (!val('a-login') || !$('#a-pass').value) return toast('Введите логин и пароль');
  serverIn('mu_login', { p_login: val('a-login'), p_password: $('#a-pass').value });
}
function quickLogin(l, p) { const u = DB.auth(l, p); if (u) launch(u); else toast('Логин или пароль не подошли'); }
function doPhone() {
  if (!phoneStep) {
    const n = val('ph-num'); if (DB.digits(n).length < 11) return toast('Введите номер полностью, 11 цифр');
    if (!$('#ph-ok').checked) return toast('Нужно согласие на обработку данных');
    S.phone = n; phoneStep = 1; renderAuth('phone'); $('#ph-code').focus(); return;
  }
  if (val('ph-code') !== '1234') return toast('Код не подошёл. В демо-режиме это 1234');
  launch(DB.authPhone(S.phone));
}
function doRegister() {
  const name = val('r-name'), login = val('r-login'), pass = $('#r-pass').value;
  if (!name || !login || !pass) return toast('Заполните имя, логин и пароль');
  if (!$('#r-ok').checked) return toast('Нужно согласие на обработку данных');
  if (SRV()) return serverIn('mu_register', { p_login: login, p_password: pass, p_name: name, p_phone: val('r-phone'), p_ref: val('r-ref') },
    r => { S.ref = ''; if (r.ref) toast(`Скидка ${DB.S.refPct}% на первую бронь уже ваша`); });
  const r = DB.register(name, login, pass, val('r-phone'), val('r-ref'));
  if (!r.ok) return toast(r.msg);
  launch(r.user); if (r.ref) toast(`Скидка ${DB.S.refPct}% на первую бронь уже ваша`);
}
function browseVisitor() {
  if (SRV()) return serverIn('mu_visitor', {}, () => go('g_book'));
  launch(DB.visitor()); go('g_book');
}
function logout(force) {
  if (SRV() && !force && PH.count()) return ask('Не все фото отправлены', `${PH.count()} фото ещё на телефоне: не было связи. Если выйти сейчас, они пропадут.`, 'Выйти всё равно', () => logout(true), true);
  if (SRV()) SYNC.signOut(); else DB.logout();   // с общей базой с телефона стираются и данные
  S.user = null; S.cart = {}; S.qrKeys = null; closeSheet(); renderAuth(); window.scrollTo(0, 0);
}
// Гостю с общей базой ночные проверки не нужны: брони закрывает и уборки ставит телефон персонала
const canTick = u => u && (!SRV() || u.role !== 'guest');

function launch(user) {
  S.user = user; if (canTick(user)) DB.tick();
  if (SRV()) { SYNC.pub('mu_pay_ready').then(r => { S.payReady = !!(r && r.ready); }); setTimeout(payPendingCheck, 1500); }
  $('#auth').hidden = true; $('#auth').innerHTML = ''; $('#app').hidden = false;
  go(NAV[user.role][0][0]);
}
function go(tab) {
  if (tab === 'threads') return threads();
  if (!V[tab]) tab = NAV[S.user.role][0][0];
  closeSheet(); S.tab = tab; render(); window.scrollTo(0, 0);
  // Блоки нового экрана появляются по очереди
  const v = $('#view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  clearTimeout(go.t); go.t = setTimeout(() => v.classList.remove('enter'), 900);
}

function render() {
  if (!S.user) return;
  S.user = DB.user(S.user.login) || S.user;
  // Шахматка: запоминаем прокрутку, а при первом открытии показываем сегодняшний день и текущий час
  const keep = S.shown === S.tab + S.chess, sx = keep && $('#chess-scroll, #tl-scroll') ? $('#chess-scroll, #tl-scroll').scrollLeft : null;
  $('#view').innerHTML = PH.fix(V[S.tab]());
  PH.hydrate($('#view'));
  S.shown = S.tab + S.chess;
  const sc = $('#chess-scroll, #tl-scroll');
  if (sc) {
    const th = $('th.tdy', sc);
    sc.scrollLeft = sx != null ? sx : sc.id === 'tl-scroll' ? Math.max(0, (Math.min(Math.max(T.nowMin(), 660), 1140) - H0 * 60) / 60 * PX - 110) : th ? Math.max(0, th.offsetLeft - 170) : 0;
  }
  const d = DB.d, me = S.user;
  const badge = {
    today: d.messages.some(m => m.from === 'guest' && !m.read) || d.sos.some(s => s.status === 'open'),
    g_chat: d.messages.some(m => m.login === me.login && m.from === 'admin' && !m.read),
    learn: me.role === 'staff' && !me.trained
  };
  const cur = PARENT[S.tab] || S.tab;
  $('#dock').innerHTML = NAV[me.role].map(([id, icon, label]) =>
    `<button class="dk ${id === cur ? 'on' : ''}" onclick="go('${id}')" aria-label="${label}" ${id === cur ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${badge[id] ? '<em></em>' : ''}</button>`).join('');
  if (S.tab === 'g_chat') { DB.markRead(me.login, 'admin'); window.scrollTo(0, document.body.scrollHeight); }
}
// Колокольчик с непрочитанными уведомлениями — в правом углу каждого экрана
const bell = () => { const n = DB.notesFor(S.user).filter(x => !x.read).length; return `<button class="iconbtn bell" aria-label="Уведомления${n ? ', новых: ' + n : ''}" onclick="notesSheet()">${ic('bell')}${n ? `<em>${n > 9 ? '9+' : n}</em>` : ''}</button>`; };
const head = (sub, title, right) => `<header class="top"><div><p class="top-sub">${sub}</p><h1 class="top-title">${title}</h1></div>${right === undefined ? bell() : `<div class="nav">${right}${bell()}</div>`}</header>`;
// Заголовок вложенной страницы: стрелка назад ведёт на вкладку дока
const subhead = (title, sub, right = '') => `<header class="top sub"><button class="iconbtn" aria-label="Назад" onclick="go('${PARENT[S.tab] || NAV[S.user.role][0][0]}')">${ic('left')}</button><div style="flex:1;min-width:0"><h1 class="top-title">${title}</h1>${sub ? `<p class="top-sub">${sub}</p>` : ''}</div>${right}</header>`;

const STATUS = { ready: ['ok', 'Готов к заселению'], cleaning: ['warn', 'Идёт уборка'], dirty: ['bad', 'Нужна уборка'], rework: ['bad', 'На переделке'] };
const statusChip = u => { const [c, l] = STATUS[u.status] || STATUS.ready; return `<span class="chip ${c}">${u.status === 'ready' && u.kind !== 'house' ? 'Готово к гостям' : l}</span>`; };
const srcClass = s => /Яндекс/.test(s || '') ? 's2' : /Авито/.test(s || '') ? 's3' : /Островок|Сайт/.test(s || '') ? 's4' : '';
const CATC = { stay: '--c1', gazebo: '--c2', sauna: '--c3', quad: '--c4', goods: '--c5', food: '--ok', rent: '--warn', extra: '--ember', pass: '--muted', tax: '--faint', other: '--faint' };

// =====================================================================
//  4. Общие экраны: уведомления, оплата, чек, карта территории
// =====================================================================
function notesSheet() {
  const list = DB.notesFor(S.user).slice(0, 40);
  sheet(sheetHead('Уведомления', 'Когда подключим сервер, эти же сообщения будут приходить в Telegram') + `<div class="card flat"><div class="list">${list.length ? list.map(n => `<button class="li" onclick="${n.go ? `go('${n.go}')` : 'closeSheet()'}"><span class="li-ic ${n.read ? '' : 'hot'}">${ic(n.icon || 'info')}</span><span class="li-main"><span class="li-t" style="font-weight:${n.read ? 500 : 600}">${esc(n.text)}</span><br><span class="li-s">${T.stamp(n.ts)}</span></span></button>`).join('') : '<p class="empty">Пока тихо.</p>'}</div></div>`);
  DB.readNotes(S.user);
  const b = $('.bell em'); if (b) b.remove();
}

// Демо-оплата: СБП или карта, бонусы, сертификат. Деньги не списываются, пока не подключён эквайринг
let payCtx = null;
// Онлайн-оплата подключена (payments.sql и ключи терминала): платёж идёт через страницу Т-Банка
const payOnline = () => SRV() && SYNC.signedIn && S.payReady;
function paySheet(o) {
  // o: { title, amount, onPaid(method, info), folioId, allowBonus }
  payCtx = Object.assign({ method: payOnline() ? 'Онлайн' : 'СБП', bonus: 0, cert: 0, certCode: '' }, o);
  renderPay();
}
function renderPay() {
  const p = payCtx, u = S.user, bonusMax = p.allowBonus === false ? 0 : Math.min(u.bonus || 0, Math.floor(p.amount * .3));
  const due = Math.max(0, p.amount - p.bonus - p.cert);
  const stay = p.folioId != null;
  sheet(sheetHead('Оплата', esc(p.title)) + `
    <div class="total"><span class="muted">К оплате</span><b>${money(due)}</b></div>
    <div class="seg in">${(payOnline() ? [['Онлайн', 'Картой или СБП']] : [['СБП', 'СБП'], ['Карта', 'Картой']]).concat(stay ? [['В счёт проживания', 'В счёт дома']] : []).map(([k, l]) => `<button class="${p.method === k ? 'on' : ''}" onclick="payCtx.method='${k}';renderPay()">${l}</button>`).join('')}</div>
    ${p.method === 'В счёт проживания' ? '<p class="small muted">Сумма добавится в общий счёт дома, оплатите всё разом при выезде.</p>' : ''}
    ${bonusMax > 0 && p.method !== 'В счёт проживания' ? `<label class="check"><input type="checkbox" ${p.bonus ? 'checked' : ''} onchange="payCtx.bonus=this.checked?${bonusMax}:0;renderPay()"><span>Списать ${money(bonusMax)} бонусами <span class="muted small">(есть ${money(u.bonus)}, можно до 30% суммы)</span></span></label>` : ''}
    ${p.method !== 'В счёт проживания' ? `<div class="composer"><input id="pay-cert" class="inp" placeholder="Код сертификата" value="${esc(p.certCode)}" aria-label="Код сертификата"><button class="btn sm ghost" style="min-height:46px" onclick="applyCert()">Применить</button></div>${p.cert ? `<p class="small" style="color:var(--ok)">Сертификат: −${money(p.cert)}</p>` : ''}` : ''}
    <button class="btn block" id="pay-go" onclick="doPay()">${p.method === 'В счёт проживания' ? 'Добавить в счёт' : due ? `Оплатить ${money(due)}` : 'Подтвердить'}</button>
    <p class="small muted" style="text-align:center">${payOnline() ? 'Оплата на защищённой странице Т-Банка. Данные карты приложение не видит.' : 'Демо-режим: деньги не списываются. После подключения эквайринга здесь откроется страница банка, а чек придёт на телефон.'}</p>`);
}
async function applyCert() {
  // С общей базой код проверяет сервер: чужие сертификаты телефону не видны
  const c = SRV() ? await SYNC.call('mu_cert', { p_code: val('pay-cert'), p_amount: 0 }) : DB.cert(val('pay-cert'));
  if (!c || c.ok === false) return toast(c && c.error || 'Сертификат не найден или уже потрачен');
  payCtx.certCode = c.code; payCtx.cert = Math.min(c.balance, payCtx.amount - payCtx.bonus); renderPay();
}
async function doPay() {
  const p = payCtx, btn = $('#pay-go');
  const due = Math.max(0, p.amount - p.bonus - p.cert);
  if (p.method === 'Онлайн' && payOnline() && due > 0) {
    btn.disabled = true; btn.textContent = 'Создаём платёж…';
    const r = await SYNC.call('mu_pay_init', { p_amount: due, p_title: p.title, p_contact: S.user.phone || '' });
    if (!r.ok) { btn.disabled = false; renderPay(); return toast(r.error); }
    try { localStorage.setItem('mu_pay_pending', JSON.stringify({ order: r.order, title: p.title, amount: due, login: S.user.login })); } catch (e) { /* без памяти обойдёмся */ }
    S.payOrder = r.order; S.payUrl = r.url; S.payStarted = Date.now();
    return payWait();
  }
  if (p.method !== 'В счёт проживания') { btn.disabled = true; btn.textContent = 'Связываемся с банком…'; await new Promise(r => setTimeout(r, 900)); }
  if (p.bonus) DB.updateUser(S.user.login, { bonus: (S.user.bonus || 0) - p.bonus });
  if (p.cert && SRV()) {
    const r = await SYNC.call('mu_cert', { p_code: p.certCode, p_amount: p.cert });
    if (!r.ok) { btn.disabled = false; renderPay(); return toast(r.error); }
    p.cert = r.taken; SYNC.cycle(true);
  } else if (p.cert) DB.useCert(p.certCode, p.cert);
  const info = { paid: p.amount - p.bonus - p.cert, bonus: p.bonus, cert: p.cert };
  closeSheet();
  p.onPaid(p.method, info);
}
// Ждём, пока банк подтвердит оплату. Заказ оформляется только после ответа банка «оплачено»
function payWait(msg) {
  const p = payCtx, due = Math.max(0, p.amount - p.bonus - p.cert);
  sheet(sheetHead('Оплата', esc(p.title)) + `
    <div class="total"><span class="muted">К оплате</span><b>${money(due)}</b></div>
    <a class="btn block" href="${esc(S.payUrl)}" target="_blank" rel="noopener">${ic('wallet', 'sm')} Перейти к оплате</a>
    <p class="small muted" id="pay-st" style="text-align:center">${esc(msg || 'Откроется страница Т-Банка. Оплатите картой или по СБП и вернитесь сюда: заказ оформится сам.')}</p>
    <button class="btn block ghost" onclick="payPoll(true)">Я оплатил, проверить</button>
    <button class="btn block line" onclick="payCancel()">Отменить</button>`);
  clearTimeout(S.payTimer); S.payTimer = setTimeout(() => payPoll(false), 3000);
}
async function payPoll(manual) {
  clearTimeout(S.payTimer);
  const order = S.payOrder; if (!order) return;
  const r = await SYNC.call('mu_pay_status', { p_order: order });
  if (S.payOrder !== order) return;
  if (r.ok && r.paid) return payDone(order);
  if (r.ok && r.failed) { S.payOrder = null; payForget(); if ($('#pay-st')) { closeSheet(); toast('Оплата не прошла. Попробуйте ещё раз или другой картой'); } return; }
  if (manual) toast(r.ok ? 'Банк ещё не подтвердил оплату. Подождите минуту' : r.error);
  if (Date.now() - S.payStarted < 20 * 60000 && $('#pay-st')) S.payTimer = setTimeout(() => payPoll(false), 3000);
}
function payCancel() { clearTimeout(S.payTimer); S.payOrder = null; payForget(); closeSheet(); toast('Оплата отменена'); }
function payForget() { try { localStorage.removeItem('mu_pay_pending'); } catch (e) { /* нет памяти */ } }
async function payDone(order) {
  const p = payCtx; S.payOrder = null; payForget();
  if (p.bonus) DB.updateUser(S.user.login, { bonus: (S.user.bonus || 0) - p.bonus });
  if (p.cert) { const c = await SYNC.call('mu_cert', { p_code: p.certCode, p_amount: p.cert }); p.cert = c.ok ? c.taken : 0; }
  const info = { paid: p.amount - p.bonus - p.cert, bonus: p.bonus, cert: p.cert, payId: order };
  closeSheet();
  DB.curPay = order;
  try { p.onPaid('Онлайн', info); } finally { DB.curPay = null; }
  DB.save();
  toast('Оплата прошла, спасибо!');
}
// Оплатил, но приложение закрылось раньше, чем банк ответил: сообщаем управляющему, чтобы заказ оформили вручную
async function payPendingCheck() {
  let pend = null; try { pend = JSON.parse(localStorage.getItem('mu_pay_pending')); } catch (e) { pend = null; }
  if (!pend || !S.user || pend.login !== S.user.login || S.payOrder === pend.order) return;
  const r = await SYNC.call('mu_pay_status', { p_order: pend.order });
  if (!r.ok) return;
  if (r.paid) {
    payForget();
    DB.notify('admin', `Онлайн-оплата ${money(pend.amount)} от ${S.user.name} прошла, но заказ «${pend.title}» не оформился: приложение закрыли раньше. Оформите вручную`, 'wallet', 'cash');
    DB.save();
    ask('Оплата получена', `Мы получили ${money(pend.amount)} за «${pend.title}», но заказ не успел оформиться. Администратор уже знает и всё оформит, ничего делать не нужно.`, 'Понятно', () => {});
  } else if (r.failed) payForget();
}
// Возврат со страницы банка в браузере, где не выполнен вход (на iPhone приложение и Safari живут отдельно)
function renderPayReturn(ok) {
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#auth').innerHTML = `<div class="auth-bg">${scene('base', 3)}</div><div class="auth-in"><div><div class="brand">${ok ? 'Оплата прошла' : 'Оплата не прошла'}</div>
    <p class="brand-sub">${ok ? 'Вернитесь в приложение «Медвежий угол»: заказ оформится сам через несколько секунд. Эту вкладку можно закрыть.' : 'Деньги не списаны. Вернитесь в приложение и попробуйте ещё раз или выберите другую карту.'}</p></div>
    <button class="btn block" onclick="history.replaceState(null,'',location.pathname);route()">Открыть приложение здесь</button></div>`;
}

// Электронный чек. Реквизиты кассы появятся после подключения онлайн-кассы (54-ФЗ)
function receiptSheet(txId) {
  const x = DB.d.tx.find(t => t.id === txId); if (!x) return;
  const prop = CAT.properties.find(p => p.id === DB.pid());
  sheet(sheetHead('Кассовый чек', `№ ${x.receipt || x.id}, ${T.stamp(x.ts)}`) + `<div class="receipt">
    <b>${esc(prop.name)}</b><span>Приход</span><hr>
    <div class="rl"><span>${esc(x.title)}</span><b>${money(x.amount)}</b></div>
    <div class="rl"><span>НДС</span><span>не облагается</span></div><hr>
    <div class="rl big2"><span>Итого</span><b>${money(x.amount)}</b></div>
    <div class="rl"><span>${x.method === 'Наличные' ? 'Наличными' : 'Безналичными'}</span><span>${money(x.amount)}</span></div><hr>
    <span class="muted small">ФН, ФД и ФП появятся после подключения онлайн-кассы. Чек будет уходить гостю по SMS или на почту автоматически.</span></div>`);
}

// Схема территории: объекты, маршрут «как дойти», точка квадроцикла на тропе
function mapSVG(o = {}) {
  const M = CAT.map, d = DB.d, rr = rnd(11);
  let trees = '';
  for (let i = 0; i < 150; i++) { const x = rr() * 400, y = rr() * 520; if (y > 440 && x < 200) continue; trees += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(3 + rr() * 5).toFixed(1)}" class="mp-tree"/>`; }
  const pts = r => r.map(p => p.join(',')).join(' ');
  const route = o.route && M.routes[o.route] ? `<polyline points="${pts(M.routes[o.route])}" class="mp-route"/><circle cx="${M.routes[o.route][0][0]}" cy="${M.routes[o.route][0][1]}" r="7" class="mp-start"/>` : '';
  const walk = [...new Set(Object.values(M.routes).map(pts))].map(p => `<polyline points="${p}" class="mp-walk"/>`).join('');
  const units = d.units.filter(u => M.units[u.id]).map(u => {
    const [x, y] = M.units[u.id], on = o.focus === u.id, busy = d.bookings.some(b => b.unitId === u.id && b.start && b.start <= T.today() && T.today() < b.end);
    return `<g class="mp-u ${on ? 'on' : ''}" transform="translate(${x} ${y})" onclick="mapPick('${u.id}')" role="button" aria-label="${esc(u.short)}"><circle r="${on ? 17 : 14}" class="${u.status === 'ready' ? 'ok' : 'warn'}"/><text y="4">${u.kind === 'house' ? u.id.slice(1) : u.kind === 'sauna' ? 'Б' : 'Бс'}</text>${busy && o.admin ? '<circle cx="11" cy="-11" r="4" class="mp-busy"/>' : ''}</g><text x="${x}" y="${y + 30}" class="mp-label">${esc(u.short)}</text>`;
  }).join('');
  const pois = M.pois.map(p => `<g class="mp-p ${o.focus === p.id ? 'on' : ''}" transform="translate(${p.x} ${p.y})" onclick="mapPick('${p.id}')" role="button" aria-label="${esc(p.name)}"><rect x="-12" y="-12" width="24" height="24" rx="8"/><g transform="translate(-8 -8) scale(.667)"><path d="${ICONS[p.icon]}"/></g></g>`).join('');
  const riding = (o.rides || []).map(r => {
    const f = Math.min(.98, Math.max(.02, (Date.now() - r.startedAt) / (r.dur * 60000)));
    return `<circle r="7" class="mp-quad"><animateMotion dur="0.01s" fill="freeze" keyPoints="${f.toFixed(3)};${f.toFixed(3)}" keyTimes="0;1" calcMode="linear" path="${M.trail}"/></circle>`;
  }).join('');
  return `<div class="map"><svg viewBox="0 0 400 520" role="img" aria-label="Схема территории">
    <rect width="400" height="520" class="mp-bg"/>${trees}
    <path d="${M.creek}" class="mp-creek"/><path d="M0 500 L60 470 L92 478" class="mp-road"/>
    ${o.trail ? `<path d="${M.trail}" class="mp-trail"/>` : ''}${walk}${route}${pois}${units}${riding}
  </svg></div>`;
}
let mapPickFn = null;
function mapPick(id) { if (mapPickFn) mapPickFn(id); }
const placeName = id => { const u = DB.unit(id); if (u) return u.short; const p = CAT.map.pois.find(x => x.id === id); return p ? p.name : id; };
// Шторка «Как дойти» для гостя и персонала
function mapSheet(focus) {
  mapPickFn = id => mapSheet(id);
  const u = DB.unit(focus), p = CAT.map.pois.find(x => x.id === focus);
  const len = focus && CAT.map.routes[focus] ? CAT.map.routes[focus].reduce((a, pt, i, arr) => i ? a + Math.hypot(pt[0] - arr[i - 1][0], pt[1] - arr[i - 1][1]) : 0, 0) : 0;
  sheet(sheetHead('Карта базы', focus ? `От парковки до «${esc(placeName(focus))}» около ${Math.max(1, Math.round(len * .9 / 80))} мин пешком` : 'Нажмите на объект, чтобы проложить путь от парковки') + mapSVG({ focus, route: focus, trail: !focus }) +
    (u ? `<div class="card"><span class="h2">${esc(u.name)}</span><span class="muted small">${esc(u.desc)}</span></div>` : p ? `<div class="card"><span class="h2">${esc(p.name)}</span></div>` : '') +
    `<p class="small muted">Ночью тропы освещены фонарями. Если заблудились, нажмите SOS на главном экране.</p>`);
}

// =====================================================================
//  5. Приветствие и экран загрузки
// =====================================================================
const INTRO = [
  { kind: 'base', seed: 3, sky: '', glow: '#4d8dff', a: 'Тишина, которую', b: 'слышно', text: 'Медвежий угол стоит в сосновом лесу. Дома с террасами, костёр по вечерам и два гектара тайги вокруг. Город остаётся за шлагбаумом.' },
  { kind: 'sauna', seed: 9, sky: '', glow: '#ff7a3d', a: 'Баня, костёр и', b: 'лесные маршруты', text: 'Финскую баню растопим к вашему приходу. Беседки с мангалами ждут компанию, а квадроциклы тех, кому не сидится на месте.' },
  { kind: 'aframe', seed: 4, sky: 'lodge', glow: '#3fbf8f', a: 'Весь отдых', b: 'в телефоне', text: 'Забронировать дом, заказать дрова к террасе, записаться в баню или написать администратору можно за минуту. Без звонков и ожидания.' }
];
let introI = 0;
function renderIntro(i) {
  introI = i; const sl = INTRO[i], last = i === INTRO.length - 1;
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#auth').innerHTML = `<div class="intro" style="--glow:${sl.glow}">
    <div class="intro-bg">${scene(sl.kind, sl.seed, '', sl.sky)}</div>
    <button class="intro-tap" style="left:0" aria-label="Предыдущий слайд" onclick="introGo(-1)"></button><button class="intro-tap" style="right:0" aria-label="Следующий слайд" onclick="introGo(1)"></button>
    <div class="intro-in">
      <div><div class="intro-bars">${INTRO.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'run' : ''}"><b ${k === i ? 'onanimationend="introGo(1,true)"' : ''}></b></i>`).join('')}</div>
        <div class="intro-top"><span>${ic('aframe', 'sm')} Медвежий угол</span><button onclick="introDone()">Пропустить</button></div></div>
      <div class="intro-text"><h1>${sl.a} <em>${sl.b}</em></h1><p>${sl.text}</p>
        <button class="btn block" onclick="${last ? 'introDone()' : 'introGo(1)'}">${last ? 'Войти в приложение' : 'Дальше'}</button></div>
    </div></div>`;
}
function introGo(n, auto) {
  const k = introI + n;
  if (k < 0) return renderIntro(0);
  if (k >= INTRO.length) return auto ? null : introDone(); // на последнем слайде ждём нажатия
  renderIntro(k);
}
function introDone() { DB.prefSet('intro', '1'); loader(route); }

// Загрузка: пока идёт анимация, заранее готовим шрифты, рисунки домов и фотографии,
// чтобы дальше экраны открывались без подгрузок
const wait = ms => new Promise(r => setTimeout(r, ms));
const preloadImg = src => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = src; });
const LOAD = [
  ['Общая база', () => window.SYNC && SYNC.enabled ? (SYNC.ready || SYNC.start()) : null],
  ['Шрифты', () => document.fonts && document.fonts.load ? Promise.race([Promise.all(['600 16px Onest', '400 16px Onest', '500 16px Unbounded'].map(f => document.fonts.load(f, 'Медвежий угол 123 ₽'))), wait(2500)]) : null],
  ['Дома и лес', () => { DB.d.units.forEach(u => { unitScene(u); if (u.kind === 'house') { const sd = u.id.charCodeAt(1); scene(u.scene, sd, '', 'aframe'); scene(u.scene, sd, '', 'barn'); scene(u.scene, sd + 2, '', 'creek'); } }); scene('base', 3); scene('quad', 5); }],
  ['Фотографии', () => Promise.race([Promise.all([].concat(DB.d.units.map(u => u.photo), ...Object.values(CAT.houses).map(h => h.photos || []), Object.values(DB.d.refs || {})).filter(x => x && !/^ph:/.test(x)).map(preloadImg)), wait(4000)])],
  ['Брони и задачи', () => { if (canTick(DB.me())) DB.tick(); }]
];
async function loader(next) {
  closeSheet(); $('#app').hidden = true; $('#auth').hidden = false;
  $('#auth').innerHTML = `<div class="load"><div class="beam"></div><div class="load-in">
    <svg class="load-mark" viewBox="0 0 64 64" aria-hidden="true"><path pathLength="100" d="M6 54h52M12 54L32 10l20 44M27 54V40h10v14"/></svg>
    <div class="brand">Медвежий угол</div>
    <div class="load-bar" role="progressbar" aria-label="Загрузка"><i id="ld-bar"></i></div><p id="ld-txt">Загрузка</p></div></div>`;
  for (let i = 0; i < LOAD.length; i++) {
    const bar = $('#ld-bar'); if (!bar) return; // пользователь уже ушёл с экрана
    $('#ld-txt').textContent = LOAD[i][0]; bar.style.width = (i + 1) / LOAD.length * 100 + '%';
    try { await Promise.all([Promise.race([LOAD[i][1](), wait(15000)]), wait(S.warm ? 260 : 420)]); } catch (e) { /* не получилось подгрузить заранее — подгрузится позже */ }
  }
  S.warm = true;
  if (SRV() && SYNC.signedIn && !SYNC.online && !S.offlineWarned) { S.offlineWarned = true; setTimeout(() => toast('Нет связи с сервером. Работаем на данных телефона, изменения отправятся позже'), 400); }
  const el = $('.load'); if (!el) return;
  el.classList.add('out'); await wait(320);
  next();
}

// =====================================================================
//  6. Запуск
// =====================================================================
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#ask').hidden) closeAsk(); else if (!$('#sheet').hidden) closeSheet(); } });

// Приложение ставится на телефон как обычное (PWA) и открывается без интернета
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

// Куда вести после загрузки: QR со стола, приглашение в компанию, ссылка друга, отметка смены
async function route() {
  const h = location.hash;
  const payRet = /^#pay(ok|fail)/.exec(h);
  if (payRet) {
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    if (!(SRV() && SYNC.signedIn && DB.me())) return renderPayReturn(payRet[1] === 'ok');
    S.flash = payRet[1] === 'ok' ? 'Оплата прошла. Проверяем у банка…' : 'Оплата не прошла';
  }
  let user = DB.me();
  if (SRV() && !SYNC.signedIn) user = null;
  const qr = /^#qr-([a-z0-9]+)(?:-([a-f0-9]+))?$/i.exec(h);  // QR на столе в доме или беседке: …#qr-h1-<ключ>
  const join = /^#join-([A-Z0-9]+)$/i.exec(h);      // приглашение в бронь компании: …#join-G1234
  const ref = /^#ref-([A-Z0-9]+)$/i.exec(h);        // ссылка друга со скидкой: …#ref-KOSTYA
  if (SRV() && (qr || join)) {
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);   // ключ не остаётся в адресе
    if (!user) {
      const r = qr ? await SYNC.signIn('mu_qr', { p_unit: qr[1], p_key: qr[2] || '' }) : await SYNC.signIn('mu_join', { p_code: join[1].toUpperCase() });
      if (r.ok) user = r.user; else S.flash = r.error;
    }
  } else if (qr) user = DB.qrLogin(qr[1]) || user;
  if (join && !user && !SRV()) user = DB.joinGroup(join[1].toUpperCase());
  if (ref && !user) { S.ref = ref[1].toUpperCase(); DB.prefSet('intro', '1'); return renderAuth('reg'); }
  // QR на воротах для персонала: …#checkin отмечает приход на смену
  if (h === '#checkin' && user && user.role !== 'guest' && !DB.onShift(user.login)) { DB.checkIn(user.login); S.flash = 'Приход на смену отмечен'; }
  if (user) launch(user); else renderAuth();
  if (S.flash) { toast(S.flash); S.flash = ''; }
}

// Данные с сервера изменились: обновляем экран, но не мешаем, если открыта форма
function onRemoteChange() {
  if (!S.user) return;
  if ($('#sheet').hidden && $('#ask').hidden) render(); else S.dirtyRemote = true;
}

document.addEventListener('DOMContentLoaded', function boot() {
  DB.load(); applyTheme();
  if (window.SYNC) {
    SYNC.onRemote = onRemoteChange;
    SYNC.onSession = () => { if (S.user) { S.user = null; closeSheet(); renderAuth(); toast('Сессия закончилась или доступ изменён. Войдите снова'); } };
    SYNC.onDenied = () => { if (Date.now() - (S.deniedAt || 0) > 8000) { S.deniedAt = Date.now(); toast('Часть изменений не сохранилась: на это нет прав'); } };
    if (SYNC.enabled) SYNC.start();
  }
  if (!DB.prefGet('intro') && !location.hash) renderIntro(0);   // первый запуск: приветствие, база грузится в фоне
  else loader(route);
});
