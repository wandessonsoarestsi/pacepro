const { setSession } = require('../_lib');

module.exports = (req, res) => {
  setSession(res, null);
  res.json({ ok: true });
};
