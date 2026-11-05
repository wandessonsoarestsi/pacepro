// Volta do Strava: troca o código por tokens e guarda no perfil do usuário.
const { tokenRequest, saveTokens, open } = require('../_lib');

module.exports = async (req, res) => {
  const go = to => { res.writeHead(302, { Location: to }); res.end(); };
  const { code, error, scope, state } = req.query || {};
  const st = state && open(state);
  if (error || !code || !st || !st.uid || st.exp < Date.now()) return go('/?strava=erro#ajustes');
  if (scope && !/activity:read/.test(scope)) return go('/?strava=scope#ajustes');
  try {
    const j = await tokenRequest({ code, grant_type: 'authorization_code' });
    await saveTokens({
      user_id: st.uid,
      athlete_id: j.athlete ? j.athlete.id : null,
      athlete_name: j.athlete ? [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ') : null,
      access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at
    });
    go('/?strava=ok#hoje');
  } catch (e) { go('/?strava=erro#ajustes'); }
};
