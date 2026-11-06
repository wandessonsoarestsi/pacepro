/* Gerador de plano de corrida por algoritmo (método VDOT de Jack Daniels).
   Entrada: { start, race (aaaa-mm-dd), distanceKm, goalSec, currentSec5k, runDays (3|4|5), runWeekdays ([0..6], 0 = segunda), cross, gym, level: 'normal'|'iniciante'|'pausa' }
   runWeekdays, quando vem, define os dias de corrida (de 2 a 6) e vale mais que runDays.
   Saída: Markdown no formato lido por plan-parser.js. */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const DAY = 864e5;
  const D = s => new Date(s + 'T12:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const add = (s, n) => iso(new Date(D(s).getTime() + n * DAY));
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WDL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const dmy = s => `${dm(s)}/${s.slice(0, 4)}`;
  const fmtPace = s => { s = Math.round(s / 5) * 5; return `${Math.floor(s / 60)}'${pad(s % 60)}"`; };
  const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
  const kmh = pace => (3600 / pace).toFixed(1).replace('.', ',');
  const km = n => String(n).replace('.', ',');

  /* --- VDOT --- */
  const vo2 = v => -4.6 + 0.182258 * v + 0.000104 * v * v;                       // v em m/min
  const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); // t em min
  const vdotFrom = (meters, sec) => { const t = sec / 60, v = meters / t; return vo2(v) / pctMax(t); };
  const speedFor = target => { const a = 0.000104, b = 0.182258, c = -4.6 - target; return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); };
  const paceAt = (vdot, frac) => 60000 / speedFor(vdot * frac);                  // s/km
  function raceTime(vdot, meters) { // tempo previsto para a distância
    let lo = 60, hi = 6 * 3600;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotFrom(meters, mid) > vdot) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function paces(vdot) {
    return {
      easyFast: paceAt(vdot, 0.74), easySlow: paceAt(vdot, 0.66),
      threshold: paceAt(vdot, 0.88), interval: paceAt(vdot, 0.975), rep: paceAt(vdot, 1.05)
    };
  }

  // Textos das atividades além da corrida (usados no gerador e no ajuste do plano atual).
  const CROSS_TEXT = {
    swim: { label: 'Natação', ico: '🏊', leve: 'Natação leve, 30 min', moderada: 'Natação leve a moderada, 30–40 min' },
    bike: { label: 'Bike', ico: '🚴', leve: 'Bike leve, 30 min, giro solto', moderada: 'Bike leve a moderada, 40–50 min, giro solto' },
    mobility: { label: 'Mobilidade', ico: '🧘', leve: 'Mobilidade e alongamento, 20 min', moderada: 'Mobilidade e alongamento, 25–30 min' }
  };

  /* --- Musculação --- */
  const GYM_MD = `## Sessões de musculação (40 min cada)

Todas começam com 5 min de aquecimento e terminam com 3 min de alongamento leve. Descanso entre séries: 60–90 s.
O número de séries e repetições de cada semana está na linha em itálico abaixo do título da semana.

### 💪 A — Pernas: força
| Exercício | Observação |
|---|---|
| Agachamento livre ou leg press | Principal. Descer controlado. |
| Levantamento terra romeno | Posterior de coxa e glúteo. Coluna neutra. |
| Agachamento búlgaro | Por perna. |
| Mesa flexora | Protege o posterior nos tiros. |
| Panturrilha em pé | 3 × 15 sempre. |
| Prancha frontal | 3 × 40–60 s |

### 💪 B — Superiores + core
| Exercício | Observação |
|---|---|
| Supino reto (ou flexão de braço) | |
| Remada curvada ou baixa | Postura na corrida. |
| Puxada frente | |
| Desenvolvimento com halteres | |
| Pallof press | 3 × 10 por lado |
| Dead bug | 3 × 10 por lado |

### 💪 C — Pernas: potência
| Exercício | Observação |
|---|---|
| Saltitos de tornozelo (pogo) | 3 × 15–20 (sem saltos nas semanas leves) |
| Afundo caminhando | Por perna. |
| Step-up no banco | Por perna, subida firme. |
| Hip thrust / ponte de glúteo | |
| Panturrilha unilateral | 3 × 15 por perna |

### 💪 D — Superiores + core
| Exercício | Observação |
|---|---|
| Remada unilateral com halter | |
| Supino inclinado com halteres | |
| Face pull | Ombros e postura. |
| Farmer walk | 3 × 30–40 m |
| Prancha lateral | 3 × 30–45 s por lado |
| Bird dog | 3 × 10 por lado |

### 💪 E — Preventivo + mobilidade
| Exercício | Volume |
|---|---|
| Mobilidade de tornozelo (joelho à parede) | 2 × 10 por lado |
| Mobilidade de quadril (90/90) | 2 × 8 por lado |
| Monster walk com elástico | 2 × 15 passos por lado |
| Clamshell | 2 × 15 por lado |
| Elevação de ponta de pé (tibial) | 2 × 20 |
| Equilíbrio em uma perna | 2 × 30 s por perna |
`;

  /* --- Dias da semana escolhidos --- */
  // Recebe os dias de corrida (0 = segunda ... 6 = domingo) e decide onde fica cada treino:
  // longo (L) no fim de semana se der, intervalado (I) e limiar (T) longe do longo e um do outro,
  // o resto vira leve (E com strides e X). Outras atividades vão nos dias livres, deixando ao menos um de descanso.
  function layoutFor(days) {
    const L = days.includes(6) ? 6 : days.includes(5) ? 5 : days[days.length - 1];
    const rest = days.filter(d => d !== L);
    const gap = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 7 - x); };
    let best = null;
    const hardN = days.length >= 3 ? 2 : 1;
    const pairs = [];
    rest.forEach(i => { if (hardN === 1) pairs.push([i, null]); else rest.forEach(t => { if (t !== i) pairs.push([i, t]); }); });
    pairs.forEach(([i, t]) => {
      const hard = [i, t, L].filter(d => d != null);
      let score = 0;
      for (let a = 0; a < hard.length; a++) for (let b = a + 1; b < hard.length; b++) { const g = gap(hard[a], hard[b]); score += g === 1 ? 100 : g === 2 ? 10 : 0; }
      if (t != null && t < i) score += 1; // intervalado antes do limiar na semana
      score += i * 0.01;
      if (!best || score < best.score) best = { i, t, score };
    });
    const easy = rest.filter(d => d !== best.i && d !== best.t);
    // E (com strides) no dia leve mais longe do longo; os outros leves viram X
    const E = easy.length ? easy.slice().sort((a, b) => gap(b, L) - gap(a, L) || a - b)[0] : null;
    const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !days.includes(d));
    const nCross = Math.max(0, Math.min(2, free.length - 1));
    // outras atividades: de preferência dias de semana e não na véspera do longo
    const swim = free.slice().sort((a, b) => ((a === L - 1 ? 10 : 0) + (a > 4 ? 5 : 0)) - ((b === L - 1 ? 10 : 0) + (b > 4 ? 5 : 0)) || a - b).slice(0, nCross);
    return { I: best.i, T: best.t, E, X: easy.filter(d => d !== E), L, swim };
  }

  /* --- Treino híbrido: várias modalidades na mesma semana --- */
  // Modalidades que a pessoa pode escolher. "event" = pode ser a prova principal do ciclo.
  const SPORTS = {
    run: { label: 'Corrida', ico: '🏃', event: 'Prova de corrida' },
    swim: { label: 'Natação', ico: '🏊', event: 'Prova de natação' },
    bike: { label: 'Bike', ico: '🚴', event: 'Prova de bike' },
    gym: { label: 'Musculação', ico: '💪' },
    hyrox: { label: 'Hyrox', ico: '🏋️', event: 'Prova de Hyrox' },
    crossfit: { label: 'Crossfit', ico: '🔥', event: 'Competição de Crossfit' },
    tri: { label: 'Triatlo', ico: '🏅', event: 'Prova de triatlo' },
    mobility: { label: 'Mobilidade', ico: '🧘' },
    other: { label: 'Outra', ico: '🔸' }
  };
  // Sessões por semana: [foco, complementar].
  const PER_WEEK = { run: [4, 2], swim: [3, 1], bike: [3, 1], gym: [3, 2], hyrox: [2, 1], crossfit: [3, 2], mobility: [2, 1], other: [2, 1], brick: [1, 0] };
  // Ordem de corte quando não cabe tudo nos dias escolhidos (primeiro o que sai antes).
  const CUT_ORDER = ['mobility', 'other', 'brick', 'gym', 'bike', 'swim', 'crossfit', 'hyrox', 'run'];

  // Textos das sessões por fase: base, build (construção), spec (específica) e light (semana leve, teste e polimento).
  // Cada modalidade tem variações; a 1ª costuma ser a forte. hard = treino forte, legs = pesa nas pernas, long = vai bem no fim de semana.
  const SESS = {
    swim: [
      { hard: true, t: { base: w => `🏊 Natação — **técnica + ${6 + Math.min(4, w)} × 50 m fortes**, pausa 20" (≈1.200 m)`, build: w => `🏊 Natação — **${8 + Math.min(4, w % 5)} × 100 m no ritmo de prova**, pausa 15" (≈1.800 m)`, spec: () => '🏊 Natação — **5 × 200 m fortes**, pausa 30" + 4 × 50 m rápidos (≈2.000 m)', light: () => '🏊 Natação — **técnica e educativos**, 1.000 m leve' } },
      { t: { base: () => '🏊 Natação — **contínuo leve 25 min**, respiração bilateral', build: () => '🏊 Natação — **contínuo leve 35 min**, respiração bilateral', spec: () => '🏊 Natação — **contínuo 45 min**, ritmo confortável', light: () => '🏊 Natação — **leve 20 min**, solto' } },
      { long: true, t: { base: () => '🏊 Natação — **3 × 400 m aeróbios**, pausa 30"', build: () => '🏊 Natação — **4 × 400 m aeróbios**, pausa 30"', spec: () => '🏊 Natação — **2 × 800 m no ritmo de prova**, pausa 1\'', light: () => '🏊 Natação — **2 × 300 m leves**' } }
    ],
    bike: [
      { hard: true, legs: true, t: { base: () => '🚴 Bike — **6 × 2\' fortes** (cadência 95+), pausa 2\' leve, total 45 min', build: () => '🚴 Bike — **4 × 6\' no limiar**, pausa 3\', total 60 min', spec: () => '🚴 Bike — **3 × 10\' no ritmo de prova**, pausa 4\', total 70 min', light: () => '🚴 Bike — **giro leve 30 min**, com 4 × 30" soltos' } },
      { t: { base: () => '🚴 Bike — **giro leve 45 min** (Z2)', build: () => '🚴 Bike — **giro leve 60 min** (Z2)', spec: () => '🚴 Bike — **giro 70 min** (Z2)', light: () => '🚴 Bike — **giro leve 30 min**' } },
      { long: true, t: { base: () => '🚴 Bike — **longo 75 min** (Z2), comendo a cada 30 min', build: () => '🚴 Bike — **longo 1h40** (Z2), comendo a cada 30 min', spec: () => '🚴 Bike — **longo 2h** com 3 × 10\' no ritmo de prova', light: () => '🚴 Bike — **45 min leve**' } }
    ],
    hyrox: [
      { hard: true, legs: true, t: { base: () => 'Hyrox — **4 × (1 km de corrida moderada + 1 estação)**: SkiErg 500 m, remo 500 m, wall ball 30, farmers carry 100 m. Pausa 2\'', build: () => 'Hyrox — **6 × (1 km + estação)** no ritmo da meta: SkiErg, sled push, sled pull, burpee broad jump, remo, wall ball. Pausa 1\'30"', spec: w => `Hyrox — **${w % 2 ? 'meio simulado' : 'simulado'}: ${w % 2 ? 4 : 8} × (1 km + estação)** na ordem da prova, no ritmo da meta`, light: () => 'Hyrox — **3 × (500 m + estação leve)**, técnica nas transições' } },
      { hard: true, legs: true, t: { base: () => 'Hyrox — **força para as estações**: sled push e pull 4 × 20 m, afundo com sandbag 3 × 20 m, wall ball 3 × 15, farmers carry 3 × 50 m', build: () => 'Hyrox — **EMOM 30\'**: SkiErg 12 cal, burpee broad jump 8, remo 12 cal, wall ball 15, sandbag lunges 10 m', spec: () => 'Hyrox — **estações no ritmo de prova**: 2 voltas de sled push 50 m + sled pull 50 m + burpee broad jump 80 m, pausa 3\'', light: () => 'Hyrox — **técnica das estações**, 30 min leve' } },
      { t: { base: () => 'Hyrox — **motor aeróbio**: 30\' alternando SkiErg, remo e corrida leve', build: () => 'Hyrox — **roxzone**: 5 × (800 m + 20 wall balls), ritmo moderado', spec: () => 'Hyrox — **transições**: 6 × (400 m + 15 wall balls), ritmo de prova sem parar', light: () => 'Hyrox — **20\' leve** de SkiErg e remo' } }
    ],
    crossfit: [
      { hard: true, legs: true, t: { base: () => 'Crossfit — **técnica 15\' + AMRAP 12\'**: 10 thrusters, 10 pull-ups (ou remada), 200 m de corrida', build: () => 'Crossfit — **EMOM 16\' + for time**: 21-15-9 de power clean e burpee', spec: w => `Crossfit — **benchmark**: ${['Fran', 'Grace', 'Helen', 'Cindy'][w % 4]}. Anote o tempo ou as rodadas`, light: () => 'Crossfit — **WOD leve 20\'**, ritmo de conversa, + mobilidade' } },
      { hard: true, legs: true, t: { base: () => 'Crossfit — **força**: back squat 5 × 5 + ginástica (pull-up, parada de mão) 15\'', build: () => 'Crossfit — **olímpico**: snatch e clean & jerk 6 × 2 (técnica) + WOD curto de 8\'', spec: () => 'Crossfit — **força + chipper**: deadlift 5 × 3 pesado + chipper de 15\'', light: () => 'Crossfit — **técnica e mobilidade**, 30 min' } },
      { t: { base: () => 'Crossfit — **engine**: 30\' alternando remo, bike e corda, ritmo moderado', build: () => 'Crossfit — **engine**: 4 × 6\' (remo, bike, corda), pausa 2\'', spec: () => 'Crossfit — **engine**: 5 × 5\' fortes, pausa 2\'', light: () => 'Crossfit — **20\' leve** de remo e corda' } }
    ],
    mobility: [
      { t: { base: () => '🧘 Mobilidade e alongamento, 25 min', build: () => '🧘 Mobilidade e alongamento, 30 min', spec: () => '🧘 Mobilidade e alongamento, 30 min', light: () => '🧘 Mobilidade e alongamento, 20 min' } },
      { t: { base: () => '🧘 Mobilidade de quadril, tornozelo e ombro, 25 min', build: () => '🧘 Mobilidade de quadril, tornozelo e ombro, 30 min', spec: () => '🧘 Mobilidade de quadril, tornozelo e ombro, 30 min', light: () => '🧘 Mobilidade leve, 20 min' } }
    ],
    brick: [
      { hard: true, legs: true, long: true, t: { base: () => '🧱 Transição — **bike 30\' + corrida 10\' leve**, troca rápida', build: () => '🧱 Transição — **bike 50\' + corrida 20\'** (os 10\' finais no ritmo de prova)', spec: () => '🧱 Transição — **bike 60\' com 20\' no ritmo de prova + corrida 25\' no ritmo de prova**', light: () => '🧱 Transição — **bike 20\' + corrida 10\' leve**' } }
    ]
  };
  const otherSess = name => [
    { t: { base: () => `🔸 ${name} leve a moderado, 30–45 min`, build: () => `🔸 ${name} moderado, 45 min`, spec: () => `🔸 ${name} moderado, 45 min`, light: () => `🔸 ${name} leve, 30 min` } },
    { hard: true, t: { base: () => `🔸 ${name} — **sessão forte**, 40 min`, build: () => `🔸 ${name} — **sessão forte**, 45 min`, spec: () => `🔸 ${name} — **sessão forte**, 45 min`, light: () => `🔸 ${name} leve, 30 min` } }
  ];
  // Quais variações usar conforme o número de sessões na semana.
  const PATTERN = {
    swim: [[], [1], [0, 1], [0, 1, 2], [0, 1, 2, 1]],
    bike: [[], [1], [0, 1], [0, 1, 2], [0, 1, 2, 1]],
    hyrox: [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 0]],
    crossfit: [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 0], [0, 1, 2, 0, 1]],
    mobility: [[], [0], [0, 1], [0, 1, 0]],
    other: [[], [0], [0, 1], [0, 1, 0]],
    brick: [[], [0]]
  };
  const GYM_LETTERS = ['A', 'B', 'C', 'D', 'E'];

  // Normaliza a lista de modalidades: [{ k, focus, goal, name }]. Triatlo vira natação + bike + corrida + transição.
  function normSports(list) {
    const out = [];
    (list || []).forEach(s => {
      const k = typeof s === 'string' ? s : s && s.k;
      if (!SPORTS[k] || out.some(x => x.k === k && k !== 'other')) return;
      const name = k === 'other' ? String(s.name || '').trim().slice(0, 40) : '';
      if (k === 'other' && !name) return;
      out.push({ k, focus: !!(s && s.focus), goal: String((s && s.goal) || '').trim().slice(0, 80), name, label: name || SPORTS[k].label });
    });
    if (out.length && !out.some(s => s.focus)) out[0].focus = true;
    return out;
  }

  // Quantas sessões de cada modalidade por semana, cabendo nos dias escolhidos (até 2 treinos por dia).
  function weeklyCounts(sports, nDays, level) {
    const c = {}, focus = {};
    const set = (k, n, f) => { c[k] = Math.max(c[k] || 0, n); if (f) focus[k] = true; };
    sports.forEach(s => {
      if (s.k === 'tri') return;
      const key = s.k === 'other' ? 'other' : s.k;
      set(key, PER_WEEK[key][s.focus ? 0 : 1], s.focus);
    });
    const tri = sports.find(s => s.k === 'tri');
    if (tri) {
      const f = tri.focus;
      set('swim', f ? 3 : 2, f); set('bike', f ? 2 : 2, f); set('run', f ? 3 : 2, f);
      if (f) set('brick', 1, true);
    }
    const hy = sports.find(s => s.k === 'hyrox');
    if (hy && c.run) c.run = Math.max(c.run, hy.focus ? 3 : 2);
    Object.keys(c).forEach(k => { c[k] = Math.min(c[k], nDays, k === 'run' ? 6 : 7); });
    const cap = level === 'iniciante' ? nDays + Math.floor(nDays / 2) : level === 'pausa' ? nDays + Math.ceil(nDays / 2) : nDays * 2;
    const total = () => Object.values(c).reduce((a, b) => a + b, 0);
    const dropped = [];
    const rank = k => (focus[k] ? 100 : 0) + CUT_ORDER.indexOf(k);
    // Corta nesta ordem: sessões extras das complementares, complementares inteiras, sessões extras do foco (até 2), foco.
    const steps = [
      k => !focus[k] && c[k] > 1 ? 'trim' : null,
      k => !focus[k] ? 'drop' : null,
      k => focus[k] && c[k] > 2 ? 'trim' : null,
      k => focus[k] && c[k] > 1 ? 'trim' : null,
      () => 'drop'
    ];
    for (const st of steps) {
      while (total() > cap) {
        const k = Object.keys(c).filter(x => c[x] > 0 && st(x)).sort((a, b) => rank(a) - rank(b) || c[b] - c[a])[0];
        if (!k) break;
        if (st(k) === 'trim') c[k]--; else { c[k] = 0; dropped.push(k); }
      }
    }
    return { counts: c, focus, dropped, cap };
  }

  // Dias de corrida dentro dos dias de treino: espalhados, com o fim de semana para o longo quando der.
  function pickRunDays(days, r) {
    if (r >= days.length) return days.slice();
    if (r <= 0) return [];
    const gap = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 7 - x); };
    let best = null;
    const rec = (start, pick) => {
      if (pick.length === r) {
        let s = 0;
        for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) { const g = gap(pick[i], pick[j]); s += g === 1 ? 10 : g === 2 ? 2 : 0; }
        if (pick.includes(6)) s -= 6; else if (pick.includes(5)) s -= 5;
        if (!best || s < best.s) best = { s, pick: pick.slice() };
        return;
      }
      for (let i = start; i < days.length; i++) { pick.push(days[i]); rec(i + 1, pick); pick.pop(); }
    };
    rec(0, []);
    return best.pick;
  }

  // Monta a semana-modelo: o que vai em cada dia (0 = segunda ... 6 = domingo).
  // runKinds: { dia: 'I'|'T'|'E'|'X'|'L' }. Devolve sched: { dia: [sessões que não são corrida] } e as que não couberam.
  function weekTemplate(days, counts, focus, runKinds, sports) {
    const HARD_RUN = { I: 1, T: 1, L: 1 };
    const sched = {}; days.forEach(d => { sched[d] = []; });
    const list = [];
    Object.keys(counts).forEach(k => {
      if (k === 'run' || !counts[k]) return;
      if (k === 'gym') {
        GYM_LETTERS.slice(0, counts[k]).forEach((L, i) => list.push({ k, letter: L, hard: L === 'A' || L === 'C', legs: L === 'A' || L === 'C', focus: !!focus[k], i }));
        return;
      }
      const pat = (PATTERN[k] || [])[counts[k]] || Array.from({ length: counts[k] }, (_, i) => i % 2);
      const name = k === 'other' ? (sports.find(s => s.k === 'other') || {}).name : '';
      const lib = k === 'other' ? otherSess(name) : SESS[k];
      pat.forEach((v, i) => { const s = lib[Math.min(v, lib.length - 1)]; list.push({ k, v, hard: !!s.hard, legs: !!s.legs, long: !!s.long, focus: !!focus[k], i, name }); });
    });
    // Ordem: transição, depois as fortes (foco antes), depois o resto; mobilidade por último.
    const pri = s => (s.k === 'brick' ? 0 : s.k === 'mobility' ? 50 : 10) + (s.hard ? 0 : 20) + (s.focus ? 0 : 5);
    list.sort((a, b) => pri(a) - pri(b) || a.i - b.i);
    const isHardDay = d => !!(HARD_RUN[runKinds[d]] || (sched[d] || []).some(x => x.hard));
    const dropped = [];
    list.forEach(s => {
      let best = null;
      days.forEach(d => {
        const S = sched[d], run = runKinds[d];
        const n = S.length + (run ? 1 : 0);
        if (n >= 2 || S.some(x => x.k === s.k)) return;
        if (s.k === 'brick' && run) return;
        let cost = s.k === 'mobility' ? n * 6 : n * 30;
        if (s.hard && isHardDay(d)) cost += 40;
        [(d + 6) % 7, (d + 1) % 7].forEach(nb => {
          if (s.hard && isHardDay(nb)) cost += 12;
          if ((sched[nb] || []).some(x => x.k === s.k)) cost += 8;
        });
        if (s.legs && (runKinds[(d + 1) % 7] === 'I' || runKinds[(d + 1) % 7] === 'L')) cost += 15;
        if (s.legs && run && HARD_RUN[run]) cost += 10;
        if (run === 'L') cost += 15;
        if (s.long && (d === 5 || d === 6)) cost -= 10;
        if (!best || cost < best.cost || (cost === best.cost && d < best.d)) best = { d, cost };
      });
      if (best) sched[best.d].push(s); else dropped.push(s.k);
    });
    return { sched, dropped };
  }
  function weekCountsText(wc, sports) {
    const name = k => k === 'run' ? ['corrida', 'corridas'] : k === 'swim' ? ['natação', 'natações'] : k === 'bike' ? ['bike', 'bikes'] : k === 'gym' ? ['musculação', 'musculações'] : k === 'brick' ? ['transição', 'transições'] : k === 'mobility' ? ['mobilidade', 'mobilidades'] : k === 'other' ? [((sports.find(s => s.k === 'other') || {}).name || 'outra').toLowerCase(), ((sports.find(s => s.k === 'other') || {}).name || 'outras').toLowerCase()] : [SPORTS[k].label, SPORTS[k].label];
    const order = ['run', 'swim', 'bike', 'brick', 'hyrox', 'crossfit', 'gym', 'other', 'mobility'];
    const parts = order.filter(k => wc[k]).map(k => `${wc[k]} ${name(k)[wc[k] > 1 ? 1 : 0]}`);
    return parts.length ? `Nesta semana: ${parts.join(' · ')}.` : '';
  }
  const phaseKey = ph => ph === 'Base' ? 'base' : ph === 'Construção' ? 'build' : ph === 'Específica' ? 'spec' : 'light';
  function sessText(s, pk, w) {
    if (s.k === 'gym') return `💪 **Musculação ${s.letter}**`;
    const lib = s.k === 'other' ? otherSess(s.name) : SESS[s.k];
    const v = lib[Math.min(s.v, lib.length - 1)];
    return v.t[pk](w);
  }


  /* --- Texto do plano híbrido --- */
  const listPt = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`;
  const RUN_KIND = { I: 'Corrida — intervalado', T: 'Corrida — limiar', E: 'Corrida — leve + strides', X: 'Corrida — leve', L: 'Corrida — longo' };
  const SESS_NAME = {
    swim: ['Natação — séries fortes', 'Natação — contínuo leve', 'Natação — aeróbio longo'],
    bike: ['Bike — intervalado', 'Bike — giro leve', 'Bike — longo'],
    hyrox: ['Hyrox — corrida + estações', 'Hyrox — força das estações', 'Hyrox — motor aeróbio'],
    crossfit: ['Crossfit — WOD', 'Crossfit — força e olímpico', 'Crossfit — engine'],
    mobility: ['Mobilidade', 'Mobilidade'],
    brick: ['Transição bike + corrida']
  };
  const sessName = s => s.k === 'gym' ? `Musculação ${s.letter}` : s.k === 'other' ? `${s.name} ${s.hard ? 'forte' : 'leve'}` : SESS_NAME[s.k][Math.min(s.v, SESS_NAME[s.k].length - 1)];
  function hybridMd(x) {
    const { o, sports, event, runEvent, HC, TPL, chosen, runDays, weeks, curV, goalV, predicted, testWeek, gymOn, runKindsAt } = x;
    const ev = sports.find(s => s.k === event);
    const evName = event === 'goal' ? 'Dia da meta' : SPORTS[event].event;
    const perWeek = {};
    Object.values(TPL.sched).forEach(S => S.forEach(s => { perWeek[s.k] = (perWeek[s.k] || 0) + 1; }));
    perWeek.run = runDays;
    const n = k => perWeek[k] || 0;
    const rowFor = s => {
      let goal = s.goal;
      if (s.k === 'run' && !goal && runEvent) goal = `${km(o.distanceKm)} km em ${fmtTime(o.goalSec)}`;
      const pw = s.k === 'tri' ? [n('swim') && `${n('swim')} natação`, n('bike') && `${n('bike')} bike`, n('run') && `${n('run')} corrida`, n('brick') && `${n('brick')} transição`].filter(Boolean).join(' + ') || '—'
        : s.k === 'other' ? String(n('other')) : String(n(s.k));
      return `| ${s.label} | ${s.focus ? 'Foco' : 'Complementar'}${s.k === event ? ' · prova principal' : ''} | ${(goal || '—').replace(/\|/g, '/')} | ${pw} |`;
    };
    const left = [...new Set(HC.dropped.concat(TPL.dropped))].map(k => k === 'brick' ? 'transição' : k === 'other' ? ((sports.find(s => s.k === 'other') || {}).name || 'outra') : SPORTS[k].label.toLowerCase());
    const tplRows = chosen.map(d => {
      const S = TPL.sched[d] || [];
      const a = [runKindsAt[d] ? RUN_KIND[runKindsAt[d]] : null, ...S.map(sessName)].filter(Boolean);
      return `| ${WDL[(d + 1) % 7]} | ${a[0] || 'Descanso'} | ${a[1] || '—'} |`;
    });
    const restDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !chosen.includes(d)).map(d => WDL[(d + 1) % 7]);
    const focusNames = sports.filter(s => s.focus).map(s => s.label.toLowerCase());
    const P0 = paces(curV), PG = paces(goalV);
    const raceLine = runEvent
      ? `**Prova:** ${WDL[D(o.race).getUTCDay()]}, ${dmy(o.race)} · **Meta:** ${km(o.distanceKm)} km em menos de ${fmtTime(o.goalSec)}`
      : `**Prova:** ${WDL[D(o.race).getUTCDay()]}, ${dmy(o.race)} · **Objetivo:** ${evName}${ev && ev.goal ? ' — ' + ev.goal : ''}`;
    return `# Plano Híbrido — ${listPt(sports.map(s => s.label))}
