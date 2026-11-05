// Devolve o endereço de autorização do Strava para o usuário logado.
const { STRAVA, baseUrl, needConfig, getUser, seal, fail } = require('../_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    needConfig();
    const user = await getUser(req);
    const state = seal({ uid: user.id, exp: Date.now() + 15 * 60 * 1000 });
    const q = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/api/strava/callback`,
      response_type: 'code', approval_prompt: 'auto',
      scope: 'read,activity:read_all', state
    });
    res.json({ url: `${STRAVA}/oauth/authorize?${q}` });
  } catch (e) { fail(res, e); }
};
