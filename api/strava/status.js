const { getAccess, db, dbConf, fail } = require('../_lib');

// hook: { on: webhook do Strava ligado, t: hora do último aviso de atividade deste atleta }.
async function hookInfo(s) {
  if (!process.env.STRAVA_VERIFY_TOKEN || !dbConf() || !s || !s.athlete || !s.athlete.id) return { on: false, t: null };
  try {
    const [ok, t] = await db([['GET', 'pp:hook:ok'], ['GET', `pp:sa:${String(s.athlete.id).replace(/\D/g, '')}:t`]]);
    return { on: !!ok, t: t ? +t : null };
  } catch (e) { return { on: false, t: null }; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.SESSION_SECRET);
  try {
    if (!configured) return res.json({ connected: false, configured, athlete: null });
    const s = await getAccess(req, res);
    res.json({ connected: !!s, configured, athlete: s ? s.athlete : null, hook: s ? await hookInfo(s) : null });
  } catch (e) {
    if (e.status === 401) { require('../_lib').setSession(res, null); return res.json({ connected: false, configured, athlete: null }); }
    fail(res, e);
  }
};
