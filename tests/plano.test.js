// Testes do gerador e do leitor de planos. Rodar: npm test
const assert = require('assert');
const fs = require('fs');
const G = require('../public/plan-generator.js');
const P = require('../public/plan-parser.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('plano de exemplo continua sendo lido', () => {
  const p = P.parse(fs.readFileSync(__dirname + '/../public/plano.md', 'utf8'));
  assert.ok(p.days.length > 20); assert.ok(p.race); assert.strictEqual(p.goalSec, 1800);
  assert.strictEqual(p.sports.length, 0);
  assert.ok(p.days.every(d => !d.second));
});

t('plano só de corrida não muda de formato', () => {
  const md = G.generate({ start: '2026-11-09', race: '2027-01-24', distanceKm: 10, goalSec: 3000, currentSec5k: 1620, runWeekdays: [0, 2, 4, 6], cross: ['swim'], gym: true, level: 'normal' });
  const p = P.parse(md);
  assert.ok(/\| Data \| Corrida/.test(md));
  assert.strictEqual(p.distanceKm, 10); assert.strictEqual(p.goalSec, 3000);
  assert.strictEqual(p.days[p.days.length - 1].type, 'race');
});

const DOW = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
const cases = [
  { sports: [{ k: 'run', focus: true, goal: '15 km em 1 mês' }, { k: 'hyrox', focus: true, goal: 'sub 2h' }, { k: 'gym' }, { k: 'swim' }, { k: 'mobility' }], event: 'hyrox', days: [0, 1, 2, 3, 5, 6] },
  { sports: [{ k: 'tri', focus: true, goal: 'primeiro triatlo' }, { k: 'gym' }], event: 'tri', days: [0, 1, 2, 3, 4, 5] },
  { sports: [{ k: 'crossfit', focus: true }, { k: 'gym', focus: true }, { k: 'mobility' }], event: 'crossfit', days: [0, 2, 4, 6] },
  { sports: [{ k: 'run', focus: true }, { k: 'swim' }, { k: 'bike' }, { k: 'gym' }, { k: 'hyrox' }, { k: 'crossfit' }, { k: 'mobility' }], event: 'run', days: [1, 3, 5], level: 'iniciante' },
  { sports: [{ k: 'run', focus: true }, { k: 'gym' }, { k: 'other', name: 'Pilates' }], event: 'run', days: [2, 6] }
];
cases.forEach((c, i) => t(`plano híbrido ${i + 1} (${c.sports.map(s => s.k).join(', ')})`, () => {
  const md = G.generate({ start: '2026-11-09', race: '2027-02-28', distanceKm: 5, goalSec: 1800, currentSec5k: 1750, trainWeekdays: c.days, sports: c.sports, event: c.event, level: c.level || 'normal' });
  const p = P.parse(md);
  assert.ok(p.days.length > 50);
  assert.strictEqual(p.event, c.event);
  assert.strictEqual(p.sports.length, c.sports.length);
  assert.ok(p.sports.some(s => s.event));
  const last = p.days[p.days.length - 1];
  assert.strictEqual(last.date, '2027-02-28');
  assert.strictEqual(last.type, c.event === 'run' ? 'race' : 'event');
  if (c.event !== 'run') assert.strictEqual(p.goalSec, null);
  p.days.forEach(d => {
    const n = (d.type !== 'rest' ? 1 : 0) + (d.seconds ? d.seconds.length : 0) + (d.gym && d.type !== 'gym' ? 1 : 0);
    assert.ok(n <= 3, `mais de 3 atividades em ${d.date}`);
    if (n && d.date !== last.date) assert.ok(c.days.includes(DOW(d.date)), `treino fora dos dias escolhidos em ${d.date}`);
  });
  // Na véspera e na antevéspera da prova não há treino forte de outra modalidade.
  p.days.filter(d => d.date >= '2027-02-26' && d.date < '2027-02-28').forEach(d => assert.ok(!['hyrox', 'crossfit', 'brick'].includes(d.type)));
}));

t('dias escolhidos para cada modalidade e até 3 atividades no dia', () => {
  const md = G.generate({ start: '2026-11-09', race: '2027-02-28', distanceKm: 5, goalSec: 1800, currentSec5k: 1750, trainWeekdays: [0, 2, 4, 6], event: 'run', level: 'normal',
    sports: [{ k: 'run', goal: 'sub 30', days: [1, 3, 6] }, { k: 'swim', days: [0, 1] }, { k: 'gym', days: [1, 3] }, { k: 'hyrox' }, { k: 'mobility' }] });
  const p = P.parse(md);
  const wk = p.weeks[3].days;
  const at = dow => wk.find(d => DOW(d.date) === dow);
  assert.ok(['interval', 'threshold', 'easy', 'test'].includes(at(1).type) && at(1).gym && at(1).seconds.some(x => x.type === 'swim'), 'terça: corrida + musculação + natação');
  assert.strictEqual(at(0).type, 'swim');
  [2, 4, 5].forEach(d => assert.ok(!['interval', 'threshold'].includes(at(d).type), 'corrida só nos dias dela'));
  // Sem meta = complementar: Hyrox entra só com a sessão leve.
  assert.ok(p.days.filter(d => d.type === 'hyrox').every(d => /leve|motor|roxzone|transições|técnica/i.test(d.rua)));
  assert.ok(p.sports.find(s => s.k === 'run').focus && !p.sports.find(s => s.k === 'hyrox').focus);
});

