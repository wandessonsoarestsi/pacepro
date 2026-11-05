// Lista corridas recentes. Parâmetros: after e before (segundos Unix), opcionais.
const { getAccess, strava, fail } = require('../_lib');

const RUN = new Set(['Run', 'TrailRun', 'VirtualRun']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const s = await getAccess(req, res);
    if (!s) return res.status(401).json({ error: 'Strava não conectado' });
    const q = new URLSearchParams({ per_page: '60' });
    if (req.query.after) q.set('after', String(parseInt(req.query.after, 10)));
    if (req.query.before) q.set('before', String(parseInt(req.query.before, 10)));
    const list = await strava(`/athlete/activities?${q}`, s);
    res.json(list.filter(a => RUN.has(a.sport_type || a.type)).map(a => ({
      id: a.id, name: a.name, start: a.start_date_local, distance: a.distance,
      moving_time: a.moving_time, elapsed_time: a.elapsed_time,
      average_heartrate: a.average_heartrate || null, average_cadence: a.average_cadence || null,
      trainer: !!a.trainer
    })));
  } catch (e) { fail(res, e); }
};
