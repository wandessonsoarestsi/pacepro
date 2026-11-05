/* Mapa da corrida: acha os momentos marcantes, os tiros, onde o cansaço apareceu e a comparação
   com a última vez no mesmo percurso. Só cálculo, sem desenho. Funciona no navegador e no Node. */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const fmtPace = s => { s = Math.round(s); return `${Math.floor(s / 60)}'${pad(s % 60)}"`; };
  const kmTxt = m => (m / 1000).toFixed(1).replace('.', ',');
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  // Velocidade de cada ponto (m/s). Usa a do Strava ou calcula pela distância.
  function speeds(s) {
    if (s.v && s.v.length === s.n) return s.v.slice();
    return s.d.map((_, i) => { const a = Math.max(0, i - 1), b = Math.min(s.n - 1, i + 1); const dt = s.t[b] - s.t[a]; return dt > 0 ? (s.d[b] - s.d[a]) / dt : 0; });
  }
  // Média móvel por tempo: para cada ponto, média dos valores numa janela de w segundos ao redor.
  function rolling(s, arr, w) {
    const out = new Array(s.n); let a = 0, b = 0, sum = 0, cnt = 0;
    for (let i = 0; i < s.n; i++) {
      while (b < s.n && s.t[b] <= s.t[i] + w / 2) { if (arr[b] != null) { sum += arr[b]; cnt++; } b++; }
      while (s.t[a] < s.t[i] - w / 2) { if (arr[a] != null) { sum -= arr[a]; cnt--; } a++; }
      out[i] = cnt ? sum / cnt : null;
    }
    return out;
  }
  // Tempo (s) em que a corrida passou por uma distância (m), interpolando entre os pontos.
  function timeAt(s, dist) {
    const d = s.d; if (dist <= d[0]) return s.t[0]; if (dist >= d[s.n - 1]) return s.t[s.n - 1];
    let lo = 0, hi = s.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] < dist) lo = m; else hi = m; }
    const f = d[hi] > d[lo] ? (dist - d[lo]) / (d[hi] - d[lo]) : 0;
    return s.t[lo] + f * (s.t[hi] - s.t[lo]);
  }
  function indexAt(s, dist) { let i = 0; while (i < s.n - 1 && s.d[i] < dist) i++; return i; }

  function fastestKm(s) {
    const total = s.d[s.n - 1], out = [];
    for (let k = 1; k * 1000 <= total + 1; k++) out.push({ k, sec: timeAt(s, k * 1000) - timeAt(s, (k - 1) * 1000) });
    if (out.length < 2) return null;
    const best = out.reduce((a, b) => (b.sec < a.sec ? b : a));
    return { ...best, i0: indexAt(s, (best.k - 1) * 1000), i1: indexAt(s, best.k * 1000), all: out };
  }
  function peakSpeed(s, sp) {
    const r = rolling(s, sp, 20); let bi = -1, bv = 0;
    for (let i = 0; i < s.n; i++) if (r[i] != null && r[i] > bv && r[i] < 9) { bv = r[i]; bi = i; }
    return bi < 0 || bv < 1 ? null : { i: bi, v: bv, pace: 1000 / bv };
  }
  function maxHr(s) {
    if (!s.hr) return null; let bi = -1, bv = 0;
    for (let i = 0; i < s.n; i++) if (s.hr[i] > bv) { bv = s.hr[i]; bi = i; }
    return bi < 0 ? null : { i: bi, hr: bv };
  }
  // Maior subida contínua (tolera quedas de até 3 m no meio).
  function biggestClimb(s) {
    if (!s.alt) return null;
    const a = rolling(s, s.alt, 20); let start = 0, peak = 0, best = null;
    const close = () => {
      if (peak <= start) return;
      let i0 = start; for (let k = peak; k > start; k--) if (a[k] <= a[start] + 0.6) { i0 = k; break; } // início real da subida
      const g = a[peak] - a[i0]; if (!best || g > best.gain) best = { i0, i1: peak, gain: g, dist: s.d[peak] - s.d[i0] };
    };
    for (let i = 1; i < s.n; i++) {
      if (a[i] > a[peak]) peak = i;
      if (a[i] < a[peak] - 3 || i === s.n - 1) { close(); start = i; peak = i; }
      else if (a[i] < a[start]) { start = i; peak = i; }
    }
    if (!best || best.gain < 6 || best.dist < 60 || best.gain / best.dist < 0.015) return null;
    best.grade = best.gain / best.dist;
    return best;
  }

  // Tiros: pelas voltas do relógio; se não houver, pelos trechos rápidos do próprio percurso.
  function plannedReps(rua) {
    const out = []; let m;
    const re = /(\d+)\s*×\s*(\d+)\s*(m|km)\b(?:\s*a\s*(\d{1,2})'(\d{2}))?/g;
    while ((m = re.exec(rua || ''))) out.push({ n: +m[1], dist: (+m[2]) * (m[3] === 'km' ? 1000 : 1), pace: m[4] ? (+m[4]) * 60 + (+m[5]) : null });
    const rt = /(\d+)\s*×\s*(\d+)'(?:(\d{2})")?(?!\d)(?:\s*a\s*(\d{1,2})'(\d{2}))?/g;
    while ((m = rt.exec(rua || ''))) out.push({ n: +m[1], sec: (+m[2]) * 60 + (+m[3] || 0), pace: m[4] ? (+m[4]) * 60 + (+m[5]) : null });
    return out;
  }
  // Separa os tiros das pausas: corta no maior salto de ritmo, se ele for claro.
  function fastSide(list) {
    if (list.length < 3) return list;
    const ps = list.map(l => l.pace).sort((a, b) => a - b); let gi = -1, gv = 0;
    for (let i = 1; i < ps.length; i++) { const g = ps[i] / ps[i - 1] - 1; if (g > gv) { gv = g; gi = i; } }
    return gv >= 0.06 && gi >= 2 ? list.filter(l => l.pace < ps[gi]) : list;
  }
  function reps(s, sp, o) {
    let list = (s.laps || []).filter(l => l.dist >= 150 && l.dist <= 1600 && l.time > 0).map(l => ({ d0: l.d0, d1: l.d1, dist: l.dist, pace: l.time / (l.dist / 1000), hr: l.hr }));
    if (list.length >= 2) { const best = Math.min(...list.map(l => l.pace)); list = fastSide(list.filter(l => l.pace <= best * 1.35)); }
    if (list.length < 2) {
      // Sem voltas: trechos de pelo menos 40 s bem mais rápidos que o resto da corrida.
      const r = rolling(s, sp, 15), base = median(r.filter(x => x)), top = Math.max(...r.filter(x => x));
      const cut = base + (top - base) * 0.45; list = [];
      let i0 = -1;
      for (let i = 0; i <= s.n; i++) {
        const fast = i < s.n && r[i] && r[i] >= cut;
        if (fast && i0 < 0) i0 = i;
        if (!fast && i0 >= 0) { const dt = s.t[i - 1] - s.t[i0], dd = s.d[i - 1] - s.d[i0]; if (dt >= 40 && dd >= 150) list.push({ d0: s.d[i0], d1: s.d[i - 1], dist: dd, pace: dt / (dd / 1000), hr: null }); i0 = -1; }
      }
      if (top - base < 0.5) list = [];
    }
    if (list.length < 2) return [];
    const planned = plannedReps(o.rua);
    return list.map((l, k) => {
      const sec = l.pace * l.dist / 1000;
      const p = planned.find(pb => pb.dist ? Math.abs(pb.dist - l.dist) / pb.dist < 0.3 : Math.abs(pb.sec - sec) / pb.sec < 0.3);
      const tgt = p && p.pace ? p.pace : (planned.length <= 1 ? o.target : null);
      const diff = tgt ? l.pace - tgt : null;
      return { n: k + 1, ...l, i0: indexAt(s, l.d0), i1: indexAt(s, l.d1), target: tgt, tone: diff == null ? 'info' : diff <= 5 ? 'good' : diff <= 12 ? 'warn' : 'bad' };
    });
  }

  // "Aqui você cansou": o ponto a partir do qual o ritmo caiu (ou a FC subiu sem acelerar) até o fim.
  function fatigue(s, sp) {
    const T = s.t[s.n - 1] - s.t[0]; if (T < 18 * 60) return null;
    const v = rolling(s, sp, 180), h = s.hr ? rolling(s, s.hr, 180) : null;
    const eff = i => (h ? (h[i] ? v[i] / h[i] : null) : v[i]);
    const t0 = s.t[0] + 300, tb = s.t[0] + Math.max(600, T / 3), tEnd = s.t[s.n - 1] - 60;
    const base = mean(s.t.map((t, i) => (t >= t0 && t <= tb ? eff(i) : null)).filter(x => x));
    if (!base) return null;
    const drop = s.t.map((t, i) => { const e = eff(i); return e ? 1 - e / base : null; });
    for (let i = 0; i < s.n; i++) {
      if (s.t[i] <= tb || s.t[i] > tEnd - 240 || drop[i] == null || drop[i] < 0.06) continue;
      const rest = drop.slice(i).filter((x, k) => x != null && s.t[i + k] <= tEnd);
      if (rest.length < 3 || mean(rest) < 0.08 || rest.filter(x => x >= 0.04).length < rest.length * 0.8) continue;
      const before = s.t.map((t, k) => (t >= t0 && t < s.t[i] ? k : -1)).filter(k => k >= 0), after = s.t.map((t, k) => (k >= i ? k : -1)).filter(k => k >= 0);
      const paceOf = ks => { const a = ks[0], b = ks[ks.length - 1]; const dd = s.d[b] - s.d[a]; return dd > 0 ? (s.t[b] - s.t[a]) / (dd / 1000) : null; };
      const hrOf = ks => (s.hr ? Math.round(mean(ks.map(k => s.hr[k]).filter(x => x))) : null);
      const pb = paceOf(before), pa = paceOf(after), hb = hrOf(before), ha = hrOf(after);
      let tip;
      if (pa && pb && pa - pb >= 8) tip = `O ritmo caiu de ${fmtPace(pb)} para ${fmtPace(pa)}/km${hb && ha ? ` com a FC em ${ha} (antes ${hb})` : ''}. Na próxima, comece uns 10 s/km mais devagar para chegar inteiro.`;
      else if (hb && ha && ha - hb >= 4) tip = `O ritmo se manteve, mas a FC subiu de ${hb} para ${ha} sem você acelerar. Sinal de calor, pouca água ou início forte. Hidrate antes e segure o começo.`;
      else tip = 'Daqui em diante o esforço ficou mais caro para o mesmo ritmo. Hidrate antes e segure o começo.';
      return { i, dist: s.d[i], pct: Math.round(mean(rest) * 100), paceBefore: pb, paceAfter: pa, hrBefore: hb, hrAfter: ha, tip };
    }
    return null;
  }

  // Mesmo percurso? Largada perto, distância parecida e o traçado passando pelos mesmos lugares.
  function meters(a, b) { const R = 6371000, k = Math.PI / 180; const x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) * k / 2), y = (b[0] - a[0]) * k; return Math.sqrt(x * x + y * y) * R; }
  function sameRoute(A, B) {
    if (!A || !B || A.length < 5 || B.length < 5) return false;
    if (meters(A[0], B[0]) > 250) return false;
    const len = P => P.reduce((s, p, i) => s + (i ? meters(P[i - 1], p) : 0), 0);
    const la = len(A), lb = len(B); if (Math.abs(la - lb) / Math.max(la, lb) > 0.15) return false;
    const near = (p, P) => Math.min(...P.map(q => meters(p, q)));
    const step = Math.max(1, Math.floor(A.length / 30)); let far = 0, cnt = 0;
    for (let i = 0; i < A.length; i += step) { cnt++; if (near(A[i], B) > 120) far++; }
    const stepB = Math.max(1, Math.floor(B.length / 30)); let farB = 0, cntB = 0;
    for (let i = 0; i < B.length; i += stepB) { cntB++; if (near(B[i], A) > 120) farB++; }
    return far / cnt <= 0.15 && farB / cntB <= 0.15;
  }
  // Fantasma: diferença de tempo contra a corrida anterior em cada ponto (negativo = à frente).
  function ghost(s, p) {
    const lim = Math.min(s.d[s.n - 1], p.d[p.n - 1]);
    const delta = s.d.map((d, i) => (d <= lim ? (s.t[i] - s.t[0]) - (timeAt(p, d) - p.t[0]) : null));
    const perKm = [];
    for (let k = 1; k * 1000 <= lim; k++) { const a = timeAt(s, k * 1000) - timeAt(s, (k - 1) * 1000), b = timeAt(p, k * 1000) - timeAt(p, (k - 1) * 1000); perKm.push({ k, diff: Math.round(a - b) }); }
    const final = Math.round((timeAt(s, lim) - s.t[0]) - (timeAt(p, lim) - p.t[0]));
    let best = null; delta.forEach((x, i) => { if (x != null && (best == null || x < delta[best])) best = i; });
    return { delta, perKm, final, lim, bestI: best, bestLead: best != null ? Math.round(-delta[best]) : 0 };
  }

  function analyze(s, o) {
    o = o || {};
    if (!s || !s.n || s.n < 5) return null;
    const sp = speeds(s);
    const res = { sp, fastestKm: fastestKm(s), peak: peakSpeed(s, sp), maxHr: maxHr(s), climb: biggestClimb(s), reps: [], fatigue: null, ghost: null };
    if (o.type === 'interval' || /\d+\s*×\s*\d/.test(o.rua || '')) res.reps = reps(s, sp, o);
    if (!res.reps.length && ['easy', 'long', 'threshold', 'test', 'race'].includes(o.type || 'easy')) res.fatigue = fatigue(s, sp);
    if (o.prev && o.prev.n > 5) res.ghost = ghost(s, o.prev);
    return res;
  }

  const api = { analyze, sameRoute, timeAt, rolling, speeds, fmtPace, kmTxt, meters };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RouteInsights = api;
})(typeof window !== 'undefined' ? window : globalThis);
