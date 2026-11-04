const { getAccess, fail } = require('../_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const s = await getAccess(req, res);
    res.json({ connected: !!s, athlete: s ? s.athlete : null, configured: !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET) });
  } catch (e) { fail(res, e); }
};
