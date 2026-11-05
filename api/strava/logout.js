// Desconecta o Strava: revoga o acesso no Strava e apaga o cookie.
const { STRAVA, readCookie, open, setSession } = require('../_lib');

module.exports = async (req, res) => {
  const raw = readCookie(req, 'pp_strava');
  let s = null; try { s = raw && open(raw); } catch (e) {}
  if (s) { try { await fetch(`${STRAVA}/oauth/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${s.access}` } }); } catch (e) {} }
  setSession(res, null);
  res.json({ ok: true });
};
