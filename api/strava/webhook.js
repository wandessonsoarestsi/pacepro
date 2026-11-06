// Webhook do Strava: o Strava avisa quando o atleta cria, muda ou apaga uma atividade, ou tira o acesso do app.
// Assim o app só busca as corridas quando algo mudou, em vez de consultar o Strava toda vez que abre.
// GET: confirmação da inscrição (hub.challenge). POST: eventos.
// Guarda só a hora do último evento de cada atleta, por 7 dias. Nenhum dado de atividade fica guardado.
// Atividade nova: avisa os aparelhos inscritos nas notificações (sem buscar nada no Strava).
const { db, dbConf, baseUrl } = require('../_lib');
const P = require('../_push');

// Manda o aviso de atividade nova, sem passar de ~1,3 s (o Strava espera a resposta em até 2 s).
async function notify(owner, actId, origin) {
  const [ids, fresh] = await db([['SMEMBERS', P.athKey(owner)], ['SET', `pp:push:act:${actId}`, '1', 'NX', 'EX', '86400']]);
  if (!ids || !ids.length || fresh !== 'OK') return; // sem aparelhos ou aviso repetido do Strava
  const raws = await db(ids.slice(0, 10).map(id => ['GET', P.subKey(id)]));
  const msg = { title: 'Treino novo no Strava', body: 'Toque para ver a análise e contar como foi.', url: '/#hoje', tag: 'strava' };
  await Promise.all(ids.slice(0, 10).map((id, i) => {
    let rec = null; try { rec = raws[i] ? JSON.parse(raws[i]) : null; } catch (e) {}
    if (!rec) return db([['SREM', P.athKey(owner), id]]);
    if (!rec.prefs || rec.prefs.strava === false) return null;
    return P.sendTo(id, rec, msg, { origin, timeout: 1200, ttl: 6 * 3600, urgency: 'high' });
  }));
}

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
    if (e.object_type === 'athlete' && e.updates && String(e.updates.authorized) === 'false') await db([['DEL', key, P.athKey(owner)]]);
    else if (e.object_type === 'activity') {
      await db([['SET', key, String(Date.now()), 'EX', String(TTL)]]);
      if (e.aspect_type === 'create' && e.object_id) await Promise.race([notify(owner, String(e.object_id).replace(/\D/g, ''), baseUrl(req)), new Promise(r => setTimeout(r, 1300))]);
    }
  } catch (err) {}
  res.json({ ok: true });
};
