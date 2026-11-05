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
      return d;
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
  const lastDay = () => plan ? plan.days[plan.days.length - 1].date : today;
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
  function renderTop() {
    const d = D(selected);
    $('dayTitle').textContent = selected === today ? 'HOJE' : selected === addDays(today, 1) ? 'AMANHÃ' : selected === addDays(today, -1) ? 'ONTEM' : WDL[d.getDay()].toUpperCase();
    $('daySub').textContent = `${WDL[d.getDay()]}, ${d.getDate()} de ${MON[d.getMonth()]}`;
    $('prevDay').disabled = selected <= minDay();
    $('nextDay').disabled = selected >= lastDay();
  }

  function renderSummary() {
    const race = new Date(raceISO() + 'T05:30:00-03:00');
    const ms = race - Date.now();
    const days = Math.max(0, Math.ceil(ms / 864e5));
    $('sDays').textContent = ms > 0 ? `${days} dias` : 'Prova!';
    const day = dayOf(selected);
    const wk = day ? plan.weeks.find(w => w.n === day.week) : null;
    const keyDays = wk ? wk.days.filter(x => x.type !== 'rest' && x.type !== 'swim') : [];
    const nDone = keyDays.filter(x => done[x.date]).length;
    $('sWeek').textContent = keyDays.length ? `${nDone}/${keyDays.length}` : '–';
    const est = estimateAt(today);
    const proj = est ? A.project(est.sec, today, raceISO()) : null;
    $('sProj').textContent = proj ? A.fmtTime(proj) : '–';

    // anéis: ciclo, semana, distância até a meta
    const start = D(firstDay()).getTime(), end = race.getTime();
    const p1 = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
    const p2 = keyDays.length ? nDone / keyDays.length : 0;
    const startEst = 44 * 60;
    const p3 = proj ? Math.min(1, Math.max(0.02, (startEst - proj) / (startEst - goalSec()))) : 0;
    const ring = (r, p, c) => {
      const C = 2 * Math.PI * r;
      return `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="10"/>` +
        `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(${c})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>`;
    };
    $('rings').innerHTML = ring(52, p1, '--c1') + ring(38, p2, '--c2') + ring(24, p3, '--c3');

    // tiles
    $('tEst').textContent = est ? A.fmtTime(est.sec) : '–';
    $('tEstSub').textContent = est ? `${A.fmtPace(est.sec / distKm())}/km${est.gapDays > 10 ? ' · com pausa' : ''}` : 'sem corridas';
    $('tGoal').textContent = A.fmtTime(goalSec());
    $('tGoalSub').textContent = `${A.fmtPace(goalSec() / distKm())}/km`;
    const lastDone = Object.entries(done).filter(([, v]) => v.analysis).sort((a, b) => b[0].localeCompare(a[0]))[0];
    if (lastDone) { $('tLast').textContent = A.fmtPace(lastDone[1].analysis.metrics.pace) ; $('tLastSub').textContent = `${ddmm(lastDone[0])} · ${lastDone[1].analysis.metrics.distKm.toFixed(1).replace('.', ',')} km`; }
    else { const r = allRuns().slice(-1)[0]; $('tLast').textContent = r ? A.fmtPace(r.sec / r.km) : '–'; $('tLastSub').textContent = r ? `${ddmm(r.date)} · ${r.km.toFixed(1).replace('.', ',')} km` : '–'; }
    const h = Math.max(0, Math.floor(ms / 36e5) % 24), m = Math.max(0, Math.floor(ms / 6e4) % 60);
    $('tClock').textContent = ms > 0 ? `${days}d ${h}h` : '0d';
    $('tClockSub').textContent = ms > 0 ? `${m} min · ${ddmm(raceISO())}` : 'Boa prova!';
  }

  /* ---------- Treino do dia ---------- */
  function gymBlock(key, day) {
    const g = plan.gym[key];
    if (!g) return `<div class="blk gym"><span class="k">Musculação</span><b>Sessão ${esc(key)}</b><p class="note">${esc(day.gymText)}</p></div>`;
    const head = g.head || ['Exercício', 'Volume'];
    const wk = plan.weeks.find(w => w.n === day.week);
    const extra = day.gymText.replace(/^[A-E]\b\s*/, '').replace(/^leve:?\s*/i, m => m);
    return `<div class="blk gym"><span class="k">Musculação</span><b>${esc(key)} · ${esc(g.name.replace(/\s*\(.*\)$/, ''))}</b>` +
      (extra && extra !== key ? `<p class="note">${esc(extra)}</p>` : '') +
      (wk && wk.note ? `<p class="note">${esc(wk.note)}</p>` : '') +
      `<div class="tbl"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${g.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }

  const TYPE_LABEL = { easy: 'Leve', threshold: 'Limiar', interval: 'Intervalado', test: 'Teste', race: 'Prova', swim: 'Natação', rest: 'Descanso' };

  function renderWorkout() {
    const day = dayOf(selected);
    const el = $('workout');
    if (!day && selected < firstDay()) {
      const n = Math.round((D(firstDay()) - D(selected)) / 864e5);
      el.innerHTML = `<div class="wk-top"><div><span class="eyebrow">Antes do plano</span><h3>O plano começa ${n === 1 ? 'amanhã' : `em ${n} dias`}</h3></div></div>` +
        `<div class="blocks"><div class="blk rest"><span class="k">Até lá</span><p class="note">Primeiro treino: ${WDL[D(firstDay()).getDay()].toLowerCase()}, ${ddmm(firstDay())}. Até lá, caminhadas ou trotes leves de 20 a 30 minutos, se estiver se sentindo bem.</p></div></div>` +
        `<div class="row-actions"><button class="btn ghost" id="goStart" type="button">Ver o primeiro treino</button></div>`;
      $('analysis').hidden = true;
      $('goStart').onclick = () => { selected = firstDay(); renderAll(); };
      return;
    }
    if (!day) { el.innerHTML = `<p class="muted">Sem treino planejado para este dia.</p>`; $('analysis').hidden = true; return; }
    const st = done[day.date];
    const isRun = !['swim', 'rest'].includes(day.type);
    let html = `<div class="wk-top"><div><span class="eyebrow">Semana ${day.week} · ${esc(TYPE_LABEL[day.type])}</span><h3>${esc(day.title)}</h3></div><div class="badges">` +
      (day.key && isRun ? '<span class="chip key">Treino-chave</span>' : '') + (st ? '<span class="chip good">Feito</span>' : '') + `</div></div><div class="blocks">`;
    if (isRun) {
      html += `<div class="blk run"><span class="k">Corrida</span><dl class="kv"><dt>Rua</dt><dd>${esc(day.rua)}</dd>${day.esteira ? `<dt>Esteira</dt><dd>${esc(day.esteira)}${/\d$/.test(day.esteira) ? ' km/h' : ''}${/\d/.test(day.esteira) ? ' · inclinação 1%' : ''}</dd>` : ''}${day.targetPace ? `<dt>Ritmo-alvo</dt><dd>${A.fmtPace(day.targetPace)}/km (${(3600 / day.targetPace).toFixed(1).replace('.', ',')} km/h)</dd>` : ''}</dl>` +
        `<p class="note">${day.type === 'easy' ? 'FC até ~145. Passou disso, caminhe até baixar e volte a trotar.' : day.type === 'threshold' ? 'FC entre 150 e 165, ritmo constante. Se for quebrar, reduza 10–15 s/km em vez de parar.' : day.type === 'interval' ? 'Marque uma volta no relógio a cada tiro. Todos os tiros no mesmo ritmo.' : 'Km 1 levemente mais lento, km 2–4 no alvo, km 5 com tudo.'}</p>` +
        `<p class="note">Aquecimento 10' leve e desaquecimento 5–10'. Treinos fortes cedo ou na esteira.</p></div>`;
    }
    if (day.type === 'swim') html += `<div class="blk swim"><span class="k">Natação</span><b>${esc(day.title)}</b><p class="note">Técnica e respiração, sem séries fortes.</p></div>`;
    if (day.gym) html += gymBlock(day.gym, day);
    if (day.type === 'rest' && !day.gym) html += `<div class="blk rest"><span class="k">Descanso</span><p class="note">${esc(day.rua && !/^descanso$/i.test(day.rua) ? day.rua : 'Descanso total. Sono, água e boa comida.')}</p></div>`;
    const adj = day.movedFrom ? `Treino de ${WD[D(day.movedFrom).getDay()]} ${ddmm(day.movedFrom)} remarcado para hoje.` : day.movedTo ? '' : day.skipped ? '' : day.softened ? `Era "${day.softened}". Trocado por leve para recuperar.` : '';
    if (day.movedFrom || day.movedTo || day.skipped || day.softened) html += `<div class="blk adj"><span class="k">Plano ajustado</span>${adj ? `<p class="note">${esc(adj)}</p>` : ''}<button class="linkbtn" id="undoAdj" type="button">Desfazer ajuste</button></div>`;
    if (day.type === 'race') html += `<div class="blk run"><span class="k">Plano de prova</span><p class="note">Ritmo por km, aquecimento e checklist do dia.</p><a class="linkbtn" href="#progresso" data-goto="raceCard">Ver o plano de prova</a></div>`;
    html += `</div>`;

    if (day.type !== 'rest' || day.gym) {
      if (st) html += `<div class="row-actions"><button class="btn ghost" id="undo" type="button">Desmarcar</button>${isRun && st.analysis ? `<button class="btn ghost" id="redo" type="button">Analisar de novo</button>` : ''}</div>`;
      else html += `<div class="row-actions"><button class="btn" id="finish" type="button">Marcar como finalizado</button></div>`;
    }
    html += `<div id="finishArea"></div>`;
    if (st && day.type !== 'rest') html += feelHtml(day.date);
    el.innerHTML = html;
    bindFeel(day.date);
    const ua = $('undoAdj'); if (ua) ua.onclick = () => {
      if (day.movedFrom) delete extra.moves[day.date];
      if (day.movedTo) delete extra.moves[day.movedTo];
      if (day.skipped) delete extra.skips[day.date];
      if (day.softened) delete extra.soft[day.date];
      refreshAdjust();
    };
    el.querySelectorAll('[data-goto]').forEach(a => a.onclick = () => setTimeout(() => { const t = $(a.dataset.goto); if (t) t.scrollIntoView({ block: 'start' }); }, 50));

    const f = $('finish'); if (f) f.onclick = () => finish(day);
    const u = $('undo'); if (u) u.onclick = () => { if (st && st.auto) extra.dismiss['a' + day.date] = true; delete done[day.date]; persist(); renderAll(); };
    const r = $('redo'); if (r) r.onclick = () => finish(day, true);
    renderAnalysis(day);
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
      bars + (() => { const Z = hrZones(); const zb = Z ? zoneBar(zoneTimes(a.splits, Z)) : ''; return zb ? `<div><span class="eyebrow">Tempo por zona de FC</span>${zb}</div>` : ''; })() + `<ul class="points">${a.points.map(p => `<li class="${p.tone}">${esc(p.txt)}</li>`).join('')}</ul>` +
      (a.estimateSec ? `<p class="msg good">Este treino indica ${A.fmtTime(a.estimateSec)} nos ${distKm()} km (${esc(a.estimateBasis)}). A estimativa foi atualizada.</p>` : '') +
      (st.activityId ? `<a class="muted small" href="https://www.strava.com/activities/${encodeURIComponent(st.activityId)}" target="_blank" rel="noopener">Ver no Strava ↗</a>` : '');
    box.hidden = false;
  }

  /* ---------- Plano ---------- */
  let planWeek = null;
  const ICON = {
    run: '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M6 12l3-3 4 1 2 3 3 1"/></svg>',
    swim: '<svg viewBox="0 0 24 24"><path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M7 13l4-4 3 3M14 6.5a1.5 1.5 0 1 0 0-.1"/></svg>',
    rest: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };
  function renderPlan() {
    const d = dayOf(selected);
    if (planWeek == null) planWeek = d ? d.week : plan.weeks[0].n;
    $('weekPills').innerHTML = plan.weeks.map(w => `<button type="button" role="tab" data-w="${w.n}" aria-selected="${w.n === planWeek}">SEM ${w.n}</button>`).join('');
    document.querySelectorAll('#weekPills button').forEach(b => b.onclick = () => { planWeek = +b.dataset.w; renderPlan(); });
    const w = plan.weeks.find(x => x.n === planWeek);
    $('weekNote').innerHTML = `<span class="eyebrow">${esc(w.range)}</span><h3>${esc(w.title)}</h3>${w.note ? `<p class="muted">${esc(w.note)}</p>` : ''}`;
    $('weekDays').innerHTML = w.days.map(x => {
      const dt = D(x.date); const kind = x.type === 'swim' ? 'swim' : x.type === 'rest' ? 'rest' : 'run';
      const right = done[x.date] ? '<span class="done">✓ feito</span>' : x.gym ? `<span class="chip">${esc(x.gym)}</span>` : '';
      return `<button type="button" class="lrow ${x.date === today ? 'today' : ''}" data-d="${x.date}"><span class="ico ${x.key && kind === 'run' ? 'key' : kind}">${ICON[kind]}</span><span style="min-width:0"><span class="t">${esc(x.title)}</span><span class="s">${WD[dt.getDay()]} ${ddmm(x.date)} · ${esc(TYPE_LABEL[x.type])}</span></span>${right}</button>`;
    }).join('');
    document.querySelectorAll('#weekDays .lrow').forEach(b => b.onclick = () => { selected = b.dataset.d; location.hash = 'hoje'; renderAll(); window.scrollTo(0, 0); });
  }
  $('openFull').onclick = () => {
    const fp = $('fullPlan');
    if (fp.hidden) { fp.innerHTML = window.marked ? window.marked.parse(plan.raw) : `<pre style="white-space:pre-wrap">${esc(plan.raw)}</pre>`; fp.hidden = false; $('openFull').textContent = 'Esconder o plano completo'; }
    else { fp.hidden = true; $('openFull').textContent = 'Ver o plano completo'; }
  };

  /* ---------- Progresso ---------- */
  function renderProgress() {
    const rs = allRuns();
    $('runsSrc').textContent = strava.connected ? 'do Strava' : 'conecte o Strava para ver todas';
    $('runs').innerHTML = rs.slice().reverse().map(r => `<div class="lrow" style="cursor:default"><span class="ico run">${ICON.run}</span><span style="min-width:0"><span class="t">${esc(r.name)}</span><span class="s">${ddmm(r.date)} · ${r.km.toFixed(2).replace('.', ',')} km · ${A.fmtTime(r.sec)}${r.hr ? ` · FC ${r.hr}` : ''}</span></span><span class="v">${A.fmtPace(r.sec / r.km)}<small>/km</small></span></div>`).join('') || '<p class="muted">Nenhuma corrida ainda.</p>';

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
    $('chartHint').textContent = 'Linha azul: tempo estimado nos 5 km a partir das suas corridas e dos treinos analisados. Tracejado laranja: projeção até a prova se o plano for cumprido. Pausas longas aumentam a estimativa.';
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
    $('planInfo').textContent = plan ? `${plan.title} · ${plan.weeks.length} semanas, ${plan.days.length} dias · prova em ${ddmm(raceISO())}.` : 'Nenhum plano ainda. Gere um acima, importe um arquivo .md ou use o plano de exemplo.';
    const t = store.get('sub30.theme', 'system');
    document.querySelectorAll('#themePills button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.t === t)));
  }
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
      const msg = $('genMsg'); msg.className = 'msg good'; msg.textContent = 'Plano novo em uso. O plano anterior pode ser restaurado em "Voltar ao plano padrão".';
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
  function renderRace() {
    const box = $('raceCard'); if (!plan) { box.innerHTML = ''; return; }
    const r = racePlan(), dist = distKm();
    const show = dist > 10 ? r.rows.filter(x => x.km % 5 === 0 || x.km === r.rows.length) : r.rows;
    const sec = planSection(/estrat[ée]gia de prova/i);
    box.innerHTML = `<div class="card-head"><div><span class="eyebrow">Plano de prova · ${ddmm(raceISO())}</span><h3>Alvo: ${A.fmtTime(r.target)}</h3></div><span class="chip key">${A.fmtPace(r.target / dist)}/km</span></div>` +
      `<p class="muted small">${esc(r.note)}</p>` +
      `<div class="tbl"><table><thead><tr><th>Km</th><th>Ritmo</th><th>Acumulado</th></tr></thead><tbody>${show.map(x => `<tr><td>${x.len < 1 ? `${x.km - 1 + +x.len.toFixed(1)}`.replace('.', ',') : x.km}</td><td>${A.fmtPace(x.pace)}/km</td><td>${A.fmtTime(Math.round(x.acc))}</td></tr>`).join('')}</tbody></table></div>` +
      `<p class="muted small">O relógio costuma marcar um pouco mais que a distância oficial. Mire 3–5 s/km mais rápido do que a tabela no relógio.</p>` +
      `<div class="checks2">` +
      `<div><b>Véspera</b><ul><li>Jantar com carboidrato que você já conhece</li><li>Separar roupa, tênis, número e chip</li><li>Dormir cedo, sem treino</li></ul></div>` +
      `<div><b>Manhã da prova</b><ul><li>Café da manhã 2–3 h antes, já testado em treino</li><li>Água aos poucos, sem exagero</li><li>Chegar 45 min antes</li></ul></div>` +
      `<div><b>Largada</b><ul><li>10 min de trote leve + 3 acelerações curtas</li><li>Largar no meio do pelotão, sem ziguezague</li><li>Km 1 levemente mais lento que o alvo</li></ul></div>` +
      `<div><b>Durante</b><ul><li>Olhar o ritmo médio a cada km</li><li>Km 3 é o mais duro de cabeça: só mantenha</li><li>Último km com tudo o que sobrar</li></ul></div>` +
      `</div>` +
      (sec && window.marked ? `<details class="prose"><summary>Estratégia do seu plano</summary>${window.marked.parse(sec)}</details>` : '');
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
      (weigh ? `<p class="msg">${lw ? 'Já faz uma semana desde a última pesagem.' : 'Registre seu peso para acompanhar a evolução.'} Pese-se em jejum, sempre no mesmo dia e horário. <a href="#progresso" data-goto="weightCard">Registrar peso</a></p>` : '');
    box.hidden = false;
    box.querySelectorAll('.ck').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, cur = new Set(extra.diet[today] || []);
      cur.has(i) ? cur.delete(i) : cur.add(i);
      extra.diet[today] = [...cur].sort(); persist(); renderDiet();
    });
    box.querySelectorAll('[data-goto]').forEach(a => a.onclick = () => setTimeout(() => { const t = $(a.dataset.goto); if (t) t.scrollIntoView({ block: 'start' }); }, 50));
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
    $('wForm').onsubmit = e => {
      e.preventDefault();
      const v = parseFloat($('wKg').value.replace(',', '.'));
      if (!(v >= 30 && v <= 250)) { showToast('Informe o peso em kg, como 82,4.', true); return; }
      extra.weights = extra.weights.filter(w => w.date !== today).concat({ date: today, kg: Math.round(v * 10) / 10 }).sort((a, b) => a.date.localeCompare(b.date));
      persist(); renderWeight(); renderDiet(); showToast('Peso registrado.');
    };
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
  }
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; renderInstall(); };
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  /* ---------- Rotas ---------- */
  const VIEWS = ['hoje', 'plano', 'progresso', 'ajustes'];
  function route() {
    const h = (location.hash || '#hoje').slice(1); const v = VIEWS.includes(h) ? h : 'hoje';
    document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== v; });
    document.querySelectorAll('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === v ? 'page' : 'false'));
    document.querySelector('.topbar').hidden = v !== 'hoje' || !plan;
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  $('prevDay').onclick = () => { selected = addDays(selected, -1); renderAll(); };
  $('nextDay').onclick = () => { selected = addDays(selected, 1); renderAll(); };

  function renderAll() {
    const has = !!plan;
    document.querySelectorAll('[data-no-plan]').forEach(el => { el.hidden = has; });
    document.querySelectorAll('[data-needs-plan]').forEach(el => { el.hidden = !has; });
    if (has) { renderTop(); renderSummary(); renderAdjust(); renderWorkout(); renderDiet(); renderPlan(); renderRace(); }
    renderProgress(); renderZones(); renderWeight(); renderSettings(); renderHr(); renderInstall(); bindStravaButtons(); route();
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
    await checkStrava();
    renderSettings();
    if (strava.connected) await syncAndAnalyze(true);
    renderAll();
    if (q === 'ok') showToast('Strava conectado.');
    if (q === 'erro' || q === 'scope') { location.hash = 'ajustes'; showToast(q === 'scope' ? 'Autorize o acesso às atividades para analisar os treinos.' : 'Não consegui conectar ao Strava. Tente de novo.', true); }
    setInterval(() => { if (plan) renderSummary(); }, 60000);
  })();
})();
