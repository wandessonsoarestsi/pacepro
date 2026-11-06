// Rodar uma vez: apaga da nuvem (Redis) os dados do Strava que as versões antigas do app salvavam.
// Uso: KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/limpar-strava-nuvem.js
// (as duas variáveis estão em Vercel → Settings → Environment Variables).
const { db } = require('../api/_lib');
const { noStrava } = require('../api/account');

(async () => {
  let cursor = '0', seen = 0, fixed = 0;
  do {
    const [[next, keys]] = await db([['SCAN', cursor, 'MATCH', 'pp:u:*:data', 'COUNT', '200']]);
    cursor = String(next);
    for (const k of keys) {
      seen++;
      const [raw] = await db([['GET', k]]);
      if (!raw) continue;
      const clean = JSON.stringify(noStrava(JSON.parse(raw)));
      if (clean !== raw) { await db([['SET', k, clean]]); fixed++; }
    }
  } while (cursor !== '0');
  console.log(`Contas vistas: ${seen}. Limpas agora: ${fixed}.`);
})().catch(e => { console.error(e.message); process.exit(1); });
