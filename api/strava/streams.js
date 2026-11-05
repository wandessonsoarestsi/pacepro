// Dados ponto a ponto de uma corrida (posição, tempo, distância, velocidade, FC, altitude) e as voltas.
// Reduzidos para no máximo ~700 pontos, o suficiente para desenhar o mapa no celular. Parâmetro: id.
const { getAccess, strava, fail } = require('../_lib');

const MAX = 700;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: 'Informe o id da atividade' });
    const s = await getAccess(req, res);
    if (!s) return res.status(401).json({ error: 'Strava não conectado' });
    const keys = 'latlng,time,distance,velocity_smooth,heartrate,altitude';
    const [st, laps] = await Promise.all([
      strava(`/activities/${id}/streams?keys=${keys}&key_by_type=true`, s),
      strava(`/activities/${id}/laps`, s).catch(() => [])
    ]);
    const col = k => (st && st[k] && st[k].data) || null;
    const ll = col('latlng'), t = col('time'), d = col('distance');
    if (!ll || !t || !d || ll.length < 2) return res.json({ id: +id, n: 0 });
    const v = col('velocity_smooth'), hr = col('heartrate'), alt = col('altitude');
    const n = ll.length, step = Math.max(1, Math.ceil(n / MAX));
    const idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const r5 = x => Math.round(x * 1e5) / 1e5, r1 = x => Math.round(x * 10) / 10;
    const pick = (a, f) => a ? idx.map(i => f(a[i])) : null;
    res.json({
      id: +id, n: idx.length,
      lat: idx.map(i => r5(ll[i][0])), lon: idx.map(i => r5(ll[i][1])),
      t: pick(t, x => x), d: pick(d, r1), v: pick(v, x => Math.round(x * 100) / 100),
      hr: pick(hr, x => x), alt: pick(alt, r1),
      laps: (laps || []).map(l => ({
        d0: d[Math.min(l.start_index || 0, n - 1)], d1: d[Math.min(l.end_index || 0, n - 1)],
        dist: l.distance, time: l.moving_time, hr: l.average_heartrate || null
      }))
    });
  } catch (e) { fail(res, e); }
};
