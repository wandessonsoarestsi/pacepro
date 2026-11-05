// Detalhe de uma corrida com parciais por km e voltas. Parâmetro: id.
const { getAccess, strava, fail } = require('../_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: 'Informe o id da atividade' });
    const s = await getAccess(req, res);
    if (!s) return res.status(401).json({ error: 'Strava não conectado' });
    const [a, laps] = await Promise.all([strava(`/activities/${id}`, s), strava(`/activities/${id}/laps`, s)]);
    res.json({
      id: a.id, name: a.name, start: a.start_date_local, distance: a.distance,
      moving_time: a.moving_time, elapsed_time: a.elapsed_time,
      average_heartrate: a.average_heartrate || null, max_heartrate: a.max_heartrate || null,
      average_cadence: a.average_cadence || null, trainer: !!a.trainer,
      splits_metric: (a.splits_metric || []).map(x => ({ distance: x.distance, moving_time: x.moving_time, average_heartrate: x.average_heartrate || null })),
      laps: (laps || []).map(l => ({ distance: l.distance, moving_time: l.moving_time, average_heartrate: l.average_heartrate || null }))
    });
  } catch (e) { fail(res, e); }
};
