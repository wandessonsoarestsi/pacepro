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
  const Cloud = { sb: null, user: null, session: null, enabled: false };
  const userKey = k => `pp.${Cloud.user ? Cloud.user.id : 'local'}.${k}`;
  let strava = { connected: false, configured: true, athlete: null, checked: false };
  const today = isoLocal(new Date());
  let selected = today;
  let busy = false;

  /* ---------- Plano ---------- */
  function applyPlanMd(md, source) {
    planMd = md || null;
    plan = null;
    if (md) { try { const p = P.parse(md); if (p.days.length) { plan = p; planSource = source || 'salvo'; } } catch (e) {} }
  }
  function setPlanMd(md, source) {
    applyPlanMd(md, source);
    planWeek = null; selected = today; if (plan) clampSelected();
    persist(); renderAll();
  }
  async function examplePlanMd() { const r = await fetch('/plano.md', { cache: 'no-cache' }); return r.text(); }

  /* ---------- Dados do usuário (Supabase ou este aparelho) ---------- */
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }
  async function saveNow() {
    const row = { plan_md: planMd, done, updated_at: new Date().toISOString() };
    if (Cloud.enabled && Cloud.user) {
      const { error } = await Cloud.sb.from('user_state').upsert({ user_id: Cloud.user.id, ...row });
      if (error) showToast('Não consegui salvar agora. Tentando de novo…', true), setTimeout(persist, 5000);
    } else store.set(userKey('state'), row);
  }
  async function loadState() {
    let row = null;
    if (Cloud.enabled && Cloud.user) {
      const { data, error } = await Cloud.sb.from('user_state').select('plan_md, done').eq('user_id', Cloud.user.id).maybeSingle();
      if (error) throw error;
      row = data;
      if (!row) { // primeiro acesso: traz o que estava salvo neste aparelho
        const legacyPlan = store.get('sub30.planmd', null), legacyDone = store.get('sub30.done', null);
        if (legacyPlan || legacyDone) { row = { plan_md: legacyPlan, done: legacyDone || {} }; planMd = row.plan_md; done = row.done; await saveNow(); }
      }
    } else row = store.get(userKey('state'), null);
    done = (row && row.done) || {};
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
  function clampSelected() {
    if (selected < firstDay()) selected = firstDay();
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
  async function authHeader() {
    if (!Cloud.enabled) return {};
    const { data } = await Cloud.sb.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  }
  async function api(path, opts) {
    const r = await fetch(path, { ...(opts || {}), headers: { ...(await authHeader()), ...((opts && opts.headers) || {}) } });
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
    $('prevDay').disabled = selected <= firstDay();
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
    html += `</div>`;

    if (day.type !== 'rest' || day.gym) {
      if (st) html += `<div class="row-actions"><button class="btn ghost" id="undo" type="button">Desmarcar</button>${isRun && st.analysis ? `<button class="btn ghost" id="redo" type="button">Analisar de novo</button>` : ''}</div>`;
      else html += `<div class="row-actions"><button class="btn" id="finish" type="button">Marcar como finalizado</button></div>`;
    }
    html += `<div id="finishArea"></div>`;
    el.innerHTML = html;

    const f = $('finish'); if (f) f.onclick = () => finish(day);
    const u = $('undo'); if (u) u.onclick = () => { delete done[day.date]; persist(); renderAll(); };
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
      bars + `<ul class="points">${a.points.map(p => `<li class="${p.tone}">${esc(p.txt)}</li>`).join('')}</ul>` +
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
      ? `${strava.athlete && strava.athlete.name ? strava.athlete.name + ' · ' : ''}${synced ? 'última sincronização ' + new Date(synced).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não sincronizado'}.`
      : strava.configured === false ? 'O Strava ainda não foi configurado neste site (faltam as chaves da API no Vercel).' : 'Conecte para puxar seus treinos e atualizar a estimativa.';
    $('stravaConnect').hidden = strava.connected;
    $('stravaSync').hidden = !strava.connected;
    $('stravaOut').hidden = !strava.connected;
    $('planInfo').textContent = plan ? `${plan.title} · ${plan.weeks.length} semanas, ${plan.days.length} dias · prova em ${ddmm(raceISO())}.` : 'Nenhum plano ainda. Gere um acima, importe um arquivo .md ou use o plano de exemplo.';
    renderProfile();
    const t = store.get('sub30.theme', 'system');
    document.querySelectorAll('#themePills button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.t === t)));
  }
  document.querySelectorAll('#themePills button').forEach(b => b.onclick = () => {
    const t = b.dataset.t; store.set('sub30.theme', t);
    try { localStorage.setItem('sub30.theme', t); } catch (e) {}
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    renderSettings();
  });
  $('stravaSync').onclick = async () => { $('stravaSync').disabled = true; try { await syncRuns(); } catch (e) {} $('stravaSync').disabled = false; renderAll(); };
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
    if (has) { renderTop(); renderSummary(); renderWorkout(); renderPlan(); }
    renderProgress(); renderSettings(); bindStravaButtons(); route();
  }
  function bindStravaButtons() {
    document.querySelectorAll('[data-strava-connect]').forEach(b => {
      b.onclick = async () => {
        if (Cloud.enabled && !Cloud.user) return;
        b.disabled = true;
        try { const j = await api('/api/strava/login'); location.href = j.url; }
        catch (e) { b.disabled = false; showToast(e.message, true); }
      };
    });
  }
  document.querySelectorAll('[data-example]').forEach(b => b.onclick = async () => { try { setPlanMd(await examplePlanMd(), 'exemplo'); } catch (e) { showToast('Não consegui carregar o exemplo.', true); } });
  $('signOut').onclick = async () => { if (Cloud.enabled) { await Cloud.sb.auth.signOut(); } location.replace('/'); };
  function renderProfile() {
    const u = Cloud.user;
    $('profileCard').hidden = !u;
    if (!u) return;
    const m = u.user_metadata || {};
    $('pName').textContent = m.full_name || m.name || u.email;
    $('pEmail').textContent = u.email || '';
    if (m.avatar_url) { $('pAvatar').src = m.avatar_url; $('pAvatar').hidden = false; }
  }

  async function startCloud() {
    let cfg = null;
    try { const r = await fetch('/api/config'); if (r.ok) cfg = await r.json(); } catch (e) {}
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return false;
    Cloud.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
    Cloud.enabled = true;
    const { data } = await Cloud.sb.auth.getSession();
    Cloud.session = data.session; Cloud.user = data.session ? data.session.user : null;
    Cloud.sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_OUT') location.replace('/'); Cloud.session = session; });
    return true;
  }
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    if (msg) { $('loginMsg').hidden = false; $('loginMsg').textContent = msg; }
    $('googleBtn').onclick = async () => {
      $('googleBtn').disabled = true;
      const { error } = await Cloud.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
      if (error) { $('googleBtn').disabled = false; $('loginMsg').hidden = false; $('loginMsg').textContent = 'Não consegui abrir o login do Google. Tente de novo.'; }
    };
  }

  (async function boot() {
    const params = new URLSearchParams(location.search);
    const q = params.get('strava');
    const cloud = await startCloud();
    if (params.has('code') || params.has('error_description') || q) history.replaceState(null, '', '/' + location.hash);
    if (cloud && !Cloud.user) { showLogin(params.get('error_description') ? 'O login não foi concluído. Tente de novo.' : null); return; }
    try { await loadState(); } catch (e) { showToast('Não consegui carregar seus dados.', true); }
    if (!cloud && !plan) { try { applyPlanMd(await examplePlanMd(), 'exemplo'); } catch (e) {} }
    if (plan) { clampSelected(); if (plan.race > today) $('gRace').value = plan.race; if (plan.goalSec) $('gGoal').value = A.fmtTime(plan.goalSec); }
    renderAll();
    await checkStrava();
    renderSettings();
    if (strava.connected) { try { await syncRuns(); } catch (e) {} }
    renderAll();
    if (q === 'ok') showToast('Strava conectado.');
    if (q === 'erro' || q === 'scope') { location.hash = 'ajustes'; showToast(q === 'scope' ? 'Autorize o acesso às atividades para analisar os treinos.' : 'Não consegui conectar ao Strava. Tente de novo.', true); }
    setInterval(() => { if (plan) renderSummary(); }, 60000);
  })();
})();
