// Devolve o endereço de autorização do Strava.
const crypto = require('crypto');
const { STRAVA, NONCE, baseUrl, needConfig, seal, cookie, addCookie, fail } = require('../_lib');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    needConfig();
    const n = crypto.randomBytes(16).toString('base64url');
    addCookie(res, cookie(NONCE, n, 15 * 60));
    const q = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/api/strava/callback`,
      response_type: 'code', approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state: seal({ n, exp: Date.now() + 15 * 60 * 1000 })
    });
    res.json({ url: `${STRAVA}/oauth/authorize?${q}` });
  } catch (e) { fail(res, e); }
};
