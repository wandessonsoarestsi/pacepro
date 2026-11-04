const { STRAVA, baseUrl } = require('../_lib');

module.exports = (req, res) => {
  if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send('Configure STRAVA_CLIENT_ID no Vercel.');
  const q = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${baseUrl(req)}/api/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all'
  });
  res.writeHead(302, { Location: `${STRAVA}/oauth/authorize?${q}` });
  res.end();
};
