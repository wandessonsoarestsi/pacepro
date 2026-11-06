// Lista corridas recentes (as 100 últimas atividades). Parâmetros: after e before (segundos Unix), opcionais.
// Resposta: { list, from }. from vem quando a página encheu: só a partir dessa data a lista está completa.
const { getAccess, strava, fail } = require('../_lib');

const RUN = new Set(['Run', 'TrailRun', 'VirtualRun']);
const PER = 100;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const s = await getAccess(req, res);
    if (!s) return res.status(401).json({ error: 'Strava não conectado' });
    const q = new URLSearchParams({ per_page: String(PER) });
    if (req.query.after) q.set('after', String(parseInt(req.query.after, 10)));
    if (req.query.before) q.set('before', String(parseInt(req.query.before, 10)));
    const list = await strava(`/athlete/activities?${q}`, s);
    const full = list.length >= PER;
    const from = full ? list.map(a => String(a.start_date_local || '').slice(0, 10)).filter(Boolean).sort()[0] || null : null;
    res.json({ from, list: list.filter(a => RUN.has(a.sport_type || a.type)).map(a => ({
      id: a.id, name: a.name, start: a.start_date_local, distance: a.distance,
      moving_time: a.moving_time, elapsed_time: a.elapsed_time,
      average_heartrate: a.average_heartrate || null, average_cadence: a.average_cadence || null,
      trainer: !!a.trainer, poly: (a.map && a.map.summary_polyline) || null
    })) });
  } catch (e) { fail(res, e); }
};
