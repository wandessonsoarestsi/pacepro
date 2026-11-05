// Desconecta o Strava do perfil: revoga no Strava e apaga os tokens.
const { STRAVA, getUser, getTokens, deleteTokens, fail } = require('../_lib');

module.exports = async (req, res) => {
  try {
    const user = await getUser(req);
    const t = await getTokens(user.id);
    if (t) { try { await fetch(`${STRAVA}/oauth/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}` } }); } catch (e) {} }
    await deleteTokens(user.id);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
};
