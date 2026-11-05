const { getUser, getTokens, fail } = require('../_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (!configured) return res.json({ connected: false, configured, athlete: null });
    const user = await getUser(req);
    const t = await getTokens(user.id);
    res.json({ connected: !!t, configured, athlete: t ? { id: t.athlete_id, name: t.athlete_name } : null });
  } catch (e) { fail(res, e); }
};
