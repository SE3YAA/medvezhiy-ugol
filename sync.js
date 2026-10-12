// sync.js — общая база: все телефоны видят одни и те же брони, задачи, кассу и фото.
//
// Как это устроено. Приложение по-прежнему работает с DB.d в памяти, поэтому экраны открываются мгновенно
// и не зависят от связи в лесу. Этот файл в фоне:
//   1) при запуске забирает с сервера все записи объекта и собирает из них DB.d;
//   2) после каждого DB.save() находит изменённые записи и отправляет только их;
//   3) каждые несколько секунд забирает с сервера то, что поменяли другие, и обновляет экран.
// Если связи нет, всё копится в телефоне и уйдёт на сервер, когда сеть появится.
// Сервер — таблица records в Supabase (см. sync.sql), запросы идут напрямую в её REST API.
(function () {
  const C = window.MU_CONFIG || {};
  const enabled = !!(C.supabaseUrl && C.supabaseKey);
  const API = enabled ? C.supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '') + '/rest/v1/records' : '';
  const HEADERS = { apikey: C.supabaseKey, 'Content-Type': 'application/json' };
  if (C.supabaseKey && /^eyJ/.test(C.supabaseKey)) HEADERS.Authorization = 'Bearer ' + C.supabaseKey; // старый формат ключа anon

  // ---------- Как разложить DB.d на отдельные записи ----------
  const SKIP = ['seq', 'pid', 'created'];                 // у каждого телефона свои
  const MAPS = ['refs', 'crm', 'heat'];                   // объекты «ключ → значение»: каждая пара отдельной записью
  const KEY = {                                           // чем однозначно назвать запись в разделе
    users: x => x.login, promos: x => x.code, certs: x => x.code,
    shifts: x => x.date + '|' + x.login, checkins: x => x.login + '|' + x.date + '|' + x.in
  };
  const keyOf = (coll, x) => String((KEY[coll] || (y => y.id != null ? y.id : JSON.stringify(y)))(x));
  // Разделы, где свежие записи идут первыми (касса, задачи, уведомления…)
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
  // Применить одну запись к DB.d (value === undefined — удалить)
  function put(d, coll, rid, value) {
    if (coll === '$') { if (value === undefined) delete d[rid]; else d[rid] = value; return; }
    if (MAPS.includes(coll)) { d[coll] = d[coll] || {}; if (value === undefined) delete d[coll][rid]; else d[coll][rid] = value; return; }
    const arr = d[coll] = Array.isArray(d[coll]) ? d[coll] : [];
    const i = arr.findIndex(x => keyOf(coll, x) === rid);
    if (value === undefined) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = value; else if (NEWEST.includes(coll)) arr.unshift(value); else arr.push(value);
  }

  // ---------- Сеть ----------
  async function req(url, opt = {}, ms = 12000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ headers: Object.assign({}, HEADERS, opt.headers || {}), signal: ctl.signal }, opt.body ? { method: opt.method || 'POST', body: opt.body } : {}));
      if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error(r.status + ' ' + txt.slice(0, 200)); }
      return r.status === 204 ? null : r.json().catch(() => null);
    } finally { clearTimeout(t); }
  }
  async function fetchRows(since) {
    const rows = [];
    for (let off = 0; ; off += 1000) {
      let url = `${API}?property=eq.${encodeURIComponent(SYNC.property)}&select=coll,rid,data,deleted,updated_at&order=updated_at.asc&limit=1000&offset=${off}`;
      if (since) url += `&updated_at=gt.${encodeURIComponent(since)}`;
      const part = await req(url);
      rows.push(...(part || []));
      if (!part || part.length < 1000) break;
    }
    return rows;
  }
  async function upsert(rows) {
    for (let i = 0; i < rows.length; i += 100) {
      await req(`${API}?on_conflict=property,coll,rid`, { body: JSON.stringify(rows.slice(i, i + 100)), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }, 30000);
    }
  }

  // ---------- Синхронизация ----------
  const SYNC = {
    enabled, online: false, property: 'mu', snap: {}, cursor: null, lastOk: 0, error: '',
    ready: null, busy: false, timer: null, pushTimer: null, onRemote: null,

    // Первый запуск: забрать всё с сервера. Если сервер пустой, этот телефон заливает на него стартовые данные
    async start() {
      if (!enabled) { this.ready = Promise.resolve(false); return this.ready; }
      this.property = DB.pid();
      this.ready = (async () => {
        try {
          const rows = await fetchRows(null);
          const live = rows.filter(r => !r.deleted);
          // Метка «стартовые данные залиты целиком» уходит последней. Нет метки — заливка прервалась, доливаем
          const seeded = live.some(r => r.coll === '$' && r.rid === 'seeded');
          if (!seeded) {
            this.snap = {};
            rows.forEach(r => this.track(r));
            DB.d.seeded = true;
            await this.push();
            DB.saveLocal();
          } else {
            const d = { pid: DB.d.pid, seq: DB.d.seq, created: DB.d.created };
            Object.keys(DB.d).forEach(k => { if (!SKIP.includes(k)) d[k] = Array.isArray(DB.d[k]) ? [] : MAPS.includes(k) ? {} : DB.d[k]; });
            this.snap = {};
            rows.forEach(r => { this.track(r); if (!r.deleted) put(d, r.coll, r.rid, r.data); });
            Object.keys(d).forEach(k => { if (Array.isArray(d[k])) sortColl(k, d[k]); });
            DB.d = d; DB.saveLocal();
          }
          this.online = true; this.lastOk = Date.now(); this.error = '';
        } catch (e) { this.online = false; this.error = String(e.message || e); }
        this.loop();
        return this.online;
      })();
      return this.ready;
    },
    restart() { clearTimeout(this.timer); this.snap = {}; this.cursor = null; return this.start(); },
    track(r) {
      if (!this.cursor || r.updated_at > this.cursor) this.cursor = r.updated_at;
      const key = r.coll + '|' + r.rid;
      if (r.deleted) delete this.snap[key]; else this.snap[key] = JSON.stringify(r.data);
    },

    // После каждого сохранения: через полсекунды отправить изменения
    schedule() {
      if (!enabled || !this.ready) return;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => this.cycle(false), 600);
    },
    async push() {
      const cur = explode(DB.d), rows = [], done = [];
      Object.keys(cur).forEach(k => {
        const j = JSON.stringify(cur[k]);
        if (this.snap[k] !== j) { const [coll, rid] = split(k); rows.push({ property: this.property, coll, rid, data: cur[k], deleted: false }); done.push([k, j]); }
      });
      Object.keys(this.snap).forEach(k => {
        if (!(k in cur)) { const [coll, rid] = split(k); rows.push({ property: this.property, coll, rid, data: null, deleted: true }); done.push([k, null]); }
      });
      if (!rows.length) return 0;
      rows.sort((a, b) => (a.coll === '$' && a.rid === 'seeded') - (b.coll === '$' && b.rid === 'seeded'));
      await upsert(rows);
      done.forEach(([k, j]) => { if (j === null) delete this.snap[k]; else this.snap[k] = j; });
      return rows.length;
    },
    // Забрать чужие изменения. Берём с запасом 15 секунд назад, повторы отсекаются сравнением
    async pull() {
      const since = this.cursor ? new Date(new Date(this.cursor).getTime() - 15000).toISOString() : null;
      const rows = await fetchRows(since);
      const cur = explode(DB.d);
      let changed = 0;
      rows.forEach(r => {
        const key = r.coll + '|' + r.rid, local = key in cur ? JSON.stringify(cur[key]) : undefined;
        if (local !== this.snap[key]) { if (!this.cursor || r.updated_at > this.cursor) this.cursor = r.updated_at; return; } // своё ещё не ушло — оно главнее
        const j = r.deleted ? undefined : JSON.stringify(r.data);
        if (j === local) { this.track(r); return; }
        put(DB.d, r.coll, r.rid, r.deleted ? undefined : r.data);
        this.track(r); changed++;
      });
      if (changed) { DB.saveLocal(); if (this.onRemote) this.onRemote(changed); }
      return changed;
    },
    async cycle(withPull = true) {
      if (this.busy) { if (!withPull) this.schedule(); return; }
      this.busy = true;
      try {
        await this.push();
        if (withPull) await this.pull();
        this.online = true; this.lastOk = Date.now(); this.error = '';
      } catch (e) { this.online = false; this.error = String(e.message || e); }
      this.busy = false;
    },
    loop() {
      clearTimeout(this.timer);
      const sec = document.hidden ? 30 : (C.pollSeconds || 5);
      this.timer = setTimeout(async () => { await this.cycle(true); this.loop(); }, sec * 1000);
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && SYNC.ready) { SYNC.cycle(true); SYNC.loop(); } });
  window.addEventListener('online', () => { if (SYNC.ready) SYNC.cycle(true); });
  window.SYNC = SYNC;
})();
