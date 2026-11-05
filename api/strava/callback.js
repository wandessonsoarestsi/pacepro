// Volta do Strava: troca o código por tokens e guarda a conexão num cookie criptografado.
const { NONCE, tokenRequest, setSession, open, readCookie, cookie, addCookie } = require('../_lib');

module.exports = async (req, res) => {
  const go = to => { res.writeHead(302, { Location: to }); res.end(); };
  const { code, error, scope, state } = req.query || {};
  const st = state && open(state);
  const n = readCookie(req, NONCE);
  addCookie(res, cookie(NONCE, '', 0));
  if (error || !code || !st || !n || st.n !== n || st.exp < Date.now()) return go('/?strava=erro#ajustes');
  if (scope && !/activity:read/.test(scope)) return go('/?strava=scope#ajustes');
  try {
    const j = await tokenRequest({ code, grant_type: 'authorization_code' });
    setSession(res, {
      access: j.access_token, refresh: j.refresh_token, exp: j.expires_at,
      athlete: j.athlete ? { id: j.athlete.id, name: [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ') } : null
    });
    go('/?strava=ok#hoje');
  } catch (e) { go('/?strava=erro#ajustes'); }
};
