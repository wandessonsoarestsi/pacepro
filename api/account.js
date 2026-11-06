// Conta e dados salvos na nuvem.
// GET: quem está logado e quando os dados foram salvos (com ?full=1, os dados também).
// PUT: salva os dados ({ data, updated_at }). Se a nuvem tiver uma versão mais nova, responde 409.
// POST ?a=logout: sai da conta neste aparelho. DELETE: apaga os dados da conta e sai.
const { getUser, setUser, db, accountConfigured, fail } = require('./_lib');

const MAX = 4 * 1024 * 1024;

// Nada do Strava fica na nuvem (política da API do Strava, item 6.2: no máximo 7 dias de cache).
// Tira a lista de corridas e, de cada dia, a análise e o id da atividade. O app manda sem isso; aqui é só garantia.
const STRAVA_FIELDS = ['activityId', 'name', 'analysis', 'auto'];
function noStrava(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  delete out.runs;
  if (out.done && typeof out.done === 'object') {
    const d = {};
    Object.entries(out.done).forEach(([k, v]) => {
      if (k[0] === '_' || !v || typeof v !== 'object') { d[k] = v; return; }
      const o = { ...v }; STRAVA_FIELDS.forEach(f => delete o[f]); if (v.activityId) o.sx = 1;
      d[k] = o;
    });
    out.done = d;
  }
  return out;
}
const keys = sub => [`pp:u:${sub}:data`, `pp:u:${sub}:t`];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = accountConfigured();
  const user = configured ? getUser(req) : null;
  try {
    if (req.method === 'GET') {
      if (!user) return res.json({ configured, user: null });
      const [kd, kt] = keys(user.sub);
      const full = req.query && req.query.full === '1';
      const [t, d] = await db(full ? [['GET', kt], ['GET', kd]] : [['GET', kt]]);
      const out = { configured, user: { name: user.name, email: user.email, pic: user.pic, sub: user.sub }, updated_at: t || null };
      if (full) out.data = d ? noStrava(JSON.parse(d)) : null;
      return res.json(out);
    }
    if (req.method === 'POST' && req.query && req.query.a === 'logout') { setUser(res, null); return res.json({ ok: true }); }
    if (!user) return res.status(401).json({ error: 'Entre na sua conta de novo.' });
    const [kd, kt] = keys(user.sub);
    if (req.method === 'PUT') {
      if (!/application\/json/.test(req.headers['content-type'] || '')) return res.status(400).json({ error: 'Formato inválido.' });
      const b = req.body || {};
      const at = typeof b.updated_at === 'string' && !isNaN(Date.parse(b.updated_at)) ? new Date(b.updated_at).toISOString() : null;
      if (!at || !b.data || typeof b.data !== 'object') return res.status(400).json({ error: 'Dados inválidos.' });
      const raw = JSON.stringify(noStrava(b.data));
      if (raw.length > MAX) return res.status(413).json({ error: 'Dados grandes demais para salvar.' });
      const [t] = await db([['GET', kt]]);
      if (t && t > at && !b.force) return res.status(409).json({ error: 'Há dados mais novos na conta.', updated_at: t });
      await db([['SET', kd, raw], ['SET', kt, at]]);
      return res.json({ ok: true, updated_at: at });
    }
    if (req.method === 'DELETE') {
      await db([['DEL', kd, kt]]);
      setUser(res, null);
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) { fail(res, e); }
};
module.exports.noStrava = noStrava;
