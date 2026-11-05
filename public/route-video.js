/* Vídeo da corrida: mapa 3D (MapLibre + mapas gratuitos), câmera percorrendo o trajeto, paradas nos
   momentos marcantes e cartão final. Grava no próprio celular (MediaRecorder) em 9:16. */
(function (root) {
  const STYLE = 'https://tiles.openfreemap.org/styles/positron';
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const CW = 360, CH = 640, PR = 2, W = CW * PR, H = CH * PR; // saída 720×1280
  const T_INTRO = 2200, T_RUN = 11000, T_HOLD = 1700, T_OUTRO = 3400, FPS = root.__vsFPS || 30;

  let mlP = null;
  function loadMapLibre() {
    if (root.maplibregl) return Promise.resolve(root.maplibregl);
    if (!mlP) mlP = new Promise((ok, no) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/maplibre/maplibre-gl.css'; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = '/vendor/maplibre/maplibre-gl.js'; s.onload = () => ok(root.maplibregl); s.onerror = () => { mlP = null; no(new Error('Não consegui carregar o mapa 3D.')); }; document.head.appendChild(s);
    });
    return mlP;
  }
  let muxP = null;
  function loadMuxer() {
    if (root.Mp4Muxer) return Promise.resolve(root.Mp4Muxer);
    if (!muxP) muxP = new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/mp4-muxer/mp4-muxer.js'; s.onload = () => ok(root.Mp4Muxer); s.onerror = () => { muxP = null; no(new Error('mux')); }; document.head.appendChild(s); });
    return muxP;
  }
  // Codificador de vídeo do aparelho (WebCodecs): grava quadro a quadro, sem depender da velocidade do celular.
  async function pickEncoder() {
    if (!root.VideoEncoder || !root.VideoFrame) return null;
    const tries = [['avc1.640028', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.42002a', 'avc'], ['avc1.42001f', 'avc'], ['vp09.00.31.08', 'vp9']];
    for (const [codec, mux] of tries) {
      try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 8e6, framerate: FPS }); if (r.supported) return { codec, mux }; } catch (e) {}
    }
    return null;
  }
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const angLerp = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };
  const bearingOf = (a, b) => { const k = Math.PI / 180; const y = Math.sin((b[1] - a[1]) * k) * Math.cos(b[0] * k), x = Math.cos(a[0] * k) * Math.sin(b[0] * k) - Math.sin(a[0] * k) * Math.cos(b[0] * k) * Math.cos((b[1] - a[1]) * k); return (Math.atan2(y, x) / k + 360) % 360; };
  const pad = n => String(n).padStart(2, '0');
  const fmtT = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
  const fmtP = s => { s = Math.round(s); return `${Math.floor(s / 60)}'${pad(s % 60)}"`; };

  function pickMime() {
    if (!root.MediaRecorder) return null;
    for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
    }
    return '';
  }
  async function demOk() {
    try { const r = await fetch(DEM.replace('{z}/{x}/{y}', '10/377/524'), { mode: 'cors' }); return r.ok; } catch (e) { return false; }
  }

  /* d: { lat[], lon[], dist[] (m), time[] (s), colors[] (por ponto), moments: [{i, ico, color, t, d}], meta: {title, date, km, time, pace, hr, ghost, brand} } */
  function open(d) {
    let box = document.getElementById('vStudio');
    if (box) box.remove();
    box = document.createElement('div'); box.id = 'vStudio'; box.className = 'vstudio';
    box.innerHTML = `<div class="vs-bar"><button type="button" class="vs-x">‹ Voltar</button><b>Vídeo da corrida</b><span></span></div>
      <div class="vs-body"><div class="vs-stage"><canvas class="vs-canvas" width="${W}" height="${H}"></canvas><video class="vs-video" playsinline controls hidden></video><div class="vs-load" hidden><div class="vs-lrow"><i class="vs-spin"></i><b class="vs-lt">Preparando…</b><span class="vs-pct"></span></div><div class="vs-pbar"><i></i></div></div></div>
      <p class="vs-msg muted small">Vídeo vertical com o mapa 3D do seu percurso. Deixe o app aberto enquanto ele é gerado.</p>
      <div class="vs-actions">${d.kmMoments && d.kmMoments.length ? '<label class="vs-opt"><input type="checkbox" class="vs-km" checked><span><b>Análise por km</b><small>Uma parada em cada km com o que aconteceu nele</small></span></label>' : ''}<button type="button" class="btn wide vs-go">Gerar vídeo</button></div></div>
      <div class="vs-map" aria-hidden="true"></div>`;
    document.body.appendChild(box); document.body.classList.add('noscroll');
    const $ = s => box.querySelector(s);
    const cv = $('.vs-canvas'), ctx = cv.getContext('2d');
    let map = null, stop = false, rec = null, url = null;
    const close = () => { stop = true; try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {} try { map && map.remove(); } catch (e) {} if (url) URL.revokeObjectURL(url); box.remove(); document.body.classList.remove('noscroll'); };
    $('.vs-x').onclick = close;
    const msg = (t, bad) => {
      const m = $('.vs-msg'); m.textContent = t; m.classList.toggle('bad', !!bad);
      const ld = $('.vs-load'); if (ld.hidden) return;
      const pm = /(\d+)%/.exec(t); $('.vs-lt').textContent = t.replace(/…?\s*\d+%$/, '').replace(/…$/, '');
      $('.vs-pct').textContent = pm ? pm[1] + '%' : ''; $('.vs-pbar i').style.width = (pm ? pm[1] : 2) + '%';
    };
    const busy = on => { $('.vs-load').hidden = !on; const g = $('.vs-go'); if (on) { g.dataset.t = g.textContent; g.innerHTML = '<i class="vs-spin sm"></i> Gerando…'; } else if (g.dataset.t) g.textContent = g.dataset.t; };
    const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

    // Pontos e camera
    const n = d.lat.length, P = i => [d.lat[i], d.lon[i]];
    const total = d.dist[n - 1];
    const idxAt = m => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const k = (lo + hi) >> 1; if (d.dist[k] < m) lo = k; else hi = k; } return lo; };
    const posAt = m => { const i = idxAt(m), j = Math.min(n - 1, i + 1); const f = d.dist[j] > d.dist[i] ? (m - d.dist[i]) / (d.dist[j] - d.dist[i]) : 0; return [lerp(d.lat[i], d.lat[j], f), lerp(d.lon[i], d.lon[j], f), i, f]; };
    const timeAtM = m => { const [, , i, f] = posAt(m); const j = Math.min(n - 1, i + 1); return lerp(d.time[i], d.time[j], f) - d.time[0]; };
    let summary = '', moms = [], holdsAt = [], holdT = [], holdOff = [0], runEnd = 0, END = 0;
    // Linha do tempo: intro → percurso (com paradas) → final
    function setMoments(withKm) {
      const base = d.moments.filter(m => m.i > 2 && m.i < n - 3 && !(withKm && m.kmFast)).sort((a, b) => a.i - b.i).slice(0, 7);
      const kms = withKm ? (d.kmMoments || []).filter(m => m.i > 2 && m.i <= n - 1) : [];
      moms = base.concat(kms).sort((a, b) => a.i - b.i || (a.km ? 1 : 0) - (b.km ? 1 : 0));
      holdsAt = moms.map(m => d.dist[m.i]);
      // cada parada dura o tempo de ler o cartão (~60 ms por letra), entre 1,7 s e 9 s
      holdT = moms.map(m => Math.max(T_HOLD, Math.min(9000, 900 + 60 * (String(m.t).length + String(m.d).length))));
      holdOff = [0]; holdT.forEach(x => holdOff.push(holdOff[holdOff.length - 1] + x));
      runEnd = T_INTRO + T_RUN + holdOff[moms.length]; summary = d.summary || ''; END = runEnd + T_OUTRO + (summary ? Math.min(9000, 60 * summary.length) : 0);
    }
    setMoments(false);
    function stateAt(t) {
      if (t < T_INTRO) return { ph: 'intro', k: t / T_INTRO, m: 0 };
      if (t >= runEnd) return { ph: 'outro', k: Math.min(1, (t - runEnd) / T_OUTRO), m: total };
      let x = t - T_INTRO; // tempo dentro do percurso, descontando paradas
      for (let h = 0; h < holdsAt.length; h++) {
        const tReach = (holdsAt[h] / total) * T_RUN + holdOff[h];
        if (x < tReach) return { ph: 'run', m: ((x - holdOff[h]) / T_RUN) * total, passed: h };
        if (x < tReach + holdT[h]) return { ph: 'hold', m: holdsAt[h], hold: h, hk: (x - tReach) / holdT[h], passed: h + 1 };
      }
      return { ph: 'run', m: Math.min(total, ((x - holdOff[holdsAt.length]) / T_RUN) * total), passed: holdsAt.length };
    }

    function segData(m) {
      const [la, lo, i] = posAt(m); const feats = []; let start = 0;
      const push = (a, b, c) => { const coords = []; for (let k = a; k <= b; k++) coords.push([d.lon[k], d.lat[k]]); if (b === i) coords.push([lo, la]); if (coords.length > 1) feats.push({ type: 'Feature', properties: { c }, geometry: { type: 'LineString', coordinates: coords } }); };
      for (let k = 1; k <= i; k++) if (d.colors[k] !== d.colors[start] || k === i) { push(start, k, d.colors[start]); start = k; }
      if (i === 0) push(0, 0, d.colors[0]);
      return { type: 'FeatureCollection', features: feats };
    }

    let cam0 = null, zRun = 16, bSmooth = null;
    function camAt(s) {
      const ahead = (m, dm) => posAt(Math.max(0, Math.min(total, m + dm)));
      const runCam = m => { const a = ahead(m, -60), b = ahead(m, 140); const br = bearingOf(a, b); bSmooth = bSmooth == null ? br : angLerp(bSmooth, br, 0.05); const p = ahead(m, 25); return { center: [p[1], p[0]], zoom: zRun, pitch: 62, bearing: bSmooth }; };
      if (s.ph === 'intro') {
        const a = { ...cam0 }, b = runCam(0); const k = ease(s.k);
        return { center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: lerp(a.zoom, b.zoom, k), pitch: lerp(0, b.pitch, k), bearing: angLerp(0, b.bearing, k) };
      }
      if (s.ph === 'outro') {
        const k = ease(s.k), b = { ...cam0, pitch: 35, bearing: (bSmooth || 0) + 20 };
        const a = runCam(total);
        return { center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)], zoom: lerp(a.zoom, b.zoom, k), pitch: lerp(a.pitch, b.pitch, k), bearing: angLerp(a.bearing, b.bearing, k) };
      }
      const c = runCam(s.m); if (s.ph === 'hold') c.bearing += Math.sin(s.hk * Math.PI) * 8; return c;
    }

    // Desenho por cima do mapa
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    const txt = (t, x, y, size, weight, color, align) => { ctx.font = `${weight || 700} ${size}px ${font}`; ctx.fillStyle = color || '#fff'; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); };
    function pin(x, y, r, color, ico) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.font = `800 ${r * 1.05}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(ico, x, y + 1); ctx.textBaseline = 'alphabetic'; }
    const kmIdx = []; for (let k = 1, i = 0; k * 1000 < d.dist[d.dist.length - 1] - 50; k++) { while (i < d.dist.length - 1 && d.dist[i] < k * 1000) i++; kmIdx.push([k, i]); }
    function kmTag(x, y, k) { const t = `${k} km`; ctx.font = `800 22px ${font}`; const w = ctx.measureText(t).width + 22; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; rr(x - w / 2, y - 17, w, 34, 17); ctx.fillStyle = '#1a1d23'; ctx.fill(); ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; rr(x - w / 2, y - 17, w, 34, 17); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(t, x, y + 1); ctx.textBaseline = 'alphabetic'; }
    function proj(i) { const p = map.project([d.lon[i], d.lat[i]]); return [p.x * PR, p.y * PR]; }
    function compose(s) {
     
      ctx.clearRect(0, 0, W, H);
      try { ctx.drawImage(map.getCanvas(), 0, 0, W, H); } catch (e) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); }
      let g = ctx.createLinearGradient(0, 0, 0, 260); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 260);
      g = ctx.createLinearGradient(0, H - 380, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)'); ctx.fillStyle = g; ctx.fillRect(0, H - 380, W, 380);
      // marca e data
      txt(d.meta.brand || 'PacePro', 44, 92, 40, 900, '#fff'); txt(d.meta.date, 44, 136, 26, 600, 'rgba(255,255,255,.75)');
      txt('dados: Strava', W - 40, H - 34, 20, 600, 'rgba(255,255,255,.55)', 'right');
      // Rastro colorido até o corredor (desenhado aqui para acompanhar o ponto exatamente)
      if (s.ph === 'run' || s.ph === 'hold') {
        const [la, lo, ci] = posAt(s.m); const rp = map.project([lo, la]);
        const tr = [[rp.x * PR, rp.y * PR, d.colors[ci]]];
        for (let k = ci; k >= 0; k--) { const [x, y] = proj(k); if (y > H * 1.6 || y < -H * 0.6 || x < -W || x > 2 * W) break; tr.push([x, y, d.colors[k]]); }
        if (tr.length > 1) {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); tr.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 22; ctx.stroke();
          ctx.lineWidth = 13;
          for (let k = 1; k < tr.length; k++) { ctx.beginPath(); ctx.moveTo(tr[k - 1][0], tr[k - 1][1]); ctx.lineTo(tr[k][0], tr[k][1]); ctx.strokeStyle = tr[k][2]; ctx.stroke(); }
        }
      }
      // marcos de km já percorridos
      if (s.ph !== 'intro') kmIdx.forEach(([k, i]) => { if (s.ph !== 'outro' && d.dist[i] > s.m) return; const [x, y] = proj(i); if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return; kmTag(x, y, k); });
      // pinos dos momentos já alcançados
      const passed = s.ph === 'outro' || s.ph === 'intro' ? (s.ph === 'outro' ? moms.length : 0) : s.passed;
      moms.slice(0, passed).forEach(m => { if (m.km) return; const [x, y] = proj(m.i); pin(x, y, 22, m.color, m.ico); });
      if (s.ph !== 'intro') { const p = map.project([posAt(s.m)[1], posAt(s.m)[0]]); const x = p.x * PR, y = p.y * PR; ctx.beginPath(); ctx.arc(x, y, 26, 0, 7); ctx.fillStyle = 'rgba(26,29,35,.22)'; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.fillStyle = '#1a1d23'; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); }
      if (s.ph === 'intro') {
        const a = Math.min(1, s.k * 3) * (s.k > 0.75 ? (1 - s.k) * 4 : 1); ctx.globalAlpha = Math.max(0, a);
        txt(d.meta.title, W / 2, H / 2 - 20, 54, 900, '#fff', 'center'); txt(`${d.meta.km} km`, W / 2, H / 2 + 44, 34, 700, 'rgba(255,255,255,.85)', 'center'); ctx.globalAlpha = 1;
      }
      if (s.ph === 'run' || s.ph === 'hold') {
        const sec = timeAtM(s.m), km = s.m / 1000;
        rr(40, H - 190, W - 80, 104, 26); ctx.fillStyle = 'rgba(15,17,21,.72)'; ctx.fill();
        const cols = [[`${km.toFixed(2).replace('.', ',')}`, 'km'], [fmtT(sec), 'tempo'], [km > 0.05 ? fmtP(sec / km) : '–', 'pace']];
        cols.forEach(([v, l], k) => { const x = 40 + (W - 80) * (k + 0.5) / 3; txt(v, x, H - 132, 40, 800, '#fff', 'center'); txt(l, x, H - 100, 20, 600, 'rgba(255,255,255,.6)', 'center'); });
      }
      if (s.ph === 'hold') {
        const m = moms[s.hold], fk = holdT[s.hold] / 280, a = Math.min(1, s.hk * fk, (1 - s.hk) * fk); ctx.globalAlpha = a;
        ctx.font = `600 26px ${font}`; const dl = lineSplit(m.d, W - 220);
        const ch = Math.max(150, 120 + dl.length * 32), y = 210 + (1 - a) * 20; rr(40, y, W - 80, ch, 30); ctx.fillStyle = 'rgba(15,17,21,.85)'; ctx.fill();
        if (m.km) { ctx.save(); rr(64, y + 40, 76, 50, 25); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); txt(m.ico, 102, y + 75, 28, 900, '#1a1d23', 'center'); }
        else pin(100, y + 75, 32, m.color, m.ico);
        let ts = 34; ctx.font = `800 ${ts}px ${font}`; while (ts > 24 && ctx.measureText(m.t).width > W - 220) { ts -= 2; ctx.font = `800 ${ts}px ${font}`; }
        txt(m.t, 160, y + 64, ts, 800, '#fff'); dl.forEach((l, k) => txt(l, 160, y + 106 + k * 32, 26, 600, 'rgba(255,255,255,.78)'));
        ctx.globalAlpha = 1;
      }
      if (s.ph === 'outro' && s.k > 0.15) {
        const a = Math.min(1, (s.k - 0.15) * 4); ctx.globalAlpha = a;
        ctx.font = `600 26px ${font}`; const sl = summary ? lineSplit(summary, W - 160) : [];
        const h = (d.meta.ghost ? 420 : 360) + (sl.length ? sl.length * 34 + 30 : 0), y = H - h - 90;
        rr(40, y, W - 80, h, 34); ctx.fillStyle = 'rgba(15,17,21,.86)'; ctx.fill();
        txt(d.meta.title, 80, y + 72, 38, 900, '#fff');
        const cells = [[d.meta.km, 'km'], [d.meta.time, 'tempo'], [d.meta.pace, 'pace /km'], [d.meta.hr ? String(d.meta.hr) : '–', 'FC média']];
        cells.forEach(([v, l], k) => { const cx = 80 + (k % 2) * ((W - 160) / 2), cy = y + 160 + Math.floor(k / 2) * 110; txt(v, cx, cy, 56, 900, '#fff'); txt(l, cx, cy + 34, 22, 600, 'rgba(255,255,255,.6)'); });
        if (sl.length) { ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(80, y + 330, W - 160, 2); sl.forEach((l, k) => txt(l, 80, y + 378 + k * 34, 26, 600, 'rgba(255,255,255,.85)')); }
        if (d.meta.ghost) txt(d.meta.ghost, 80, y + h - 44, 26, 700, d.meta.ghostColor || '#3CC48A');
        ctx.globalAlpha = 1;
      }
    }
    function lineSplit(t, maxW) { const out = []; let line = ''; for (const w of String(t).split(' ')) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test; } if (line) out.push(line); return out.slice(0, 8); }
    function wrap(t, x, y, maxW, size, lines) {
      ctx.font = `600 ${size}px ${font}`; ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.textAlign = 'left';
      const words = String(t).split(' '); let line = '', k = 0;
      for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(k === lines - 1 ? line + '…' : line, x, y + k * (size + 6)); k++; line = w; if (k >= lines) return; } else line = test; }
      if (k < lines) ctx.fillText(line, x, y + k * (size + 6));
    }

    async function build() {
      const ml = await loadMapLibre();
      msg('Preparando o mapa 3D…');
      const holder = $('.vs-map'); holder.style.width = CW + 'px'; holder.style.height = CH + 'px';
      const lons = d.lon, lats = d.lat;
      const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
      map = new ml.Map({ container: holder, style: STYLE, bounds, fitBoundsOptions: { padding: { top: 120, bottom: 330, left: 36, right: 36 } }, interactive: false, attributionControl: false, pixelRatio: PR, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true } });
      map.on('error', () => {});
      await new Promise((ok, no) => { const to = setTimeout(() => no(new Error('O mapa demorou para carregar. Confira a internet e tente de novo.')), 20000); map.once('load', () => { clearTimeout(to); ok(); }); });
      const st = map.getStyle();
      if (st.sources.openmaptiles && !st.layers.some(l => l.type === 'fill-extrusion')) {
        map.addLayer({ id: 'pp-b3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, paint: { 'fill-extrusion-color': '#d6d2ca', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.9 } });
      }
      if (await demOk()) {
        map.addSource('pp-hs', { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 14 });
        try { map.addLayer({ id: 'pp-hill', type: 'hillshade', source: 'pp-hs', paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#000' } }, map.getStyle().layers.find(l => l.type === 'line' || l.type === 'symbol')?.id); } catch (e) {}
      }
      const full = { type: 'Feature', geometry: { type: 'LineString', coordinates: lons.map((x, i) => [x, lats[i]]) } };
      map.addSource('pp-full', { type: 'geojson', data: full });
      map.addSource('pp-done', { type: 'geojson', data: segData(total) });
      map.addLayer({ id: 'pp-full', type: 'line', source: 'pp-full', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a1d23', 'line-opacity': 0.3, 'line-width': 4 } });
      map.addLayer({ id: 'pp-allc', type: 'line', source: 'pp-done', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': '#000', 'line-opacity': 0.55, 'line-width': 11 } });
      map.addLayer({ id: 'pp-all', type: 'line', source: 'pp-done', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': ['get', 'c'], 'line-width': 6.5 } });
      const c = map.getCenter(); cam0 = { center: [c.lng, c.lat], zoom: map.getZoom() };
      zRun = Math.max(15, Math.min(16.6, cam0.zoom + 2.3));
      // Pré-carrega os pedaços do mapa por onde a câmera vai passar
      const stops = 8;
      for (let k = 0; k <= stops && !stop; k++) {
        bSmooth = null; map.jumpTo(camAt({ ph: 'run', m: total * k / stops }));
        msg(`Preparando o mapa 3D… ${Math.round(100 * k / stops)}%`);
        await new Promise(ok => { const to = setTimeout(ok, 3500); map.once('idle', () => { clearTimeout(to); ok(); }); });
      }
      map.jumpTo({ center: cam0.center, zoom: cam0.zoom, pitch: 0, bearing: 0 });
      await new Promise(ok => { const to = setTimeout(ok, 3000); map.once('idle', () => { clearTimeout(to); ok(); }); });
      bSmooth = null;
    }

    const nextRender = () => new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; map.once('render', fin); map.triggerRepaint(); setTimeout(fin, 1500); });
    const settle = ms => new Promise(ok => { if (map.areTilesLoaded()) return ok(); const to = setTimeout(ok, ms); map.once('idle', () => { clearTimeout(to); ok(); }); });
    let lastPh = '';
    function place(t) {
      const s = stateAt(t);
      if (s.ph !== lastPh) { lastPh = s.ph; try { map.setLayoutProperty('pp-all', 'visibility', s.ph === 'outro' ? 'visible' : 'none'); map.setLayoutProperty('pp-allc', 'visibility', s.ph === 'outro' ? 'visible' : 'none'); } catch (e) {} }
      map.jumpTo(camAt(s));
      return s;
    }
    // Caminho principal: quadro a quadro com WebCodecs → MP4 (H.264 quando o aparelho tem).
    async function encodeFrames(enc) {
      const M = await loadMuxer();
      const target = new M.ArrayBufferTarget();
      const muxer = new M.Muxer({ target, video: { codec: enc.mux, width: W, height: H, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
      let err = null;
      const ve = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
      ve.configure({ codec: enc.codec, width: W, height: H, bitrate: 8e6, framerate: FPS, ...(enc.mux === 'avc' ? { avc: { format: 'avc' } } : {}) });
      const N = Math.ceil(END / 1000 * FPS);
      lastPh = ''; bSmooth = null;
      for (let i = 0; i < N && !stop; i++) {
        const s = place(i * 1000 / FPS);
        await nextRender(); await settle(400);
        // Desenha dentro do evento de render: é quando o quadro do mapa acabou de ser feito.
        await new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; compose(s); ok(); } }; map.once('render', fin); map.triggerRepaint(); setTimeout(fin, 1500); });
        const fr = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        ve.encode(fr, { keyFrame: i % (FPS * 2) === 0 }); fr.close();
        while (ve.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
        if (err) throw err;
        if (i % 3 === 0) msg(`Gerando o vídeo… ${Math.round(100 * i / N)}%`);
      }
      if (stop) { try { ve.close(); } catch (e) {} return null; }
      await ve.flush(); ve.close(); muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    }
    // Plano B: grava a tela em tempo real (MediaRecorder).
    function recordLive() {
      const mime = pickMime();
      if (mime == null || !cv.captureStream) { msg('Este navegador não grava vídeo. Tente pelo Chrome ou Safari atualizado.', true); return Promise.resolve(null); }
      const stream = cv.captureStream(30), chunks = [];
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : { videoBitsPerSecond: 6e6 });
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise(ok => { rec.onstop = () => ok(new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] })); });
      let t0 = null; lastPh = ''; bSmooth = null;
      const frame = now => {
        if (stop) return;
        if (t0 == null) t0 = now;
        const t = now - t0, s = place(t);
        map.once('render', () => compose(s));
        map.triggerRepaint();
        msg(`Gravando… ${Math.min(100, Math.round(100 * t / END))}%`);
        if (t < END + 300) requestAnimationFrame(frame); else setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150);
      };
      compose(stateAt(0)); rec.start(250); requestAnimationFrame(frame);
      return done;
    }
    async function record() {
      const enc = root.__vsNoCodecs ? null : await pickEncoder();
      if (enc) { try { return await encodeFrames(enc); } catch (e) { if (stop) return null; } }
      return recordLive();
    }

    $('.vs-go').onclick = async () => {
      const go = $('.vs-go'); go.disabled = true; const kc = $('.vs-km'); setMoments(!!(kc && kc.checked)); if (kc) kc.disabled = true; $('.vs-video').hidden = true; cv.hidden = false; busy(true); msg('Preparando o mapa 3D…');
      const old = box.querySelector('.vs-share'); if (old) old.remove();
      try {
        if (!map) await build();
        if (stop) return;
        const blob = await record();
        busy(false);
        if (!blob || stop) { go.disabled = false; if (kc) kc.disabled = false; return; }
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        const v = $('.vs-video'); v.src = url; v.hidden = false; cv.hidden = true;
        const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
        const file = new File([blob], `pacepro-${(d.meta.fileDate || 'corrida')}.${ext}`, { type: blob.type });
        msg(`Pronto: ${Math.round(END / 1000)} s, ${(blob.size / 1048576).toFixed(1).replace('.', ',')} MB.${ext === 'webm' ? ' Alguns apps preferem MP4; se o Instagram recusar, envie pelo WhatsApp ou converta.' : ''}`);
        const acts = document.createElement('div'); acts.className = 'vs-share row-actions';
        const canShare = navigator.canShare && navigator.canShare({ files: [file] });
        acts.innerHTML = `${canShare ? '<button type="button" class="btn vs-sh">Compartilhar</button>' : ''}<a class="btn ghost" download="${file.name}" href="${url}">Baixar</a>`;
        $('.vs-actions').appendChild(acts);
        const sh = acts.querySelector('.vs-sh'); if (sh) sh.onclick = () => navigator.share({ files: [file], title: d.meta.title }).catch(() => {});
        go.textContent = 'Gerar de novo'; go.dataset.t = ''; go.classList.add('ghost');
      } catch (e) { busy(false); msg(e.message || 'Não consegui gerar o vídeo.', true); }
      go.disabled = false; if (kc) kc.disabled = false;
    };
    return { close };
  }

  root.RouteVideo = { open, loadMapLibre, STYLE };
})(window);
