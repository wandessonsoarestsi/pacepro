const { tokenRequest, setSession } = require('../_lib');

module.exports = async (req, res) => {
  const { code, error, scope } = req.query || {};
  if (error || !code) { res.writeHead(302, { Location: '/#ajustes' }); return res.end(); }
  try {
    if (scope && !/activity:read/.test(scope)) { res.writeHead(302, { Location: '/?strava=scope#ajustes' }); return res.end(); }
    const j = await tokenRequest({ code, grant_type: 'authorization_code' });
    setSession(res, {
      access: j.access_token, refresh: j.refresh_token, exp: j.expires_at,
      athlete: j.athlete ? { id: j.athlete.id, name: [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ') } : null
    });
    res.writeHead(302, { Location: '/?strava=ok#hoje' });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: '/?strava=erro#ajustes' });
    res.end();
  }
};
