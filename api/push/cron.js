// Lembretes do dia, chamado uma vez por dia pelo Cron da Vercel (vercel.json, 10h UTC = 7h em Brasília).
// Para cada aparelho inscrito: treino de hoje, contagem para a prova e treino-chave de ontem que ficou sem fazer.
// Cada aparelho recebe no máximo uma rodada por dia, mesmo se o cron rodar mais vezes.
const { db, dbConf, baseUrl } = require('../_lib');
const P = require('../_push');

const TZ = 'America/Fortaleza';
const isoLocal = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const D = s => new Date(s + 'T12:00:00-03:00');
const addDays = (s, n) => isoLocal(new Date(D(s).getTime() + n * 864e5));
const COUNT = [30, 14, 7, 3, 1];

// Quais avisos este aparelho recebe hoje. stravaAt: hora do último aviso de atividade do Strava (webhook).
function messages(rec, today, stravaAt) {
  const out = [], pr = rec.prefs || {}, days = rec.days || [];
  const day = days.find(d => d.d === today);
  const race = rec.race && rec.race.d >= today ? rec.race : null;
  const raceName = race && race.n ? race.n : 'a prova';
  const raceDay = (day && day.ty === 'race') || (race && race.d === today);
  if (raceDay && (pr.treino !== false || pr.prova !== false)) out.push({ title: 'Dia de prova! 🏁', body: 'Boa prova! Confira os horários, o checklist e o ritmo km a km.', url: '/#hoje', tag: 'treino' });
  else if (pr.treino !== false && day && day.ty !== 'rest') {
    out.push({ title: `Treino de hoje: ${day.t || 'corrida'}`, body: day.x || 'Toque para ver o treino completo.', url: '/#hoje', tag: 'treino' });
  }
  if (pr.prova !== false && race && race.d > today) {
    const n = Math.round((D(race.d) - D(today)) / 864e5);
    if (COUNT.includes(n)) out.push({
      title: n === 1 ? `Amanhã é ${raceName}!` : `Faltam ${n} dias para ${raceName}`,
      body: n === 1 ? 'Descanse, hidrate-se e deixe tudo separado hoje à noite. O checklist está no app.'
        : n <= 7 ? 'Reta final: mantenha os treinos leves e durma bem.' : 'Siga o plano. Veja a estimativa de tempo no app.',
      url: '/#provas', tag: 'prova'
    });
  }
  if (pr.perdido !== false) {
    const y = addDays(today, -1), yd = days.find(d => d.d === y);
    const ranSince = stravaAt && isoLocal(new Date(stravaAt)) >= y;
    if (yd && yd.k && yd.ty !== 'rest' && !(rec.done || []).includes(y) && !ranSince) out.push({
      title: `Ficou para trás: ${yd.t || 'treino de ontem'}`,
      body: 'Se já fez, marque como feito. Se não, o app mostra como encaixar na semana.', url: '/#hoje', tag: 'perdido'
    });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Não autorizado.' });
  if (!dbConf()) return res.json({ ok: true, sent: 0 });
  const today = isoLocal(new Date()), origin = baseUrl(req);
  let sent = 0, seen = 0;
  try {
    const [ids] = await db([['SMEMBERS', P.ALL]]);
    for (let i = 0; i < (ids || []).length; i += 20) {
      const batch = ids.slice(i, i + 20);
      const raws = await db(batch.map(id => ['GET', P.subKey(id)]));
      await Promise.all(batch.map(async (id, j) => {
        let rec = null; try { rec = raws[j] ? JSON.parse(raws[j]) : null; } catch (e) {}
        if (!rec) { await db([['SREM', P.ALL, id]]); return; } // inscrição expirou
        seen++;
        if (rec.last === today) return;
        const [t] = rec.ath ? await db([['GET', `pp:sa:${rec.ath}:t`]]) : [null];
        const list = messages(rec, today, t ? +t : null);
        await db([['SET', P.subKey(id), JSON.stringify({ ...rec, last: today }), 'KEEPTTL']]);
        for (const m of list) { const st = await P.sendTo(id, rec, m, { origin }); if (st >= 200 && st < 300) sent++; else if (st >= 400 && st !== 429) break; }
      }));
    }
    res.json({ ok: true, today, devices: seen, sent });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
module.exports.messages = messages;