t('corrida sem meta fica só com treinos leves', () => {
  const p = P.parse(G.generate({ start: '2026-11-09', race: '2027-02-28', currentSec5k: 1750, trainWeekdays: [0, 2, 4, 6], event: 'hyrox', level: 'normal',
    sports: [{ k: 'hyrox', goal: 'sub 2h' }, { k: 'run' }, { k: 'gym' }] }));
  assert.ok(!p.days.some(d => ['interval', 'threshold', 'test'].includes(d.type)));
  assert.ok(p.days.some(d => d.type === 'easy'));
  assert.ok(p.sports.find(s => s.k === 'hyrox').focus && !p.sports.find(s => s.k === 'run').focus);
});

t('não cabe tudo: corta primeiro as complementares', () => {
  const r = G.weeklyCounts(G.normSports([{ k: 'run', focus: true }, { k: 'swim' }, { k: 'bike' }, { k: 'gym' }, { k: 'hyrox' }, { k: 'crossfit' }, { k: 'mobility' }]), 3, 'iniciante');
  assert.strictEqual(r.counts.run, 3); assert.ok(r.dropped.length);
});


const A = require('../public/analysis.js');
const act = (km, sec, hr, laps) => ({ distance: km * 1000, moving_time: sec, average_heartrate: hr, splits_metric: Array.from({ length: Math.floor(km) }, () => ({ distance: 1000, moving_time: sec / km, average_heartrate: hr })), laps: laps || [] });

t('análise escrita: leve bem feito parabeniza e diz que o plano segue', () => {
  const a = A.analyze(act(5, 2100, 138), { type: 'easy', rua: "35' L", title: 'Leve' }, {});
  const r = A.report({ a, day: { title: 'Leve' }, runs28: { n: 10, km: 50 }, auto: [], next: { title: 'Limiar', when: 'qua, 11/11' } });
  const txt = r.parts.map(p => p.h + ' ' + p.p).join(' ');
  assert.ok(/Sim, o treino leve/.test(txt)); assert.ok(/Parabéns/.test(txt)); assert.ok(/Nada muda/.test(txt)); assert.ok(/Limiar \(qua, 11\/11\)/.test(txt));
});

t('análise escrita: limiar abaixo explica o porquê (pausa, sono, peso) e incentiva', () => {
  const a = A.analyze(act(6, 6 * 420, 170), { type: 'threshold', targetPace: 380, title: 'Limiar' }, {});
  assert.strictEqual(a.status, 'bad');
  const r = A.report({ a, day: { title: 'Limiar', targetPace: 380 }, feel: { rpe: 9, pain: 'nenhuma', sleep: 5 }, gapDays: 15, weight: { diff: 2, since: '01/10' }, runs28: { n: 1, km: 5 }, auto: ['O app sugere trocar.'], tip: 'Mire o mesmo alvo.' });
  const txt = r.parts.map(p => p.h + ' ' + p.p).join(' ');
  assert.ok(/Não, o treino de limiar/.test(txt)); assert.ok(/15 dias sem correr/.test(txt)); assert.ok(/dormiu 5h/i.test(txt));
  assert.ok(/peso subiu 2,0 kg/.test(txt)); assert.ok(/O app sugere trocar/.test(txt)); assert.ok(/pausa/.test(r.parts[r.parts.length - 1].p));
  assert.ok(!/Parabéns/.test(r.parts[r.parts.length - 1].h));
});

t('análise escrita: sem dados de contexto pede o registro de "Como foi"', () => {
  const a = A.analyze(act(5, 2100, 160), { type: 'easy', rua: "35' L" }, {});
  const r = A.report({ a, day: {} });
  assert.ok(r.parts.some(p => /Como foi/.test(p.p)));
});

t('FC pessoal: sem dados mantém 145 e 150–165', () => {
  const h = A.hrTargets({});
  assert.strictEqual(h.easy, 145); assert.deepStrictEqual(h.thr, [150, 165]); assert.strictEqual(h.custom, false);
});

t('FC pessoal: FC máxima mais alta sobe o teto do leve', () => {
  const h = A.hrTargets({ peaks: [200, 230] }); // 230 é leitura errada e fica de fora
  assert.strictEqual(h.max, 200); assert.strictEqual(h.easy, 153); assert.ok(h.thr[0] > h.easy);
});

t('FC pessoal: leves lentos acima do teto sobem o teto (com limite)', () => {
  const easyRuns = [{ hr: 158, pace: 620 }, { hr: 156, pace: 600 }, { hr: 152, pace: 560 }, { hr: 160, pace: 540 }, { hr: 162, pace: 530 }, { hr: 150, pace: 500 }];
  const h = A.hrTargets({ peaks: [195], easyRuns });
  assert.ok(h.easy > Math.round(195 * 0.765)); assert.ok(h.easy <= Math.round(195 * 0.82));
  assert.ok(/leves mais lentos/.test(h.why));
});

t('FC pessoal: sem FC máxima informada, o ajuste automático não baixa o teto', () => {
  const h = A.hrTargets({ peaks: [172], avgs: [150] });
  assert.strictEqual(h.easy, 145);
});

t('análise usa o teto de FC pessoal', () => {
  const a = A.analyze(act(5, 2400, 150), { type: 'easy', rua: "40' L" }, { hr: { easy: 152, thr: [156, 170] } });
  assert.strictEqual(a.status, 'ok'); assert.deepStrictEqual(a.hr, { easy: 152, thr: [156, 170] });
  const b = A.analyze(act(5, 2400, 150), { type: 'easy', rua: "40' L" }, {});
  assert.strictEqual(b.status, 'warn');
});

console.log(`${n} testes passaram`);
