// Notificações push (Web Push) sem pacotes extras: chaves VAPID, criptografia aes128gcm (RFC 8291) e envio.
// As chaves VAPID vêm das variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY. Sem elas, o app cria um par
// na primeira vez e guarda no banco, para funcionar sem configuração.
// Cada aparelho inscrito fica em pp:push:s:<id> (id = hash do endereço de push), com o que é preciso para
// os avisos: as preferências e os próximos dias do plano. Nada do Strava fica guardado aqui.
const crypto = require('crypto');
const { db } = require('./_lib');

const SUB_TTL = 45 * 24 * 3600; // aparelho que não abre o app por 45 dias sai da lista
const ALL = 'pp:push:all';
const subKey = id => `pp:push:s:${id}`;
const athKey = a => `pp:push:ath:${a}`;
const idOf = endpoint => crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 32);
const b64 = b => Buffer.from(b).toString('base64url');
const unb64 = s => Buffer.from(String(s), 'base64url');

// Par de chaves P-256 no formato da Web Push: pública com 65 bytes, privada com 32, em base64url.
function newKeys() {
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  return { publicKey: b64(ec.getPublicKey()), privateKey: b64(ec.getPrivateKey()) };
}
let cached = null;
async function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() };
  if (cached) return cached;
  const k = newKeys();
  // NX: se dois pedidos chegarem juntos na primeira vez, vale o par que foi gravado primeiro.
  const [, raw] = await db([['SET', 'pp:push:vapid', JSON.stringify(k), 'NX'], ['GET', 'pp:push:vapid']]);
  cached = JSON.parse(raw);
  return cached;
}

function vapidAuth(endpoint, keys, subject) {
  const pub = unb64(keys.publicKey);
  // A chave privada precisa ter 32 bytes (às vezes vem com um zero a menos no começo).
  const d = unb64(keys.privateKey); const d32 = Buffer.concat([Buffer.alloc(Math.max(0, 32 - d.length)), d]);
  const jwk = { kty: 'EC', crv: 'P-256', d: b64(d32), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) };
  const head = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64(sig)}, k=${keys.publicKey}`;
}

// Criptografa a mensagem para o aparelho (RFC 8291, um único bloco aes128gcm).
function encrypt(sub, text) {
  const uaPub = unb64(sub.keys.p256dh), auth = unb64(sub.keys.auth);
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const asPub = ec.getPublicKey(), secret = ec.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}

// Envia uma notificação. msg = { title, body, url, tag }. Devolve o status HTTP do serviço de push
// (201 = entregue; 404/410 = o aparelho cancelou a inscrição; 0 = erro antes de chegar ao serviço).
// O motivo de uma falha fica em lastError, para aparecer no teste.
let lastError = '';
async function send(sub, msg, opts) {
  lastError = '';
  const keys = await vapidKeys();
  const subject = process.env.VAPID_SUBJECT || `${(opts && opts.origin) || 'https://pacepro.vercel.app'}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 8000);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: vapidAuth(sub.endpoint, keys, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String((opts && opts.ttl) || 12 * 3600), Urgency: (opts && opts.urgency) || 'normal'
      },
      body: encrypt(sub, JSON.stringify(msg))
    });
    if (r.status >= 300) lastError = `${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`.trim();
    return r.status;
  } catch (e) { lastError = (e && e.name === 'AbortError') ? 'tempo esgotado' : String((e && e.message) || e).slice(0, 160); return 0; } finally { clearTimeout(timer); }
}

// Envia e tira da lista os aparelhos que cancelaram a inscrição.
async function sendTo(id, rec, msg, opts) {
  const st = await send(rec.sub, msg, opts);
  if (st === 404 || st === 410) await remove(id, rec);
  return st;
}
async function load(id) { const [raw] = await db([['GET', subKey(id)]]); try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
async function remove(id, rec) {
  const cmds = [['DEL', subKey(id)], ['SREM', ALL, id]];
  if (rec && rec.ath) cmds.push(['SREM', athKey(rec.ath), id]);
  await db(cmds);
}

module.exports = { lastError: () => lastError, SUB_TTL, ALL, subKey, athKey, idOf, newKeys, vapidKeys, encrypt, send, sendTo, load, remove };
