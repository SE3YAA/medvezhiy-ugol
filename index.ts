// Edge Function «push» — отправляет уведомления на телефоны (Web Push).
// База сама вызывает эту функцию, когда появляется новое уведомление (см. push.sql):
// присылает текст, адреса подписанных телефонов и ключ VAPID. Функция шифрует текст для каждого телефона
// и отдаёт его сервису уведомлений Apple или Google. Ничего не хранит.
//
// Как поставить: Supabase → Edge Functions → Deploy a new function → Via Editor → имя push →
// вставить этот файл целиком → Deploy. Затем в настройках функции выключить «Verify JWT» (Enforce JWT verification).
//
// Шифрование по стандартам RFC 8291 (aes128gcm) и RFC 8292 (VAPID), только встроенный WebCrypto, без библиотек.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Подпись VAPID: доказывает сервису уведомлений, что пишем от имени нашего приложения
async function vapidHeader(endpoint, vapid, subject) {
  const jwk = JSON.parse(vapid.privateKey);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// Шифрование текста для одного телефона (его ключи p256dh и auth выдал браузер при подписке)
export async function encrypt(payload, p256dh, authSecret) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // размер записи 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, data);
}

export async function sendOne(sub, payload, vapid, subject) {
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high'
      },
      body: await encrypt(payload, sub.p256dh, sub.auth)
    });
    return { endpoint: sub.endpoint, status: r.status };
  } catch (e) {
    return { endpoint: sub.endpoint, status: 0, error: String(e && e.message || e) };
  }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Content-Type': 'application/json' };

export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: true, service: 'push' }), { headers: CORS });
  let job;
  try { job = await req.json(); } catch (e) { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: CORS }); }
  const subs = Array.isArray(job.subs) ? job.subs.slice(0, 200) : [];
  if (!job.vapid || !job.vapid.publicKey || !job.vapid.privateKey || !subs.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: CORS });
  }
  const payload = JSON.stringify({ title: job.title || 'Медвежий угол', body: String(job.body || '').slice(0, 300), url: job.url || '', tag: job.tag || '' });
  const results = await Promise.all(subs.map((s) => sendOne(s, payload, job.vapid, job.subject || 'mailto:admin@example.com')));
  return new Response(JSON.stringify({ ok: true, sent: results.filter((r) => r.status >= 200 && r.status < 300).length, results }), { headers: CORS });
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(handle);
