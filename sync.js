// sync.js — общая база и вход по паролю.
//
// Как это устроено. Приложение работает с DB.d в памяти телефона, поэтому экраны открываются мгновенно
// и не зависят от связи в лесу. Этот файл в фоне:
//   1) при входе получает ключ сессии и забирает с сервера то, что этому человеку можно видеть;
//   2) после каждого DB.save() отправляет только изменённые записи;
//   3) каждые несколько секунд забирает то, что поменяли другие, и обновляет экран.
// Сервер сам проверяет права (см. auth.sql): если записать нельзя, он присылает, как запись выглядит у него,
// и телефон возвращает её назад. Без связи всё копится в телефоне и уходит, когда сеть появится.
(function () {
  const C = window.MU_CONFIG || {};
  const enabled = !!(C.supabaseUrl && C.supabaseKey);
  const BASE = enabled ? C.supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '') + '/rest/v1/rpc/' : '';
  const HEADERS = { apikey: C.supabaseKey, 'Content-Type': 'application/json' };
  if (C.supabaseKey && /^eyJ/.test(C.supabaseKey)) HEADERS.Authorization = 'Bearer ' + C.supabaseKey; // старый формат ключа anon

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* память переполнена: состояние восстановится полной загрузкой */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* нет доступа */ } },
    keys() { try { return Object.keys(localStorage); } catch (e) { return []; } }
  };
  const SESSION = 'mu_auth_v1', STATE = 'mu_sync_v1_';

  // ---------- Как разложить DB.d на отдельные записи ----------
  const SKIP = ['seq', 'pid', 'created'];                 // у каждого телефона свои
  const MAPS = ['refs', 'crm', 'heat'];                   // объекты «ключ → значение»: каждая пара отдельной записью
  const KEY = {                                           // чем однозначно назвать запись в разделе
    users: x => x.login, promos: x => x.code, certs: x => x.code,
    shifts: x => x.date + '|' + x.login, checkins: x => x.login + '|' + x.date + '|' + x.in
  };
  const keyOf = (coll, x) => String((KEY[coll] || (y => y.id != null ? y.id : JSON.stringify(y)))(x));
  const NEWEST = ['tx', 'notes', 'tasks', 'accepts', 'tickets', 'lost', 'leads', 'incidents', 'sos', 'reviews', 'waitlist', 'passes', 'certs', 'moods', 'checkins', 'fuel', 'rentals', 'promos'];
  const stamp = x => x.ts || x.in || (typeof x.id === 'number' ? x.id : 0);
  const KIND = { house: 0, gazebo: 1, sauna: 2 };

  function explode(d) {
    const out = {};
    Object.keys(d).forEach(k => {
      if (SKIP.includes(k)) return;
      const v = d[k];
      if (Array.isArray(v)) v.forEach(x => { out[k + '|' + keyOf(k, x)] = x; });
      else if (MAPS.includes(k)) Object.keys(v || {}).forEach(r => { out[k + '|' + r] = v[r]; });
      else out['$|' + k] = v;
    });
    return out;
  }
  const split = key => { const i = key.indexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };
  function sortColl(coll, arr) {
    if (NEWEST.includes(coll)) arr.sort((a, b) => stamp(b) - stamp(a));
    else if (coll === 'units') arr.sort((a, b) => (KIND[a.kind] - KIND[b.kind]) || String(a.id).localeCompare(String(b.id)));
    else if (arr.every(x => typeof x.id === 'number')) arr.sort((a, b) => a.id - b.id);
    return arr;
  }
  function put(d, coll, rid, value) {   // value === undefined — удалить
    if (coll === '$') { if (value === undefined) delete d[rid]; else d[rid] = value; return; }
    if (MAPS.includes(coll)) { d[coll] = d[coll] || {}; if (value === undefined) delete d[coll][rid]; else d[coll][rid] = value; return; }
    const arr = d[coll] = Array.isArray(d[coll]) ? d[coll] : [];
    const i = arr.findIndex(x => keyOf(coll, x) === rid);
    if (value === undefined) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = value; else if (NEWEST.includes(coll)) arr.unshift(value); else arr.push(value);
  }
  // Отпечаток записи. Порядок полей не важен: сервер хранит их в своём порядке
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
    : JSON.stringify(v === undefined ? null : v);
  const fp = v => {
    const s = canon(v); let a = 0x811c9dc5, b = 5381;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) + c) | 0; }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36);
  };

  // ---------- Сеть ----------
  async function rpc(fn, args, ms = 20000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(BASE + fn, { method: 'POST', headers: HEADERS, body: JSON.stringify(args), signal: ctl.signal });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const e = new Error(j.hint || j.message || 'Ошибка сервера ' + r.status);
        e.session = r.status === 401 || j.code === '28000';
        e.denied = r.status === 403 || j.code === '42501';
        throw e;
      }
      return r.json();
    } finally { clearTimeout(t); }
  }

  // ---------- Синхронизация ----------
  const SYNC = {
    enabled, online: false, property: 'mu', snap: {}, cursor: null, loaded: false, lastOk: 0, error: '',
    ready: null, busy: false, timer: null, pushTimer: null,
    onRemote: null, onSession: null, onDenied: null,
    auth: (() => { try { return JSON.parse(ls.get(SESSION)) || null; } catch (e) { return null; } })(),

    get signedIn() { return !!(this.auth && this.auth.token); },
    get role() { return this.auth ? this.auth.role : null; },

    // --- Состояние сверки хранится рядом с данными, чтобы после перезапуска не качать всё заново ---
    saveState() { ls.set(STATE + this.property, JSON.stringify({ login: this.auth && this.auth.login, cursor: this.cursor, snap: this.snap })); },
    loadState() {
      try {
        const st = JSON.parse(ls.get(STATE + this.property));
        if (st && this.auth && st.login === this.auth.login && st.cursor) { this.snap = st.snap || {}; this.cursor = st.cursor; this.loaded = true; }
      } catch (e) { /* испорчено — загрузим заново */ }
    },

    start() {
      if (!enabled || !this.signedIn) { this.ready = Promise.resolve(false); return this.ready; }
      this.property = DB.pid();
      clearTimeout(this.timer);
      this.ready = (async () => {
        if (!this.loaded) this.loadState();
        if (this.loaded) await this.cycle(true); else await this.fullLoad();
        PH.init();
        this.loop();
        return this.online;
      })();
      return this.ready;
    },
    restart() { clearTimeout(this.timer); this.loaded = false; this.snap = {}; this.cursor = null; return this.start(); },

    async fetchAll(since) {
      const rows = [];
      for (let off = 0; ; off += 500) {
        const part = await rpc('mu_pull', { p_token: this.auth.token, p_property: this.property, p_since: since, p_limit: 500, p_offset: off }, 30000);
        rows.push(...(part || []));
        if (!part || part.length < 500) break;
      }
      return rows;
    },
    // Первая загрузка: собрать DB.d из того, что сервер разрешает видеть. Пустой сервер заполняет только управляющий
    async fullLoad() {
      try {
        const rows = await this.fetchAll(null);
        const seeded = rows.some(r => !r.deleted && r.coll === '$' && r.rid === 'seeded');
        this.snap = {}; this.cursor = null;
        if (!seeded && this.role === 'admin') {
          rows.forEach(r => { this.track(r); if (!r.deleted) put(DB.d, r.coll, r.rid, r.data); });
          DB.d.seeded = true;
          this.loaded = true;
          await this.push();
        } else {
          const d = { pid: DB.d.pid, seq: DB.d.seq, created: DB.d.created };
          Object.keys(DB.d).forEach(k => { if (!SKIP.includes(k)) d[k] = Array.isArray(DB.d[k]) ? [] : MAPS.includes(k) ? {} : undefined; });
          Object.keys(d).forEach(k => { if (d[k] === undefined) delete d[k]; });
          rows.forEach(r => { this.track(r); if (!r.deleted) put(d, r.coll, r.rid, r.data); });
          Object.keys(d).forEach(k => { if (Array.isArray(d[k])) sortColl(k, d[k]); });
          if (!d.settings) d.settings = DB.d.settings;   // настройки нужны экранам даже до первой записи
          DB.d = d;
          this.loaded = true;
        }
        DB.saveLocal(); this.saveState();
        this.ok();
      } catch (e) { this.fail(e); }
    },
    track(r) {
      if (!this.cursor || r.updated_at > this.cursor) this.cursor = r.updated_at;
      const key = r.coll + '|' + r.rid;
      if (r.deleted) delete this.snap[key]; else this.snap[key] = fp(r.data);
    },

    // После каждого сохранения: через полсекунды отправить изменения
    schedule() {
      if (!enabled || !this.signedIn || !this.loaded) return;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => this.cycle(false), 600);
    },
    async push() {
      if (!this.loaded) return 0;
      const cur = explode(DB.d), rows = [];
      Object.keys(cur).forEach(k => {
        const h = fp(cur[k]);
        if (this.snap[k] !== h) { const [coll, rid] = split(k); rows.push({ row: { coll, rid, data: cur[k], deleted: false }, k, h }); }
      });
      Object.keys(this.snap).forEach(k => {
        if (!(k in cur)) { const [coll, rid] = split(k); rows.push({ row: { coll, rid, data: null, deleted: true }, k, h: null }); }
      });
      if (!rows.length) return 0;
      const isSeed = x => x.row.coll === '$' && x.row.rid === 'seeded';
      rows.sort((a, b) => isSeed(a) - isSeed(b));
      let denied = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100);
        const res = await rpc('mu_push', { p_token: this.auth.token, p_property: this.property, p_rows: part.map(x => x.row) }, 30000);
        part.forEach(x => { if (x.h === null) delete this.snap[x.k]; else this.snap[x.k] = x.h; });
        // Сервер не разрешил: возвращаем запись к тому виду, что у него
        (res && res.rejected || []).forEach(r => {
          const k = r.coll + '|' + r.rid;
          if (r.data == null) { put(DB.d, r.coll, r.rid, undefined); delete this.snap[k]; }
          else { put(DB.d, r.coll, r.rid, r.data); this.snap[k] = fp(r.data); }
          denied++;
        });
        this.saveState();
      }
      if (denied) { DB.saveLocal(); if (this.onRemote) this.onRemote(denied); if (this.onDenied) this.onDenied(denied); }
      return rows.length;
    },
    // Забрать чужие изменения. Берём с запасом 15 секунд назад, повторы отсекаются по отпечатку
    async pull() {
      const since = this.cursor ? new Date(new Date(this.cursor).getTime() - 15000).toISOString() : null;
      const rows = await this.fetchAll(since);
      if (!rows.length) return 0;
      const cur = explode(DB.d);
      let changed = 0;
      rows.forEach(r => {
        const key = r.coll + '|' + r.rid, local = key in cur ? fp(cur[key]) : undefined;
        if (local !== this.snap[key]) { if (!this.cursor || r.updated_at > this.cursor) this.cursor = r.updated_at; return; } // своё ещё не ушло — оно главнее
        const h = r.deleted ? undefined : fp(r.data);
        if (h === local) { this.track(r); return; }
        put(DB.d, r.coll, r.rid, r.deleted ? undefined : r.data);
        this.track(r); changed++;
      });
      if (changed) DB.saveLocal();
      this.saveState();
      if (changed && this.onRemote) this.onRemote(changed);
      return changed;
    },
    async cycle(withPull = true) {
      if (!enabled || !this.signedIn) return;
      if (!this.loaded) return this.fullLoad();
      if (this.busy) { if (!withPull) this.schedule(); return; }
      this.busy = true;
      try {
        await this.push();
        if (withPull) await this.pull();
        this.ok();
        PH.flush();
      } catch (e) { this.fail(e); }
      this.busy = false;
    },
    ok() { this.online = true; this.lastOk = Date.now(); this.error = ''; },
    fail(e) {
      this.online = false; this.error = String(e && e.message || e);
      if (e && e.session && this.signedIn) { this.forget(); if (this.onSession) this.onSession(); }
    },
    loop() {
      clearTimeout(this.timer);
      if (!this.signedIn) return;
      const sec = document.hidden ? 30 : (C.pollSeconds || 5);
      this.timer = setTimeout(async () => { await this.cycle(true); this.loop(); }, sec * 1000);
    },

    // ---------- Вход и выход ----------
    status() { return rpc('mu_status', { p_property: DB.pid() }).catch(() => ({ ok: false })); },
    // Вызов без входа: только объект сети (например, подключена ли онлайн-оплата)
    pub(fn, args) { return rpc(fn, Object.assign({ p_property: DB.pid() }, args || {})).catch(() => ({ ok: false })); },
    // fn — mu_login, mu_register, mu_setup, mu_visitor, mu_qr или mu_join. Возвращает { ok, user } или { ok: false, error }
    async signIn(fn, args) {
      let res;
      try { res = await rpc(fn, Object.assign({ p_property: DB.pid() }, args)); }
      catch (e) { return { ok: false, error: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз' }; }
      if (!res || !res.ok) return res || { ok: false, error: 'Сервер не ответил' };
      this.forget(true);
      this.auth = { token: res.token, login: res.login, role: res.role };
      ls.set(SESSION, JSON.stringify(this.auth));
      DB.setSession(res.login);
      await this.restart();
      const user = this.loaded && DB.me();
      if (!user) { const err = this.loaded ? 'Профиль не найден на сервере' : 'Не удалось загрузить данные. Попробуйте ещё раз'; this.signOut(); return { ok: false, error: err }; }
      return Object.assign({}, res, { user });
    },
    signOut() {
      if (this.signedIn) rpc('mu_logout', { p_token: this.auth.token }).catch(() => {});
      this.forget();
    },
    // Стереть с телефона сессию и все данные: следующий человек на этом телефоне ничего не увидит
    forget(keepData) {
      clearTimeout(this.timer); clearTimeout(this.pushTimer);
      this.auth = null; this.loaded = false; this.snap = {}; this.cursor = null; this.online = false;
      ls.del(SESSION);
      ls.keys().filter(k => k.indexOf(STATE) === 0).forEach(k => ls.del(k));
      PH.wipe();
      if (!keepData) DB.wipe();
    },
    // Вызов для экранов управляющего: доступы персонала, ключи QR, смена пароля
    async call(fn, args) {
      try { return await rpc(fn, Object.assign({ p_token: this.auth && this.auth.token, p_property: this.property }, args)); }
      catch (e) {
        if (e.session) { this.forget(); if (this.onSession) this.onSession(); }
        return { ok: false, error: e.denied ? 'Недостаточно прав' : e.session ? 'Сессия закончилась' : 'Нет связи с сервером' };
      }
    }
  };
  // ---------- Фото в облаке ----------
  // Снимок сразу сохраняется в телефоне (IndexedDB) и уходит на сервер в фоне. В данных остаётся ссылка ph:<номер>.
  // При показе экрана ссылки заменяются на сами фото: из памяти, из телефона или с сервера
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const PH = {
    mem: {}, pending: {}, asked: {}, db: null, flushing: false, ready: false,
    on() { return enabled && SYNC.signedIn; },
    idb() {
      if (!this.db) this.db = new Promise(res => {
        try {
          const rq = indexedDB.open('mu_photos', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('p');
          rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
        } catch (e) { res(null); }
      });
      return this.db;
    },
    async store(mode, fn) {
      const db = await this.idb(); if (!db) return null;
      return new Promise(res => {
        try {
          const tx = db.transaction('p', mode), rq = fn(tx.objectStore('p'));
          tx.oncomplete = () => res(rq ? rq.result : null); tx.onerror = tx.onabort = () => res(null);
        } catch (e) { res(null); }
      });
    },
    save(id, data, pending) { return this.store('readwrite', st => st.put({ id, data, pending }, id)); },
    // После входа: вспомнить фото, которые ещё не ушли на сервер
    async init() {
      if (this.ready) return; this.ready = true;
      const all = await this.store('readonly', st => st.getAll()) || [];
      all.forEach(x => { if (x && x.pending) { this.mem[x.id] = x.data; this.pending[x.id] = true; } });
      this.flush();
    },
    add(dataUrl) {
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      this.mem[id] = dataUrl; this.pending[id] = true;
      this.save(id, dataUrl, true);
      setTimeout(() => this.flush(), 100);
      return 'ph:' + id;
    },
    count() { return Object.keys(this.pending).length; },
    async flush() {
      if (!this.on() || this.flushing || !this.count()) return;
      this.flushing = true;
      try {
        for (const id of Object.keys(this.pending)) {
          if (!this.mem[id]) { const x = await this.store('readonly', st => st.get(id)); if (x) this.mem[id] = x.data; else { delete this.pending[id]; continue; } }
          const r = await rpc('mu_photo_put', { p_token: SYNC.auth.token, p_property: SYNC.property, p_id: id, p_data: this.mem[id] }, 90000);
          // Сервер ответил отказом (не фото, слишком большое) — повторять бесполезно, снимок остаётся в телефоне
          delete this.pending[id];
          await this.save(id, this.mem[id], false);
          if (r && !r.ok && SYNC.onDenied) SYNC.onDenied(1);
        }
      } catch (e) { if (e.session) SYNC.fail(e); }   // нет связи — попробуем при следующей сверке
      this.flushing = false;
    },
    // HTML экрана: src="ph:номер" → сам снимок или серая заглушка, которую заполнит hydrate
    fix(html) {
      if (typeof html !== 'string' || html.indexOf('"ph:') < 0) return html;
      return html.replace(/src="ph:([a-z0-9]+)"/g, (m, id) => this.mem[id] ? `src="${this.mem[id]}" data-ph="${id}"` : `src="${BLANK}" data-ph="${id}" data-ph-wait="1"`);
    },
    async hydrate(root) {
      const imgs = Array.from((root || document).querySelectorAll('img[data-ph-wait]'));
      if (!imgs.length) return;
      const ids = Array.from(new Set(imgs.map(i => i.dataset.ph)));
      for (const id of ids) if (!this.mem[id]) { const x = await this.store('readonly', st => st.get(id)); if (x) this.mem[id] = x.data; }
      const need = ids.filter(id => !this.mem[id] && !(this.asked[id] > Date.now() - 60000));
      if (need.length && this.on()) {
        need.forEach(id => { this.asked[id] = Date.now(); });
        for (let i = 0; i < need.length; i += 20) {
          try {
            const r = await rpc('mu_photo_get', { p_token: SYNC.auth.token, p_property: SYNC.property, p_ids: need.slice(i, i + 20) }, 90000);
            Object.keys(r && r.photos || {}).forEach(id => { this.mem[id] = r.photos[id]; this.save(id, r.photos[id], false); });
          } catch (e) { need.slice(i, i + 20).forEach(id => { delete this.asked[id]; }); if (e.session) SYNC.fail(e); }
        }
      }
      document.querySelectorAll('img[data-ph-wait]').forEach(im => { const d = this.mem[im.dataset.ph]; if (d) { im.src = d; im.removeAttribute('data-ph-wait'); } });
    },
    wipe() { this.mem = {}; this.pending = {}; this.asked = {}; this.ready = false; return this.store('readwrite', st => st.clear()); }
  };
  window.PH = PH;

  document.addEventListener('visibilitychange', () => { if (!document.hidden && SYNC.ready && SYNC.signedIn) { SYNC.cycle(true); SYNC.loop(); } });
  window.addEventListener('online', () => { if (SYNC.ready && SYNC.signedIn) SYNC.cycle(true); });
  window.SYNC = SYNC;
})();
