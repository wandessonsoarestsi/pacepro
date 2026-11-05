// Funções comuns da integração com o Strava. A conexão fica num cookie criptografado,
// só no navegador que conectou. Não há login nem banco de dados.
const crypto = require('crypto');

const STRAVA = 'https://www.strava.com';
const COOKIE = 'pp_strava';
const NONCE = 'pp_oauth';

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error('Configure SESSION_SECRET no Vercel (mínimo 16 caracteres).'), { status: 500 });
  return crypto.createHash('sha256').update(s).digest();
}
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
function open(token) {
  try {
    const b = Buffer.from(String(token), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch (e) { return null; }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(/;\s*/).find(p => p.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function addCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(prev || [], c));
}
function setSession(res, data) {
  addCookie(res, cookie(COOKIE, data ? seal(data) : '', data ? 60 * 60 * 24 * 365 : 0));
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function needConfig() {
  const miss = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'SESSION_SECRET'].filter(k => !process.env[k]);
  if (miss.length) throw Object.assign(new Error(`Faltam variáveis no Vercel: ${miss.join(', ')}`), { status: 500 });
}

async function tokenRequest(params) {
  const r = await fetch(`${STRAVA}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Falha no token do Strava'), { status: r.status === 400 || r.status === 401 ? 401 : 502 });
  return j;
}

// Devolve a conexão válida, renovando o token quando necessário. null se o Strava não foi conectado.
async function getAccess(req, res) {
  const raw = readCookie(req, COOKIE);
  const s = raw && open(raw);
  if (!s) return null;
  if (s.exp - 120 > Date.now() / 1000) return s;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh });
  const next = { ...s, access: j.access_token, refresh: j.refresh_token, exp: j.expires_at };
  setSession(res, next);
  return next;
}

async function strava(path, s) {
  const r = await fetch(`${STRAVA}/api/v3${path}`, { headers: { Authorization: `Bearer ${s.access}` } });
  if (r.status === 429) throw Object.assign(new Error('Limite de consultas do Strava atingido. Tente em 15 minutos.'), { status: 429 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Erro no Strava'), { status: r.status === 401 ? 401 : 502 });
  return j;
}

function fail(res, e) {
  const status = [400, 401, 429, 502].includes(e.status) ? e.status : 500;
  res.status(status).json({ error: e.message || 'Erro inesperado' });
}

module.exports = { STRAVA, NONCE, seal, open, readCookie, cookie, addCookie, setSession, baseUrl, needConfig, tokenRequest, getAccess, strava, fail };
