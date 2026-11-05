// Funções comuns: usuário do Supabase, tokens do Strava guardados no banco e chamadas à API do Strava.
const crypto = require('crypto');

const STRAVA = 'https://www.strava.com';
const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');

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

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function needConfig() {
  const miss = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'SESSION_SECRET'].filter(k => !process.env[k]);
  if (miss.length) throw Object.assign(new Error(`Faltam variáveis no Vercel: ${miss.join(', ')}`), { status: 500 });
}

// Confere o token do Supabase enviado pelo navegador e devolve o usuário.
async function getUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw Object.assign(new Error('Faça login para continuar.'), { status: 401 });
  const r = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw Object.assign(new Error('Sua sessão expirou. Entre de novo.'), { status: 401 });
  return r.json();
}

// Acesso à tabela strava_tokens com a chave de serviço (nunca exposta ao navegador).
function sbHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(extra || {}) };
}
async function getTokens(uid) {
  const r = await fetch(`${SB()}/rest/v1/strava_tokens?user_id=eq.${encodeURIComponent(uid)}&select=*`, { headers: sbHeaders() });
  if (!r.ok) throw Object.assign(new Error('Erro ao ler o banco de dados.'), { status: 500 });
  const rows = await r.json();
  return rows[0] || null;
}
async function saveTokens(row) {
  const r = await fetch(`${SB()}/rest/v1/strava_tokens?on_conflict=user_id`, {
    method: 'POST', headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw Object.assign(new Error('Erro ao salvar a conexão com o Strava.'), { status: 500 });
}
async function deleteTokens(uid) {
  await fetch(`${SB()}/rest/v1/strava_tokens?user_id=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: sbHeaders() });
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

// Devolve tokens válidos do usuário, renovando quando necessário. null se ele não conectou o Strava.
async function getAccess(uid) {
  const t = await getTokens(uid);
  if (!t) return null;
  if (t.expires_at - 120 > Date.now() / 1000) return t;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const next = { ...t, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at };
  await saveTokens(next);
  return next;
}

async function strava(path, t) {
  const r = await fetch(`${STRAVA}/api/v3${path}`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  if (r.status === 429) throw Object.assign(new Error('Limite de consultas do Strava atingido. Tente em 15 minutos.'), { status: 429 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Erro no Strava'), { status: r.status === 401 ? 401 : 502 });
  return j;
}

function fail(res, e) {
  const status = [400, 401, 429, 502].includes(e.status) ? e.status : 500;
  res.status(status).json({ error: e.message || 'Erro inesperado' });
}

module.exports = { STRAVA, seal, open, baseUrl, needConfig, getUser, getTokens, saveTokens, deleteTokens, tokenRequest, getAccess, strava, fail };
