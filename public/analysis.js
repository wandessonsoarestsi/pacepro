/* Análise de treinos do Strava e estimativa de tempo de prova. Funciona no navegador e no Node. */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
  const fmtPace = s => { s = Math.round(s); return `${Math.floor(s / 60)}'${pad(s % 60)}"`; };
  const paceOf = (meters, seconds) => meters > 0 ? seconds / (meters / 1000) : null;
  const riegel = (sec, km, target) => sec * Math.pow(target / km, 1.06);
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  const HR_EASY = 145;

  function plannedMinutes(rua) { const m = /(\d+)'\s*L/.exec(rua || ''); return m ? +m[1] : null; }
  function repDistance(rua) { const m = /×\s*(\d+)\s*(m|km)\b/.exec(rua || ''); return m ? (+m[1]) * (m[2] === 'km' ? 1000 : 1) : null; }

  /* activity: detalhe do Strava (com splits_metric e laps). day: dia do plano (pode ser null). */
  function analyze(activity, day, opts) {
    opts = opts || {};
    const distKm = (activity.distance || 0) / 1000;
    const time = activity.moving_time || activity.elapsed_time || 0;
    const pace = paceOf(activity.distance, time);
    const hr = activity.average_heartrate ? Math.round(activity.average_heartrate) : null;
    const cadence = activity.average_cadence ? Math.round(activity.average_cadence * 2) : null;
    const splits = (activity.splits_metric || []).filter(s => s.distance > 500).map(s => ({ pace: paceOf(s.distance, s.moving_time), hr: s.average_heartrate ? Math.round(s.average_heartrate) : null }));
    const laps = (activity.laps || []).map(l => ({ dist: l.distance, time: l.moving_time, pace: paceOf(l.distance, l.moving_time), hr: l.average_heartrate ? Math.round(l.average_heartrate) : null }));
    const type = day ? day.type : 'easy';
    const target = day ? day.targetPace : null;
    const goalPace = opts.goalSec ? opts.goalSec / (opts.distanceKm || 5) : 360;

    const res = { type, status: 'ok', headline: '', points: [], metrics: { distKm, time, pace, hr, cadence, maxHr: activity.max_heartrate || null }, splits, estimateSec: null, estimateBasis: '' };
    const add = (txt, tone) => res.points.push({ txt, tone: tone || 'info' });
    const worse = s => { const order = { ok: 0, warn: 1, bad: 2 }; if (order[s] > order[res.status]) res.status = s; };

    if (type === 'easy') {
      const mins = plannedMinutes(day && day.rua);
      const highSplits = splits.filter(s => s.hr && s.hr > HR_EASY + 3).length;
      if (hr && hr <= HR_EASY + 3) add(`FC média ${hr}: ficou leve de verdade.`, 'good');
      else if (hr) { add(`FC média ${hr}, acima do teto de ${HR_EASY}. Caminhe mais vezes quando passar.`, 'warn'); worse('warn'); }
      if (highSplits && splits.length) add(`${highSplits} de ${splits.length} km com FC acima de ${HR_EASY + 3}.`, highSplits > splits.length / 2 ? 'warn' : 'info');
      if (mins) { const done = time / 60; if (done < mins * 0.85) { add(`Duração de ${Math.round(done)}' para ${mins}' planejados.`, 'warn'); worse('warn'); } else add(`Duração cumprida: ${Math.round(done)}' de ${mins}'.`, 'good'); }
      res.headline = res.status === 'ok' ? 'Treino leve bem feito' : 'O leve ficou forte demais';
    }

    if (type === 'threshold') {
      let work = laps.filter(l => l.dist >= 800 && target && Math.abs(l.pace - target) <= 30);
      if (!work.length) work = splits.slice(1, Math.max(1, splits.length - 1)).map(s => ({ pace: s.pace, hr: s.hr, time: s.pace, dist: 1000 }));
      const wp = work.length ? avg(work.map(w => w.pace)) : pace;
      const wh = work.filter(w => w.hr).length ? Math.round(avg(work.filter(w => w.hr).map(w => w.hr))) : hr;
      if (target) {
        const diff = wp - target;
        if (diff < -15) { add(`Bloco principal a ${fmtPace(wp)}/km, ${Math.round(-diff)} s mais rápido que o alvo de ${fmtPace(target)}. Rápido demais para um limiar.`, 'warn'); worse('warn'); }
        else if (diff <= 6) add(`Bloco principal a ${fmtPace(wp)}/km, no alvo de ${fmtPace(target)}.`, 'good');
        else if (diff <= 15) { add(`Bloco principal a ${fmtPace(wp)}/km, ${Math.round(diff)} s acima do alvo de ${fmtPace(target)}.`, 'warn'); worse('warn'); }
        else { add(`Bloco principal a ${fmtPace(wp)}/km, bem acima do alvo de ${fmtPace(target)}. Pela regra do degrau, repita este ritmo na próxima semana.`, 'bad'); worse('bad'); }
      }
      if (wh) add(wh > 167 ? `FC no bloco ${wh}: acima da faixa de limiar (150–165).` : wh < 148 ? `FC no bloco ${wh}: abaixo da faixa de limiar, dava para apertar.` : `FC no bloco ${wh}, dentro da faixa de limiar.`, wh > 167 ? 'warn' : 'good');
      const workMin = work.reduce((s, w) => s + (w.time || 0), 0) / 60;
      if (wp && (workMin >= 10 || splits.length >= 3)) { res.estimateSec = (wp - 15) * (opts.distanceKm || 5); res.estimateBasis = 'ritmo de limiar − 15 s/km'; }
      res.headline = res.status === 'ok' ? 'Limiar no ritmo' : res.status === 'warn' ? 'Limiar perto do alvo' : 'Limiar abaixo do alvo';
    }

    if (type === 'interval') {
      const cand = laps.filter(l => l.dist >= 150 && l.dist <= 1600 && l.pace);
      const best = cand.length ? Math.min(...cand.map(l => l.pace)) : 0;
      const reps = cand.filter(l => l.pace <= best * 1.35);
      // blocos planejados, ex.: "6 × 400 m a 7'15"/km ... 4 × 200 m a 6'00"/km"
      const planned = [];
      const rua = (day && day.rua) || '';
      let m; const reA = /(\d+)\s*×\s*(\d+)\s*(m|km)\b(?:\s*a\s*(\d{1,2})'(\d{2}))?/g;
      while ((m = reA.exec(rua))) planned.push({ n: +m[1], dist: (+m[2]) * (m[3] === 'km' ? 1000 : 1), pace: m[4] ? (+m[4]) * 60 + (+m[5]) : null });
      if (reps.length >= 2) {
        // agrupa os tiros por distância
        const groups = [];
        reps.forEach(r => {
          const g = groups.find(x => Math.abs(x.dist - r.dist) / x.dist < 0.25);
          if (g) { g.items.push(r); g.dist = avg(g.items.map(i => i.dist)); } else groups.push({ dist: r.dist, items: [r] });
        });
        groups.sort((a, b) => b.dist - a.dist);
        let worstSpread = 0;
        groups.forEach(g => {
          const gp = avg(g.items.map(i => i.pace));
          const spread = Math.max(...g.items.map(i => i.pace)) - Math.min(...g.items.map(i => i.pace));
          worstSpread = Math.max(worstSpread, spread);
          const label = Math.round(g.dist / 50) * 50;
          const plan = planned.find(pb => Math.abs(pb.dist - g.dist) / pb.dist < 0.3);
          const tgt = plan && plan.pace ? plan.pace : (planned.length === 1 ? target : null);
          let txt = `${g.items.length}${plan ? ' de ' + plan.n : ''} tiros de ~${label} m a ${fmtPace(gp)}/km`;
          let tone = 'info';
          if (tgt) {
            const diff = gp - tgt;
            if (diff <= 5) { txt += `, no alvo de ${fmtPace(tgt)}.`; tone = 'good'; }
            else if (diff <= 12) { txt += `, ${Math.round(diff)} s/km acima do alvo de ${fmtPace(tgt)}.`; tone = 'warn'; worse('warn'); }
            else { txt += `, ${Math.round(diff)} s/km acima do alvo de ${fmtPace(tgt)}. Repita este degrau.`; tone = 'bad'; worse('bad'); }
          } else txt += '.';
          if (plan && g.items.length < plan.n) { tone = tone === 'bad' ? 'bad' : 'warn'; worse('warn'); }
          add(txt, tone);
        });
        planned.forEach(pb => { if (!groups.some(g => Math.abs(pb.dist - g.dist) / pb.dist < 0.3)) { add(`Não achei os tiros de ${pb.dist} m.`, 'warn'); worse('warn'); } });
        add(worstSpread <= 12 ? `Tiros regulares (variação de até ${Math.round(worstSpread)} s/km).` : `Tiros irregulares (variação de ${Math.round(worstSpread)} s/km). Segure o primeiro e mantenha todos iguais.`, worstSpread <= 12 ? 'good' : 'warn');
        if (worstSpread > 12) worse('warn');
        const main = groups.find(g => g.dist >= 380);
        if (main) {
          const rd = Math.round(main.dist / 50) * 50, rp = avg(main.items.map(i => i.pace));
          const adj = rd >= 1000 ? 8 : rd >= 800 ? 12 : rd >= 600 ? 15 : 20;
          res.estimateSec = (rp + adj) * (opts.distanceKm || 5); res.estimateBasis = `tiros de ${rd} m + ${adj} s/km`;
        }
      } else {
        add('Não achei os tiros separados. Marque uma volta no relógio a cada tiro para a análise ficar completa.', 'warn'); worse('warn');
      }
      res.headline = res.status === 'ok' ? 'Intervalado completo' : res.status === 'warn' ? 'Intervalado com ressalvas' : 'Intervalado abaixo do alvo';
    }

    if (type === 'test' || type === 'race') {
      if (distKm >= 4.5) {
        res.estimateSec = riegel(time, distKm, opts.distanceKm || 5);
        res.estimateBasis = type === 'race' ? 'tempo de prova' : 'tempo do teste';
        add(`${distKm.toFixed(2).replace('.', ',')} km em ${fmtTime(time)} (${fmtPace(pace)}/km). Equivale a ${fmtTime(res.estimateSec)} nos ${opts.distanceKm || 5} km.`, 'info');
        if (opts.goalSec) add(res.estimateSec <= opts.goalSec ? 'Meta alcançada!' : `Faltam ${fmtTime(res.estimateSec - opts.goalSec)} para a meta.`, res.estimateSec <= opts.goalSec ? 'good' : 'info');
      }
      res.headline = type === 'race' ? 'Resultado da prova' : 'Resultado do teste';
    }

    if (splits.length >= 3) {
      const first = splits[0].pace, last = splits[splits.length - 1].pace;
      const worst = Math.max(...splits.map(s => s.pace));
      if (type === 'test' || type === 'race') {
        if (last <= first) add(`Progressivo: último km ${fmtPace(last)}, primeiro ${fmtPace(first)}.`, 'good');
        else if (worst - first > 30) { add(`Largou forte e caiu: de ${fmtPace(first)} para ${fmtPace(worst)} no pior km.`, 'warn'); worse('warn'); }
      }
    }
    if (cadence) add(cadence >= 158 ? `Cadência ${cadence} passos/min, no alvo.` : `Cadência ${cadence} passos/min. Alvo: 160, com passos mais curtos.`, cadence >= 158 ? 'good' : 'info');

    if (!res.headline) res.headline = 'Corrida registrada';
    return res;
  }

  /* runs: [{date:'aaaa-mm-dd', km, sec}] resumos de corrida. done: {data:{analysis}} treinos analisados. */
  function estimate(asOf, runs, analyses, distanceKm) {
    distanceKm = distanceKm || 5;
    const t = new Date(asOf + 'T12:00:00').getTime();
    const cands = [];
    runs.forEach(r => { if (r.km >= 3) cands.push({ date: r.date, v: riegel(r.sec, r.km, distanceKm) * 0.975, src: 'corrida' }); });
    analyses.forEach(a => { if (a.estimateSec) cands.push({ date: a.date, v: a.estimateSec, src: a.basis }); });
    const past = cands.filter(c => new Date(c.date + 'T12:00:00').getTime() <= t);
    if (!past.length) return null;
    const recent = past.filter(c => t - new Date(c.date + 'T12:00:00').getTime() <= 28 * 864e5);
    const pool = recent.length ? recent : past;
    const best = pool.reduce((a, b) => (b.v < a.v ? b : a));
    const allDates = runs.map(r => r.date).concat(analyses.map(a => a.date)).filter(d => d <= asOf).sort();
    const last = allDates.length ? new Date(allDates[allDates.length - 1] + 'T12:00:00').getTime() : t;
    const gap = (t - last) / 864e5;
    let v = best.v;
    if (gap > 10) v *= 1 + Math.min(0.06, (gap - 10) * 0.003);
    return { sec: v, basis: best.src, date: best.date, gapDays: Math.round(gap) };
  }

  function project(estSec, asOf, raceISO) {
    const weeks = Math.max(0, (new Date(raceISO + 'T07:00:00') - new Date(asOf + 'T12:00:00')) / (7 * 864e5));
    const train = Math.max(0, weeks - 1);
    return estSec * (1 - Math.min(0.15, 0.025 * train));
  }

  const api = { analyze, estimate, project, fmtTime, fmtPace, riegel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
