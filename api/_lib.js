// Funções comuns da integração com o Strava: sessão criptografada em cookie e renovação do token.
const crypto = require('crypto');

const COOKIE = 'sub30_strava';
const STRAVA = 'https://www.strava.com';

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET ausente ou curto (mínimo 16 caracteres).');
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
    const b = Buffer.from(token, 'base64url');
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

function setSession(res, data) {
  const v = data ? seal(data) : '';
  const age = data ? 60 * 60 * 24 * 180 : 0;
  res.setHeader('Set-Cookie', `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

async function tokenRequest(params) {
  const r = await fetch(`${STRAVA}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...params })
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.message || 'Falha no token do Strava'), { status: r.status });
  return j;
}

// Devolve um access token válido, renovando se necessário, ou null se não houver sessão.
async function getAccess(req, res) {
  const raw = readCookie(req, COOKIE);
  const s = raw && open(raw);
  if (!s) return null;
  if (s.exp && s.exp - 120 > Date.now() / 1000) return s;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh });
  const next = { ...s, access: j.access_token, refresh: j.refresh_token, exp: j.expires_at };
  setSession(res, next);
  return next;
}

async function strava(path, s) {
  const r = await fetch(`${STRAVA}/api/v3${path}`, { headers: { Authorization: `Bearer ${s.access}` } });
  if (r.status === 429) throw Object.assign(new Error('Limite de consultas do Strava atingido. Tente em 15 minutos.'), { status: 429 });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.message || 'Erro no Strava'), { status: r.status });
  return j;
}

function fail(res, e) {
  const status = e.status === 401 ? 401 : e.status === 429 ? 429 : 500;
  res.status(status).json({ error: e.message || 'Erro inesperado' });
}

module.exports = { COOKIE, STRAVA, seal, open, readCookie, setSession, baseUrl, tokenRequest, getAccess, strava, fail };
