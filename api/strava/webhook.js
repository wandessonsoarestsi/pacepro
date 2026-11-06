// Webhook do Strava: o Strava avisa quando o atleta cria, muda ou apaga uma atividade, ou tira o acesso do app.
// Assim o app só busca as corridas quando algo mudou, em vez de consultar o Strava toda vez que abre.
// GET: confirmação da inscrição (hub.challenge). POST: eventos.
// Guarda só a hora do último evento de cada atleta, por 7 dias. Nenhum dado de atividade fica guardado.
const { db, dbConf } = require('../_lib');

const TTL = 7 * 24 * 3600;

module.exports = async (req, res) => {
  const tok = process.env.STRAVA_VERIFY_TOKEN;
  if (req.method === 'GET') {
    const q = req.query || {};
    if (!tok || q['hub.mode'] !== 'subscribe' || q['hub.verify_token'] !== tok) return res.status(403).json({ error: 'Token inválido' });
    try { if (dbConf()) await db([['SET', 'pp:hook:ok', String(Date.now())]]); } catch (e) {}
    return res.json({ 'hub.challenge': q['hub.challenge'] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const e = req.body || {};
  const sub = process.env.STRAVA_SUBSCRIPTION_ID;
  // O Strava espera resposta 200 em até 2 segundos, mesmo para eventos ignorados.
  if ((sub && String(e.subscription_id) !== String(sub)) || !dbConf()) return res.json({ ok: true });
  const owner = String(e.owner_id || '').replace(/\D/g, '');
  if (!owner) return res.json({ ok: true });
  const key = `pp:sa:${owner}:t`;
  try {
    if (e.object_type === 'athlete' && e.updates && String(e.updates.authorized) === 'false') await db([['DEL', key]]);
    else if (e.object_type === 'activity') await db([['SET', key, String(Date.now()), 'EX', String(TTL)]]);
  } catch (err) {}
  res.json({ ok: true });
};
