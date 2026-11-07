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
    // Faixas de FC da pessoa (calculadas no app pelos treinos); sem elas, os valores padrão.
    const HE = (opts.hr && opts.hr.easy) || HR_EASY, TL = (opts.hr && opts.hr.thr) || [150, 165];

    const res = { type, hr: { easy: HE, thr: TL }, status: 'ok', headline: '', points: [], metrics: { distKm, time, pace, hr, cadence, maxHr: activity.max_heartrate || null }, splits, estimateSec: null, estimateBasis: '' };
    const add = (txt, tone) => res.points.push({ txt, tone: tone || 'info' });
    const worse = s => { const order = { ok: 0, warn: 1, bad: 2 }; if (order[s] > order[res.status]) res.status = s; };

    if (type === 'easy') {
      const mins = plannedMinutes(day && day.rua);
      const highSplits = splits.filter(s => s.hr && s.hr > HE + 3).length;
      if (hr && hr <= HE + 3) add(`FC média ${hr}: ficou leve de verdade.`, 'good');
      else if (hr) { add(`FC média ${hr}, acima do teto de ${HE}. Caminhe mais vezes quando passar.`, 'warn'); worse('warn'); }
      if (highSplits && splits.length) add(`${highSplits} de ${splits.length} km com FC acima de ${HE + 3}.`, highSplits > splits.length / 2 ? 'warn' : 'info');
      if (mins) { const done = time / 60; if (done < mins * 0.85) { add(`Duração de ${Math.round(done)}' para ${mins}' planejados.`, 'warn'); worse('warn'); } else add(`Duração cumprida: ${Math.round(done)}' de ${mins}'.`, 'good'); }
      res.headline = res.status === 'ok' ? 'Treino leve bem feito' : 'O leve ficou forte demais';
    }

    if (type === 'threshold') {
      let work = laps.filter(l => l.dist >= 800 && target && Math.abs(l.pace - target) <= 30);
      if (!work.length) work = splits.slice(1, Math.max(1, splits.length - 1)).map(s => ({ pace: s.pace, hr: s.hr, time: s.pace, dist: 1000 }));
      const wp = work.length ? avg(work.map(w => w.pace)) : pace;
      const wh = work.filter(w => w.hr).length ? Math.round(avg(work.filter(w => w.hr).map(w => w.hr))) : hr;
      if (wp) res.metrics.work = { pace: wp, hr: wh, label: 'bloco de limiar' };
      if (target) {
        const diff = wp - target;
        if (diff < -15) { add(`Bloco principal a ${fmtPace(wp)}/km, ${Math.round(-diff)} s mais rápido que o alvo de ${fmtPace(target)}. Rápido demais para um limiar.`, 'warn'); worse('warn'); }
        else if (diff <= 6) add(`Bloco principal a ${fmtPace(wp)}/km, no alvo de ${fmtPace(target)}.`, 'good');
        else if (diff <= 15) { add(`Bloco principal a ${fmtPace(wp)}/km, ${Math.round(diff)} s acima do alvo de ${fmtPace(target)}.`, 'warn'); worse('warn'); }
        else { add(`Bloco principal a ${fmtPace(wp)}/km, bem acima do alvo de ${fmtPace(target)}. Na próxima semana, faça o mesmo treino num ritmo um pouco mais lento (ajuste de 5 a 10 s/km) e só aperte depois de repetir o alvo.`, 'bad'); worse('bad'); }
      }
      if (wh) add(wh > TL[1] + 2 ? `FC no bloco ${wh}: acima da faixa de limiar (${TL[0]}–${TL[1]}).` : wh < TL[0] - 2 ? `FC no bloco ${wh}: abaixo da faixa de limiar, dava para apertar.` : `FC no bloco ${wh}, dentro da faixa de limiar.`, wh > TL[1] + 2 ? 'warn' : 'good');
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
            else { txt += `, ${Math.round(diff)} s/km acima do alvo de ${fmtPace(tgt)}. Na próxima vez, faça o mesmo treino num ritmo um pouco mais lento (5 a 10 s/km) e só aperte depois de repetir o alvo.`; tone = 'bad'; worse('bad'); }
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
          const mh = main.items.filter(i => i.hr); res.metrics.work = { pace: rp, hr: mh.length ? Math.round(avg(mh.map(i => i.hr))) : null, label: `tiros de ${rd} m` };
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

  /* Faixas de FC pessoais. o = { hrMax (informada), peaks: [FC máx. dos treinos], avgs: [FC média de corridas de 3 km ou mais],
     easyRuns: [{ hr, pace }] corridas feitas em dias de treino leve }.
     Base: 76,5% da FC máxima para o teto do leve e 79–87% para o limiar (com FC máx. 190 dá os 145 e 150–165 de antes).
     Se nem os leves mais lentos ficam abaixo do teto, o teto sobe até a FC desses leves (limite de 82% da FC máx.). */
  function hrTargets(o) {
    o = o || {};
    let max = o.hrMax || null, src = max ? 'informada' : '';
    if (!max) {
      const peaks = (o.peaks || []).filter(x => x >= 140 && x <= 215), low = (o.avgs || []).filter(x => x >= 100 && x <= 200).map(x => x / 0.92);
      // Pico e média só mostram que a FC máxima é pelo menos aquilo: sem valor informado, o ajuste automático só sobe.
      const est = Math.max(0, ...peaks, ...low);
      if (est > 190) { max = Math.round(est); src = 'estimada pelos treinos'; }
    }
    let floor = null;
    const er = (o.easyRuns || []).filter(r => r.hr && r.pace).sort((a, b) => b.pace - a.pace);
    if (er.length >= 3) { const slow = er.slice(0, Math.max(2, Math.ceil(er.length / 3))).map(r => r.hr).sort((a, b) => a - b); floor = slow[Math.floor(slow.length / 2)]; }
    const m = max || 190;
    let easy = Math.round(m * 0.765), thr = [Math.round(m * 0.79), Math.round(m * 0.87)], why = max ? `76% da FC máxima ${src}, ${max}` : 'valor padrão';
    if (floor && floor + 3 > easy) { const cap = Math.round(m * 0.82); const e2 = Math.min(floor + 3, cap); if (e2 > easy) { easy = e2; why = `pela FC média de ${floor} nos seus leves mais lentos${e2 === cap ? ', com limite de 82% da FC máxima' : ''}`; } }
    if (thr[0] <= easy + 2) thr = [easy + 3, Math.max(thr[1], easy + 15)];
    return { easy, thr, max, src: max ? src : '', floor, why, custom: !!(max || (floor && easy !== Math.round(m * 0.765))) };
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


  /* Texto completo da análise (sem IA): junta o resultado do treino com o histórico da pessoa.
     c = { a: análise, day: { title, targetPace }, feel: { rpe, pain, sleep }, cmp: { msg, tone, trend }, gapDays, runs28: { n, km },
           hasHistory, returning, load (7 dias / média do mês), weight: { diff, since }, auto: [frases], tip, next: { title, when }, wx: { tempC } }
     Devolve { tone, parts: [{ h, p }] }. */
  function report(c) {
    const a = c.a, m = a.metrics || {}, t = a.type, f = c.feel || null, day = c.day || {};
    const hard = ['interval', 'threshold', 'test', 'race'].includes(t);
    const parts = [];
    const join = arr => arr.filter(Boolean).join(' ');
    const good = a.points.filter(p => p.tone === 'good').map(p => p.txt);
    const off = a.points.filter(p => p.tone === 'warn' || p.tone === 'bad').map(p => p.txt);
    const tName = { easy: 'treino leve', threshold: 'treino de limiar', interval: 'intervalado', test: 'teste', race: 'prova' }[t] || 'treino';
    const kg = n => n.toFixed(1).replace('.', ',');
    const gap = c.gapDays != null && c.gapDays >= 10 ? c.gapDays : null;

    // 1) Cumpriu o planejado?
    let p1;
    if (t === 'test' || t === 'race') {
      p1 = join([`${t === 'race' ? 'Prova' : 'Teste'} concluído: ${m.distKm.toFixed(2).replace('.', ',')} km em ${fmtTime(m.time)}.`, ...a.points.filter(p => !/Cadência/.test(p.txt)).map(p => p.txt)]);
    } else if (a.status === 'ok') {
      p1 = join([`Sim, o ${tName}${day.title ? ` (${day.title})` : ''} cumpriu o planejado.`, ...good.slice(0, 3)]);
    } else {
      p1 = join([a.status === 'bad' ? `Não, o ${tName} ficou abaixo do planejado.` : `Em parte. O ${tName} saiu perto do planejado, mas com pontos fora.`,
        `O que ficou fora: ${off.join(' ')}`, good.length ? `O que deu certo: ${good.slice(0, 2).join(' ')}` : '']);
    }
    parts.push({ h: 'Cumpriu o planejado?', p: p1 });

    // 2) Por quê: sinais do dia e do histórico
    const why = [];
    if (gap) why.push(`Você ficou ${gap} dias sem correr antes deste treino. Depois de uma pausa, o corpo leva de 1 a 2 semanas para voltar ao ritmo de antes, então FC mais alta e ritmo mais lento são esperados.`);
    else if (c.returning) why.push('Você está no começo de um plano de retomada depois de uma pausa: as primeiras semanas servem para o corpo se readaptar, sem cobrar ritmo.');
    else if (c.hasHistory && c.runs28 && c.runs28.n === 0) why.push('Não encontrei corridas nas 4 semanas antes deste treino, o que pesa no fôlego e na FC.');
    if (f && f.sleep && f.sleep <= 5) why.push(`Você dormiu ${f.sleep}h ou menos na noite anterior. Pouco sono sobe a FC e deixa o ritmo mais pesado.`);
    else if (f && f.sleep === 6 && a.status !== 'ok') why.push('Seis horas de sono na noite anterior podem ter pesado.');
    if (f && f.pain === 'forte') why.push('Você registrou dor forte, o que muda a passada e o ritmo.');
    else if (f && f.pain === 'leve' && a.status !== 'ok') why.push('Você registrou dor leve, que costuma travar um pouco o ritmo.');
    if (f && f.rpe) {
      if (t === 'easy' && f.rpe >= 7) why.push(`Você marcou esforço ${f.rpe}/10 num treino que deveria ser leve (o ideal é 3 a 4).`);
      else if (hard && f.rpe <= 4 && a.status !== 'ok') why.push(`Esforço ${f.rpe}/10 num treino forte indica que dava para apertar mais.`);
      else if (hard && f.rpe >= 9 && a.status !== 'ok') why.push(`Você marcou esforço ${f.rpe}/10: deu tudo e mesmo assim não chegou no alvo, sinal de cansaço acumulado ou de um alvo puxado para o momento.`);
    }
    if (c.load && c.load > 1.3) why.push(`Os 7 dias antes deste treino tiveram ${Math.round((c.load - 1) * 100)}% mais volume que a sua média do mês. O cansaço acumulado explica parte do resultado.`);
    if (c.wx && c.wx.tempC >= 28 && a.status !== 'ok') why.push(`Fazia cerca de ${Math.round(c.wx.tempC)} °C, e calor sobe a FC e derruba o ritmo.`);
    if (c.weight && c.weight.diff >= 1) why.push(`Seu peso subiu ${kg(c.weight.diff)} kg desde ${c.weight.since}. Cada kg a mais custa alguns segundos por km.`);
    if (c.weight && c.weight.diff <= -1) why.push(`Seu peso caiu ${kg(-c.weight.diff)} kg desde ${c.weight.since}, o que ajuda no ritmo.`);
    if (c.runs28 && c.runs28.n >= 8 && !gap && a.status === 'ok') why.push(`A regularidade ajuda: foram ${c.runs28.n} corridas nas 4 semanas antes deste treino.`);
    if (a.status !== 'ok' && t !== 'test' && t !== 'race') {
      if (!why.length) why.push(f ? 'Os dados não mostram um motivo claro (sono, dor, pausa e volume estão normais). Percurso, horário e alimentação também influenciam; um dia abaixo não muda a tendência.'
        : 'Os dados não mostram um motivo claro. Registre o esforço, a dor e o sono em "Como foi" para a análise apontar a causa.');
      parts.push({ h: 'Por que não saiu como planejado', p: join(why) });
    } else if (why.length) parts.push({ h: 'O que pesou neste treino', p: join(why) });

    // 3) Comparado com os treinos anteriores
    const hist = [];
    if (c.cmp && c.cmp.msg) hist.push(`Comparado com o último treino igual: ${c.cmp.msg}`);
    if (c.cmp && c.cmp.trend) hist.push(c.cmp.trend);
    if (!hist.length) hist.push('Ainda não há um treino igual recente para comparar. A comparação aparece a partir da próxima vez.');
    if (c.runs28 && c.runs28.n > 0 && !(c.runs28.n >= 8 && a.status === 'ok')) hist.push(`Nas 4 semanas antes deste treino foram ${c.runs28.n} corrida${c.runs28.n === 1 ? '' : 's'} (${kg(c.runs28.km)} km).`);
    parts.push({ h: 'Comparado com os treinos anteriores', p: join(hist) });

    // 4) O que muda no plano
    const auto = (c.auto || []).filter(Boolean);
    const adj = [auto.length ? join(auto) : 'Nada muda automaticamente: o plano segue como está.', c.tip || '', c.next ? `Próximo treino-chave: ${c.next.title} (${c.next.when}).` : ''];
    parts.push({ h: 'O que muda nos próximos treinos', p: join(adj) });

    // 5) Fechamento
    let end;
    const goalHit = (t === 'test' || t === 'race') && a.points.some(p => /Meta alcançada/.test(p.txt));
    if (goalHit) end = 'Parabéns, meta alcançada! Todo o trabalho das últimas semanas apareceu aqui. Aproveite o momento e recupere bem.';
    else if (t === 'test' || t === 'race') end = `Parabéns por ${t === 'race' ? 'completar a prova' : 'fazer o teste'}! Agora você sabe exatamente onde está, e é a partir daqui que o plano trabalha.`;
    else if (a.status === 'ok' && (gap || c.returning)) end = 'Parabéns pela volta! Retomar com controle é a parte mais difícil, e você fez do jeito certo. Mantenha a regularidade nas próximas semanas.';
    else if (a.status === 'ok') end = t === 'easy' ? 'Parabéns! Treino leve feito no leve é o que mais gente erra, e você acertou. É ele que constrói a base para os treinos fortes.' : 'Parabéns pelo treino! Bater o alvo num treino forte é exatamente o que leva ao resultado na prova.';
    else if (gap || c.returning) end = 'Voltar depois de uma pausa é assim mesmo: as primeiras corridas parecem pesadas. O importante foi ter voltado. Siga com calma e regularidade que o ritmo volta em poucas semanas.';
    else if (a.status === 'warn') end = 'Bom treino, mesmo com ressalvas. Ele entrou na conta da semana e é a soma das semanas que leva à prova. Ajuste o detalhe acima no próximo.';
    else end = 'Dias assim fazem parte de qualquer preparação, e ter ido treinar já conta. Descanse, cuide do sono e volte no próximo treino com calma: a evolução aparece na sequência, não num treino só.';
    if (f && f.pain === 'forte') end += ' Se a dor continuar, procure uma avaliação antes de voltar aos treinos fortes.';
    parts.push({ h: a.status === 'ok' || goalHit ? 'Parabéns' : 'Força para o próximo', p: end });

    return { tone: a.status, parts };
  }

  const api = { analyze, estimate, project, report, hrTargets, fmtTime, fmtPace, riegel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
