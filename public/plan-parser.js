/* Lê um plano de treino em Markdown e devolve dias, semanas, sessões de musculação e dados da prova.
   Formato esperado (o mesmo do plano_5km_sub30_13dez):
   - Linha com "Prova:" e uma data dd/mm/aaaa
   - Linha com "Meta:" e um tempo mm:ss
   - Títulos "### Semana N — Nome (...)" seguidos de tabelas cuja 1ª coluna é "Seg 09/11", "Ter 10/11"...
   - Colunas: Data | Corrida (rua) | Esteira | Musculação
   - Sessões de musculação em títulos "### 💪 A — Nome" com uma tabela logo abaixo */
(function (root) {
  const DOW = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, 'sáb': 6, sab: 6, dom: 0 };

  const clean = s => (s || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const pad = n => String(n).padStart(2, '0');

  function paceToSec(str) {
    const m = /(\d{1,2})'(\d{2})"?\s*\/\s*km/.exec(str || '');
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  function classify(rua, isKeyCell) {
    const t = clean(rua).toLowerCase();
    if (!t || t === '—' || t === '-') return 'rest';
    if (/^descanso/.test(t)) return 'rest';
    if (/nata[cç][aã]o|🏊/.test(t)) return 'swim';
    if (/🚴/.test(t) || /^(bike|bicicleta|pedal|ciclismo)\b/.test(t)) return 'bike';
    if (/🧘/.test(t) || /^(mobilidade|alongamento|yoga|pilates)\b/.test(t)) return 'mobility';
    if (/🔸/.test(t)) return 'cross';
    if (/descanso/.test(t)) return 'rest';
    if (/🏆/.test(t) || /^prova\b/.test(t)) return 'race';
    if (/🏁/.test(t) || /^teste\b/.test(t)) return 'test';
    if (/×|\bx\b/.test(t) && /\d+\s*m\b|\d+\s*km\b/.test(t) && !/strides?$/.test(t.replace(/\(.*?\)/g, '').trim()) && !/^\d+' l \+ \d+ strides/.test(t)) return 'interval';
    if (/×/.test(t) && /\d+'\s*a\s*\d/.test(t)) return 'threshold';
    if (/\d+'\s*a\s*\d'\d{2}"/.test(t)) return 'threshold';
    return 'easy';
  }

  // Título curto: os trechos em negrito da célula de corrida (ou o texto até a primeira vírgula).
  function shortTitle(rua) {
    const bold = (rua.match(/\*\*([^*]+)\*\*/g) || []).map(b => clean(b)).filter(b => b.length > 1);
    let t = bold.length ? bold.join(' + ') : clean(rua).split(/[,.(]/)[0];
    t = t.replace(/^[🏊🏁🏆🚴🧘🔸]\s*/u, '').replace(/[🏊🏁🏆🚴🧘🔸]/gu, '').trim();
    t = t.replace(/(\d+)'\s*L\b/g, "$1' leve");
    return t.length > 70 ? t.slice(0, 67).trim() + '…' : t;
  }

  function parse(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    const out = { title: '', race: null, goalSec: null, distanceKm: 5, weeks: [], days: [], gym: {}, raw: md };

    const h1 = lines.find(l => /^#\s+/.test(l));
    out.title = h1 ? clean(h1.replace(/^#\s+/, '')) : 'Plano de treino';

    const raceLine = lines.find(l => /prova/i.test(l) && /\d{2}\/\d{2}\/\d{4}/.test(l));
    if (raceLine) {
      const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(raceLine);
      out.race = `${m[3]}-${m[2]}-${m[1]}`;
    }
    const metaLine = lines.find(l => /meta/i.test(l) && /\d{1,2}:\d{2}/.test(l));
    if (metaLine) {
      const m = /(\d{1,2}):(\d{2})/.exec(metaLine);
      out.goalSec = (+m[1]) * 60 + (+m[2]);
      const d = /(\d+(?:[.,]\d+)?)\s*km/i.exec(metaLine);
      if (d) out.distanceKm = parseFloat(d[1].replace(',', '.'));
    }
    const baseYear = out.race ? +out.race.slice(0, 4) : new Date().getFullYear();
    const raceMonth = out.race ? +out.race.slice(5, 7) : 12;

    let week = null, gymKey = null, gymRows = null, pendingNote = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const wk = /^#{2,4}\s+Semana\s+(\d+)\s*[—–-]?\s*([^(]*)(?:\((.*?)\))?/i.exec(line);
      if (wk) {
        week = { n: +wk[1], title: clean(wk[2]) || `Semana ${wk[1]}`, range: clean(wk[3] || ''), note: '', days: [] };
        out.weeks.push(week); gymKey = null; continue;
      }
      const g = /^#{2,4}\s+(?:💪\s*)?([A-E])\s*[—–-]\s*(.+)$/.exec(line);
      if (g) { gymKey = g[1]; out.gym[gymKey] = { key: gymKey, name: clean(g[2]), rows: [], note: '' }; gymRows = out.gym[gymKey].rows; continue; }
      if (/^#{1,4}\s/.test(line)) { gymKey = null; if (!/semana/i.test(line)) week = week && /^#{4}/.test(line) ? week : (/^#{2}\s/.test(line) ? null : week); continue; }

      if (week && /^\*[^*].*\*$/.test(line.trim()) && !week.note) { week.note = clean(line); continue; }

      if (!line.trim().startsWith('|')) {
        if (gymKey && line.trim() && !out.gym[gymKey].rows.length) out.gym[gymKey].note += (out.gym[gymKey].note ? ' ' : '') + clean(line);
        continue;
      }
      const c = cells(line);
      if (c.every(x => /^:?-+:?$/.test(x))) continue;

      if (gymKey) {
        const head = c.map(x => clean(x).toLowerCase());
        if (head[0] === 'exercício' || head[0] === 'exercicio') { out.gym[gymKey].head = c.map(clean); continue; }
        gymRows.push(c.map(clean));
        continue;
      }

      const dm = /(seg|ter|qua|qui|sex|s[áa]b|dom)\w*\s+(\d{1,2})\/(\d{1,2})/i.exec(clean(c[0]));
      if (!dm || !week) continue;
      const day = +dm[2], mon = +dm[3];
      const year = mon > raceMonth ? baseYear - 1 : baseYear;
      const date = `${year}-${pad(mon)}-${pad(day)}`;
      const rua = c[1] || '', esteira = c[2] || '', musc = c[3] || '';
      const type = classify(rua);
      const gm = /\*\*([A-E])\b|^\s*([A-E])\b/.exec(musc);
      const gymLetter = gm ? (gm[1] || gm[2]) : null;
      const d = {
        date, week: week.n, key: /^\*\*/.test(c[0].trim()) || ['interval', 'threshold', 'test', 'race'].includes(type), type,
        title: shortTitle(rua),
        rua: clean(rua), esteira: clean(esteira),
        gym: gymLetter, gymText: clean(musc), targetPace: paceToSec(rua)
      };
      if (type === 'swim') d.title = ('Natação ' + clean(rua).replace(/🏊|nata[cç][aã]o/gi, '').trim()).trim();
      if (['bike', 'mobility', 'cross'].includes(type)) { const t = clean(rua).replace(/[🚴🧘🔸]/gu, '').trim(); d.title = t.charAt(0).toUpperCase() + t.slice(1); }
      if (type === 'rest') d.title = 'Descanso';
      week.days.push(d); out.days.push(d);
    }
    out.days.sort((a, b) => a.date.localeCompare(b.date));
    if (!out.race) { const r = out.days.find(d => d.type === 'race'); if (r) out.race = r.date; }
    return out;
  }

  const api = { parse, paceToSec, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
