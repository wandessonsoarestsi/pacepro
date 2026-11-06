// Login com Google. Sem "code": manda para o Google. Com "code": é a volta do Google,
// confere a pessoa e guarda a conta num cookie criptografado.
const crypto = require('crypto');
const { seal, open, readCookie, cookie, addCookie, baseUrl, setUser, accountConfigured } = require('../_lib');

const NONCE = 'pp_goauth';

module.exports = async (req, res) => {
  const go = to => { res.setHeader('Cache-Control', 'no-store'); res.writeHead(302, { Location: to }); res.end(); };
  if (!accountConfigured()) return go('/?conta=config#ajustes');
  const redirect = `${baseUrl(req)}/api/auth/google`;
  const { code, error, state } = req.query || {};

  if (!code && !error) {
    const n = crypto.randomBytes(16).toString('base64url');
    addCookie(res, cookie(NONCE, n, 15 * 60));
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code',
      scope: 'openid email profile', prompt: 'select_account',
      state: seal({ n, exp: Date.now() + 15 * 60 * 1000 })
    });
    return go(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  const st = state && open(state);
  const n = readCookie(req, NONCE);
  addCookie(res, cookie(NONCE, '', 0));
  if (error || !code || !st || !n || st.n !== n || st.exp < Date.now()) return go('/?conta=erro#ajustes');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) throw new Error('token');
    // O id_token veio direto do Google por HTTPS, então dá para ler sem conferir a assinatura.
    const p = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString('utf8'));
    const iss = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
    if (!iss || p.aud !== process.env.GOOGLE_CLIENT_ID || !p.sub || p.exp * 1000 < Date.now()) throw new Error('id_token');
    setUser(res, { sub: String(p.sub), email: p.email || '', name: p.name || p.given_name || '', pic: p.picture || '' });
    go('/?conta=ok#ajustes');
  } catch (e) { go('/?conta=erro#ajustes'); }
};