${raceLine}
**Prova principal:** ${event === 'goal' ? 'Meta' : SPORTS[event].label}
**Período:** ${dmy(o.start)} a ${dmy(o.race)} · gerado pelo PacePro

## Modalidades e metas

| Modalidade | Prioridade | Meta | Por semana |
|---|---|---|---|
${sports.map(rowFor).join('\n')}

## Resumo

- **Dias de treino:** ${chosen.length} por semana (${chosen.map(d => WDL[(d + 1) % 7]).join(', ')})${restDays.length ? `; descanso ${listPt(restDays)}` : ''}. Até 2 treinos no mesmo dia quando precisa, e os treinos fortes ficam em dias separados sempre que dá.
- **Foco:** ${listPt(focusNames)}. As modalidades de foco ganham mais sessões e os treinos mais importantes; as complementares mantêm a forma sem roubar recuperação.
- **${evName}:** ${WDL[D(o.race).getUTCDay()]}, ${dmy(o.race)}. A última semana é de polimento: tudo fica mais curto e leve.
- **Fases:** base, construção e específica, com uma semana leve a cada 4.
${runDays ? `- **Corrida:** VDOT ${curV.toFixed(1).replace('.', ',')} hoje${runEvent ? `, que prevê ${fmtTime(predicted)} nos ${km(o.distanceKm)} km; meta VDOT ${goalV.toFixed(1).replace('.', ',')}` : ''}. Cerca de 80% do volume é leve.\n` : ''}${testWeek ? `- **Teste de corrida:** no fim de semana da semana ${testWeek}. Se o resultado vier diferente do previsto, gere o plano de novo a partir dele.\n` : ''}${left.length ? `- **Não coube nos dias escolhidos:** ${listPt(left)}. Adicione um dia de treino para incluir.\n` : ''}
### Rotina-modelo da semana

