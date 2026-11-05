const { getAccess, fail } = require('../_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.SESSION_SECRET);
  try {
    if (!configured) return res.json({ connected: false, configured, athlete: null });
    const s = await getAccess(req, res);
    res.json({ connected: !!s, configured, athlete: s ? s.athlete : null });
  } catch (e) {
    if (e.status === 401) { require('../_lib').setSession(res, null); return res.json({ connected: false, configured, athlete: null }); }
    fail(res, e);
  }
};
