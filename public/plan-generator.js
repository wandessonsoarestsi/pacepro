/* Gerador de plano de corrida por algoritmo (método VDOT de Jack Daniels).
   Entrada: { start, race (aaaa-mm-dd), distanceKm, goalSec, currentSec5k, runDays (3|4|5), swim, gym, level: 'normal'|'iniciante'|'pausa' }
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

  /* --- Gerador --- */
  function generate(o) {
    const meters = o.distanceKm * 1000;
    const goalV = vdotFrom(meters, o.goalSec);
    const curSec5 = o.currentSec5k || o.goalSec * (5 / o.distanceKm) * 1.18;
    let curV = vdotFrom(5000, curSec5);
    if (o.level === 'pausa') curV *= 0.97;
    const runDays = Math.min(5, Math.max(3, o.runDays || 4));
    const beginner = o.level === 'iniciante', returning = o.level === 'pausa';

    // semanas de segunda a domingo; a primeira pode começar no meio
    const startDow = D(o.start).getUTCDay();
    const firstMon = add(o.start, -((startDow + 6) % 7));
    const nWeeks = Math.max(1, Math.ceil((D(o.race) - D(firstMon) + DAY) / (7 * DAY)));
    const taper = nWeeks; // última semana
    const testWeek = nWeeks >= 5 ? Math.round(nWeeks / 2) + (nWeeks % 2 ? 0 : 0) : null;
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
    const layout = runDays === 3 ? { I: 1, T: 3, E: null, X: null, L: 6, swim: [0, 4] }
      : runDays === 4 ? { I: 0, T: 2, E: 4, X: null, L: 6, swim: [1, 3] }
      : { I: 0, T: 2, E: 4, X: 1, L: 6, swim: [3] };

    // Outras atividades escolhidas (natação, bike, mobilidade ou outra que a pessoa escrever).
    const CROSS = CROSS_TEXT;
    const cross = (o.cross || (o.swim ? ['swim'] : [])).map(c => {
      if (typeof c === 'string' && CROSS[c]) return { ...CROSS[c], k: c };
      const name = String((c && c.name) || c || '').trim().slice(0, 40);
      return name ? { k: 'other', label: name, ico: '🔸', leve: `${name} leve, 30 min`, moderada: `${name} leve a moderado, 30–45 min` } : null;
    }).filter(Boolean);
    const crossText = (c, lvl, short) => !c ? 'Descanso' : `${c.ico} ${short ? c.leve.split(',')[0] + ', 30 min' : c[lvl]}`;

    const gymFor = (dow, kinds) => {
      if (!o.gym || dow > 4) return null;
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
      const kinds = {};
      kinds[layout.I] = 'I'; kinds[layout.T] = 'T'; if (layout.E != null) kinds[layout.E] = 'E'; if (layout.X != null) kinds[layout.X] = 'X'; kinds[layout.L] = 'L';
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

        if (date === o.race) {
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
        const gymCell = g ? `**${g}**` : '—';
        rows.push(`| ${key ? `**${label}**` : label} | ${rua} | ${est} | ${gymCell} |`);
      }
      if (!rows.length) continue;
      const a0 = mon < o.start ? o.start : mon, b0 = sun > o.race ? o.race : sun;
      weeks.push(`### Semana ${weeks.length + 1} — ${ph} (${a0.slice(5, 7) === b0.slice(5, 7) ? a0.slice(8, 10) : dm(a0)} a ${dm(b0)})
${o.gym ? `*${gymNote(w)}*\n` : ''}
| Data | ${cross.length ? 'Corrida / outras atividades' : 'Corrida'} (rua) | Esteira | Musculação |
|---|---|---|---|
${rows.join('\n')}`);
    }

    const predicted = raceTime(curV, meters);
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
- **Estrutura:** ${runDays} corridas por semana${cross.length ? ', ' + cross.map(c => c.label.toLowerCase()).join(', ') + ' nos dias sem corrida' : ''}${o.gym ? ', musculação de segunda a sexta' : ''}. Cerca de 80% do volume é leve (FC até ~145). Ritmos dos treinos fortes sobem até 0,8 VDOT por semana em direção à meta.
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

  const api = { generate, vdotFrom, raceTime, paces, GYM_MD, CROSS_TEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis);