| Dia | Treino 1 | Treino 2 |
|---|---|---|
${tplRows.join('\n')}
${runDays ? `
| Ritmo | Hoje | Na meta |
|---|---|---|
| Leve | ${fmtPace(P0.easyFast)}–${fmtPace(P0.easySlow)}/km | ${fmtPace(PG.easyFast)}–${fmtPace(PG.easySlow)}/km |
| Limiar | ${fmtPace(P0.threshold)}/km | ${fmtPace(PG.threshold)}/km |
| Intervalado | ${fmtPace(P0.interval)}/km | ${fmtPace(PG.interval)}/km |
` : ''}
Todo treino tem aquecimento de 10' e desaquecimento de 5–10'. "L" = leve. Em dia com 2 treinos, faça o principal primeiro ou separe por algumas horas.

## Cronograma

${weeks.join('\n\n')}

${gymOn ? GYM_MD : ''}`;
  }

  /* --- Gerador --- */
  function generate(o) {
    // Plano híbrido: o.sports = [{ k, focus, goal, name }], o.event = modalidade da prova principal.
    const sports = Array.isArray(o.sports) ? normSports(o.sports) : null;
    const hybrid = !!(sports && sports.length);
    const hasRun = !hybrid || sports.some(s => s.k === 'run' || s.k === 'tri');
    const canEvent = k => !!(SPORTS[k] && SPORTS[k].event) && (k !== 'run' || hasRun);
    const event = !hybrid ? 'run'
      : sports.some(s => s.k === o.event) && canEvent(o.event) ? o.event
      : ((sports.find(s => s.focus && canEvent(s.k)) || sports.find(s => canEvent(s.k)) || {}).k || 'goal');
    const runEvent = event === 'run';
    if (!runEvent) {
      // Sem prova de corrida: os ritmos vêm do tempo atual nos 5 km e a meta de corrida é melhorar um pouco.
      const cur5 = o.currentSec5k || (o.level === 'iniciante' ? 2100 : 1800);
      o = { ...o, distanceKm: 5, goalSec: Math.round(cur5 * 0.97 / 5) * 5, currentSec5k: cur5 };
    }
    const meters = o.distanceKm * 1000;
    const goalV = vdotFrom(meters, o.goalSec);
    const curSec5 = o.currentSec5k || o.goalSec * (5 / o.distanceKm) * 1.18;
    let curV = vdotFrom(5000, curSec5);
    if (o.level === 'pausa') curV *= 0.97;
    let chosen = [...new Set((o.trainWeekdays || o.runWeekdays || []).map(Number).filter(d => d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (hybrid && (chosen.length < 2 || chosen.length > 6)) chosen = [0, 2, 4, 6];
    // Semana híbrida: quantas sessões de cada modalidade e em quais dias.
    const HC = hybrid ? weeklyCounts(sports, chosen.length, o.level) : null;
    const runPick = hybrid ? pickRunDays(chosen, HC.counts.run || 0) : null;
    const custom = !hybrid && chosen.length >= 2 && chosen.length <= 6;
    const runDays = hybrid ? runPick.length : custom ? chosen.length : Math.min(5, Math.max(3, o.runDays || 4));
    const beginner = o.level === 'iniciante', returning = o.level === 'pausa';

    // semanas de segunda a domingo; a primeira pode começar no meio
    const startDow = D(o.start).getUTCDay();
    const firstMon = add(o.start, -((startDow + 6) % 7));
    const nWeeks = Math.max(1, Math.ceil((D(o.race) - D(firstMon) + DAY) / (7 * DAY)));
    const taper = nWeeks; // última semana
    const runFocus = hybrid && sports.some(s => (s.k === 'run' || s.k === 'tri') && s.focus);
    const testWeek = nWeeks >= 5 && (!hybrid || (runDays >= 2 && (runEvent || runFocus))) ? Math.round(nWeeks / 2) + (nWeeks % 2 ? 0 : 0) : null;
    const deload = w => w % 4 === 0 && w < nWeeks - 1 && w !== testWeek && w !== (testWeek || 0) + 1;
    const phaseOf = w => {
      if (w === taper) return 'Polimento e prova';
      if (w === testWeek) return 'Semana do teste';
      if (deload(w)) return 'Semana leve';
      const r = (w - 1) / Math.max(1, nWeeks - 1);
      return r < 0.34 ? 'Base' : r < 0.7 ? 'Construção' : 'Específica';
    };

    // VDOT de treino: sobe no máximo 0,8 por semana em direção à meta
    const trainV = w => Math.min(goalV, curV + Math.min(goalV - curV, 0.8 * (w - 1)) * (goalV > curV ? 1 : 0));
    const goalPace = o.goalSec / o.distanceKm;

    // volume
    const longCap = { 5: 70, 10: 85, 21.1: 120, 42.2: 180 }[o.distanceKm] || 90;
    const long0 = beginner ? 35 : o.distanceKm >= 21 ? 60 : 45;
    const easy0 = beginner ? 20 : 25;
    const scale = w => (returning && w === 1 ? 0.75 : deload(w) ? 0.8 : 1);

    // dias da semana por número de corridas (0 = segunda ... 6 = domingo)
    const layout = hybrid ? (runDays >= 2 ? layoutFor(runPick) : { I: null, T: null, E: null, X: [], L: runDays ? runPick[0] : null, swim: [] })
      : custom ? layoutFor(chosen)
      : runDays === 3 ? { I: 1, T: 3, E: null, X: [], L: 6, swim: [0, 4] }
      : runDays === 4 ? { I: 0, T: 2, E: 4, X: [], L: 6, swim: [1, 3] }
      : { I: 0, T: 2, E: 4, X: [1], L: 6, swim: [3] };

    // Outras atividades escolhidas (natação, bike, mobilidade ou outra que a pessoa escrever).
    const CROSS = CROSS_TEXT;
    const cross = (hybrid ? [] : (o.cross || (o.swim ? ['swim'] : []))).map(c => {
      if (typeof c === 'string' && CROSS[c]) return { ...CROSS[c], k: c };
      const name = String((c && c.name) || c || '').trim().slice(0, 40);
      return name ? { k: 'other', label: name, ico: '🔸', leve: `${name} leve, 30 min`, moderada: `${name} leve a moderado, 30–45 min` } : null;
    }).filter(Boolean);
    const crossText = (c, lvl, short) => !c ? 'Descanso' : `${c.ico} ${short ? c.leve.split(',')[0] + ', 30 min' : c[lvl]}`;

    const gymOn = hybrid ? !!HC.counts.gym : !!o.gym;
    const runKindsAt = {};
    if (layout.I != null) runKindsAt[layout.I] = 'I'; if (layout.T != null) runKindsAt[layout.T] = 'T'; if (layout.E != null) runKindsAt[layout.E] = 'E'; layout.X.forEach(d => { runKindsAt[d] = 'X'; }); if (layout.L != null) runKindsAt[layout.L] = 'L';
    const TPL = hybrid ? weekTemplate(chosen, HC.counts, HC.focus, runKindsAt, sports) : null;
    const gymFor = (dow, kinds) => {
      if (hybrid || !o.gym || dow > 4) return null;
      if (kinds[dow] === 'I') return 'A';
      if (kinds[dow] === 'T') return 'C';
      const others = [0, 1, 2, 3, 4].filter(d => kinds[d] !== 'I' && kinds[d] !== 'T');
      const idx = others.indexOf(dow);
      return ['B', 'D', 'E'][idx] || 'E';
    };
    const gymNote = w => {
      const p = phaseOf(w);
      if (p === 'Polimento e prova') return 'Musculação: só manutenção leve, 2 séries, nada até a falha. Nada de perna nos 3 dias antes da prova.';
      if (p === 'Semana do teste' || p === 'Semana leve') return 'Musculação: 2 séries de 10, carga moderada (sobrando 3 reps). Sem saltos.';
      if (w === 1 && (returning || beginner)) return 'Musculação: 2 séries de 12, carga leve (sobrando 4 reps). Sem saltos.';
      if (p === 'Base') return 'Musculação: 3 × 12, carga moderada (sobrando 3 reps).';
      if (p === 'Construção') return 'Musculação: 3 × 8, carga mais pesada (sobrando 2 reps). Saltos na C.';
      return 'Musculação: 3 × 6 com movimento explosivo (sobrando 2 reps). Saltos na C.';
    };

    // repetições específicas por distância de prova
    const specRep = { 5: [600, 800, 1000], 10: [1000, 1600, 2000], 21.1: [2000, 3000, 3000], 42.2: [3000, 5000, 5000] }[o.distanceKm] || [1000, 1600, 2000];
    const testDist = o.distanceKm <= 10 ? o.distanceKm : 10;

    const lines = [];
    const weeks = [];
    let specIdx = 0;
    for (let w = 1; w <= nWeeks; w++) {
      const mon = add(firstMon, (w - 1) * 7);
      const sun = add(mon, 6);
      const ph = phaseOf(w);
      const V = trainV(w);
      const P = paces(V);
      const sc = scale(w);
      const easyMin = Math.round(Math.min(40, easy0 + (w - 1) * 2) * sc / 5) * 5;
      const longMin = Math.round(Math.min(longCap, long0 + (w - 1) * 5) * sc / 5) * 5;
      const kinds = {}, wc = {};
      Object.assign(kinds, runKindsAt);
      // Outras atividades nos dias sem corrida, revezando quando houver mais atividades que dias.
      const free = layout.swim.filter(d => !kinds[d]);
      const crossOf = {};
      if (cross.length) free.forEach((d, i) => { kinds[d] = 'S'; crossOf[d] = cross[(i + (cross.length > free.length ? (w - 1) * free.length : 0)) % cross.length]; });

      const rows = [];
      for (let d = 0; d < 7; d++) {
        const date = add(mon, d);
        if (date < o.start || date > o.race) continue;
        const dow = (d + 1) % 7;
        const label = `${WD[dow]} ${dm(date)}`;
        let k = kinds[d] || 'R';
        let rua = '', est = '', key = false;
        const easyEst = `${kmh(P.easySlow)}–${kmh(P.easyFast)}`;

        if (date === o.race && !runEvent) {
          const ev = sports.find(s => s.k === event);
          rua = `🏅 **${event === 'goal' ? 'Dia da meta' : SPORTS[event].event}**${ev && ev.goal ? ` — objetivo: ${ev.goal}` : ''}`; key = true; k = 'race';
        } else if (date === o.race) {
          rua = `🏆 **PROVA ${km(o.distanceKm)} km** — meta ${fmtTime(o.goalSec)} (${fmtPace(goalPace)}/km)`; key = true; k = 'race';
        } else if (w === taper) {
          // polimento: intervalado curto no ritmo de prova, leves curtos
          const daysToRace = (D(o.race) - D(date)) / DAY;
          if (k === 'I' && daysToRace >= 5) { rua = `10' L + **3 × 800 m a ${fmtPace(goalPace)}/km**, pausa 2'30" + 5' L`; est = `3 × 800 m a **${kmh(goalPace)} km/h**`; key = true; }
          else if ((k === 'T' || k === 'E' || k === 'X') && daysToRace >= 2) { rua = `**${daysToRace <= 3 ? 15 : 25}' L + ${daysToRace <= 3 ? 3 : 4} strides**`; est = `${easyEst} + strides a ${kmh(P.rep)}`; key = true; }
          else if (k === 'S' && daysToRace >= 4) rua = crossText(crossOf[d], 'leve', true);
          else rua = daysToRace <= 1 ? 'Descanso. Separe kit, número e tênis.' : 'Descanso';
        } else if (k === 'I') {
          key = true;
          if (returning && w === 1) { rua = `10' L + **6 × 1' a ${fmtPace(P.threshold)}/km**, pausa 2' caminhando + 5' L`; est = `6 × 1' a **${kmh(P.threshold)} km/h**`; }
          else if (ph === 'Semana do teste' || ph === 'Semana leve') { rua = `10' L + **5 × 400 m a ${fmtPace(P.interval)}/km**, pausa 1'30" + 5' L`; est = `5 × 400 m a **${kmh(P.interval)} km/h**`; }
          else if (ph === 'Base') { const n = Math.min(8, 5 + (w - 1)); rua = `10' L + **${n} × 400 m a ${fmtPace(P.interval)}/km**, pausa 1'30" + 3' caminhando + **4 × 200 m a ${fmtPace(Math.min(goalPace, P.rep))}/km**, pausa 1'30"`; est = `${n} × 400 m a **${kmh(P.interval)}** + 4 × 200 m a **${kmh(Math.min(goalPace, P.rep))}**`; }
          else if (ph === 'Construção') { const n = Math.min(6, 4 + ((w - 1) % 3)); rua = `10' L + **${n} × 800 m a ${fmtPace(P.interval)}/km**, pausa 2' + **4 × 200 m a ${fmtPace(Math.min(goalPace, P.rep))}/km**, pausa 1'30"`; est = `${n} × 800 m a **${kmh(P.interval)}** + 4 × 200 m a **${kmh(Math.min(goalPace, P.rep))}**`; }
          else { const rd = specRep[Math.min(specRep.length - 1, specIdx++)]; const n = Math.max(3, Math.round((o.distanceKm <= 10 ? 3000 : o.distanceKm * 400) / rd)); rua = `10' L + **${n} × ${rd >= 1000 ? km(rd / 1000) + ' km' : rd + ' m'} a ${fmtPace(goalPace)}/km**, pausa 2'30"`; est = `${n} × ${rd >= 1000 ? km(rd / 1000) + ' km' : rd + ' m'} a **${kmh(goalPace)} km/h**`; }
        } else if (k === 'T') {
          key = true;
          if (ph === 'Semana do teste') { rua = `10' L + **15' a ${fmtPace(P.threshold)}/km** + 5' L`; est = `15' a **${kmh(P.threshold)} km/h**`; }
          else if (ph === 'Semana leve' || (returning && w === 1)) { rua = `10' L + **2 × 8' a ${fmtPace(P.threshold)}/km**, pausa 2' + 5' L`; est = `2 × 8' a **${kmh(P.threshold)} km/h**`; }
          else if (ph === 'Base') { const m = Math.min(20, 15 + (w - 1) * 2.5); rua = `10' L + **${Math.round(m)}' a ${fmtPace(P.threshold)}/km** + 5' L`; est = `${Math.round(m)}' a **${kmh(P.threshold)} km/h**`; }
          else if (ph === 'Construção') { rua = `10' L + **3 × 8' a ${fmtPace(P.threshold)}/km**, pausa 2' + 5' L`; est = `3 × 8' a **${kmh(P.threshold)} km/h**`; }
          else { rua = `10' L + **2 × 12' a ${fmtPace(P.threshold)}/km**, pausa 2' + 5' L`; est = `2 × 12' a **${kmh(P.threshold)} km/h**`; }
        } else if (k === 'E') {
          key = true; const s = ph === 'Semana do teste' ? 4 : 6; const m = ph === 'Semana do teste' ? 20 : easyMin;
          rua = `**${m}' L + ${s} strides**`; est = `${m}' a ${easyEst} + ${s} × 20" a ${kmh(P.rep)}`;
        } else if (k === 'X') {
          key = true; rua = `**${Math.max(20, easyMin - 5)}' L**`; est = easyEst;
        } else if (k === 'L') {
          key = true;
          if (ph === 'Semana do teste') { rua = `🏁 **TESTE ${km(testDist)} km** — progressivo, km 1 levemente mais lento e o último o mais rápido`; est = 'De preferência na rua'; }
          else { rua = `**${longMin}' L** (FC ≤ 145)`; est = easyEst; }
        } else if (k === 'S') rua = crossText(crossOf[d], ph === 'Semana do teste' || ph === 'Semana leve' ? 'leve' : 'moderada');
        else rua = 'Descanso';

        let g = null;
        if (k !== 'race' && !(w === taper && (D(o.race) - D(date)) / DAY <= 3)) g = gymFor(d, kinds);
        if (w === taper && g && (D(o.race) - D(date)) / DAY <= 3) g = null;
        let gymCell = g ? `**${g}**` : '—';
        if (hybrid) {
          // Outras modalidades do dia: no máximo 2 treinos; a corrida fica na coluna principal.
          const toRace = (D(o.race) - D(date)) / DAY;
          let S = date === o.race ? [] : (TPL.sched[d] || []).slice();
          if (w === taper) S = S.filter(s => toRace >= (s.hard ? 4 : 2) && !(s.k === 'gym' && toRace <= 3));
          const pk = w === taper ? 'light' : phaseKey(ph);
          const gymS = S.find(s => s.k === 'gym'), texts = S.filter(s => s.k !== 'gym').map(s => sessText(s, pk, w));
          const runOn = k !== 'race' && rua && !/^Descanso/.test(rua);
          let second = null;
          if (k === 'race') { /* dia da prova: só a prova */ }
          else if (runOn) second = texts[0] || null;
          else if (gymS && S.every(s => s.k === 'gym' || s.k === 'mobility')) { rua = sessText(gymS); second = texts[0] || null; est = ''; }
          else { rua = texts[0] || (gymS ? sessText(gymS) : rua || 'Descanso'); second = texts[1] || null; est = ''; }
          if (runOn) wc.run = (wc.run || 0) + 1;
          S.forEach(s => { wc[s.k] = (wc[s.k] || 0) + 1; });
          // Musculação como treino principal: a letra já vai na coluna principal e a 4ª fica para o 2º treino.
          gymCell = gymS && !/Musculação/.test(rua) ? `**${gymS.letter}**` : second || '—';
        }
        rows.push(`| ${key ? `**${label}**` : label} | ${rua} | ${est} | ${gymCell} |`);
      }
      if (!rows.length) continue;
      const a0 = mon < o.start ? o.start : mon, b0 = sun > o.race ? o.race : sun;
      const hNote = hybrid ? weekCountsText(wc, sports) : '';
      const note = [hNote, gymOn ? gymNote(w) : ''].filter(Boolean).join(' ');
      weeks.push(`### Semana ${weeks.length + 1} — ${ph} (${a0.slice(5, 7) === b0.slice(5, 7) ? a0.slice(8, 10) : dm(a0)} a ${dm(b0)})
${note ? `*${note}*\n` : ''}
| Data | ${hybrid ? 'Treino principal' : (cross.length ? 'Corrida / outras atividades' : 'Corrida') + ' (rua)'} | Esteira | ${hybrid ? '2º treino' : 'Musculação'} |
|---|---|---|---|
${rows.join('\n')}`);
    }

    const predicted = raceTime(curV, meters);
    if (hybrid) return hybridMd({ o, sports, event, runEvent, HC, TPL, chosen, runDays, weeks, curV, goalV, predicted, testWeek, gymOn, runKindsAt });
    const gap = goalV - curV;
    const realism = gap <= 0 ? 'Sua forma atual já indica a meta. O plano foca em manter e chegar descansado.'
      : gap <= nWeeks * 0.5 ? 'A meta é ambiciosa, mas possível no prazo com consistência.'
      : 'A meta está além do que costuma ser possível nesse prazo. Os treinos continuam mirando nela; o teste do meio do ciclo vai mostrar a largada certa.';
    const P0 = paces(curV), PG = paces(goalV);

    return `# Plano de Treino ${km(o.distanceKm)} km — ${fmtTime(o.goalSec)}
**Prova:** ${WDL[D(o.race).getUTCDay()]}, ${dmy(o.race)} · **Meta:** ${km(o.distanceKm)} km em menos de ${fmtTime(o.goalSec)}
**Período:** ${dmy(o.start)} a ${dmy(o.race)} · gerado pelo PacePro

## Resumo

- **Forma atual:** VDOT ${curV.toFixed(1).replace('.', ',')}, que prevê ${fmtTime(predicted)} nos ${km(o.distanceKm)} km.
- **Meta:** VDOT ${goalV.toFixed(1).replace('.', ',')} (${fmtPace(goalPace)}/km).
- ${realism}
- **Estrutura:** ${runDays} corridas por semana${custom ? ' (' + chosen.map(d => WDL[(d + 1) % 7]).join(', ') + ')' : ''}${cross.length ? ', ' + cross.map(c => c.label.toLowerCase()).join(', ') + ' nos dias sem corrida' : ''}${o.gym ? ', musculação de segunda a sexta' : ''}. Cerca de 80% do volume é leve (FC até ~145). Ritmos dos treinos fortes sobem até 0,8 VDOT por semana em direção à meta.
${testWeek ? `- **Teste:** no domingo da semana ${testWeek}. Se o resultado vier diferente do previsto, gere o plano de novo a partir dele.\n` : ''}
| Ritmo | Hoje | Na meta |
|---|---|---|
| Leve | ${fmtPace(P0.easyFast)}–${fmtPace(P0.easySlow)}/km | ${fmtPace(PG.easyFast)}–${fmtPace(PG.easySlow)}/km |
| Limiar | ${fmtPace(P0.threshold)}/km | ${fmtPace(PG.threshold)}/km |
| Intervalado | ${fmtPace(P0.interval)}/km | ${fmtPace(PG.interval)}/km |
| Ritmo de prova | ${fmtPace(predicted / o.distanceKm)}/km | ${fmtPace(goalPace)}/km |

Todo treino tem aquecimento de 10' leve e desaquecimento de 5–10'. Na esteira, use inclinação 1%. "L" = leve.

## Cronograma

${weeks.join('\n\n')}

${o.gym ? GYM_MD : ''}`;
  }

  const api = { generate, layoutFor, vdotFrom, raceTime, paces, GYM_MD, CROSS_TEXT, SPORTS, normSports, weeklyCounts, pickRunDays, weekTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis);
