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
    const n = (d.type !== 'rest' ? 1 : 0) + (d.second ? 1 : 0) + (d.gym && d.type !== 'gym' ? 1 : 0);
    assert.ok(n <= 2, `mais de 2 treinos em ${d.date}`);
    if (n && d.date !== last.date) assert.ok(c.days.includes(DOW(d.date)), `treino fora dos dias escolhidos em ${d.date}`);
  });
  // Na véspera e na antevéspera da prova não há treino forte de outra modalidade.
  p.days.filter(d => d.date >= '2027-02-26' && d.date < '2027-02-28').forEach(d => assert.ok(!['hyrox', 'crossfit', 'brick'].includes(d.type)));
}));

t('não cabe tudo: corta primeiro as complementares', () => {
  const r = G.weeklyCounts(G.normSports([{ k: 'run', focus: true }, { k: 'swim' }, { k: 'bike' }, { k: 'gym' }, { k: 'hyrox' }, { k: 'crossfit' }, { k: 'mobility' }]), 3, 'iniciante');
  assert.strictEqual(r.counts.run, 3); assert.ok(r.dropped.length);
});

console.log(`${n} testes passaram`);
