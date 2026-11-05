/* PacePro: app de plano de treino com Strava. */
(function () {
  const A = window.Analysis, P = window.PlanParser;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const TZ = 'America/Fortaleza';
  const isoLocal = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const D = s => new Date(s + 'T12:00:00-03:00');
  const addDays = (s, n) => isoLocal(new Date(D(s).getTime() + n * 864e5));
  const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const WDL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const ddmm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;


  let plan = null, planSource = '';
  let done = {};
  let runs = [];
  let planMd = null;
  // Dados pessoais além do plano: como foi cada treino, peso, alimentação, ajustes do plano e FC máxima.
  const defaultExtra = () => ({ feel: {}, weights: [], diet: {}, moves: {}, skips: {}, soft: {}, dismiss: {}, hrMax: null });
  let extra = defaultExtra();
  const userKey = k => `pp.local.${k}`;
  let strava = { connected: false, configured: true, athlete: null, checked: false };
  const today = isoLocal(new Date());
  let selected = today;
  let busy = false;

  /* ---------- Plano ---------- */
  function applyPlanMd(md, source) {
    planMd = md || null;
    plan = null;
    if (md) { try { const p = P.parse(md); if (p.days.length) { plan = p; planSource = source || 'salvo'; } } catch (e) {} }
    if (plan) { plan.base = plan.days.map(d => ({ ...d })); plan.weeks.forEach(w => { w.dates = w.days.map(x => x.date); }); applyAdjust(); }
  }

  /* ---------- Ajustes do plano (treino remarcado, pulado ou aliviado) ---------- */
  const isRunType = t => !['swim', 'rest'].includes(t);
  // Treino forte: intervalado, limiar, teste ou o longo do fim de semana.
  const isHard = d => !!d && (['interval', 'threshold', 'test'].includes(d.type) || (d.type === 'easy' && d.key && [0, 6].includes(D(d.date).getDay())));
  function applyAdjust() {
    if (!plan) return;
    const base = {}; plan.base.forEach(d => { base[d.date] = d; });
    const movedTo = {}; Object.entries(extra.moves).forEach(([to, from]) => { movedTo[from] = to; });
    const fmtD = dt => `${WD[D(dt).getDay()]} ${ddmm(dt)}`;
    plan.days = plan.base.map(d0 => {
      let d = { ...d0 };
      const from = extra.moves[d.date];
      if (from && base[from]) {
        const f = base[from];
        d = { ...d, type: f.type, title: f.title, rua: f.rua, esteira: f.esteira, targetPace: f.targetPace, key: f.key, movedFrom: from };
      } else if (movedTo[d.date]) {
        d = { ...d, type: 'rest', title: 'Treino remarcado', rua: `Este treino foi passado para ${fmtD(movedTo[d.date])}.`, esteira: '', targetPace: null, key: false, movedTo: movedTo[d.date] };
      } else if (extra.skips[d.date]) {
        d = { ...d, type: 'rest', title: 'Treino pulado', rua: 'Treino pulado para não acumular cansaço. Siga a semana normalmente.', esteira: '', targetPace: null, key: false, skipped: true };
      }
      if (extra.soft[d.date] && isRunType(d.type) && d.type !== 'race') {
        d = { ...d, type: 'easy', title: 'Leve (aliviado)', rua: "30–40' leve pela FC (até ~145)", esteira: '', targetPace: null, key: false, softened: d.title };
      }
      return applyTestPaces(d, d0);
    });
    const by = {}; plan.days.forEach(d => { by[d.date] = d; });
    plan.weeks.forEach(w => { w.days = w.dates.map(dt => by[dt]).filter(Boolean); });
  }
  function refreshAdjust() { applyAdjust(); persist(); renderAll(); }
  function setPlanMd(md, source) {
    applyPlanMd(md, source);
    planWeek = null; selected = today; if (plan) clampSelected();
    persist(); renderAll();
  }
  async function examplePlanMd() { const r = await fetch('/plano.md', { cache: 'no-cache' }); return r.text(); }

  /* ---------- Dados (salvos neste aparelho) ---------- */
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }
  function saveNow() {
    store.set(userKey('state'), { plan_md: planMd, done, extra, updated_at: new Date().toISOString() });
  }
  // Salva na hora ao fechar ou trocar de app, para não perder a última mudança.
  window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });
  function loadState() {
    let row = store.get(userKey('state'), null);
    if (!row) { // versão antiga do site
      const legacyPlan = store.get('sub30.planmd', null), legacyDone = store.get('sub30.done', null);
      if (legacyPlan || legacyDone) row = { plan_md: legacyPlan, done: legacyDone || {} };
    }
    done = (row && row.done) || {};
    extra = { ...defaultExtra(), ...((row && row.extra) || {}) };
    applyPlanMd(row && row.plan_md, 'salvo');
    runs = store.get(userKey('runs'), []);
  }
  function showToast(text, bad) {
    let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = text; el.classList.toggle('bad', !!bad); el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  const dayOf = date => plan.days.find(d => d.date === date) || null;
  const raceISO = () => plan ? (plan.race || plan.days[plan.days.length - 1].date) : addDays(today, 60);
  const goalSec = () => (plan && plan.goalSec) || 1800;
  const distKm = () => (plan && plan.distanceKm) || 5;
  const firstDay = () => plan ? plan.days[0].date : today;
  const lastDay = () => { if (!plan) return today; const l = plan.days[plan.days.length - 1].date, r = addDays(raceISO(), 7); let x = l > r ? l : r; if (today > x) x = today; return x; };
  // Antes do início do plano, o app abre em hoje e mostra quanto falta.
  const minDay = () => (today < firstDay() ? today : firstDay());
  function clampSelected() {
    if (selected < minDay()) selected = minDay();
    if (selected > lastDay()) selected = lastDay();
  }

  /* ---------- Estimativa ---------- */
  function allRuns() {
    const byId = {};
    runs.forEach(r => { byId[r.id] = r; });
    return Object.values(byId).sort((a, b) => a.date.localeCompare(b.date));
  }
  function analyses() {
    const list = Object.entries(done).filter(([, v]) => v && v.analysis && v.analysis.estimateSec).map(([date, v]) => ({ date, estimateSec: v.analysis.estimateSec, basis: v.analysis.estimateBasis }));
    if (done._base && done._base.sec) list.push({ date: done._base.date, estimateSec: done._base.sec, basis: 'tempo informado' });
    return list;
  }
  const estimateAt = date => A.estimate(date, allRuns(), analyses(), distKm());

  /* ---------- Strava ---------- */
  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'same-origin', ...(opts || {}) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error((j && j.error) || 'Falha ao falar com o Strava.'), { status: r.status });
    return j;
  }
  async function checkStrava() {
    try { const s = await api('/api/strava/status'); strava = { ...s, checked: true }; }
    catch (e) { strava = { connected: false, configured: false, athlete: null, checked: true, error: e.message }; }
  }
  async function syncRuns() {
    if (!strava.connected) return;
    const after = Math.floor(D(addDays(today, -90)).getTime() / 1000);
    const list = await api(`/api/strava/activities?after=${after}`);
    runs = list.map(a => ({ id: 's' + a.id, stravaId: a.id, date: a.start.slice(0, 10), name: a.name, km: a.distance / 1000, sec: a.moving_time, hr: a.average_heartrate ? Math.round(a.average_heartrate) : null }));
    store.set(userKey('runs'), runs);
    store.set(userKey('synced'), Date.now());
  }

  /* ---------- Topo e navegação ---------- */
  const VIEW_TITLE = { hoje: 'Hoje', plano: 'Plano', progresso: 'Progresso', provas: 'Provas', ajustes: 'Ajustes' };
  let view = 'hoje';
  const mondayOf = s => addDays(s, -((D(s).getDay() + 6) % 7));
  function renderHeader() {
    const d = D(selected);
    let title = VIEW_TITLE[view], sub = '';
    if (view === 'hoje' && plan) {
      title = selected === today ? 'Hoje' : selected === addDays(today, 1) ? 'Amanhã' : selected === addDays(today, -1) ? 'Ontem' : WDL[d.getDay()];
      const day = dayAt(selected);
      sub = `${WDL[d.getDay()]}, ${d.getDate()} de ${MON[d.getMonth()]}${day && day.week ? ` · semana ${day.week} de ${plan.weeks.length}` : day && day.recovery ? ` · recuperação, dia ${day.recovery} de 7` : ''}`;
    } else if (view === 'plano' && plan) sub = `${plan.weeks.length} semanas · prova em ${ddmm(raceISO())}`;
    else if (view === 'progresso' && plan) { const n = Math.max(0, Math.ceil((new Date(raceISO() + 'T05:30:00-03:00') - Date.now()) / 864e5)); sub = n ? `${n} dias para a prova` : 'Dia de prova'; }
    else if (view === 'provas') { const n = allRaces().filter(r => r.date >= today).length; sub = n ? `${n} prova${n > 1 ? 's' : ''} pela frente` : 'Seu calendário de provas'; }
    else if (view === 'ajustes') sub = strava.connected ? 'Strava conectado' : 'Strava, plano e preferências';
    $('pageTitle').textContent = title;
    $('pageSub').textContent = sub;
    const inRange = today >= minDay() && today <= lastDay();
    $('goToday').hidden = !(view === 'hoje' && plan && selected !== today && inRange);
    $('syncDot').className = 'sdot' + (strava.connected ? ' on' : '');
    $('syncBtn').setAttribute('aria-label', strava.connected ? 'Sincronizar com o Strava' : 'Conectar o Strava');
    renderWeekStrip();
  }
  function renderWeekStrip() {
    const strip = $('weekStrip');
    strip.hidden = !(view === 'hoje' && plan);
    if (strip.hidden) return;
    const mon = mondayOf(selected);
    const LET = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    let html = '';
    for (let i = 0; i < 7; i++) {
      const dt = addDays(mon, i), x = dayAt(dt), off = dt < minDay() || dt > lastDay();
      const kind = !x ? 'none' : x.type === 'swim' ? 'swim' : x.type === 'rest' ? (x.gym ? 'gym' : 'rest') : x.type === 'race' ? 'race' : 'run';
      const mark = done[dt] ? '<i class="mk done"></i>' : `<i class="mk ${kind}${x && x.key && kind === 'run' ? ' key' : ''}"></i>`;
      html += `<button type="button" role="tab" class="wd${dt === today ? ' today' : ''}" data-d="${dt}" aria-selected="${dt === selected}"${off ? ' disabled' : ''} aria-label="${WDL[D(dt).getDay()]} ${ddmm(dt)}${x ? ', ' + esc(x.title) : ''}${done[dt] ? ', feito' : ''}"><span class="wl">${LET[D(dt).getDay()]}</span><span class="wn">${D(dt).getDate()}</span>${mark}</button>`;
    }
    $('weekDaysStrip').innerHTML = html;
    $('weekDaysStrip').querySelectorAll('.wd').forEach(b => b.onclick = () => { selected = b.dataset.d; renderAll(); });
    $('prevWeek').disabled = mon <= minDay();
    $('nextWeek').disabled = addDays(mon, 6) >= lastDay();
  }
  function goDay(n) {
    const t = addDays(selected, n);
    selected = t < minDay() ? minDay() : t > lastDay() ? lastDay() : t;
    renderAll();
  }

  function renderSummary() {
    const race = new Date(raceISO() + 'T05:30:00-03:00');
    const ms = race - Date.now();
    const days = Math.max(0, Math.ceil(ms / 864e5));
    $('sDays').textContent = today > raceISO() ? 'Concluído' : ms <= 0 || raceISO() === today ? 'É hoje!' : days === 1 ? '1 dia' : `${days} dias`;
    const day = dayOf(selected);
    const wk = day ? plan.weeks.find(w => w.n === day.week) : null;
    const keyDays = wk ? wk.days.filter(x => x.type !== 'rest' && x.type !== 'swim') : [];
    const nDone = keyDays.filter(x => done[x.date]).length;
    $('sWeek').textContent = keyDays.length ? `${nDone}/${keyDays.length}` : '–';
    const est = estimateAt(today);
    const proj = est ? A.project(est.sec, today, raceISO()) : null;
    $('sProj').textContent = proj ? A.fmtTime(proj) : '–';

    // Ciclo: uma faixa por semana, com a semana atual preenchida até hoje
    const nW = plan.weeks.length, cur = dayOf(today) ? dayOf(today).week : (today < firstDay() ? 0 : nW);
    $('sCycle').innerHTML = plan.weeks.map((w, i) => {
      const a0 = w.dates[0], a1 = w.dates[w.dates.length - 1];
      const f = today > a1 ? 1 : today < a0 ? 0 : (D(today) - D(a0) + 864e5) / (D(a1) - D(a0) + 864e5);
      return `<span class="${w.n === cur ? 'now' : ''}"><i style="width:${(100 * f).toFixed(0)}%"></i></span>`;
    }).join('');
    $('sCycleSub').textContent = today < firstDay() ? `começa em ${ddmm(firstDay())} · prova em ${ddmm(raceISO())}` : `semana ${Math.min(cur, nW)} de ${nW} · prova em ${ddmm(raceISO())}`;

    // Treinos da semana: uma pílula por corrida
    $('sPills').innerHTML = keyDays.map(x => {
      const st = done[x.date] ? 'done' : x.date < today ? 'miss' : x.date === today ? 'today' : '';
      return `<span class="wp ${st}" title="${esc(x.title)}"><b>${WD[D(x.date).getDay()]}</b>${st === 'done' ? '✓' : st === 'miss' ? '–' : ''}</span>`;
    }).join('') || '<small class="muted">Sem corridas nesta semana.</small>';

    // Projeção: régua de tempo, mais rápido à direita, com a meta marcada
    const goal = goalSec();
    const past = estimateAt(addDays(today, -14));
    const pastProj = past ? A.project(past.sec, addDays(today, -14), raceISO()) : null;
    if (proj) {
      const hi = Math.max(proj, pastProj || 0, goal + 300) + 60, lo = goal - 90;
      const X = v => 12 + (hi - Math.min(hi, Math.max(lo, v))) / (hi - lo) * 276;
      let g = `<rect x="12" y="16" width="276" height="8" rx="4" fill="var(--sunk)"/>`;
      g += `<rect x="${Math.min(X(proj), X(goal)).toFixed(1)}" y="16" width="${Math.abs(X(goal) - X(proj)).toFixed(1)}" height="8" fill="var(--tint-blue)"/>`;
      g += `<line x1="${X(goal)}" x2="${X(goal)}" y1="10" y2="30" stroke="var(--c1)" stroke-width="2.5"/><text x="${X(goal)}" y="39" text-anchor="middle" font-size="10" font-weight="700" fill="var(--c1)">meta ${A.fmtTime(goal)}</text>`;
      g += `<circle cx="${X(proj)}" cy="20" r="7" fill="var(--c3)" stroke="var(--card)" stroke-width="2"/><text x="${X(proj)}" y="9" text-anchor="middle" font-size="10" font-weight="700" fill="var(--fg)">você</text>`;
      $('sGauge').innerHTML = g; $('sGauge').hidden = false;
      const gap = proj - goal;
      const trend = pastProj ? pastProj - proj : 0;
      $('sProjSub').textContent = (gap <= 0 ? `dentro da meta (${A.fmtTime(-gap)} de folga)` : `faltam ${A.fmtTime(gap)} para a meta`) +
        (pastProj && Math.abs(trend) >= 5 ? ` · ${trend > 0 ? '−' : '+'}${A.fmtTime(Math.abs(trend))} em 2 semanas` : '');
    } else { $('sGauge').hidden = true; $('sProjSub').textContent = 'aparece com as primeiras corridas'; }

    renderStats(est, proj);
  }
  function renderStats(est, proj) {
    $('tEst').textContent = est ? A.fmtTime(est.sec) : '–';
    $('tEstSub').textContent = est ? `${A.fmtPace(est.sec / distKm())}/km${est.gapDays > 10 ? ' · com pausa' : ''}` : 'sem corridas';
    $('tGoal').textContent = A.fmtTime(goalSec());
    $('tGoalSub').textContent = `${A.fmtPace(goalSec() / distKm())}/km`;
    const lastDone = Object.entries(done).filter(([, v]) => v.analysis).sort((a, b) => b[0].localeCompare(a[0]))[0];
    if (lastDone) { $('tLast').textContent = A.fmtPace(lastDone[1].analysis.metrics.pace) ; $('tLastSub').textContent = `${ddmm(lastDone[0])} · ${lastDone[1].analysis.metrics.distKm.toFixed(1).replace('.', ',')} km`; }
    else { const r = allRuns().slice(-1)[0]; $('tLast').textContent = r ? A.fmtPace(r.sec / r.km) : '–'; $('tLastSub').textContent = r ? `${ddmm(r.date)} · ${r.km.toFixed(1).replace('.', ',')} km` : '–'; }
    $('tProj').textContent = proj ? A.fmtTime(proj) : '–';
    $('tProjSub').textContent = proj ? (proj <= goalSec() ? 'dentro da meta' : `${A.fmtTime(proj - goalSec())} acima da meta`) : 'sem corridas';
  }

  /* ---------- Treino do dia ---------- */
  let gymOpen = false;
  function gymBlock(key, day, alone) {
    const g = plan.gym[key];
    if (!g) return `<div class="blk gym"><span class="k">Musculação</span><b>Sessão ${esc(key)}</b><p class="note">${esc(day.gymText)}</p></div>`;
    const head = g.head || ['Exercício', 'Volume'];
    const wk = plan.weeks.find(w => w.n === day.week);
    const extra = day.gymText.replace(/^[A-E]\b\s*/, '');
    const open = alone || gymOpen;
    return `<details class="blk gym" id="gymBox"${open ? ' open' : ''}><summary><span class="k">Musculação</span><span class="gsum"><b>${esc(key)} · ${esc(g.name.replace(/\s*\(.*\)$/, ''))}</b><small>${g.rows.length} exercícios</small></span></summary>` +
      (extra && extra !== key ? `<p class="note">${esc(extra)}</p>` : '') +
      (wk && wk.note ? `<p class="note">${esc(wk.note)}</p>` : '') +
      `<div class="tbl"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${g.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }

  const TYPE_LABEL = { easy: 'Leve', threshold: 'Limiar', interval: 'Intervalado', test: 'Teste', race: 'Prova', swim: 'Natação', rest: 'Descanso' };
  const TIP = {
    easy: 'FC até ~145. Passou disso, caminhe até baixar e volte a trotar.',
    threshold: 'FC entre 150 e 165, ritmo constante. Se for quebrar, reduza 10–15 s/km em vez de parar.',
    interval: 'Marque uma volta no relógio a cada tiro. Todos os tiros no mesmo ritmo.',
    test: 'Km 1 levemente mais lento, km 2–4 no alvo, km 5 com tudo.',
    race: 'Km 1 levemente mais lento, depois o ritmo do plano de prova.'
  };
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderWorkout() {
    const day = dayAt(selected);
    const el = $('workout');
    if (!day && selected < firstDay()) {
      const n = Math.round((D(firstDay()) - D(selected)) / 864e5);
      el.innerHTML = `<div class="wk-top"><div><span class="eyebrow">Antes do plano</span><h3>O plano começa ${n === 1 ? 'amanhã' : `em ${n} dias`}</h3></div></div>` +
        `<div class="blocks"><div class="blk rest"><span class="k">Até lá</span><p class="note">Primeiro treino: ${WDL[D(firstDay()).getDay()].toLowerCase()}, ${ddmm(firstDay())}. Até lá, caminhadas ou trotes leves de 20 a 30 minutos, se estiver se sentindo bem.</p></div></div>` +
        `<button class="btn wide" id="goStart" type="button">Ver o primeiro treino</button>`;
      $('analysis').hidden = true;
      $('goStart').onclick = () => { selected = firstDay(); renderAll(); };
      return;
    }
    if (!day && selected > raceISO()) { el.innerHTML = `<div class="wk-top"><div><span class="eyebrow">Plano concluído</span><h3>Ciclo encerrado</h3></div></div><p class="muted">A semana de recuperação acabou. Defina o próximo objetivo logo abaixo e o app monta um plano novo.</p>`; $('analysis').hidden = true; return; }
    if (!day) { el.innerHTML = `<p class="muted">Sem treino planejado para este dia.</p>`; $('analysis').hidden = true; return; }
    const st = done[day.date];
    const isRun = !['swim', 'rest'].includes(day.type);
    let html = `<div class="wk-top"><div><span class="eyebrow">${day.recovery ? `Recuperação · dia ${day.recovery} de 7` : esc(TYPE_LABEL[day.type])}${day.key && isRun ? ' · treino-chave' : ''}</span><h3>${esc(day.title)}</h3></div>` +
      (st ? `<span class="chip good">${CHECK}Feito</span>` : '') + `</div>`;
    if (isRun) {
      const hero = [];
      if (day.targetPace) hero.push(['Ritmo-alvo', A.fmtPace(day.targetPace), '/km'], ['Na esteira', (3600 / day.targetPace).toFixed(1).replace('.', ','), 'km/h']);
      if (day.type === 'easy' || day.type === 'threshold') hero.push(['FC', day.type === 'easy' ? '≤145' : '150–165', 'bpm']);
      if (hero.length) html += `<div class="hero">${hero.map(([l, v, u]) => `<div><span>${l}</span><b${v.length > 5 && hero.length > 2 ? ' class="sm"' : ''}>${v}</b><small>${u}</small></div>`).join('')}</div>`;
    }
    html += `<div class="blocks">`;
    if (isRun) {
      html += `<div class="blk run"><span class="k">Corrida</span><dl class="kv"><dt>Rua</dt><dd>${esc(day.rua)}</dd>${day.esteira ? `<dt>Esteira</dt><dd>${esc(day.esteira)}${/\d$/.test(day.esteira) ? ' km/h' : ''}${/\d/.test(day.esteira) ? ' · incl. 1%' : ''}</dd>` : ''}</dl>` +
        (day.paceFrom ? `<p class="note"><b>Ritmo atualizado pelo teste</b> (antes ${A.fmtPace(day.paceFrom)}/km).</p>` : day.paceNew ? '<p class="note"><b>Ritmo-alvo calculado pelo seu teste.</b></p>' : '') +
        `<p class="note">${TIP[day.type] || ''} Aquecimento 10' leve e desaquecimento 5–10'.</p></div>`;
      if (!st && day.date >= addDays(today, -1)) html += wxBlock(day);
    }
    if (day.type === 'swim') html += `<div class="blk swim"><span class="k">Natação</span><b>${esc(day.title)}</b><p class="note">Técnica e respiração, sem séries fortes.</p></div>`;
    if (day.gym) html += gymBlock(day.gym, day, !isRun && day.type !== 'swim');
    if (day.type === 'rest' && !day.gym) html += `<p class="muted">${esc(day.rua && !/^descanso$/i.test(day.rua) ? day.rua : 'Descanso total. Sono, água e boa comida.')}</p>`;
    const adj = day.movedFrom ? `Treino de ${WD[D(day.movedFrom).getDay()]} ${ddmm(day.movedFrom)} remarcado para hoje.` : day.movedTo ? '' : day.skipped ? '' : day.softened ? `Era "${day.softened}". Trocado por leve para recuperar.` : '';
    if (day.movedFrom || day.movedTo || day.skipped || day.softened) html += `<div class="blk adj"><span class="k">Plano ajustado</span>${adj ? `<p class="note">${esc(adj)}</p>` : ''}<button class="linkbtn" id="undoAdj" type="button">Desfazer ajuste</button></div>`;
    if (!st) html += raceDayBlock(day);
    if (day.type === 'race') html += `<a class="blk run golink" href="#plano" data-goto="raceCard"><span class="k">Plano de prova</span><span>Ritmo por km, aquecimento e checklist do dia <b>›</b></span></a>`;
    html += `</div>`;

    if (day.type !== 'rest' || day.gym) {
      if (!st) html += `<button class="btn wide big" id="finish" type="button">${CHECK}${isRun && strava.connected ? 'Concluir e analisar' : 'Concluir treino'}</button>`;
    }
    html += `<div id="finishArea"></div>`;
    if (st && day.type !== 'rest') html += feelHtml(day.date);
    if (st && (day.type !== 'rest' || day.gym)) html += `<div class="row-actions"><button class="btn ghost sm" id="undo" type="button">Desmarcar</button>${isRun && st.analysis ? `<button class="btn ghost sm" id="redo" type="button">Analisar de novo</button>` : ''}</div>`;
    el.innerHTML = html;
    bindFeel(day.date); bindRaceChecks(el);
    const ro = $('rmOpen'); if (ro) ro.onclick = openRaceMode;
    const gb = $('gymBox'); if (gb && isRun) gb.ontoggle = () => { gymOpen = gb.open; };
    const ua = $('undoAdj'); if (ua) ua.onclick = () => {
      if (day.movedFrom) delete extra.moves[day.date];
      if (day.movedTo) delete extra.moves[day.movedTo];
      if (day.skipped) delete extra.skips[day.date];
      if (day.softened) delete extra.soft[day.date];
      refreshAdjust();
    };
    bindGoto(el);

    const f = $('finish'); if (f) f.onclick = () => finish(day);
    const u = $('undo'); if (u) u.onclick = () => { if (st && st.auto) extra.dismiss['a' + day.date] = true; delete done[day.date]; persist(); renderAll(); };
    const r = $('redo'); if (r) r.onclick = () => finish(day, true);
    renderAnalysis(day);
    // Treino feito com análise: o resultado vem primeiro.
    const an = $('analysis');
    if (!an.hidden) el.before(an); else el.after(an);
  }
  // Links que levam a um cartão em outra aba: troca a aba e rola até ele.
  function bindGoto(root) {
    root.querySelectorAll('[data-goto]').forEach(a => a.onclick = () => setTimeout(() => { const t = $(a.dataset.goto); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60));
  }

  function say(html, tone) { const a = $('finishArea'); if (a) a.innerHTML = `<p class="msg ${tone || ''}">${html}</p>`; }

  async function finish(day, again) {
    if (busy) return;
    const isRun = !['swim', 'rest'].includes(day.type);
    if (!isRun) { done[day.date] = { at: Date.now() }; persist(); renderAll(); return; }
    if (!strava.connected) {
      $('finishArea').innerHTML = `<p class="msg">Conecte o Strava para puxar os dados desse treino.</p><div class="row-actions"><button class="btn strava" type="button" data-strava-connect>Conectar com Strava</button><button class="btn ghost" id="noData" type="button">Marcar sem dados</button></div>`;
      $('noData').onclick = () => { done[day.date] = { at: Date.now() }; persist(); renderAll(); };
      bindStravaButtons();
      return;
    }
    busy = true; say('Buscando o treino no Strava…');
    try {
      const after = Math.floor(D(addDays(day.date, -1)).getTime() / 1000);
      const before = Math.floor(D(addDays(day.date, 1)).getTime() / 1000);
      const list = (await api(`/api/strava/activities?after=${after}&before=${before}`)).filter(a => a.start.slice(0, 10) === day.date);
      busy = false;
      if (!list.length) {
        $('finishArea').innerHTML = `<p class="msg">Não achei corrida no Strava em ${ddmm(day.date)}. Sincronize o relógio com o Strava e tente de novo.</p><div class="row-actions"><button class="btn" id="retry" type="button">Tentar de novo</button><button class="btn ghost" id="noData" type="button">Marcar sem dados</button></div>`;
        $('retry').onclick = () => finish(day, again);
        $('noData').onclick = () => { done[day.date] = { at: Date.now() }; persist(); renderAll(); };
        return;
      }
      if (list.length > 1) {
        $('finishArea').innerHTML = `<p class="msg">Achei ${list.length} corridas nesse dia. Qual é o treino?</p><div class="picklist">${list.map(a => `<button class="pick" type="button" data-id="${a.id}"><span><b>${esc(a.name)}</b><br><small class="muted">${a.start.slice(11, 16)} · ${(a.distance / 1000).toFixed(2).replace('.', ',')} km</small></span><b>${A.fmtTime(a.moving_time)}</b></button>`).join('')}</div>`;
        document.querySelectorAll('.pick').forEach(b => b.onclick = () => analyzeOne(day, b.dataset.id));
        return;
      }
      await analyzeOne(day, list[0].id);
    } catch (e) {
      busy = false;
      if (e.status === 401) { strava.connected = false; say('A conexão com o Strava expirou. Conecte de novo em Ajustes.', 'bad'); }
      else say(esc(e.message), 'bad');
    }
  }

  async function analyzeOne(day, id) {
    busy = true; say('Analisando o treino…');
    try {
      const act = await api(`/api/strava/activity?id=${encodeURIComponent(id)}`);
      const an = A.analyze(act, day, { goalSec: goalSec(), distanceKm: distKm() });
      done[day.date] = { at: Date.now(), activityId: act.id, name: act.name, analysis: an };
      maybeSetTest(day, an);
      persist();
      try { await syncRuns(); } catch (e) {}
      busy = false; renderAll();
    } catch (e) { busy = false; say(esc(e.message), 'bad'); }
  }

  function renderAnalysis(day) {
    const box = $('analysis');
    const st = day && done[day.date];
    if (!st || !st.analysis) { box.hidden = true; return; }
    const a = st.analysis, m = a.metrics;
    const tone = a.status === 'ok' ? 'good' : a.status;
    const label = a.status === 'ok' ? 'No alvo' : a.status === 'warn' ? 'Atenção' : 'Abaixo';
    const maxP = Math.max(...a.splits.map(s => s.pace), 1), minP = Math.min(...a.splits.map(s => s.pace), maxP);
    const bars = a.splits.length >= 2 ? `<div class="bars" aria-label="Ritmo por km">${a.splits.map(s => `<i title="${A.fmtPace(s.pace)}/km" style="height:${(30 + 70 * (maxP - s.pace) / Math.max(1, maxP - minP)).toFixed(0)}%"></i>`).join('')}</div><p class="muted small">Ritmo por km (barra mais alta = mais rápido): ${a.splits.map(s => A.fmtPace(s.pace)).join(' · ')}</p>` : '';
    box.innerHTML = `<div class="card-head"><div><span class="eyebrow">Análise do treino</span><h3>${esc(a.headline)}</h3></div><span class="chip ${tone}">${label}</span></div>` +
      `<div class="metrics"><div class="metric"><span>Distância</span><b>${m.distKm.toFixed(2).replace('.', ',')}</b></div><div class="metric"><span>Tempo</span><b>${A.fmtTime(m.time)}</b></div><div class="metric"><span>Ritmo</span><b>${m.pace ? A.fmtPace(m.pace) : '–'}</b></div><div class="metric"><span>FC</span><b>${m.hr || '–'}</b></div></div>` +
      bars + (() => { const Z = hrZones(); const zb = Z ? zoneBar(zoneTimes(a.splits, Z)) : ''; return zb ? `<div><span class="eyebrow">Tempo por zona de FC</span>${zb}</div>` : ''; })() + `<ul class="points">${a.points.map(p => `<li class="${p.tone}">${esc(p.txt)}</li>`).join('')}</ul>` + compareHtml(day.date) +
      (a.estimateSec ? `<p class="msg good">Este treino indica ${A.fmtTime(a.estimateSec)} nos ${distKm()} km (${esc(a.estimateBasis)}). A estimativa foi atualizada.</p>` : '') +
      `<div class="row-actions between"><button class="btn ghost sm" id="shareW" type="button">Compartilhar</button>${st.activityId ? `<a class="muted small" href="https://www.strava.com/activities/${encodeURIComponent(st.activityId)}" target="_blank" rel="noopener">Ver no Strava ↗</a>` : ''}</div>`;
    box.hidden = false;
    $('shareW').onclick = () => shareWorkout(day);
  }

  /* ---------- Plano ---------- */
  let planWeek = null;
  const ICON = {
    run: '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M6 12l3-3 4 1 2 3 3 1"/></svg>',
    swim: '<svg viewBox="0 0 24 24"><path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M7 13l4-4 3 3M14 6.5a1.5 1.5 0 1 0 0-.1"/></svg>',
    rest: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };
  function renderPlan() {
    const d = dayOf(selected), cur = dayOf(today);
    if (planWeek == null) planWeek = d ? d.week : plan.weeks[0].n;
    const counted = x => x.type !== 'rest' && x.type !== 'swim';
    $('weekPills').innerHTML = plan.weeks.map(w => {
      const k = w.days.filter(counted), all = k.length && k.every(x => done[x.date]);
      return `<button type="button" role="tab" data-w="${w.n}" aria-selected="${w.n === planWeek}" class="${cur && cur.week === w.n ? 'now' : ''}">SEM ${w.n}${all ? ' ✓' : ''}</button>`;
    }).join('');
    document.querySelectorAll('#weekPills button').forEach(b => b.onclick = () => { planWeek = +b.dataset.w; renderPlan(); });
    const sel = document.querySelector('#weekPills [aria-selected="true"]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
    const w = plan.weeks.find(x => x.n === planWeek);
    const k = w.days.filter(counted), nDone = k.filter(x => done[x.date]).length;
    $('weekNote').innerHTML = `<div class="card-head"><div><span class="eyebrow">Semana ${w.n} · ${esc(w.range)}</span><h3>${esc(w.title)}</h3></div>${k.length ? `<span class="chip ${nDone === k.length ? 'good' : ''}">${nDone}/${k.length}</span>` : ''}</div>` +
      (k.length ? `<div class="pbar"><i style="width:${Math.round(100 * nDone / k.length)}%"></i></div>` : '') +
      (w.note ? `<p class="muted small">${esc(w.note)}</p>` : '');
    $('weekDays').innerHTML = w.days.map(x => {
      const dt = D(x.date); const kind = x.type === 'swim' ? 'swim' : x.type === 'rest' ? 'rest' : 'run';
      const right = done[x.date] ? `<span class="done">${CHECK}</span>` : x.gym ? `<span class="chip">${esc(x.gym)}</span>` : '';
      return `<button type="button" class="lrow ${x.date === today ? 'today' : ''}" data-d="${x.date}"><span class="ico ${x.key && kind === 'run' ? 'key' : kind}">${ICON[kind]}</span><span style="min-width:0"><span class="t">${esc(x.title)}</span><span class="s">${x.date === today ? 'hoje' : WD[dt.getDay()] + ' ' + ddmm(x.date)} · ${esc(TYPE_LABEL[x.type])}${x.key && kind === 'run' ? ' · chave' : ''}</span></span>${right}<span class="chev" aria-hidden="true">›</span></button>`;
    }).join('');
    document.querySelectorAll('#weekDays .lrow').forEach(b => b.onclick = () => { selected = b.dataset.d; location.hash = 'hoje'; renderAll(); window.scrollTo(0, 0); });
  }
  $('openFull').onclick = () => {
    const fp = $('fullPlan');
    if (fp.hidden) { fp.innerHTML = window.marked ? window.marked.parse(plan.raw) : `<pre style="white-space:pre-wrap">${esc(plan.raw)}</pre>`; fp.hidden = false; $('openFull').textContent = 'Esconder o plano completo'; }
    else { fp.hidden = true; $('openFull').textContent = 'Ver o plano completo'; }
  };

  /* ---------- Progresso ---------- */
  let showAllRuns = false;
  $('moreRuns').onclick = () => { showAllRuns = !showAllRuns; renderProgress(); };
  function renderProgress() {
    const rs = allRuns();
    $('runsSrc').textContent = strava.connected ? 'do Strava' : 'conecte o Strava para ver todas';
    const list = rs.slice().reverse(), shown = showAllRuns ? list : list.slice(0, 6);
    $('moreRuns').hidden = list.length <= 6;
    $('moreRuns').textContent = showAllRuns ? 'Mostrar menos' : `Ver todas (${list.length})`;
    $('chartTitle').textContent = `Tempo estimado nos ${String(distKm()).replace('.', ',')} km`;
    $('runs').innerHTML = shown.map(r => `<div class="lrow" style="cursor:default"><span class="ico run">${ICON.run}</span><span style="min-width:0"><span class="t">${esc(r.name)}</span><span class="s">${ddmm(r.date)} · ${r.km.toFixed(2).replace('.', ',')} km · ${A.fmtTime(r.sec)}${r.hr ? ` · FC ${r.hr}` : ''}</span></span><span class="v">${A.fmtPace(r.sec / r.km)}<small>/km</small></span></div>`).join('') || '<p class="muted">Nenhuma corrida ainda.</p>';

    const dates = [...new Set(rs.map(r => r.date).concat(analyses().map(a => a.date)))].sort().filter(x => x <= today);
    const pts = dates.map(d => ({ d, v: (estimateAt(d) || {}).sec })).filter(p => p.v);
    const cur = estimateAt(today); if (cur && (!pts.length || pts[pts.length - 1].d !== today)) pts.push({ d: today, v: cur.sec });
    const W = 400, H = 240, l = 44, r = 14, t = 18, b = 26;
    const t0 = D(pts.length ? pts[0].d : firstDay()).getTime(), t1 = D(raceISO()).getTime();
    const goal = goalSec();
    const vmax = Math.ceil(Math.max(goal + 600, ...pts.map(p => p.v)) / 240) * 240, vmin = Math.floor((goal - 120) / 240) * 240;
    const X = d => l + (D(d).getTime() - t0) / Math.max(1, t1 - t0) * (W - l - r);
    const Y = v => t + (vmax - v) / (vmax - vmin) * (H - t - b);
    let s = '';
    for (let v = vmin; v <= vmax; v += 240) s += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${A.fmtTime(v)}</text>`;
    s += `<line x1="${l}" x2="${W - r}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--c1)" stroke-dasharray="4 4"/><text x="${W - r}" y="${Y(goal) - 6}" text-anchor="end" font-size="11" font-weight="700" fill="var(--c1)">meta ${A.fmtTime(goal)}</text>`;
    const ticks = [[pts.length ? pts[0].d : firstDay(), null], [today, 'hoje'], [raceISO(), 'prova']];
    ticks.forEach(([d, lab]) => { s += `<text x="${X(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${lab || ddmm(d)}</text>`; });
    if (pts.length) {
      const area = `M${X(pts[0].d)},${H - b} ` + pts.map(p => `L${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ') + ` L${X(pts[pts.length - 1].d)},${H - b} Z`;
      s += `<path d="${area}" fill="var(--c3)" opacity=".10"/>`;
      s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c3)" stroke-width="2.5" stroke-linejoin="round"/>`;
      const last = pts[pts.length - 1], pr = A.project(last.v, today, raceISO());
      s += `<path d="M${X(last.d)},${Y(last.v)} L${X(raceISO())},${Y(pr)}" stroke="var(--c2)" stroke-width="2.5" stroke-dasharray="6 5" fill="none"/>`;
      pts.forEach(p => { s += `<circle cx="${X(p.d)}" cy="${Y(p.v)}" r="3.5" fill="var(--card)" stroke="var(--c3)" stroke-width="2"/>`; });
      s += `<circle cx="${X(raceISO())}" cy="${Y(pr)}" r="5.5" fill="var(--c2)"/><text x="${X(raceISO()) - 10}" y="${Y(pr) - 10}" text-anchor="end" font-size="13" font-weight="800" fill="var(--fg)">${A.fmtTime(pr)}</text>`;
    }
    $('chart').innerHTML = s;
    $('chartHint').textContent = 'A estimativa vem das suas corridas e treinos analisados. A projeção mostra onde você chega se cumprir o plano.';
  }

  /* ---------- Ajustes ---------- */
  function renderSettings() {
    const chip = $('stravaChip');
    if (!strava.checked) { chip.textContent = 'verificando'; chip.className = 'chip'; }
    else if (strava.connected) { chip.textContent = 'conectado'; chip.className = 'chip good'; }
    else { chip.textContent = 'desconectado'; chip.className = 'chip'; }
    const synced = store.get(userKey('synced'), null);
    $('stravaText').textContent = strava.connected
      ? `${strava.athlete && strava.athlete.name ? strava.athlete.name + ' · ' : ''}${synced ? 'última sincronização ' + new Date(synced).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não sincronizado'}. Os treinos do plano são analisados sozinhos quando você abre o app.`
      : strava.configured === false ? 'O Strava ainda não foi configurado neste site (faltam as chaves da API no Vercel).' : 'Conecte para puxar seus treinos e atualizar a estimativa.';
    $('stravaConnect').hidden = strava.connected;
    $('stravaSync').hidden = !strava.connected;
    $('stravaOut').hidden = !strava.connected;
    $('planInfo').textContent = plan ? `${plan.title} · ${plan.weeks.length} semanas · prova em ${ddmm(raceISO())}.` : 'Nenhum plano ainda. Gere um novo, importe um arquivo .md ou use o plano de exemplo.';
    $('planChip').textContent = plan ? planSource : 'sem plano';
    $('genBox').hidden = !genOpen;
    $('genToggle').setAttribute('aria-expanded', String(genOpen));
    const t = store.get('sub30.theme', 'system');
    document.querySelectorAll('#themePills button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.t === t)));
  }
  let genOpen = false;
  function openGen(open) {
    genOpen = open; renderSettings();
    if (open) setTimeout(() => { $('genBox').scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  }
  $('genToggle').onclick = () => openGen(!genOpen);
  document.querySelectorAll('[data-open-gen]').forEach(a => a.addEventListener('click', () => openGen(true)));
  document.querySelectorAll('#themePills button').forEach(b => b.onclick = () => {
    const t = b.dataset.t; store.set('sub30.theme', t);
    try { localStorage.setItem('sub30.theme', t); } catch (e) {}
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    renderSettings();
  });
  $('stravaSync').onclick = async () => { $('stravaSync').disabled = true; await syncAndAnalyze(false); $('stravaSync').disabled = false; renderAll(); };
  $('stravaOut').onclick = async () => { try { await api('/api/strava/logout', { method: 'POST' }); } catch (e) {} strava.connected = false; runs = []; store.set(userKey('runs'), runs); renderAll(); };
  $('mdFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('planMsg'); msg.hidden = false;
    try {
      const text = await file.text();
      const p = P.parse(text);
      if (!p.days.length) throw new Error('Não encontrei nenhum dia de treino. Confira se as tabelas têm a coluna Data com "Seg 09/11", "Ter 10/11"...');
      if (!p.race) throw new Error('Não encontrei a data da prova. Inclua uma linha como "Prova: domingo, 13/12/2026".');
      setPlanMd(text, 'importado');
      genOpen = false; renderSettings();
      msg.className = 'msg good'; msg.textContent = `Plano importado: ${p.weeks.length} semanas, ${p.days.length} dias, prova em ${ddmm(p.race)}.`;
      clampSelected(); renderAll();
    } catch (err) { msg.className = 'msg bad'; msg.textContent = err.message; }
    e.target.value = '';
  };
  $('planReset').onclick = async () => { try { setPlanMd(await examplePlanMd(), 'exemplo'); const msg = $('planMsg'); msg.hidden = false; msg.className = 'msg'; msg.textContent = 'Plano de exemplo carregado.'; } catch (e) { showToast('Não consegui carregar o exemplo.', true); } };
  let clearArmed = false;
  $('clearDone').onclick = () => {
    const msg = $('clearMsg');
    if (!clearArmed) { clearArmed = true; $('clearDone').textContent = 'Toque de novo para apagar'; msg.hidden = false; msg.className = 'msg'; msg.textContent = 'Isso apaga as marcações e análises deste aparelho.'; setTimeout(() => { clearArmed = false; $('clearDone').textContent = 'Apagar treinos marcados'; msg.hidden = true; }, 5000); return; }
    done = {}; persist(); clearArmed = false; $('clearDone').textContent = 'Apagar treinos marcados'; msg.className = 'msg good'; msg.textContent = 'Marcações apagadas.'; renderAll();
  };


  /* ---------- Gerar plano ---------- */
  let generated = null;
  const toSec = s => { const p = String(s || '').trim().split(':').map(Number); if (p.some(isNaN) || p.length < 2) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  (function initGen() {
    const f = $('genForm'); if (!f) return;
    $('gStart').value = addDays(today, 1);
    f.onsubmit = e => {
      e.preventDefault();
      const msg = $('genMsg'); msg.hidden = false; $('genActions').hidden = true;
      const goalSec = toSec($('gGoal').value), race = $('gRace').value, start = $('gStart').value;
      if (!race || !start) { msg.className = 'msg bad'; msg.textContent = 'Preencha a data da prova e o início do plano.'; return; }
      if (race <= start) { msg.className = 'msg bad'; msg.textContent = 'A prova precisa ser depois do início do plano.'; return; }
      if ((D(race) - D(start)) / 864e5 > 168) { msg.className = 'msg bad'; msg.textContent = 'Escolha um período de até 24 semanas.'; return; }
      if (!goalSec) { msg.className = 'msg bad'; msg.textContent = 'Escreva o tempo-objetivo como 30:00 ou 1:55:00.'; return; }
      let cur = toSec($('gCur').value);
      if ($('gCur').value.trim() && !cur) { msg.className = 'msg bad'; msg.textContent = 'Escreva o tempo atual nos 5 km como 42:30.'; return; }
      if (!cur) { const est = estimateAt(today); cur = est ? est.sec * (5 / distKm()) : null; }
      try {
        const md = window.PlanGenerator.generate({ start, race, distanceKm: +$('gDist').value, goalSec, currentSec5k: cur, runDays: +$('gDays').value, swim: $('gSwim').checked, gym: $('gGym').checked, level: $('gLevel').value });
        const p = P.parse(md);
        if (!p.days.length) throw new Error('Não consegui montar o plano com esses dados.');
        generated = md;
        msg.className = 'msg good';
        msg.textContent = `Plano pronto: ${p.weeks.length} semanas até ${ddmm(p.race)}.${cur ? '' : ' Sem corridas registradas, usei uma estimativa a partir da meta; informe seu tempo atual para ajustar.'}`;
        const a = $('gDownload'); if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
        a.dataset.url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.href = a.dataset.url;
        $('genActions').hidden = false;
      } catch (err) { msg.className = 'msg bad'; msg.textContent = err.message; }
    };
    $('gUse').onclick = () => {
      if (!generated) return;
      const curTyped = toSec($('gCur').value);
      if (curTyped) done._base = { date: today, sec: curTyped };
      setPlanMd(generated, 'gerado no app');
      $('genActions').hidden = true;
      genOpen = false; $('genMsg').hidden = true; location.hash = 'hoje'; showToast('Plano novo em uso.');
    };
  })();

  /* ---------- Como foi o treino ---------- */
  let feelEditing = null, feelDraft = {};
  function feelHtml(date) {
    const f = extra.feel[date];
    if (f && feelEditing !== date) {
      return `<div class="feel-sum"><span>Esforço <b>${f.rpe}/10</b> · Dor <b>${esc(f.pain)}</b>${f.sleep ? ` · Sono <b>${f.sleep >= 9 ? '9h+' : f.sleep <= 5 ? '5h ou menos' : f.sleep + 'h'}</b>` : ''}</span><button class="linkbtn" id="feelEdit" type="button">editar</button></div>`;
    }
    feelDraft = { ...(f || {}) };
    const btns = (id, opts) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`).join('')}</div>`;
    return `<div class="feel" id="feel"><span class="eyebrow">Como foi?</span>` +
      `<div class="flbl">Esforço <small class="muted">1 = muito fácil · 10 = máximo</small></div>` + btns('fRpe', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, n])) +
      `<div class="flbl">Dor</div>` + btns('fPain', [['nenhuma', 'Nenhuma'], ['leve', 'Leve'], ['forte', 'Forte']]) +
      `<div class="flbl">Sono na última noite</div>` + btns('fSleep', [[5, '≤5h'], [6, '6h'], [7, '7h'], [8, '8h'], [9, '9h+']]) +
      `<div class="row-actions"><button class="btn" id="fSave" type="button">Salvar</button>${f ? '<button class="btn ghost" id="fCancel" type="button">Cancelar</button>' : ''}</div></div>`;
  }
  function bindFeel(date) {
    const e = $('feelEdit'); if (e) e.onclick = () => { feelEditing = date; renderWorkout(); };
    if (!$('feel')) return;
    const sync = () => {
      [['fRpe', 'rpe'], ['fPain', 'pain'], ['fSleep', 'sleep']].forEach(([id, k]) => $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(String(feelDraft[k]) === b.dataset.v))));
      $('fSave').disabled = !(feelDraft.rpe && feelDraft.pain);
    };
    [['fRpe', 'rpe', Number], ['fPain', 'pain', String], ['fSleep', 'sleep', Number]].forEach(([id, k, cast]) => $(id).querySelectorAll('button').forEach(b => b.onclick = () => { feelDraft[k] = cast(b.dataset.v); sync(); }));
    $('fSave').onclick = () => { extra.feel[date] = { rpe: feelDraft.rpe, pain: feelDraft.pain, sleep: feelDraft.sleep || null }; feelEditing = null; persist(); renderAll(); };
    const c = $('fCancel'); if (c) c.onclick = () => { feelEditing = null; renderWorkout(); };
    sync();
  }
  // Sinais de cansaço a partir do que foi registrado nos últimos dias.
  function fatigue() {
    const recent = Object.entries(extra.feel).filter(([d]) => d <= today && d >= addDays(today, -4)).sort((a, b) => a[0].localeCompare(b[0]));
    const why = [];
    const last = recent.slice(-3);
    if (last.length >= 2 && last.reduce((s, [, f]) => s + f.rpe, 0) / last.length >= 8) why.push('esforço muito alto nos últimos treinos');
    const strong = recent.some(([d, f]) => f.pain === 'forte' && d >= addDays(today, -2));
    if (strong) why.push('dor forte');
    else if (recent.filter(([, f]) => f.pain === 'leve').length >= 2) why.push('dor leve repetida');
    if (recent.filter(([, f]) => f.sleep && f.sleep <= 5).length >= 2) why.push('poucas horas de sono');
    return { why, strong };
  }

  /* ---------- Sugestão de ajuste na tela Hoje ---------- */
  function suggestion() {
    if (!plan) return null;
    // 1) treino-chave dos últimos 3 dias que ficou sem fazer
    for (let i = 1; i <= 3; i++) {
      const dt = addDays(today, -i), d = dayOf(dt);
      if (!d || dt < firstDay() || !isHard(d) || done[dt] || extra.dismiss[dt]) continue;
      const w = plan.weeks.find(x => x.n === d.week);
      const hardAt = x => isHard(dayOf(x));
      const free = w.days.filter(x => x.date >= today && x.date < addDays(raceISO(), -2) && isRunType(x.type) && !isHard(x) && x.type !== 'race' && !done[x.date] && !extra.moves[x.date]);
      const target = d.movedFrom ? null : free.find(x => !hardAt(addDays(x.date, -1)) && !hardAt(addDays(x.date, 1)) && !(done[addDays(x.date, -1)] && isHard(dayOf(addDays(x.date, -1)))));
      return { kind: 'missed', date: dt, day: d, target };
    }
    // 2) cansaço acumulado: aliviar o próximo treino forte
    const f = fatigue();
    if (f.why.length) {
      for (let i = 0; i <= 2; i++) {
        const dt = addDays(today, i), d = dayOf(dt);
        if (d && isHard(d) && !done[dt] && !extra.dismiss['f' + dt]) return { kind: 'fatigue', date: dt, day: d, why: f.why, strong: f.strong };
      }
    }
    return null;
  }
  function renderAdjust() {
    const box = $('adjust');
    const sg = selected === today ? suggestion() : null;
    if (!sg) { box.hidden = true; return; }
    const fmtD = dt => `${WDL[D(dt).getDay()].toLowerCase()}, ${ddmm(dt)}`;
    let html;
    if (sg.kind === 'missed') {
      html = `<span class="eyebrow">Ajuste do plano</span><h3>Ficou faltando: ${esc(sg.day.title)}</h3>` +
        (sg.target ? `<p class="muted">Era um treino-chave de ${fmtD(sg.date)}. Dá para encaixar na ${fmtD(sg.target.date)}, no lugar do treino leve, sem colar em outro treino forte.</p>`
          : `<p class="muted">Era um treino-chave de ${fmtD(sg.date)}. Não há um dia bom nesta semana para encaixar sem colar em outro treino forte. O melhor é pular e seguir a semana.</p>`) +
        `<div class="row-actions">${sg.target ? `<button class="btn" id="adjMove" type="button">Passar para ${WD[D(sg.target.date).getDay()]} ${ddmm(sg.target.date)}</button>` : ''}<button class="btn ${sg.target ? 'ghost' : ''}" id="adjSkip" type="button">Pular este treino</button><button class="btn ghost" id="adjLater" type="button">Agora não</button></div>`;
    } else {
      html = `<span class="eyebrow">Ajuste do plano</span><h3>Sinais de cansaço</h3><p class="muted">Você registrou ${esc(sg.why.join(', '))}. Sugestão: trocar "${esc(sg.day.title)}" de ${fmtD(sg.date)} por um treino leve.${sg.strong ? ' Se a dor continuar, procure uma avaliação antes de voltar aos treinos fortes.' : ''}</p>` +
        `<div class="row-actions"><button class="btn" id="adjSoft" type="button">Trocar por leve</button><button class="btn ghost" id="adjLater" type="button">Manter o treino</button></div>`;
    }
    box.innerHTML = html; box.hidden = false;
    const mv = $('adjMove'); if (mv) mv.onclick = () => { extra.moves[sg.target.date] = sg.day.movedFrom || sg.date; refreshAdjust(); showToast('Treino remarcado.'); };
    const sk = $('adjSkip'); if (sk) sk.onclick = () => { if (sg.day.movedFrom) { delete extra.moves[sg.date]; extra.skips[sg.day.movedFrom] = true; } else extra.skips[sg.date] = true; refreshAdjust(); };
    const so = $('adjSoft'); if (so) so.onclick = () => { extra.soft[sg.date] = true; refreshAdjust(); showToast('Treino trocado por leve.'); };
    $('adjLater').onclick = () => { extra.dismiss[(sg.kind === 'fatigue' ? 'f' : '') + sg.date] = true; persist(); renderAll(); };
  }

  /* ---------- Análise automática pelo Strava ---------- */
  async function autoAnalyze() {
    if (!strava.connected || !plan) return 0;
    const from = addDays(today, -7) > firstDay() ? addDays(today, -7) : firstDay();
    let n = 0;
    for (const d of plan.days) {
      if (d.date < from || d.date > today || done[d.date] || !isRunType(d.type) || extra.dismiss['a' + d.date]) continue;
      const r = runs.filter(x => x.date === d.date).sort((a, b) => b.km - a.km)[0];
      if (!r) continue;
      try {
        const act = await api(`/api/strava/activity?id=${encodeURIComponent(r.stravaId)}`);
        done[d.date] = { at: Date.now(), activityId: act.id, name: act.name, analysis: A.analyze(act, d, { goalSec: goalSec(), distanceKm: distKm() }), auto: true };
        maybeSetTest(d, done[d.date].analysis);
        n++;
      } catch (e) { if (e.status === 401 || e.status === 429) break; }
      if (n >= 4) break;
    }
    if (n) persist();
    return n;
  }
  let lastAuto = 0;
  async function syncAndAnalyze(quiet) {
    if (!strava.connected) return;
    lastAuto = Date.now();
    try { await syncRuns(); } catch (e) { return; }
    const n = await autoAnalyze();
    renderAll();
    if (n) showToast(n === 1 ? '1 treino analisado automaticamente pelo Strava.' : `${n} treinos analisados automaticamente pelo Strava.`);
    else if (!quiet) showToast('Strava sincronizado.');
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastAuto > 10 * 60 * 1000) syncAndAnalyze(true); });

  /* ---------- Zonas de frequência cardíaca ---------- */
  const ZCOL = ['var(--z1)', 'var(--c3)', 'var(--good)', 'var(--c2)', 'var(--bad)'];
  function observedMaxHr() {
    let m = 0;
    Object.values(done).forEach(v => { if (v && v.analysis && v.analysis.metrics && v.analysis.metrics.maxHr) m = Math.max(m, v.analysis.metrics.maxHr); });
    return m >= 150 ? m : null;
  }
  function hrZones() {
    const fromMax = (max, src) => ({ src, max, z: [[.5, .6], [.6, .7], [.7, .8], [.8, .9], [.9, 1]].map(([a, b]) => [Math.round(max * a), Math.round(max * b)]) });
    if (extra.hrMax) return fromMax(extra.hrMax, 'pela FC máxima informada');
    const m = plan && /Z1\s*(\d{2,3})\s*[–-]\s*(\d{2,3})[^\n]*?Z2\s*(\d{2,3})\s*[–-]\s*(\d{2,3})[^\n]*?Z3\s*(\d{2,3})\s*[–-]\s*(\d{2,3})[^\n]*?Z4\s*(\d{2,3})\s*[–-]\s*(\d{2,3})[^\n]*?Z5\s*(\d{2,3})\s*[–-]\s*(\d{2,3})/.exec(plan.raw);
    if (m) { const v = m.slice(1).map(Number); return { src: 'do plano', max: v[9], z: [0, 1, 2, 3, 4].map(i => [v[2 * i], v[2 * i + 1]]) }; }
    const o = observedMaxHr();
    return o ? fromMax(o, 'pela maior FC dos seus treinos') : null;
  }
  const zoneOf = (hr, Z) => { for (let i = 0; i < 4; i++) if (hr < Z.z[i][1]) return i; return 4; };
  function zoneTimes(splits, Z) {
    const t = [0, 0, 0, 0, 0];
    (splits || []).forEach(s => { if (s.hr && s.pace) t[zoneOf(s.hr, Z)] += s.pace; });
    return t;
  }
  function zoneBar(t) {
    const tot = t.reduce((a, b) => a + b, 0); if (!tot) return '';
    return `<div class="zbar">${t.map((v, i) => v ? `<i style="width:${(100 * v / tot).toFixed(1)}%;background:${ZCOL[i]}"></i>` : '').join('')}</div>` +
      `<div class="zleg">${t.map((v, i) => !v ? '' : `<span><i style="background:${ZCOL[i]}"></i>Z${i + 1} ${Math.round(100 * v / tot)}%</span>`).join('')}</div>`;
  }
  function renderZones() {
    const box = $('zonesCard'); const Z = hrZones();
    if (!Z) { box.innerHTML = `<div class="card-head"><h2>Zonas de FC</h2></div><p class="muted small">As zonas aparecem quando houver treinos analisados com frequência cardíaca, ou quando você informar sua FC máxima em Ajustes.</p>`; return; }
    const from = addDays(today, -28), t = [0, 0, 0, 0, 0]; let n = 0;
    Object.entries(done).forEach(([d, v]) => { if (d >= from && v && v.analysis && v.analysis.splits) { const z = zoneTimes(v.analysis.splits, Z); if (z.some(Boolean)) { n++; z.forEach((x, i) => { t[i] += x; }); } } });
    const tot = t.reduce((a, b) => a + b, 0), easy = tot ? Math.round(100 * (t[0] + t[1]) / tot) : 0;
    box.innerHTML = `<div class="card-head"><h2>Zonas de FC</h2><span class="muted small">últimos 28 dias</span></div>` +
      (tot ? zoneBar(t) + `<p class="muted small">${n} treino${n > 1 ? 's' : ''} com FC. ${easy}% do tempo em Z1–Z2. Para 5 km, o ideal é 70–80% fácil e o resto forte.${easy < 60 ? ' Seus leves podem estar fortes demais.' : ''}</p>` : '<p class="muted small">Ainda não há treinos analisados com FC nesse período.</p>') +
      `<div class="ztable">${Z.z.map(([a, b], i) => `<span><i style="background:${ZCOL[i]}"></i>Z${i + 1}</span><b>${a}–${b}</b>`).join('')}</div><p class="muted small">Zonas ${esc(Z.src)}.</p>`;
  }
  function renderHr() {
    const Z = hrZones();
    $('hrChip').textContent = Z ? (extra.hrMax ? 'informada' : Z.src === 'do plano' ? 'do plano' : 'estimada') : 'sem dados';
    $('hrText').textContent = Z ? `Zonas ${Z.src}: ${Z.z.map(([a, b], i) => `Z${i + 1} ${a}–${b}`).join(' · ')}.` : 'Informe sua FC máxima (de um teste ou do relógio) para calcular as zonas.';
    if (document.activeElement !== $('hrMax')) $('hrMax').value = extra.hrMax || '';
  }
  $('hrForm').onsubmit = e => {
    e.preventDefault();
    const v = parseInt($('hrMax').value, 10);
    if ($('hrMax').value.trim() && !(v >= 140 && v <= 220)) { showToast('Informe uma FC máxima entre 140 e 220.', true); return; }
    extra.hrMax = v || null; persist(); renderAll(); showToast(v ? 'FC máxima salva.' : 'FC máxima removida.');
  };

  /* ---------- Plano de prova ---------- */
  function racePlan() {
    const dist = distKm(), goal = goalSec();
    const est = estimateAt(today), proj = est ? A.project(est.sec, today, raceISO()) : null;
    let target = goal, note;
    if (!proj) note = 'Sem corridas recentes, o plano usa a sua meta. Ele se ajusta sozinho conforme os treinos forem analisados.';
    else if (proj <= goal) { target = goal - Math.round(dist); note = `Sua projeção (${A.fmtTime(proj)}) está dentro da meta. Mire ${A.fmtTime(target)} para ter uma pequena folga.`; }
    else if (proj - goal <= 60) note = `Sua projeção (${A.fmtTime(proj)}) está perto da meta. Dá para buscar ${A.fmtTime(goal)} se o teste confirmar.`;
    else { target = Math.round(proj / 5) * 5; note = `Hoje a projeção é ${A.fmtTime(proj)}. Largar no ritmo da meta pode te fazer quebrar no meio. Mire ${A.fmtTime(target)} e ajuste depois do teste.`; }
    const n = Math.ceil(dist - 1e-9), segs = [];
    for (let k = 1; k <= n; k++) segs.push(Math.min(1, dist - (k - 1)));
    const off = segs.map((_, i) => i === 0 ? 3 : i === n - 1 ? -3 : i === n - 2 && n > 3 ? -1 : 0);
    const base = (target - off.reduce((s, o, i) => s + o * segs[i], 0)) / dist;
    let acc = 0;
    const rows = segs.map((len, i) => { const pace = base + off[i]; acc += pace * len; return { km: i + 1, len, pace, acc }; });
    return { target, note, rows, proj };
  }
  function planSection(re) {
    if (!plan || !plan.raw) return '';
    const lines = plan.raw.split('\n'); const i = lines.findIndex(l => /^#{2,3}\s/.test(l) && re.test(l));
    if (i < 0) return '';
    const lvl = lines[i].match(/^#+/)[0].length; const out = [];
    for (let j = i + 1; j < lines.length; j++) { const m = lines[j].match(/^(#+)\s/); if (m && m[1].length <= lvl) break; if (/^---\s*$/.test(lines[j])) break; out.push(lines[j]); }
    return out.join('\n').trim();
  }
  const raceDays = () => Math.ceil((D(raceISO()) - D(today)) / 864e5);
  function renderRace() {
    const box = $('raceCard'); if (!plan) { box.innerHTML = ''; return; }
    const r = racePlan(), dist = distKm();
    const show = dist > 10 ? r.rows.filter(x => x.km % 5 === 0 || x.km === r.rows.length) : r.rows;
    const sec = planSection(/estrat[ée]gia de prova/i);
    box.innerHTML = `<div class="card-head"><div><span class="eyebrow">Plano de prova · ${ddmm(raceISO())}</span><h3>Alvo: ${A.fmtTime(r.target)}</h3></div><span class="chip key">${A.fmtPace(r.target / dist)}/km</span></div>` +
      `<p class="muted small">${esc(r.note)}</p>` +
      `<div class="tbl"><table><thead><tr><th>Km</th><th>Ritmo</th><th>Acumulado</th></tr></thead><tbody>${show.map(x => `<tr><td>${x.len < 1 ? `${x.km - 1 + +x.len.toFixed(1)}`.replace('.', ',') : x.km}</td><td>${A.fmtPace(x.pace)}/km</td><td>${A.fmtTime(Math.round(x.acc))}</td></tr>`).join('')}</tbody></table></div>` +
      `<p class="muted small">O relógio costuma marcar um pouco mais que a distância oficial. Mire 3–5 s/km mais rápido do que a tabela no relógio.</p>` +
      `<div class="race-sched"><label for="rStart">Horário da largada<input id="rStart" type="time" value="${raceCfg().start}"></label><button class="btn ghost" id="rmOpen2" type="button">Tela da prova</button></div>` +
      `<details class="race"${raceDays() <= 3 ? ' open' : ''}><summary>Horários do dia</summary>${timelineHtml()}</details>` +
      `<details class="race"${raceDays() <= 3 ? ' open' : ''}><summary>Checklist da véspera e do dia</summary>${raceChecksHtml()}</details>` +
      (sec && window.marked ? `<details class="prose"><summary>Estratégia do seu plano</summary>${window.marked.parse(sec)}</details>` : '');
    bindRaceChecks(box);
    $('rmOpen2').onclick = openRaceMode;
    $('rStart').onchange = () => { const v = $('rStart').value; if (!/^\d{2}:\d{2}$/.test(v)) return; extra.race = { ...raceCfg(), start: v }; persist(); renderAll(); };
  }

  /* ---------- Alimentação e peso ---------- */
  const DIET = ['Proteína em todas as refeições', '2 a 3 litros de água', 'Frutas e verduras no almoço e no jantar', 'Carboidrato antes e depois do treino forte', 'Sem álcool e sem ultraprocessados'];
  function renderDiet() {
    const box = $('dietCard');
    if (!plan || selected !== today) { box.hidden = true; return; }
    const got = extra.diet[today] || [];
    let week = 0; for (let i = 0; i < 7; i++) { const g = extra.diet[addDays(today, -i)] || []; if (g.length >= 4) week++; }
    const lw = extra.weights.slice(-1)[0];
    const weigh = !lw || lw.date <= addDays(today, -7);
    box.innerHTML = `<div class="card-head"><h2>Alimentação de hoje</h2><span class="chip ${got.length >= 4 ? 'good' : ''}">${got.length}/${DIET.length}</span></div>` +
      `<div class="checklist">${DIET.map((t, i) => `<button type="button" class="ck" data-i="${i}" aria-pressed="${got.includes(i)}"><span class="box"></span>${esc(t)}</button>`).join('')}</div>` +
      `<p class="muted small">Últimos 7 dias: ${week} dia${week === 1 ? '' : 's'} com 4 ou mais itens.</p>` +
      (weigh ? `<div class="wdue"><span class="flbl">${lw ? 'Hora da pesagem semanal' : 'Registre seu peso'} <small class="muted">em jejum</small></span><form class="wform" id="wQuick" novalidate><input id="wQuickKg" type="text" inputmode="decimal" placeholder="kg, ex.: 82,4" aria-label="Peso de hoje em kg"><button class="btn" type="submit">Salvar</button></form></div>` : '');
    box.hidden = false;
    box.querySelectorAll('.ck').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, cur = new Set(extra.diet[today] || []);
      cur.has(i) ? cur.delete(i) : cur.add(i);
      extra.diet[today] = [...cur].sort(); persist(); renderDiet();
    });
    const wq = $('wQuick'); if (wq) wq.onsubmit = e => { e.preventDefault(); saveWeight($('wQuickKg').value); };
  }
  function saveWeight(txt) {
    const v = parseFloat(String(txt).replace(',', '.'));
    if (!(v >= 30 && v <= 250)) { showToast('Informe o peso em kg, como 82,4.', true); return; }
    extra.weights = extra.weights.filter(w => w.date !== today).concat({ date: today, kg: Math.round(v * 10) / 10 }).sort((a, b) => a.date.localeCompare(b.date));
    persist(); renderWeight(); renderDiet(); showToast('Peso registrado.');
  }
  const fmtKg = v => v.toFixed(1).replace('.', ',');
  function renderWeight() {
    const box = $('weightCard'); const W = extra.weights;
    const last = W[W.length - 1], first = W[0];
    let chart = '';
    if (W.length >= 2) {
      const pts = W.slice(-12), lo = Math.min(...pts.map(p => p.kg)) - 0.5, hi = Math.max(...pts.map(p => p.kg)) + 0.5;
      const X = i => 10 + i * (280 / Math.max(1, pts.length - 1)), Y = v => 8 + (hi - v) / (hi - lo) * 64;
      chart = `<svg class="spark" viewBox="0 0 300 80" aria-hidden="true"><path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c1)" stroke-width="2.5" stroke-linejoin="round"/>${pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="3.5" fill="var(--card)" stroke="var(--c1)" stroke-width="2"/>`).join('')}</svg>`;
    }
    const diff = last && first && last !== first ? last.kg - first.kg : null;
    box.innerHTML = `<div class="card-head"><h2>Peso</h2>${last ? `<span class="chip">${fmtKg(last.kg)} kg</span>` : ''}</div>` +
      (diff != null ? `<p class="muted small">${diff <= 0 ? 'Menos' : 'Mais'} ${fmtKg(Math.abs(diff))} kg desde ${ddmm(first.date)}. Cada kg a menos vale ~4–6 s/km na corrida.</p>` : '<p class="muted small">Pese-se 1× por semana, em jejum, no mesmo dia e horário.</p>') +
      chart +
      `<form class="wform" id="wForm" novalidate><input id="wKg" type="text" inputmode="decimal" placeholder="Peso de hoje (kg)" aria-label="Peso de hoje em kg"><button class="btn" type="submit">Salvar</button></form>` +
      (W.length ? `<div class="wlist">${W.slice(-5).reverse().map(w => `<span>${ddmm(w.date)}</span><b>${fmtKg(w.kg)} kg</b><button type="button" class="linkbtn" data-del="${w.date}" aria-label="Apagar">apagar</button>`).join('')}</div>` : '');
    $('wForm').onsubmit = e => { e.preventDefault(); saveWeight($('wKg').value); };
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { extra.weights = extra.weights.filter(w => w.date !== b.dataset.del); persist(); renderWeight(); });
  }

  /* ---------- Instalar como app ---------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); });
  function renderInstall() {
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('installChip').textContent = standalone ? 'instalado' : 'no navegador';
    $('installChip').className = standalone ? 'chip good' : 'chip';
    $('installText').textContent = standalone ? 'Você está usando o app instalado. Ele funciona sem internet; o Strava sincroniza quando a conexão voltar.'
      : ios ? 'No iPhone: abra este site no Safari, toque em Compartilhar (quadrado com seta para cima) e depois em "Adicionar à Tela de Início". No app instalado, conecte o Strava de novo e use o backup para levar seus dados.'
      : installEvt ? 'Instale o PacePro na tela inicial: ele abre em tela cheia e funciona sem internet.'
      : 'No Android, use o menu do Chrome (⋮) e toque em "Instalar app" ou "Adicionar à tela inicial".';
    $('installBtn').hidden = !installEvt || standalone;
    $('installCard').hidden = standalone;
  }
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; renderInstall(); };
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(reg => {
    swReg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); }); });
  }).catch(() => {}));

  /* ---------- Ritmos recalculados pelo teste ---------- */
  const PG = window.PlanGenerator;
  const fmtP5 = s => { s = Math.round(s / 5) * 5; return `${Math.floor(s / 60)}'${pad(s % 60)}"`; };
  function testPaces() {
    const t = extra.test; if (!t || !t.sec5k || !PG) return null;
    const vdot = PG.vdotFrom(5000, t.sec5k);
    return { vdot, p: PG.paces(vdot) };
  }
  // Ajusta os treinos fortes depois do teste: troca os ritmos do texto pelos novos.
  function applyTestPaces(d, d0) {
    const tp = testPaces();
    if (!tp || d.date <= extra.test.date || !['threshold', 'interval'].includes(d.type) || d.softened) return d;
    const want = Math.round((d.type === 'threshold' ? tp.p.threshold : tp.p.interval) / 5) * 5;
    const first = /(\d{1,2})'(\d{2})"/.exec(d.rua || '');
    const base = d.targetPace || (first ? +first[1] * 60 + +first[2] : null);
    if (!base) return { ...d, targetPace: Math.round(want / 5) * 5, paceNew: true };
    const f = Math.min(1.15, Math.max(0.88, want / base));
    if (Math.abs(f - 1) < 0.01) return d;
    // Com ritmo-alvo: troca só os ritmos "/km". Sem ritmo-alvo (ex.: "no ritmo da tabela"): troca também os tempos de cada tiro.
    const re = d.targetPace ? /(\d{1,2})'(\d{2})"\/km/g : /(\d{1,2})'(\d{2})"(\/km)?/g;
    const sp = s => s.replace(re, (m, a, b, k) => `${d.targetPace || k ? fmtP5((+a * 60 + +b) * f) : A.fmtPace(Math.round((+a * 60 + +b) * f))}${d.targetPace || k ? '/km' : ''}`);
    const kmh = s => s.replace(/\b(\d{1,2}),(\d)\b/g, (m, a, b) => { const v = parseFloat(`${a}.${b}`); return v >= 6 ? (v / f).toFixed(1).replace('.', ',') : m; });
    return { ...d, rua: sp(d.rua), title: sp(d.title), esteira: kmh(d.targetPace ? (d.esteira || '') : sp(d.esteira || '')), targetPace: Math.round(base * f / 5) * 5, paceFrom: d0.targetPace || null, paceNew: !d0.targetPace };
  }
  const riegel5k = (sec, km) => sec * Math.pow(5 / km, 1.06);
  function maybeSetTest(day, an) {
    if (!day || day.type !== 'test' || !an || !an.metrics || an.metrics.distKm < 2.5) return;
    extra.test = { date: day.date, sec5k: Math.round(riegel5k(an.metrics.time, an.metrics.distKm)), auto: true };
    applyAdjust();
    showToast('Teste registrado: os ritmos das próximas semanas foram atualizados.');
  }
  function renderTest() {
    const box = $('testCard'); if (!plan) { box.innerHTML = ''; return; }
    const tp = testPaces(), t = extra.test;
    const testDay = plan.days.find(d => d.type === 'test');
    box.innerHTML = `<div class="card-head"><h2>Teste de 5 km</h2>${t ? `<span class="chip good">${A.fmtTime(t.sec5k)}</span>` : testDay ? `<span class="chip">${ddmm(testDay.date)}</span>` : ''}</div>` +
      (tp ? `<p class="muted small">Ritmos atualizados a partir do teste de ${ddmm(t.date)}. Os treinos de limiar e intervalado depois dessa data já usam os novos ritmos.</p>` +
        `<div class="ztable"><span>Leve</span><b>${fmtP5(tp.p.easySlow)}–${fmtP5(tp.p.easyFast)}</b><span>Limiar</span><b>${fmtP5(tp.p.threshold)}</b><span>Intervalado</span><b>${fmtP5(tp.p.interval)}</b><span>Tiros curtos</span><b>${fmtP5(tp.p.rep)}</b></div>` +
        `<p class="muted small">Previsão: 5 km em ${A.fmtTime(PG.raceTime(tp.vdot, 5000))} · 10 km em ${A.fmtTime(PG.raceTime(tp.vdot, 10000))}.</p>`
        : `<p class="muted small">${testDay ? `Quando você fizer o teste (${WDL[D(testDay.date).getDay()].toLowerCase()}, ${ddmm(testDay.date)}), o app atualiza sozinho os ritmos das semanas seguintes.` : 'Registre o tempo de um teste de 5 km para atualizar os ritmos dos treinos.'} Também dá para digitar o tempo aqui.</p>`) +
      `<form class="wform" id="testForm" novalidate><input id="testTime" type="text" inputmode="numeric" placeholder="Tempo nos 5 km (ex.: 32:40)" aria-label="Tempo do teste"><button class="btn ghost" type="submit">Salvar</button></form>` +
      (t ? '<button class="linkbtn" id="testClear" type="button">Voltar aos ritmos do plano</button>' : '');
    $('testForm').onsubmit = e => {
      e.preventDefault();
      const s = toSec($('testTime').value);
      if (!s || s < 900 || s > 3600) { showToast('Escreva o tempo como 32:40.', true); return; }
      extra.test = { date: testDay && testDay.date <= today ? testDay.date : today, sec5k: s };
      refreshAdjust(); showToast('Ritmos atualizados.');
    };
    const c = $('testClear'); if (c) c.onclick = () => { extra.test = null; refreshAdjust(); };
  }

  /* ---------- Clima ---------- */
  const WX_DEF = { lat: -3.7319, lon: -38.5267, name: 'Fortaleza', hour: 6 };
  const wxCfg = () => ({ ...WX_DEF, ...(extra.wx || {}) });
  let wxData = null, wxLoading = false;
  async function loadWx(force) {
    const c = wxCfg(), key = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
    const cached = store.get(userKey('wx'), null);
    if (!force && cached && cached.key === key && Date.now() - cached.at < 3 * 3600e3) { wxData = cached; return; }
    if (wxLoading) return; wxLoading = true;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability&timezone=America%2FFortaleza&past_days=2&forecast_days=16`;
      const r = await fetch(u); if (!r.ok) throw new Error();
      const j = await r.json();
      wxData = { key, at: Date.now(), h: j.hourly };
      store.set(userKey('wx'), wxData);
    } catch (e) { wxData = cached || null; }
    wxLoading = false;
  }
  function wxAt(date) {
    if (!wxData || !wxData.h) return null;
    const c = wxCfg(), i = wxData.h.time.indexOf(`${date}T${pad(c.hour)}:00`);
    if (i < 0) return null;
    const g = k => wxData.h[k] ? wxData.h[k][i] : null;
    return { t: g('temperature_2m'), rh: g('relative_humidity_2m'), dp: g('dew_point_2m'), feel: g('apparent_temperature'), rain: g('precipitation_probability') };
  }
  // Ajuste de ritmo pelo calor: soma de temperatura e ponto de orvalho em °F.
  function heatPct(w) {
    if (!w || w.t == null || w.dp == null) return 0;
    const s = (w.t * 9 / 5 + 32) + (w.dp * 9 / 5 + 32);
    const tbl = [[100, 0], [110, 0.25], [120, 0.75], [130, 1.5], [140, 2.5], [150, 3.75], [160, 5.25], [170, 7], [180, 9]];
    let pct = 0; for (const [lim, v] of tbl) if (s > lim) pct = v;
    return s > 180 ? 10 : pct;
  }
  function wxBlock(day) {
    const w = wxAt(day.date); if (!w) return '';
    const pct = heatPct(w), c = wxCfg();
    const add = day.targetPace ? Math.round(day.targetPace * pct / 100) : 0;
    const note = pct === 0 ? 'Clima bom para correr.' : add ? `Calor: corra uns ${add} s/km mais devagar que o alvo (${A.fmtPace(day.targetPace + add)}/km) e beba água.` : pct >= 3 ? 'Calor forte: vá pela FC e não pelo ritmo, e leve água.' : 'Um pouco de calor: vá pela FC e hidrate bem.';
    return `<div class="blk wx"><span class="k">Clima às ${c.hour}h${c.name ? ' · ' + esc(c.name) : ''}</span><span class="wxl"><b>${Math.round(w.t)}°</b> sensação ${Math.round(w.feel)}° · umidade ${Math.round(w.rh)}%${w.rain >= 30 ? ` · chuva ${w.rain}%` : ''}</span><p class="note">${note}</p></div>`;
  }
  function renderWxSettings() {
    const c = wxCfg(), sel = $('wxHour');
    if (!sel.options.length) for (let h = 4; h <= 21; h++) sel.add(new Option(`Treino às ${h}h`, h));
    sel.value = c.hour;
    $('wxChip').textContent = c.name || 'local';
    $('wxText').textContent = `Previsão de ${c.name || 'sua localização'} no horário do treino, com ajuste do ritmo pelo calor.`;
  }
  // Nome da cidade a partir das coordenadas (serviços gratuitos, sem chave).
  async function placeName(lat, lon) {
    const get = async (u, pick) => { try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); return r.ok ? pick(await r.json()) : null; } catch { return null; } };
    const join = (a, b) => [a, b].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', ') || null;
    return await get(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`,
        j => join(j.city || j.locality, (j.principalSubdivisionCode || '').split('-')[1] || j.principalSubdivision))
      || await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=pt-BR`,
        j => { const a = j.address || {}; return join(a.city || a.town || a.village || a.municipality, (a['ISO3166-2-lvl4'] || '').split('-')[1] || a.state); });
  }
  $('wxHour').onchange = () => { extra.wx = { ...wxCfg(), hour: +$('wxHour').value }; persist(); renderAll(); };
  $('wxLoc').onclick = () => {
    if (!navigator.geolocation) { showToast('Seu navegador não informa a localização.', true); return; }
    $('wxLoc').disabled = true;
    navigator.geolocation.getCurrentPosition(async p => {
      const lat = +p.coords.latitude.toFixed(3), lon = +p.coords.longitude.toFixed(3);
      const name = await placeName(lat, lon);
      extra.wx = { ...wxCfg(), lat, lon, name: name || 'sua localização' };
      persist(); await loadWx(true); $('wxLoc').disabled = false; renderAll(); showToast(name ? `Localização salva: ${name}.` : 'Localização salva.');
    }, () => { $('wxLoc').disabled = false; showToast('Não consegui pegar a localização.', true); }, { timeout: 10000 });
  };

  /* ---------- Volume semanal e risco de lesão ---------- */
  const monday = s => addDays(s, -((D(s).getDay() + 6) % 7));
  function kmBetween(a, b) { return allRuns().filter(r => r.date >= a && r.date <= b).reduce((s, r) => s + r.km, 0); }
  function renderVolume() {
    const box = $('volCard'), rs = allRuns();
    if (!rs.length) { box.innerHTML = `<div class="card-head"><h2>Volume semanal</h2></div><p class="muted small">Aparece quando houver corridas do Strava.</p>`; return; }
    const m0 = monday(today), weeks = [];
    for (let i = 7; i >= 0; i--) { const a = addDays(m0, -7 * i); weeks.push({ a, km: kmBetween(a, addDays(a, 6)), cur: i === 0 }); }
    const acute = kmBetween(addDays(today, -6), today), chronic = kmBetween(addDays(today, -27), today) / 4;
    const ratio = chronic > 0.5 ? acute / chronic : null;
    const max = Math.max(5, ...weeks.map(w => w.km));
    const bw = 300 / weeks.length;
    let svg = weeks.map((w, i) => { const h = 70 * w.km / max; return `<rect x="${(i * bw + 6).toFixed(1)}" y="${(84 - h).toFixed(1)}" width="${(bw - 12).toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="5" fill="${w.cur ? 'var(--c2)' : 'var(--c1)'}" opacity="${w.cur ? 1 : .85}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${(80 - h).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--fg)">${w.km ? w.km.toFixed(0) : ''}</text><text x="${(i * bw + bw / 2).toFixed(1)}" y="98" text-anchor="middle" font-size="9.5" fill="var(--muted)">${w.cur ? 'esta' : ddmm(w.a)}</text>`; }).join('');
    let tone = '', msg;
    if (ratio == null) msg = 'Ainda há pouco histórico para comparar.';
    else if (ratio > 1.5) { tone = 'bad'; msg = `Os últimos 7 dias tiveram ${acute.toFixed(1).replace('.', ',')} km, ${Math.round((ratio - 1) * 100)}% acima da sua média do mês. Risco maior de lesão: segure o volume nesta semana.`; }
    else if (ratio > 1.3) { tone = 'warn'; msg = `Volume subindo rápido (${Math.round((ratio - 1) * 100)}% acima da média do mês). Mantenha os leves bem leves e durma bem.`; }
    else if (ratio < 0.8) msg = 'Volume abaixo da sua média do mês. Normal em semana leve ou de prova.';
    else { tone = 'good'; msg = 'Volume na zona segura: perto da sua média do mês.'; }
    box.innerHTML = `<div class="card-head"><h2>Volume semanal</h2><span class="chip ${tone}">${ratio ? 'carga ' + ratio.toFixed(2).replace('.', ',') : 'km'}</span></div>` +
      `<svg class="vol" viewBox="0 0 300 102" role="img" aria-label="Quilômetros por semana">${svg}</svg>` +
      `<p class="msg ${tone}">${msg}</p><p class="muted small">Carga = km dos últimos 7 dias ÷ média semanal dos últimos 28. Entre 0,8 e 1,3 é a faixa mais segura.</p>`;
  }

  /* ---------- Resumo da semana ---------- */
  let sumWeek = null;
  function weekSummary(w) {
    const a = w.dates[0], b = w.dates[w.dates.length - 1];
    const runsW = allRuns().filter(r => r.date >= a && r.date <= b);
    const km = runsW.reduce((s, r) => s + r.km, 0), sec = runsW.reduce((s, r) => s + r.sec, 0);
    const planned = w.days.filter(x => isRunType(x.type) && x.type !== 'race'), runDone = planned.filter(x => done[x.date]).length;
    const gym = w.days.filter(x => x.gym), gymDone = gym.filter(x => done[x.date]).length;
    const feels = w.dates.map(d => extra.feel[d]).filter(Boolean), rpe = feels.length ? feels.reduce((s, f) => s + f.rpe, 0) / feels.length : null;
    const best = w.dates.map(d => done[d] && done[d].analysis ? { d, a: done[d].analysis } : null).filter(Boolean).sort((x, y) => (x.a.status === 'ok' ? 0 : 1) - (y.a.status === 'ok' ? 0 : 1) || (x.a.estimateSec || 9e9) - (y.a.estimateSec || 9e9))[0];
    const e0 = estimateAt(addDays(a, -1)), e1 = estimateAt(b < today ? b : today);
    const diet = w.dates.filter(d => (extra.diet[d] || []).length >= 4).length;
    const wts = extra.weights.filter(x => x.date <= b), w1 = wts[wts.length - 1], w0 = extra.weights.filter(x => x.date < a).slice(-1)[0];
    return { a, b, km, sec, runDone, runN: planned.length, gymDone, gymN: gym.length, rpe, best, e0, e1, diet, dw: w1 && w0 && w1.date >= a ? w1.kg - w0.kg : null };
  }
  function weekSumHtml(w, compact) {
    const s = weekSummary(w);
    const de0 = s.e0 && s.e1 ? s.e1.sec - s.e0.sec : null, de = de0 != null && Math.abs(de0) >= 5 ? de0 : null;
    const tiles = [
      ['Corridas', `${s.runDone}/${s.runN}`, 'treinos'], ['Distância', s.km.toFixed(1).replace('.', ','), 'km'],
      ['Tempo', s.sec ? A.fmtTime(s.sec) : '–', 'correndo'], ['Estimativa', de == null ? '–' : `${de <= 0 ? '−' : '+'}${A.fmtTime(Math.abs(de))}`, de == null ? (de0 != null ? 'estável' : 'sem dados') : de <= 0 ? 'mais rápido' : 'mais lento']
    ];
    const lines = [];
    if (s.gymN) lines.push(`Musculação: ${s.gymDone} de ${s.gymN} sessões.`);
    if (s.rpe) lines.push(`Esforço médio ${s.rpe.toFixed(1).replace('.', ',')}/10.`);
    if (s.diet) lines.push(`Alimentação: ${s.diet} dia${s.diet > 1 ? 's' : ''} com 4 ou mais itens.`);
    if (s.dw != null) lines.push(`Peso: ${s.dw <= 0 ? '−' : '+'}${Math.abs(s.dw).toFixed(1).replace('.', ',')} kg.`);
    const verdict = s.runN && s.runDone === s.runN ? 'Semana completa. Ótimo trabalho!' : s.runDone >= s.runN - 1 && s.runN ? 'Boa semana, quase tudo cumprido.' : s.b < today ? 'Semana abaixo do planejado. Siga o plano da próxima sem tentar compensar.' : 'Semana em andamento.';
    return `<div class="card-head"><div><span class="eyebrow">Semana ${w.n} · ${ddmm(s.a)} a ${ddmm(s.b)}</span><h3>${esc(verdict)}</h3></div></div>` +
      `<div class="metrics">${tiles.map(([l, v, u]) => `<div class="metric"><span>${l}</span><b>${v}</b><small class="muted">${u}</small></div>`).join('')}</div>` +
      (s.best ? `<p class="small"><b>Destaque:</b> ${esc(dayOf(s.best.d) ? dayOf(s.best.d).title : '')} (${WD[D(s.best.d).getDay()]}) · ${esc(s.best.a.headline)}</p>` : '') +
      (lines.length ? `<p class="muted small">${lines.join(' ')}</p>` : '') +
      (compact ? '<a class="linkbtn" href="#progresso" data-goto="weekSum">Ver detalhes no Progresso ›</a>' : '');
  }
  function renderWeekSum() {
    const box = $('weekSum'); if (!plan) { box.innerHTML = ''; return; }
    const cur = dayOf(today) ? dayOf(today).week : (today < firstDay() ? plan.weeks[0].n : plan.weeks[plan.weeks.length - 1].n);
    if (sumWeek == null || !plan.weeks.find(w => w.n === sumWeek)) sumWeek = cur;
    const w = plan.weeks.find(x => x.n === sumWeek);
    box.innerHTML = `<div class="card-head"><h2>Resumo da semana</h2><div class="hgroup"><button class="round sm" id="wsPrev" type="button" aria-label="Semana anterior"${sumWeek <= plan.weeks[0].n ? ' disabled' : ''}>‹</button><button class="round sm" id="wsNext" type="button" aria-label="Próxima semana"${sumWeek >= cur ? ' disabled' : ''}>›</button></div></div>` + weekSumHtml(w, false);
    $('wsPrev').onclick = () => { sumWeek--; renderWeekSum(); };
    $('wsNext').onclick = () => { sumWeek++; renderWeekSum(); };
    // Na tela Hoje: domingo mostra a semana atual; segunda, a que terminou.
    const home = $('weekSumHome'), dow = D(today).getDay();
    let hw = null;
    if (selected === today && dow === 0 && dayOf(today)) hw = plan.weeks.find(x => x.n === dayOf(today).week);
    if (selected === today && dow === 1) { const y = dayOf(addDays(today, -1)); if (y) hw = plan.weeks.find(x => x.n === y.week); }
    if (hw) { home.innerHTML = weekSumHtml(hw, true); home.hidden = false; bindGoto(home); } else home.hidden = true;
  }

  /* ---------- Calculadora de ritmo ---------- */
  (function calc() {
    const pace = () => toSec($('cPace').value);
    const upd = () => {
      const p = pace(), d = +$('cDist').value;
      $('cTime').textContent = p ? A.fmtTime(Math.round(p * d)) : '–';
      const g = toSec($('cGoal').value);
      $('cNeed').textContent = g ? `${A.fmtPace(g / d)}/km · ${(3600 * d / g).toFixed(1).replace('.', ',')} km/h` : '–';
    };
    $('cPace').oninput = () => { const p = pace(); $('cKmh').value = p ? (3600 / p).toFixed(1).replace('.', ',') : ''; upd(); };
    $('cKmh').oninput = () => { const v = parseFloat($('cKmh').value.replace(',', '.')); if (v > 2 && v < 30) { const p = Math.round(3600 / v); $('cPace').value = `${Math.floor(p / 60)}:${pad(p % 60)}`; } upd(); };
    $('cDist').onchange = upd; $('cGoal').oninput = upd;
  })();

  /* ---------- Cadência e metrônomo ---------- */
  let metro = null;
  function cadenceData() {
    return Object.entries(done).filter(([d, v]) => d[0] !== '_' && v && v.analysis && v.analysis.metrics && v.analysis.metrics.cadence)
      .map(([d, v]) => ({ d, c: v.analysis.metrics.cadence })).sort((a, b) => a.d.localeCompare(b.d));
  }
  function renderCadence() {
    const box = $('cadCard'), pts = cadenceData();
    const avg = pts.length ? Math.round(pts.slice(-5).reduce((s, p) => s + p.c, 0) / Math.min(5, pts.length)) : null;
    const target = avg ? Math.min(180, Math.max(160, Math.round(avg * 1.05 / 2) * 2)) : 166;
    const bpm = extra.metroBpm || target;
    let spark = '';
    if (pts.length >= 2) {
      const ps = pts.slice(-12), lo = Math.min(150, ...ps.map(p => p.c)) - 2, hi = Math.max(182, ...ps.map(p => p.c)) + 2;
      const X = i => 10 + i * 280 / Math.max(1, ps.length - 1), Y = v => 6 + (hi - v) / (hi - lo) * 60;
      spark = `<svg class="spark" viewBox="0 0 300 72" aria-hidden="true"><rect x="0" y="${Y(180)}" width="300" height="${Y(165) - Y(180)}" fill="var(--tint-teal)"/><text x="296" y="${Y(180) + 10}" text-anchor="end" font-size="9" fill="var(--c1)">165–180</text><path d="${ps.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.c).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--c3)" stroke-width="2.5"/>${ps.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.c).toFixed(1)}" r="3" fill="var(--card)" stroke="var(--c3)" stroke-width="2"/>`).join('')}</svg>`;
    }
    box.innerHTML = `<div class="card-head"><h2>Cadência</h2>${avg ? `<span class="chip ${avg >= 165 ? 'good' : ''}">${avg} passos/min</span>` : ''}</div>` +
      (avg ? `<p class="muted small">Média dos últimos treinos: ${avg}. ${avg >= 170 ? 'Cadência ótima.' : `Subir aos poucos para ~${target} ajuda a gastar menos energia e reduz o impacto. Passos mais curtos, não mais fortes.`}</p>` : '<p class="muted small">Aparece quando os treinos analisados tiverem cadência (relógio com sensor de passos).</p>') + spark +
      `<div class="metro"><button class="round" id="mMinus" type="button" aria-label="Menos">−</button><div><b id="mBpm">${bpm}</b><small class="muted">passos/min</small></div><button class="round" id="mPlus" type="button" aria-label="Mais">+</button><button class="btn ${metro ? 'ghost' : ''}" id="mToggle" type="button">${metro ? 'Parar' : 'Metrônomo'}</button></div>` +
      `<p class="muted small">Ligue o metrônomo e encaixe um passo em cada batida durante 1 a 2 minutos dos treinos leves.</p>`;
    const setB = v => { extra.metroBpm = Math.min(200, Math.max(140, v)); persist(); $('mBpm').textContent = extra.metroBpm; if (metro) metro.bpm = extra.metroBpm; };
    $('mMinus').onclick = () => setB((extra.metroBpm || bpm) - 2);
    $('mPlus').onclick = () => setB((extra.metroBpm || bpm) + 2);
    $('mToggle').onclick = () => { metro ? stopMetro() : startMetro(extra.metroBpm || bpm); renderCadence(); };
  }
  function startMetro(bpm) {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) { showToast('Seu navegador não toca o metrônomo.', true); return; }
    const ctx = new Ctx(); metro = { ctx, bpm, next: ctx.currentTime + 0.1, n: 0 };
    const tick = () => {
      while (metro && metro.next < ctx.currentTime + 0.2) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = metro.n % 2 ? 880 : 1320; g.gain.setValueAtTime(0.4, metro.next); g.gain.exponentialRampToValueAtTime(0.001, metro.next + 0.05);
        o.connect(g).connect(ctx.destination); o.start(metro.next); o.stop(metro.next + 0.06);
        metro.next += 60 / metro.bpm; metro.n++;
      }
    };
    metro.timer = setInterval(tick, 50); tick();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { if (metro) metro.lock = l; }).catch(() => {});
  }
  function stopMetro() { if (!metro) return; clearInterval(metro.timer); try { metro.ctx.close(); } catch (e) {} if (metro.lock) metro.lock.release().catch(() => {}); metro = null; }

  /* ---------- Cartão para compartilhar ---------- */
  let iconImg = null;
  function loadIcon() { return new Promise(res => { if (iconImg) return res(iconImg); const i = new Image(); i.onload = () => { iconImg = i; res(i); }; i.onerror = () => res(null); i.src = '/icon-512.png'; }); }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  async function makeCard(draw) {
    try { await document.fonts.load('800 40px Figtree'); } catch (e) {}
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    const ctx = cv.getContext('2d'), F = (w, s) => `${w} ${s}px Figtree, -apple-system, sans-serif`;
    const g = ctx.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, '#0B3B37'); g.addColorStop(1, '#0E1013');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
    const ic = await loadIcon(); if (ic) ctx.drawImage(ic, 72, 72, 96, 96);
    ctx.fillStyle = '#fff'; ctx.font = F(800, 44); ctx.fillText('PacePro', 188, 136);
    draw(ctx, F);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(600, 30);
    ctx.fillText(`Rumo aos ${A.fmtTime(goalSec())} · prova em ${ddmm(raceISO())}`, 72, 1278);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  async function shareBlob(blob, name, text) {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('Imagem salva.');
  }
  async function shareWorkout(day) {
    const st = done[day.date]; if (!st || !st.analysis) return;
    const a = st.analysis, m = a.metrics;
    const blob = await makeCard((ctx, F) => {
      ctx.fillStyle = '#2CC0B3'; ctx.font = F(700, 30); ctx.fillText(`${WDL[D(day.date).getDay()].toUpperCase()}, ${ddmm(day.date)} · ${TYPE_LABEL[day.type].toUpperCase()}`, 72, 290);
      ctx.fillStyle = '#fff'; ctx.font = F(800, 64);
      const words = day.title.split(' '); let line = '', y = 370;
      words.forEach(w => { if (ctx.measureText(line + w).width > 930) { ctx.fillText(line.trim(), 72, y); y += 76; line = ''; } line += w + ' '; }); ctx.fillText(line.trim(), 72, y);
      const stats = [['Distância', m.distKm.toFixed(2).replace('.', ','), 'km'], ['Tempo', A.fmtTime(m.time), ''], ['Ritmo', m.pace ? A.fmtPace(m.pace) : '–', '/km'], ['FC média', m.hr ? String(m.hr) : '–', 'bpm']];
      stats.forEach(([l, v, u], i) => {
        const x = 72 + (i % 2) * 476, yy = y + 70 + Math.floor(i / 2) * 200;
        rr(ctx, x, yy, 452, 176, 28); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(700, 26); ctx.fillText(l.toUpperCase(), x + 32, yy + 52);
        ctx.fillStyle = '#fff'; ctx.font = F(800, 72); ctx.fillText(v, x + 32, yy + 136);
        if (u) { const w = ctx.measureText(v).width; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(600, 28); ctx.fillText(u, x + 40 + w, yy + 136); }
      });
      const by = y + 500;
      if (a.splits && a.splits.length >= 2) {
        const ps = a.splits.slice(0, 12), mx = Math.max(...ps.map(s => s.pace)), mn = Math.min(...ps.map(s => s.pace)), bw = 936 / ps.length;
        ps.forEach((s, i) => { const h = 50 + 130 * (mx - s.pace) / Math.max(1, mx - mn); rr(ctx, 72 + i * bw + 6, by + 190 - h, bw - 12, h, 10); ctx.fillStyle = '#F08A24'; ctx.fill(); });
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(600, 24); ctx.fillText('Ritmo por km', 72, by + 230);
      }
      ctx.fillStyle = '#fff'; ctx.font = F(700, 34); ctx.fillText(a.headline.slice(0, 48), 72, by + 300);
    });
    shareBlob(blob, `pacepro-${day.date}.png`, `${day.title} · ${m.distKm.toFixed(1).replace('.', ',')} km`);
  }
  async function shareProgress() {
    const est = estimateAt(today), proj = est ? A.project(est.sec, today, raceISO()) : null;
    const days = Math.max(0, Math.ceil((D(raceISO()) - D(today)) / 864e5));
    const blob = await makeCard((ctx, F) => {
      ctx.fillStyle = '#2CC0B3'; ctx.font = F(700, 30); ctx.fillText(`MINHA EVOLUÇÃO · ${ddmm(today)}`, 72, 290);
      ctx.fillStyle = '#fff'; ctx.font = F(800, 200); ctx.fillText(proj ? A.fmtTime(proj) : '–', 64, 520);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = F(600, 36); ctx.fillText(`projeção para os ${String(distKm()).replace('.', ',')} km`, 72, 580);
      const items = [['Hoje', est ? A.fmtTime(est.sec) : '–'], ['Meta', A.fmtTime(goalSec())], ['Faltam', `${days} dias`]];
      items.forEach(([l, v], i) => { const x = 72 + i * 316; rr(ctx, x, 660, 292, 170, 28); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(700, 26); ctx.fillText(l.toUpperCase(), x + 28, 712); ctx.fillStyle = '#fff'; ctx.font = F(800, 64); ctx.fillText(v, x + 28, 795); });
      const tot = plan.days.filter(x => isRunType(x.type) && x.date <= today).length, ok = plan.days.filter(x => isRunType(x.type) && x.date <= today && done[x.date]).length;
      ctx.fillStyle = '#fff'; ctx.font = F(700, 40); ctx.fillText(`${ok} de ${tot} treinos de corrida feitos`, 72, 940);
      rr(ctx, 72, 970, 936, 24, 12); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
      if (tot) { rr(ctx, 72, 970, Math.max(24, 936 * ok / tot), 24, 12); ctx.fillStyle = '#F08A24'; ctx.fill(); }
    });
    shareBlob(blob, `pacepro-evolucao-${today}.png`, 'Minha evolução no PacePro');
  }
  $('shareProg').onclick = () => shareProgress();

  /* ---------- Comparar com treinos iguais ---------- */
  function similarPast(date) {
    const a = done[date] && done[date].analysis; if (!a) return [];
    const lab = x => x.metrics.work ? x.metrics.work.label : '';
    const same = b => {
      if (['test', 'race'].includes(a.type)) return ['test', 'race'].includes(b.type) && b.metrics.distKm >= 4.5;
      if (b.type !== a.type) return false;
      if (a.type === 'interval') return lab(b) === lab(a);
      if (a.type === 'easy') return Math.abs(b.metrics.distKm - a.metrics.distKm) <= Math.max(0.8, a.metrics.distKm * 0.25);
      return true;
    };
    return Object.entries(done).filter(([d, v]) => d < date && v && v.analysis && v.analysis.metrics && same(v.analysis))
      .sort((x, y) => y[0].localeCompare(x[0])).slice(0, 3).map(([d, v]) => ({ date: d, a: v.analysis }));
  }
  const workOf = a => a.metrics.work && a.metrics.work.pace ? { pace: a.metrics.work.pace, hr: a.metrics.work.hr || a.metrics.hr } : { pace: a.metrics.pace, hr: a.metrics.hr };
  function compareHtml(date) {
    const a = done[date].analysis, prev = similarPast(date);
    if (!prev.length || !a.metrics.pace) return '';
    const c = workOf(a), p = workOf(prev[0].a);
    const dp = Math.round(c.pace - p.pace), dh = c.hr && p.hr ? c.hr - p.hr : null;
    const what = ['test', 'race'].includes(a.type) ? 'teste ou prova' : a.metrics.work ? a.metrics.work.label : a.type === 'easy' ? `leve de ~${Math.round(a.metrics.distKm)} km` : 'treino igual';
    let msg, tone = 'info';
    if (dp <= -3 && (dh == null || dh <= 2)) { msg = `${-dp} s/km mais rápido${dh != null ? (dh < -1 ? ` com FC ${-dh} mais baixa` : ' com a mesma FC') : ''}. Evolução clara.`; tone = 'good'; }
    else if (Math.abs(dp) < 3 && dh != null && dh <= -3) { msg = `Mesmo ritmo com FC ${-dh} mais baixa. O corpo está se adaptando.`; tone = 'good'; }
    else if (dp <= -3) msg = `${-dp} s/km mais rápido, mas com FC ${dh} mais alta. Foi um esforço maior.`;
    else if (dp >= 3 && (dh == null || dh >= -2)) { msg = `${dp} s/km mais lento que da última vez. Calor, sono e cansaço pesam; um dia ruim não apaga a evolução.`; tone = 'warn'; }
    else if (dp >= 3) msg = `${dp} s/km mais lento, com FC ${-dh} mais baixa. Pegou mais leve.`;
    else msg = 'Bem parecido com da última vez.';
    const sign = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
    const row = (d, x, cur) => { const w = workOf(x); return `<tr${cur ? ' class="cur"' : ''}><td>${cur ? 'Hoje' : ddmm(d)}</td><td>${w.pace ? A.fmtPace(w.pace) : '–'}${cur || !w.pace ? '' : ` <small class="${c.pace - w.pace <= -3 ? 'good' : c.pace - w.pace >= 3 ? 'bad' : 'muted'}">${sign(Math.round(c.pace - w.pace))}s</small>`}</td><td>${w.hr || '–'}</td><td>${x.metrics.distKm.toFixed(1).replace('.', ',')} km</td></tr>`; };
    return `<div class="cmp"><span class="eyebrow">Comparado com ${prev.length > 1 ? 'treinos iguais' : 'o último treino igual'} · ${esc(what)}</span>` +
      `<p class="msg ${tone}">${esc(msg)}</p><div class="tbl"><table><thead><tr><th>Dia</th><th>Ritmo</th><th>FC</th><th>Dist.</th></tr></thead><tbody>${row(date, a, true)}${prev.map(x => row(x.date, x.a)).join('')}</tbody></table></div>` +
      `<p class="muted small">${a.metrics.work ? 'Ritmo e FC da parte principal do treino.' : 'Ritmo e FC médios.'} Hoje vs. cada dia (negativo = hoje mais rápido).</p></div>`;
  }

  /* ---------- Dia da prova ---------- */
  const raceCfg = () => ({ start: '06:00', checks: {}, ...(extra.race || {}) });
  const hm = m => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
  function raceTimeline() {
    const [h, m] = raceCfg().start.split(':').map(Number), t = h * 60 + m;
    return [[-180, 'Acordar e beber um copo de água'], [-165, 'Café da manhã já testado em treino'], [-90, 'Sair de casa (ajuste à distância)'], [-45, 'Chegar, retirar kit e ir ao banheiro'],
      [-25, 'Aquecer: 10 min de trote leve'], [-12, '3 acelerações curtas e ir para a largada'], [0, 'Largada: km 1 um pouco mais lento que o alvo']].map(([o, txt]) => ({ at: hm(t + o), txt }));
  }
  const RACE_CHECKS = {
    'Véspera': ['Jantar com carboidrato que você já conhece', 'Separar roupa, tênis, número e chip', 'Carregar relógio e celular', 'Conferir horário e local da largada', 'Dormir cedo, sem treino'],
    'Manhã da prova': ['Café da manhã 2 a 3 h antes', 'Água aos poucos, sem exagero', 'Vaselina onde costuma assar', 'Número preso na camisa'],
    'Durante': ['Largar no meio do pelotão, sem ziguezague', 'Olhar o ritmo médio a cada km', 'Km 3: só manter, é o mais duro de cabeça', 'Último km com tudo o que sobrar']
  };
  function raceChecksHtml(only) {
    const ck = raceCfg().checks; let i = 0;
    return `<div class="checks2 rc">${Object.entries(RACE_CHECKS).map(([g, items]) => { const html = `<div><b>${g}</b><div class="checklist">${items.map(t => { const k = 'c' + (i++); return `<label class="ck"><input type="checkbox" data-rck="${k}"${ck[k] ? ' checked' : ''}><span>${esc(t)}</span></label>`; }).join('')}</div></div>`; return !only || only === g ? html : ''; }).join('')}</div>`;
  }
  function bindRaceChecks(root) {
    root.querySelectorAll('[data-rck]').forEach(b => b.onchange = () => { const c = raceCfg(); c.checks = { ...c.checks, [b.dataset.rck]: b.checked }; extra.race = c; persist(); });
  }
  function timelineHtml() {
    return `<ol class="tline">${raceTimeline().map(x => `<li><b>${x.at}</b><span>${esc(x.txt)}</span></li>`).join('')}</ol>`;
  }
  // Tela da prova: cronômetro, alvo de cada km e quanto está na frente ou atrás.
  let rmTimer = null, rmLock = null;
  function openRaceMode() {
    const r = racePlan(); let box = $('raceMode');
    if (!box) { box = document.createElement('div'); box.id = 'raceMode'; box.className = 'racemode'; document.body.appendChild(box); }
    const live = () => (extra.race && extra.race.live) || null;
    const setLive = v => { const c = raceCfg(); c.live = v; extra.race = c; persist(); };
    const draw = () => {
      const L = live(), laps = L ? L.laps : [], k = laps.length, row = r.rows[Math.min(k, r.rows.length - 1)];
      const el = L ? (Date.now() - L.t0) / 1000 : 0, finished = L && k >= r.rows.length;
      const last = k ? laps[k - 1] - r.rows[k - 1].acc : null;
      box.innerHTML = `<div class="rm-top"><span>Alvo ${A.fmtTime(r.target)}</span><button class="rm-x" id="rmClose" type="button" aria-label="Fechar">✕</button></div>` +
        `<div class="rm-time">${A.fmtTime(finished ? laps[k - 1] : el)}</div>` +
        (finished ? `<div class="rm-km">Chegada!</div><p class="rm-sub">${laps[k - 1] <= goalSec() ? 'Meta batida.' : `${A.fmtTime(laps[k - 1] - goalSec())} acima da meta.`} Conclua o treino na tela Hoje para analisar com o Strava.</p>`
          : `<div class="rm-km">Km ${k + 1}${row.len < 1 ? ' (final)' : ''} de ${r.rows.length}</div><div class="rm-pace">${A.fmtPace(row.pace)}<small>/km</small></div><p class="rm-sub">Passe na placa em <b>${A.fmtTime(Math.round(row.acc))}</b></p>`) +
        (last != null ? `<p class="rm-delta ${last <= 2 ? 'good' : 'bad'}">${Math.abs(last) < 2 ? 'No ritmo' : last < 0 ? `${A.fmtTime(-last)} na frente` : `${A.fmtTime(last)} atrás`}</p>` : '<p class="rm-delta">&nbsp;</p>') +
        `<div class="rm-actions">${!L ? `<button class="btn big wide" id="rmGo" type="button">Iniciar na largada</button>` : finished ? `<button class="btn ghost wide" id="rmReset" type="button">Zerar</button>` : `<button class="btn big wide" id="rmLap" type="button">Passei no km ${row.len < 1 ? 'final' : k + 1}</button>`}` +
        `${L && k && !finished ? `<button class="btn ghost sm" id="rmUndo" type="button">Desfazer última placa</button>` : ''}${L && !finished ? `<button class="btn ghost sm" id="rmReset" type="button">Zerar</button>` : ''}</div>`;
      const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
      on('rmClose', closeRaceMode);
      on('rmGo', () => { setLive({ t0: Date.now(), laps: [] }); draw(); });
      on('rmLap', () => { const L2 = live(); L2.laps.push(Math.round((Date.now() - L2.t0) / 1000)); setLive(L2); if (navigator.vibrate) navigator.vibrate(120); draw(); });
      on('rmUndo', () => { const L2 = live(); L2.laps.pop(); setLive(L2); draw(); });
      let armed = false;
      on('rmReset', () => { const b = $('rmReset'); if (!armed) { armed = true; b.textContent = 'Toque de novo para zerar'; return; } setLive(null); draw(); });
    };
    draw(); box.hidden = false; document.body.classList.add('noscroll');
    clearInterval(rmTimer); rmTimer = setInterval(() => { const t = box.querySelector('.rm-time'); const L = live(); if (t && L && L.laps.length < r.rows.length) t.textContent = A.fmtTime((Date.now() - L.t0) / 1000); }, 500);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { rmLock = l; }).catch(() => {});
  }
  function closeRaceMode() {
    clearInterval(rmTimer); rmTimer = null; const b = $('raceMode'); if (b) b.hidden = true; document.body.classList.remove('noscroll');
    if (rmLock) { rmLock.release().catch(() => {}); rmLock = null; }
  }
  function raceDayBlock(day) {
    const dist = day.date === raceISO();
    if (dist) return `<div class="blk race"><span class="k">Horários de hoje · largada ${raceCfg().start}</span>${timelineHtml()}<button class="btn wide big" id="rmOpen" type="button">Abrir tela da prova</button><p class="note">Mostra o ritmo de cada km e se você está na frente ou atrás. Toque a cada placa de km.</p></div>`;
    if (day.date === addDays(raceISO(), -1)) return `<div class="blk race"><span class="k">Véspera da prova</span>${raceChecksHtml('Véspera')}<p class="note">Largada amanhã às ${raceCfg().start}. Ajuste o horário no cartão Plano de prova.</p></div>`;
    return '';
  }

  /* ---------- Depois da prova ---------- */
  const REC = [
    ['rest', 'Descanso ou caminhada', 'Descanso, ou caminhada leve de 20 a 30 min.'],
    ['rest', 'Descanso ativo', 'Natação leve ou mobilidade por 20 a 30 min, se quiser.'],
    ['easy', "Trote leve 20'", "20' L, FC ≤145. Se doer algo, caminhe."],
    ['rest', 'Descanso', 'Mobilidade e alongamento leve.'],
    ['easy', "Leve 25'", "25' L, FC ≤145."],
    ['rest', 'Descanso', 'Sono, água e boa comida.'],
    ['easy', "Leve 30' + 4 acelerações", "30' L + 4 × 15\" soltos, com 1' de caminhada entre eles."]
  ];
  const recEnd = () => addDays(raceISO(), REC.length);
  function recoveryDay(date) {
    if (!plan || date <= raceISO() || date > recEnd()) return null;
    if (plan.days.some(d => d.date > raceISO())) return null;
    const n = Math.round((D(date) - D(raceISO())) / 864e5), [type, title, rua] = REC[n - 1];
    return { date, type, title, rua, recovery: n };
  }
  const dayAt = date => (plan && dayOf(date)) || recoveryDay(date);
  function raceResult() {
    const st = done[raceISO()];
    return st && st.analysis && st.analysis.metrics ? st.analysis.metrics.time : null;
  }
  function renderNext() {
    const box = $('nextCard'); if (!box) return;
    const show = plan && (today > raceISO() || (today === raceISO() && done[today])) && !plan.days.some(d => d.date > today);
    box.hidden = !show; if (!show) return;
    const res = raceResult(), nx = extra.next || {};
    const dist = distKm();
    const head = res ? `<p class="msg ${res <= goalSec() ? 'good' : ''}">Você fez ${A.fmtTime(res)} nos ${String(dist).replace('.', ',')} km${res <= goalSec() ? `: meta de ${A.fmtTime(goalSec())} batida!` : ` (meta ${A.fmtTime(goalSec())}).`}</p>` : '';
    const opt = v => `<option value="${v}"${String(nx.dist || '') === v ? ' selected' : ''}>${v.replace('.', ',')} km</option>`;
    box.innerHTML = `<div class="card-head"><div><span class="eyebrow">Depois da prova</span><h3>Qual é o próximo objetivo?</h3></div></div>` + head +
      `<p class="muted small">Primeiro, uma semana de recuperação (já está no calendário). Depois, você escolhe a próxima prova e o app monta o plano.</p>` +
      (() => { const up = (extra.races || []).filter(r => r.date > addDays(today, 21)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3); return up.length ? `<div class="picklist">${up.map(r => `<button class="pick" type="button" data-npick="${esc(r.id)}"><span><b>${esc(r.name)}</b><br><small class="muted">${ddmm(r.date)} · ${kmTxt(r.dist)}${r.goal ? ' · meta ' + esc(r.goal) : ''}</small></span><b>›</b></button>`).join('')}</div><p class="muted small">Ou escolha outra:</p>` : ''; })() +
      `<form class="form" id="nextForm" novalidate>` +
      `<label for="nDist">Distância<select id="nDist">${['5', '10', '21.1', '42.2'].map(opt).join('')}</select></label>` +
      `<label for="nGoal">Tempo-objetivo<input id="nGoal" type="text" inputmode="numeric" placeholder="ex.: 55:00" value="${esc(nx.goal || '')}"></label>` +
      `<label for="nDate" class="full">Data da prova<input id="nDate" type="date" value="${esc(nx.date || '')}" min="${addDays(today, 21)}"></label>` +
      `<button class="btn full" type="submit">Montar o plano</button></form><p class="msg" id="nextMsg" hidden></p>`;
    box.querySelectorAll('[data-npick]').forEach(b => b.onclick = () => { const r = extra.races.find(x => x.id === b.dataset.npick); $('nDist').value = nearDist(+r.dist); $('nGoal').value = r.goal || ''; $('nDate').value = r.date; if (r.goal) $('nextForm').requestSubmit(); else $('nGoal').focus(); });
    $('nextForm').onsubmit = e => {
      e.preventDefault();
      const d = $('nDist').value, g = $('nGoal').value.trim(), dt = $('nDate').value, m = $('nextMsg');
      extra.next = { dist: d, goal: g, date: dt }; persist();
      if (!dt || !toSec(g)) { m.hidden = false; m.className = 'msg bad'; m.textContent = 'Escolha a data da prova e escreva o tempo-objetivo, como 55:00 ou 1:59:00.'; return; }
      const start = recEnd() >= today ? addDays(recEnd(), 1) : addDays(today, 1);
      if ((D(dt) - D(start)) / 864e5 < 21) { m.hidden = false; m.className = 'msg bad'; m.textContent = `Escolha uma prova a partir de ${ddmm(addDays(start, 21))}, para ter pelo menos 3 semanas de plano depois da recuperação.`; return; }
      $('gDist').value = d; $('gGoal').value = g; $('gRace').value = dt; $('gStart').value = start;
      if (res && dist === 5 && !$('gCur').value) $('gCur').value = A.fmtTime(res);
      location.hash = 'ajustes'; openGen(true);
      setTimeout(() => $('genForm').requestSubmit(), 80);
    };
  }

  /* ---------- Atualizar o app ---------- */
  let appVer = null, newVer = false, swReg = null;
  async function fetchVer() { try { const r = await fetch('/api/version', { cache: 'no-store' }); return r.ok ? (await r.json()).v || null : null; } catch (e) { return null; } }
  function showUpdate() {
    newVer = true; renderUpdate();
    let bar = $('updBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'updBar'; bar.className = 'updbar'; bar.innerHTML = `<span>Nova versão do PacePro disponível</span><button class="btn sm" type="button">Atualizar</button>`; document.body.appendChild(bar); bar.querySelector('button').onclick = doUpdate; }
    bar.hidden = false;
  }
  async function checkUpdate(manual) {
    if (swReg) swReg.update().catch(() => {});
    const v = await fetchVer();
    if (!appVer) appVer = v;
    if (v && appVer && v !== appVer) showUpdate();
    else if (manual) showToast(v ? 'Você já está na versão mais nova.' : 'Não consegui verificar agora. Tente de novo com internet.', !v);
    renderUpdate();
  }
  async function doUpdate() {
    saveNow();
    try { if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: 'skip' }); } catch (e) {}
    try { if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch (e) {}
    location.reload();
  }
  function renderUpdate() {
    const c = $('updChip'); if (!c) return;
    c.textContent = newVer ? 'nova versão' : appVer ? `versão ${appVer}` : 'versão –';
    c.className = newVer ? 'chip key' : 'chip';
    $('updText').textContent = newVer ? 'Tem uma versão nova. Toque em Atualizar: seus dados continuam salvos.' : 'O app procura atualizações sozinho quando você abre. Se quiser, verifique agora.';
    $('updNow').textContent = newVer ? 'Atualizar agora' : 'Verificar atualização';
  }
  $('updNow').onclick = () => newVer ? doUpdate() : checkUpdate(true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(false); });
  setInterval(() => checkUpdate(false), 30 * 60000);

  /* ---------- Calendário de provas ---------- */
  const MONL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const kmTxt = d => `${String(+d).replace('.', ',')} km`;
  const nearDist = d => ['5', '10', '21.1', '42.2'].reduce((b, x) => Math.abs(+x - d) < Math.abs(+b - d) ? x : b, '5');
  function allRaces() {
    const list = (extra.races || []).map(r => ({ ...r }));
    if (plan && plan.race && extra.hidePlanRace !== plan.race && !list.some(r => r.date === plan.race)) list.push({ id: 'plan', name: 'Prova do plano atual', date: plan.race, dist: distKm(), goal: A.fmtTime(goalSec()), status: 'inscrito', plan: true });
    list.forEach(r => { if (plan && r.date === plan.race) r.plan = true; });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }
  function raceResultAt(date) {
    const st = done[date]; const a = st && st.analysis;
    return a && ['race', 'test'].includes(a.type) && a.metrics ? a.metrics.time : null;
  }
  // Monta o plano para uma prova: preenche o gerador e já gera.
  function prefillGen(dist, goal, date) {
    const afterRec = plan && date > raceISO() && today <= recEnd() ? addDays(recEnd(), 1) : addDays(today, 1);
    $('gDist').value = nearDist(+dist); $('gGoal').value = goal || ''; $('gRace').value = date; $('gStart').value = afterRec;
    const res = raceResult(); if (res && distKm() === 5 && !$('gCur').value) $('gCur').value = A.fmtTime(res);
    location.hash = 'ajustes'; openGen(true);
    if (goal) setTimeout(() => $('genForm').requestSubmit(), 80);
  }
  function icsFor(r) {
    const d = r.date.replace(/-/g, ''), d2 = addDays(r.date, 1).replace(/-/g, '');
    const txt = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, ' ');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PacePro//PT', 'BEGIN:VEVENT', `UID:${r.id}-${d}@pacepro`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`, `SUMMARY:${txt(r.name)} (${txt(kmTxt(r.dist))})`, r.place ? `LOCATION:${txt(r.place)}` : '', r.goal ? `DESCRIPTION:Meta ${txt(r.goal)}` : '',
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Prova amanhã', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = `prova-${r.date}.ics`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  let raceOpen = null, raceEdit = null;
  function raceRow(r) {
    const dd = D(r.date), n = Math.round((dd - D(today)) / 864e5), past = r.date < today, res = past || n === 0 ? raceResultAt(r.date) : null;
    const when = n === 0 ? 'hoje' : n === 1 ? 'amanhã' : n > 0 ? (n < 60 ? `em ${n} dias` : `em ${Math.round(n / 7)} semanas`) : '';
    const sub = [kmTxt(r.dist), r.goal ? `meta ${r.goal}` : '', r.place].filter(Boolean).map(esc).join(' · ');
    const chip = res ? `<span class="chip ${r.goal && toSec(r.goal) && res <= toSec(r.goal) ? 'good' : ''}">${A.fmtTime(res)}</span>` : past ? '<span class="chip">sem resultado</span>' : `<span class="chip ${r.plan ? 'key' : r.status === 'inscrito' ? 'good' : ''}">${r.plan ? 'no plano' : r.status === 'inscrito' ? 'inscrito' : 'pretendo'}</span>`;
    const open = raceOpen === r.id;
    return `<div class="rrow${past ? ' past' : ''}"><button class="rr-main" type="button" data-rid="${esc(r.id)}" aria-expanded="${open}"><span class="dtile"><b>${dd.getDate()}</b><small>${WD[dd.getDay()]}</small></span><span class="rr-txt"><span class="t">${esc(r.name)}</span><span class="s">${sub}</span>${when ? `<span class="s when">${when}</span>` : ''}</span><span class="rr-end">${chip}<span class="chev" aria-hidden="true">${open ? '▴' : '▾'}</span></span></button>` +
      (open ? `<div class="rr-act">${!past && !r.plan ? `<button class="btn sm" type="button" data-rplan="${esc(r.id)}">Montar plano para esta prova</button>` : ''}${!past ? `<button class="btn ghost sm" type="button" data-rics="${esc(r.id)}">Adicionar à agenda</button>` : ''}<button class="btn ghost sm" type="button" data-redit="${esc(r.id)}">Editar</button><button class="btn ghost sm danger" type="button" data-rdel="${esc(r.id)}">${r.id === 'plan' ? 'Tirar do calendário' : 'Excluir'}</button></div>` : '') + `</div>`;
  }
  function renderRaces() {
    const box = $('racesCard'); if (!box) return;
    const list = allRaces(), up = list.filter(r => r.date >= today), past = list.filter(r => r.date < today).reverse();
    let html = `<div class="card-head"><div><span class="eyebrow">Calendário</span><h2>Próximas provas</h2></div><button class="btn sm" id="raceAdd" type="button">+ Prova</button></div>`;
    html += up.length ? `<p class="muted small">Toque numa prova para editar, excluir, montar o plano ou pôr na agenda.</p>` : `<p class="muted small">Nenhuma prova marcada. Toque em "+ Prova" para adicionar as próximas.</p>`;
    let mk = '';
    up.forEach(r => { const k = r.date.slice(0, 7); if (k !== mk) { mk = k; html += `<div class="rmonth">${MONL[+k.slice(5) - 1]} de ${k.slice(0, 4)}</div>`; } html += raceRow(r); });
    if (past.length) html += `<details class="rpast"><summary>Provas feitas (${past.length})</summary>${past.map(raceRow).join('')}</details>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-rid]').forEach(b => b.onclick = () => { raceOpen = raceOpen === b.dataset.rid ? null : b.dataset.rid; renderRaces(); });
    const find = id => list.find(r => r.id === id);
    box.querySelectorAll('[data-rplan]').forEach(b => b.onclick = () => { const r = find(b.dataset.rplan); prefillGen(r.dist, r.goal, r.date); });
    box.querySelectorAll('[data-rics]').forEach(b => b.onclick = () => icsFor(find(b.dataset.rics)));
    box.querySelectorAll('[data-redit]').forEach(b => b.onclick = () => { raceEdit = b.dataset.redit; renderRaceForm(true); });
    box.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => {
      if (b.dataset.armed) { if (b.dataset.rdel === 'plan') extra.hidePlanRace = plan.race; else extra.races = (extra.races || []).filter(r => r.id !== b.dataset.rdel); raceOpen = null; persist(); renderAll(); showToast('Prova removida do calendário.'); return; }
      b.dataset.armed = '1'; b.textContent = 'Toque de novo para confirmar';
    });
    $('raceAdd').onclick = () => { raceEdit = null; renderRaceForm(true); };
  }
  function renderRaceForm(open) {
    const box = $('raceFormCard'); if (!box) return;
    if (!open) { box.hidden = true; return; }
    const r = (raceEdit === 'plan' ? allRaces().find(x => x.id === 'plan') : (extra.races || []).find(x => x.id === raceEdit)) || { name: '', date: '', dist: 5, goal: '', place: '', status: 'inscrito' };
    box.hidden = false;
    box.innerHTML = `<div class="card-head"><h2>${raceEdit ? 'Editar prova' : 'Nova prova'}</h2></div><form class="form" id="raceForm" novalidate>` +
      `<label for="rfName" class="full">Nome<input id="rfName" type="text" value="${esc(r.name)}" placeholder="ex.: Corrida da Ponte"></label>` +
      `<label for="rfDate">Data<input id="rfDate" type="date" value="${esc(r.date)}"></label>` +
      `<label for="rfDist">Distância (km)<input id="rfDist" type="text" inputmode="decimal" list="rfDists" value="${esc(String(r.dist).replace('.', ','))}"></label><datalist id="rfDists"><option value="5"><option value="10"><option value="15"><option value="21,1"><option value="42,2"></datalist>` +
      `<label for="rfGoal">Meta (opcional)<input id="rfGoal" type="text" inputmode="numeric" value="${esc(r.goal)}" placeholder="ex.: 55:00"></label>` +
      `<label for="rfStatus">Situação<select id="rfStatus"><option value="inscrito"${r.status === 'inscrito' ? ' selected' : ''}>Inscrito</option><option value="pretendo"${r.status !== 'inscrito' ? ' selected' : ''}>Pretendo correr</option></select></label>` +
      `<label for="rfPlace" class="full">Local (opcional)<input id="rfPlace" type="text" value="${esc(r.place || '')}" placeholder="ex.: Beira Mar, Fortaleza"></label>` +
      `<div class="row-actions full"><button class="btn" type="submit">Salvar</button><button class="btn ghost" id="rfCancel" type="button">Cancelar</button></div></form><p class="msg" id="rfMsg" hidden></p>`;
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('rfCancel').onclick = () => renderRaceForm(false);
    $('raceForm').onsubmit = e => {
      e.preventDefault();
      const m = $('rfMsg'), bad = t => { m.hidden = false; m.className = 'msg bad'; m.textContent = t; };
      const name = $('rfName').value.trim(), date = $('rfDate').value, dist = parseFloat($('rfDist').value.replace(',', '.')), goal = $('rfGoal').value.trim();
      if (!name) return bad('Dê um nome para a prova.');
      if (!date) return bad('Escolha a data da prova.');
      if (!(dist > 0 && dist <= 100)) return bad('Escreva a distância em km, como 5, 10 ou 21,1.');
      if (goal && !toSec(goal)) return bad('Escreva a meta como 55:00 ou 1:59:00.');
      const item = { id: raceEdit && raceEdit !== 'plan' ? raceEdit : 'r' + Date.now().toString(36), name, date, dist, goal, place: $('rfPlace').value.trim(), status: $('rfStatus').value };
      if (raceEdit === 'plan' && plan && date !== plan.race) extra.hidePlanRace = plan.race;
      extra.races = (extra.races || []).filter(x => x.id !== item.id).concat(item);
      raceEdit = null; raceOpen = item.id; persist(); renderRaceForm(false); renderAll(); showToast('Prova salva.');
    };
  }

  /* ---------- Rotas ---------- */
  const VIEWS = ['hoje', 'plano', 'progresso', 'provas', 'ajustes'];
  function route() {
    const h = (location.hash || '#hoje').slice(1); view = VIEWS.includes(h) ? h : 'hoje';
    document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
    document.querySelectorAll('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === view ? 'page' : 'false'));
    renderHeader();
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  $('prevWeek').onclick = () => goDay(-7);
  $('nextWeek').onclick = () => goDay(7);
  $('goToday').onclick = () => { selected = today; renderAll(); };
  // Arrastar para o lado na tela Hoje troca o dia.
  (function swipe() {
    let x0 = null, y0 = 0, t0 = 0;
    const area = $('todayStack');
    area.addEventListener('touchstart', e => { if (e.touches.length !== 1 || e.target.closest('.tbl, input, .seg')) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    area.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && Date.now() - t0 < 600) goDay(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();
  $('syncBtn').onclick = async () => {
    const b = $('syncBtn');
    if (strava.connected) {
      if (b.classList.contains('spin')) return;
      b.classList.add('spin');
      await syncAndAnalyze(false);
      b.classList.remove('spin');
    } else if (strava.checked && strava.configured === false) { location.hash = 'ajustes'; }
    else { try { const j = await api('/api/strava/login'); location.href = j.url; } catch (e) { showToast(e.message, true); } }
  };

  function renderAll() {
    const has = !!plan;
    document.querySelectorAll('[data-no-plan]').forEach(el => { el.hidden = has; });
    document.querySelectorAll('[data-needs-plan]').forEach(el => { el.hidden = !has; });
    if (has) { renderSummary(); renderAdjust(); renderWorkout(); renderDiet(); renderPlan(); renderRace(); renderTest(); renderWeekSum(); renderNext(); }
    renderProgress(); renderVolume(); renderCadence(); renderZones(); renderWeight(); renderWxSettings(); renderSettings(); renderHr(); renderInstall(); renderUpdate(); renderRaces(); bindStravaButtons(); route();
  }
  function bindStravaButtons() {
    document.querySelectorAll('[data-strava-connect]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try { const j = await api('/api/strava/login'); location.href = j.url; }
        catch (e) { b.disabled = false; showToast(e.message, true); }
      };
    });
  }
  document.querySelectorAll('[data-example]').forEach(b => b.onclick = async () => { try { setPlanMd(await examplePlanMd(), 'exemplo'); } catch (e) { showToast('Não consegui carregar o exemplo.', true); } });
  $('bkSave').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'pacepro', v: 2, plan_md: planMd, done, extra, runs }, null, 1)], { type: 'application/json' });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `pacepro-backup-${today}.json`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  };
  $('bkFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'pacepro') throw new Error();
      done = j.done || {}; extra = { ...defaultExtra(), ...(j.extra || {}) }; runs = Array.isArray(j.runs) ? j.runs : []; store.set(userKey('runs'), runs);
      setPlanMd(j.plan_md || null, 'salvo'); saveNow(); showToast('Backup restaurado.');
    } catch (err) { showToast('Esse arquivo não é um backup do PacePro.', true); }
  };

  (async function boot() {
    const params = new URLSearchParams(location.search);
    const q = params.get('strava');
    if (q) history.replaceState(null, '', '/' + location.hash);
    loadState();
    if (!plan) { try { applyPlanMd(await examplePlanMd(), 'exemplo'); } catch (e) {} }
    if (plan) { clampSelected(); if (plan.race > today) $('gRace').value = plan.race; if (plan.goalSec) $('gGoal').value = A.fmtTime(plan.goalSec); }
    renderAll();
    fetchVer().then(v => { appVer = v; renderUpdate(); });
    loadWx().then(() => { if (plan) renderWorkout(); });
    if (extra.wx && extra.wx.name === 'sua localização') placeName(extra.wx.lat, extra.wx.lon).then(n => { if (n) { extra.wx = { ...extra.wx, name: n }; persist(); renderAll(); } });
    await checkStrava();
    renderSettings();
    if (strava.connected) await syncAndAnalyze(true);
    renderAll();
    if (q === 'ok') showToast('Strava conectado.');
    if (q === 'erro' || q === 'scope') { location.hash = 'ajustes'; showToast(q === 'scope' ? 'Autorize o acesso às atividades para analisar os treinos.' : 'Não consegui conectar ao Strava. Tente de novo.', true); }
    setInterval(() => { if (plan) renderSummary(); }, 60000);
  })();
})();
