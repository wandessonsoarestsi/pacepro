// Inscrição de um aparelho nas notificações.
// GET: se está disponível e a chave pública. POST: inscreve ou atualiza ({ sub, prefs, days, race, done }).
// GET ?a=cron: lembretes do dia (Cron da Vercel). POST ?a=test: manda uma notificação de teste. POST ?a=off ({ endpoint }): cancela.
// O aparelho manda os próximos dias do plano (data, título e tipo) para os lembretes saírem sem o app aberto.
const { dbConf, readCookie, open, baseUrl, fail, db } = require('./_lib');
const P = require('./_push');
const cron = require('./_cron');

const PREFS = ['treino', 'prova', 'kit', 'perdido', 'strava'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function clean(b) {
  const s = b.sub || {};
  if (!/^https:\/\//.test(s.endpoint || '') || String(s.endpoint).length > 1000 || !s.keys || !s.keys.p256dh || !s.keys.auth) return null;
  const prefs = {}; PREFS.forEach(k => { prefs[k] = !b.prefs || b.prefs[k] !== false; });
  const days = (Array.isArray(b.days) ? b.days : []).slice(0, 40).filter(d => d && DATE.test(d.d))
    .map(d => ({ d: d.d, t: txt(d.t, 80), x: txt(d.x, 160), ty: txt(d.ty, 16), k: !!d.k }));
  const race = b.race && DATE.test(b.race.d) ? { d: b.race.d, n: txt(b.race.n, 60) } : null;
  const done = (Array.isArray(b.done) ? b.done : []).filter(d => DATE.test(d)).slice(-10);
  const kits = (Array.isArray(b.kits) ? b.kits : []).slice(0, 10).filter(k => k && DATE.test(k.d)).map(k => ({ d: k.d, n: txt(k.n, 60), p: txt(k.p, 100) }));
  return { sub: { endpoint: String(s.endpoint), keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } }, prefs, days, race, done, kits };
}
// Atleta do Strava conectado neste navegador (do cookie criptografado), para o aviso de atividade nova.
function athleteOf(req) {
  const raw = readCookie(req, 'pp_strava'); const s = raw && open(raw);
  return s && s.athlete && s.athlete.id ? String(s.athlete.id).replace(/\D/g, '') : null;
}

module.exports = async (req, res) => {
  if (req.query && req.query.a === 'cron') return cron(req, res);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!dbConf()) return res.json({ configured: false });
    if (req.method === 'GET') { const k = await P.vapidKeys(); return res.json({ configured: true, publicKey: k.publicKey }); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    if (!/application\/json/.test(req.headers['content-type'] || '')) return res.status(400).json({ error: 'Formato inválido.' });
    const b = req.body || {};
    if (req.query && req.query.a === 'off') {
      if (!b.endpoint) return res.status(400).json({ error: 'Dados inválidos.' });
      const id = P.idOf(b.endpoint);
      await P.remove(id, await P.load(id));
      return res.json({ ok: true });
    }
    const id = P.idOf((b.sub && b.sub.endpoint) || '');
    if (req.query && req.query.a === 'test') {
      const rec = await P.load(id);
      if (!rec) return res.status(404).json({ error: 'Ative as notificações de novo.' });
      const st = await P.sendTo(id, rec, { title: 'Notificações ligadas', body: 'É assim que os avisos do PacePro vão aparecer.', url: '/#ajustes', tag: 'teste' }, { origin: baseUrl(req), ttl: 600 });
      if (st < 200 || st >= 300) {
        const why = P.lastError(), host = (() => { try { return new URL(rec.sub.endpoint).host; } catch (e) { return ''; } })();
        console.error('push teste falhou', host, why);
        const hint = st === 404 || st === 410 ? 'Desative e ative as notificações de novo.' : 'Tente de novo.';
        return res.status(502).json({ error: `Não consegui entregar a notificação (${host}: ${why || 'sem resposta'}). ${hint}` });
      }
      return res.json({ ok: true });
    }
    const c = clean(b);
    if (!c) return res.status(400).json({ error: 'Inscrição inválida.' });
    const prev = await P.load(id);
    const ath = athleteOf(req);
    const rec = { ...c, ath, last: prev ? prev.last || null : null, at: Date.now() };
    const cmds = [['SET', P.subKey(id), JSON.stringify(rec), 'EX', String(P.SUB_TTL)], ['SADD', P.ALL, id]];
    if (prev && prev.ath && prev.ath !== ath) cmds.push(['SREM', P.athKey(prev.ath), id]);
    if (ath) cmds.push(['SADD', P.athKey(ath), id], ['EXPIRE', P.athKey(ath), String(P.SUB_TTL)]);
    await db(cmds);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
};
module.exports.clean = clean;
