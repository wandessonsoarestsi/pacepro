/* Imagem do percurso para compartilhar: mapa claro ou arte da rota (sem mapa), momentos marcados
   no trajeto, corredor fantasma (melhor vez no mesmo percurso), comparação com o mesmo treino de
   semanas atrás e previsão de prova. Formato feed (4:5) ou stories (9:16). Sempre em tema claro. */
(function (root) {
  const W = 1080, PR = 2;
  let INK, MUTED, LINE, GOOD, BAD, TEAL, ORANGE, GHOSTT, CLEAR = false;
  // Tema: claro (fundo de mapa ou arte) ou transparente (texto branco com sombra, para pôr sobre uma foto).
  function theme(clear) { CLEAR = clear; INK = clear ? '#FFFFFF' : '#14171C'; MUTED = clear ? 'rgba(255,255,255,.88)' : '#6B7280'; LINE = clear ? 'rgba(255,255,255,.45)' : '#E4E7EB'; GOOD = clear ? '#4BE3A0' : '#22A06B'; BAD = clear ? '#FF7A70' : '#D6453D'; TEAL = clear ? '#7FE6DC' : '#128C83'; ORANGE = clear ? '#FFB36B' : '#F08A24'; GHOSTT = clear ? '#C9BBFF' : '#7A5AF8'; }
  theme(false);
  const GHOST = '#7A5AF8';
  const pad = n => String(n).padStart(2, '0');
  const fmtT = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
  let iconP = null;
  const loadIcon = () => iconP || (iconP = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = '/icon-512.png'; }));

  /* d: { lat[], lon[], dist[], time[], colors[], legend, moments: [{i, ico, color, t, s}],
         ghost: {date, label, final, perKm, colors[], legend, markDist, gapM} | null,
         compare: {when, date, rows: [{l, now, then, diff, good}], msg, tone} | null,
         predict: {big, small, ok, pct} | null,
         meta: {title, date, km, time, pace, hr, fileDate} } */
  function open(d) {
    let box = document.getElementById('iStudio'); if (box) box.remove();
    box = document.createElement('div'); box.id = 'iStudio'; box.className = 'vstudio istudio';
    const opt = (k, t, s, on) => `<label class="vs-opt"><input type="checkbox" data-o="${k}"${on ? ' checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`;
    box.innerHTML = `<div class="vs-bar"><button type="button" class="vs-x">‹ Voltar</button><b>Imagem do percurso</b><span></span></div>
      <div class="vs-body"><div class="vs-stage is-stage"><canvas class="vs-canvas"></canvas><div class="vs-load" hidden><div class="vs-lrow"><i class="vs-spin"></i><b class="vs-lt">Desenhando…</b></div></div></div>
      <div class="is-seg" role="group" aria-label="Fundo"><button type="button" data-bg="map" aria-pressed="true">Mapa</button><button type="button" data-bg="art" aria-pressed="false">Arte da rota</button><button type="button" data-bg="clear" aria-pressed="false">Transparente</button></div>
      <div class="is-seg" role="group" aria-label="Formato"><button type="button" data-fmt="feed" aria-pressed="true">Feed 4:5</button><button type="button" data-fmt="story" aria-pressed="false">Stories 9:16</button></div>
      <div class="vs-actions">
        ${d.moments.length ? opt('moments', 'Momentos no mapa', 'Km mais rápido, pico, FC mais alta, subida e onde cansou', true) : ''}
        ${d.ghost ? opt('ghost', 'Corredor fantasma', `Contra ${d.ghost.label} (${d.ghost.date})`, true) : ''}
        ${d.compare ? opt('compare', 'Comparação', `Com o mesmo treino ${d.compare.when} (${d.compare.date})`, true) : ''}
        ${d.predict ? opt('predict', 'Previsão de prova', d.predict.big, true) : ''}
        <p class="vs-msg muted small">A arte da rota não mostra as ruas. O transparente fica por cima de uma foto no Instagram: o xadrez da prévia é só para ver o que é transparente.</p>
        <div class="vs-share"><button type="button" class="btn is-sh">Compartilhar</button><button type="button" class="btn ghost is-dl">Baixar</button></div>
      </div></div><div class="vs-map" aria-hidden="true"></div>`;
    document.body.appendChild(box); document.body.classList.add('noscroll');
    const $ = s => box.querySelector(s);
    const cv = $('.vs-canvas'), ctx = cv.getContext('2d');
    let map = null, closed = false, job = 0, H = 1350;
    const st = { bg: 'map', fmt: 'feed', moments: !!d.moments.length, ghost: !!d.ghost, compare: !!d.compare, predict: !!d.predict };
    const close = () => { closed = true; try { map && map.remove(); } catch (e) {} box.remove(); document.body.classList.remove('noscroll'); };
    $('.vs-x').onclick = close;
    const font = (w, s) => `${w} ${s}px Figtree, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const busy = on => { $('.vs-load').hidden = !on; };

    const n = d.lat.length, total = d.dist[n - 1];
    const idxAt = m => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const k = (lo + hi) >> 1; if (d.dist[k] < m) lo = k; else hi = k; } return d.dist[hi] <= m ? hi : lo; };

    // Desenho básico
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    const txt = (t, x, y, size, weight, color, align) => {
      ctx.font = font(weight || 700, size); ctx.fillStyle = color || INK; ctx.textAlign = align || 'left';
      if (CLEAR) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = Math.max(6, size / 4); ctx.shadowOffsetY = 2; ctx.fillText(t, x, y); ctx.restore(); } else ctx.fillText(t, x, y);
      return ctx.measureText(t).width;
    };
    const plain = (t, x, y, size, weight, color) => { ctx.font = font(weight, size); ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(t, x, y); return ctx.measureText(t).width; };
    const fit = (t, maxW, size, weight) => { let s = size; ctx.font = font(weight, s); while (s > 18 && ctx.measureText(t).width > maxW) { s -= 2; ctx.font = font(weight, s); } return s; };
    const card = (x, y, w, h) => { if (CLEAR) return; ctx.save(); ctx.shadowColor = 'rgba(20,23,28,.14)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8; rr(x, y, w, h, 30); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); };
    function lines(t, maxW, size, weight, max) {
      ctx.font = font(weight, size); const out = []; let line = '';
      for (const w of String(t).split(' ')) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test; }
      if (line) out.push(line);
      if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…'; }
      return out;
    }

    // Cartões de baixo: cada um sabe sua altura e se desenha.
    function blocks() {
      const out = [], X = 48, CWd = W - 96, compact = st.fmt === 'feed';
      const G = st.ghost && d.ghost, Pd = st.predict && d.predict;
      out.push({ h: 150, draw: y => {
        card(X, y, CWd, 150);
        const cells = [[d.meta.km, 'km'], [d.meta.time, 'tempo'], [d.meta.pace, 'pace /km'], [d.meta.hr ? String(d.meta.hr) : '–', 'FC média']];
        cells.forEach(([v, l], k) => { const cx = X + CWd * (k + 0.5) / 4; txt(v, cx, y + 82, fit(v, CWd / 4 - 20, 54, 800), 800, INK, 'center'); txt(l, cx, y + 120, 24, 600, MUTED, 'center'); if (k) { ctx.fillStyle = LINE; ctx.fillRect(X + CWd * k / 4, y + 34, 2, 82); } });
      } });
      const ghostHead = g => (g.final < 0 ? `${-g.final} s à frente` : g.final > 0 ? `${g.final} s atrás` : 'Empate');
      const ghostTone = g => (g.final < 0 ? GOOD : g.final > 0 ? BAD : INK);
      // Feed com fantasma e previsão: os dois lado a lado, para sobrar espaço para a rota.
      if (compact && G && Pd) {
        const hw = (CWd - 20) / 2, g = d.ghost, p = d.predict;
        out.push({ h: 176, draw: y => {
          card(X, y, hw, 176); card(X + hw + 20, y, hw, 176);
          txt('CORREDOR FANTASMA', X + 28, y + 48, 21, 800, GHOSTT); ghostIcon(X + hw - 46, y + 46, 24);
          txt(ghostHead(g), X + 28, y + 104, fit(ghostHead(g), hw - 56, 50, 800), 800, ghostTone(g));
          txt(`contra ${g.short || g.label} · ${g.date}`, X + 28, y + 144, fit(`contra ${g.short || g.label} · ${g.date}`, hw - 56, 23, 600), 600, MUTED);
          const x2 = X + hw + 20;
          txt('PREVISÃO DE PROVA', x2 + 28, y + 48, 21, 800, ORANGE);
          txt(p.short || p.big, x2 + 28, y + 104, fit(p.short || p.big, hw - 56, 50, 800), 800, INK);
          if (p.note) txt(p.note, x2 + 28, y + 144, fit(p.note, hw - 56, 23, 600), 600, p.ok ? GOOD : MUTED);
        } });
      } else {
        if (G) {
          const g = d.ghost, kms = g.perKm.slice(0, 8);
          const h = kms.length ? 196 : 136;
          out.push({ h, draw: y => {
            card(X, y, CWd, h);
            ghostIcon(X + 66, y + 66, 34);
            const head = g.final ? `${ghostHead(g)} do fantasma` : 'Empate com o fantasma';
            txt(head, X + 124, y + 64, fit(head, CWd - 150, 40, 800), 800, ghostTone(g));
            const sub = `${g.label} · ${g.date}${g.gapM ? ` · ${g.gapM}` : ''}`;
            txt(sub, X + 124, y + 102, fit(sub, CWd - 150, 24, 600), 600, MUTED);
            if (kms.length) {
              const cw = (CWd - 64 - (kms.length - 1) * 8) / kms.length;
              kms.forEach((k, j) => { const x = X + 32 + j * (cw + 8); rr(x, y + 128, cw, 42, 21); ctx.fillStyle = k.diff < 0 ? '#DDF3E8' : k.diff > 0 ? '#F9DEDC' : '#EEF0F3'; ctx.fill(); const t = `km ${k.k} ${k.diff > 0 ? '+' : k.diff < 0 ? '−' : '±'}${Math.abs(k.diff)}s`; txt(t, x + cw / 2, y + 157, fit(t, cw - 10, 22, 700), 700, k.diff < 0 ? GOOD : k.diff > 0 ? BAD : MUTED, 'center'); });
            }
          } });
        }
        if (Pd) {
          const p = d.predict, h = p.pct != null ? 176 : 140;
          out.push({ h, draw: y => {
            card(X, y, CWd, h);
            txt('PREVISÃO DE PROVA', X + 32, y + 50, 22, 800, ORANGE);
            txt(p.big, X + 32, y + 98, fit(p.big, CWd - 64, 42, 800), 800, INK);
            if (p.small) txt(p.small, X + 32, y + 134, fit(p.small, CWd - 64, 25, 600), 600, p.ok ? GOOD : MUTED);
            if (p.pct != null) { rr(X + 32, y + 150, CWd - 64, 12, 6); ctx.fillStyle = '#EEF0F3'; ctx.fill(); rr(X + 32, y + 150, Math.max(12, (CWd - 64) * p.pct), 12, 6); ctx.fillStyle = p.ok ? GOOD : '#F08A24'; ctx.fill(); }
          } });
        }
      }
      if (st.compare && d.compare) {
        const c = d.compare, ml = compact ? [] : lines(c.msg, CWd - 64, 26, 600, 2), h = (compact ? 200 : 210) + ml.length * 34;
        out.push({ h, draw: y => {
          card(X, y, CWd, h);
          txt(`MESMO TREINO ${c.when.toUpperCase()}`, X + 32, y + 52, 22, 800, TEAL);
          txt(`${c.date} → hoje`, X + CWd - 32, y + 52, 22, 700, MUTED, 'right');
          const cw = (CWd - 64) / c.rows.length;
          c.rows.forEach((r, k) => {
            const x = X + 32 + k * cw;
            txt(r.l.toUpperCase(), x, y + 92, 20, 700, MUTED);
            txt(r.now, x, y + 140, fit(r.now, cw - 20, 46, 800), 800, INK);
            const t = `antes ${r.then}${r.diff ? `  ${r.diff}` : ''}`;
            txt(t, x, y + 174, fit(t, cw - 16, 22, 700), 700, r.good === true ? GOOD : r.good === false ? BAD : MUTED);
          });
          ml.forEach((l, k) => txt(l, X + 32, y + 218 + k * 34, 26, 600, c.tone === 'good' ? GOOD : INK));
        } });
      }
      return out;
    }
    function ghostIcon(x, y, r) {
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.8, Math.PI, 0); ctx.lineTo(r * 0.8, r * 0.75);
      for (let k = 0; k < 3; k++) { const x1 = r * 0.8 - (k + 0.5) * (r * 1.6 / 3), x2 = r * 0.8 - (k + 1) * (r * 1.6 / 3); ctx.quadraticCurveTo(x1, r * 0.4, x2, r * 0.75); }
      ctx.closePath(); ctx.fillStyle = GHOST; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.18, r * 0.15, 0, 7); ctx.arc(r * 0.28, -r * 0.18, r * 0.15, 0, 7); ctx.fill();
      ctx.restore();
    }

    // Projeção da arte da rota (Mercator simples, centrada na área livre).
    function artProj(rect) {
      const k = Math.PI / 180, mx = d.lon.map(x => x * k), my = d.lat.map(y => Math.log(Math.tan(Math.PI / 4 + y * k / 2)));
      const x0 = Math.min(...mx), x1 = Math.max(...mx), y0 = Math.min(...my), y1 = Math.max(...my);
      const sc = Math.min(rect.w / Math.max(1e-9, x1 - x0), rect.h / Math.max(1e-9, y1 - y0));
      const ox = rect.x + (rect.w - (x1 - x0) * sc) / 2, oy = rect.y + (rect.h - (y1 - y0) * sc) / 2;
      return mx.map((x, i) => [ox + (x - x0) * sc, oy + (y1 - my[i]) * sc]);
    }
    async function mapProj(rect) {
      const RV = root.RouteVideo; const ml = await RV.loadMapLibre();
      const holder = $('.vs-map'); holder.style.width = W / PR + 'px'; holder.style.height = H / PR + 'px';
      const bounds = [[Math.min(...d.lon), Math.min(...d.lat)], [Math.max(...d.lon), Math.max(...d.lat)]];
      const padding = { top: rect.y / PR, bottom: (H - rect.y - rect.h) / PR, left: rect.x / PR, right: (W - rect.x - rect.w) / PR };
      if (!map) {
        map = new ml.Map({ container: holder, style: RV.STYLE, bounds, fitBoundsOptions: { padding }, interactive: false, attributionControl: false, pixelRatio: PR, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true } });
        map.on('error', () => {});
        await new Promise((ok, no) => { const to = setTimeout(() => no(new Error('O mapa demorou para carregar. Confira a internet ou use a arte da rota.')), 20000); map.once('load', () => { clearTimeout(to); ok(); }); });
      } else { map.resize(); map.fitBounds(bounds, { padding, animate: false }); }
      await new Promise(ok => { const to = setTimeout(ok, 6000); const chk = () => (map.areTilesLoaded() ? (clearTimeout(to), ok()) : map.once('idle', () => { clearTimeout(to); ok(); })); chk(); });
      await new Promise(ok => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; map.once('render', fin); map.triggerRepaint(); setTimeout(fin, 1500); });
      return d.lon.map((x, i) => { const p = map.project([x, d.lat[i]]); return [p.x * PR, p.y * PR]; });
    }

    function drawRoute(P, cols, art) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const path = () => { ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
      if (art) { // ecos suaves da rota, estilo pôster
        [[64, .05], [44, .07], [28, .1]].forEach(([w, a]) => { path(); ctx.strokeStyle = `rgba(18,140,131,${a})`; ctx.lineWidth = w; ctx.stroke(); });
      }
      if (CLEAR) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 16; path(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 20; ctx.stroke(); ctx.restore(); }
      path(); ctx.strokeStyle = '#fff'; ctx.lineWidth = art ? 22 : 20; ctx.stroke();
      path(); ctx.strokeStyle = 'rgba(20,23,28,.18)'; ctx.lineWidth = art ? 18 : 16; ctx.stroke();
      ctx.lineWidth = art ? 13 : 11;
      let s = 0;
      for (let i = 1; i <= n; i++) if (i === n || cols[i] !== cols[s]) { ctx.beginPath(); for (let k = s; k <= Math.min(i, n - 1); k++) (k === s ? ctx.moveTo : ctx.lineTo).call(ctx, P[k][0], P[k][1]); ctx.strokeStyle = cols[s]; ctx.stroke(); s = i; }
      // marcos de km
      for (let k = 1; k * 1000 < total - 50; k++) {
        const [x, y] = P[idxAt(k * 1000)];
        ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.fillStyle = '#14171C'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        txt(String(k), x, y + 7, 19, 800, '#fff', 'center');
      }
      // largada e chegada
      const flag = ([x, y], c, t) => { ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fillStyle = c; ctx.fill(); txt(t, x, y + 6, 16, 900, '#fff', 'center'); };
      flag(P[0], GOOD, 'L'); flag(P[n - 1], '#14171C', 'C');
    }
    function pin(x, y, r, color, ico) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = color; ctx.fill();
      ctx.font = font(800, r * 1.05); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(ico, x, y + 1); ctx.textBaseline = 'alphabetic';
    }
    // Momentos: pino + etiqueta curta; a etiqueta procura um lado livre.
    function drawMoments(P, rect, withMoments, extra) {
      const taken = [], pins = [];
      const list = (withMoments ? d.moments.map(m => ({ ...m, p: P[Math.max(0, Math.min(n - 1, m.i))] })) : []).concat(extra);
      list.forEach(m => pins.push([m.p[0] - 34, m.p[1] - 34, 68, 68]));
      const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
      list.forEach(m => {
        const [x, y] = m.p; if (m.ghost) ghostIcon(x, y - 4, 30); else pin(x, y, 26, m.color, m.ico);
        if (!m.s) return;
        ctx.font = font(800, 25); const tw = ctx.measureText(m.s).width + 32, th = 46;
        const opts = [[x + 40, y - th / 2], [x - 40 - tw, y - th / 2], [x - tw / 2, y - 40 - th], [x - tw / 2, y + 40]];
        let best = null;
        for (const [bx, by] of opts) {
          const b = [bx, by, tw, th];
          if (bx < 20 || bx + tw > W - 20 || by < rect.lim[0] || by + th > rect.lim[1]) continue;
          if (taken.some(t => hit(t, b)) || pins.some(t => hit(t, b))) continue;
          best = b; break;
        }
        if (!best) return;
        taken.push(best);
        ctx.save(); ctx.shadowColor = 'rgba(20,23,28,.18)'; ctx.shadowBlur = 12; rr(best[0], best[1], tw, th, 23); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.arc(best[0] + 18, best[1] + th / 2, 6, 0, 7); ctx.fillStyle = m.ghost ? GHOST : m.color; ctx.fill();
        plain(m.s, best[0] + 30, best[1] + 32, 25, 800, '#14171C');
      });
    }
    function legend(items, x, y) {
      if (!items || !items.length) return;
      ctx.font = font(700, 22); let w = 28; items.forEach(([, l]) => { w += 30 + ctx.measureText(l).width + 18; });
      ctx.save(); ctx.shadowColor = 'rgba(20,23,28,.12)'; ctx.shadowBlur = 10; rr(x, y, w, 44, 22); ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fill(); ctx.restore();
      let cx = x + 18; items.forEach(([c, l]) => { ctx.beginPath(); ctx.arc(cx + 9, y + 22, 9, 0, 7); ctx.fillStyle = c; ctx.fill(); cx += 26; cx += plain(l, cx, y + 30, 22, 700, '#6B7280') + 22; });
    }

    async function render() {
      const my = ++job; busy(true);
      H = st.fmt === 'story' ? 1920 : 1350;
      cv.width = W; cv.height = H; $('.is-stage').style.aspectRatio = `${W}/${H}`;
      try { await document.fonts.load('800 40px Figtree'); } catch (e) {}
      const ic = await loadIcon();
      const B = blocks(), gap = 20, story = st.fmt === 'story';
      const tl = lines(d.meta.title, W - 96, 58, 900, story ? 2 : 1), top = 150 + tl.length * 64;
      const cardsTop = H - 56 - B.reduce((a, b) => a + b.h + gap, 0) + gap;
      const rect = { x: 110, y: top + 50, w: W - 220, h: Math.max(200, cardsTop - top - 110) };
      rect.lim = [top + 56, cardsTop - 16];
      let P;
      try {
        if (st.bg === 'map') P = await mapProj(rect);
      } catch (e) { if (my !== job) return; st.bg = 'art'; syncSeg(); $('.vs-msg').textContent = e.message || 'Não consegui carregar o mapa. Mostrei a arte da rota.'; }
      if (my !== job || closed) return;
      if (st.bg !== 'map') P = artProj(rect);
      theme(st.bg === 'clear');
      $('.is-stage').classList.toggle('clear', st.bg === 'clear');
      // fundo
      if (st.bg === 'clear') ctx.clearRect(0, 0, W, H);
      else if (st.bg === 'map') {
        ctx.clearRect(0, 0, W, H);
        try { ctx.drawImage(map.getCanvas(), 0, 0, W, H); } catch (e) { ctx.fillStyle = '#F2F3F5'; ctx.fillRect(0, 0, W, H); }
        let g = ctx.createLinearGradient(0, 0, 0, top + 60); g.addColorStop(0, 'rgba(255,255,255,.97)'); g.addColorStop(0.7, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, top + 60);
        const by = rect.y + rect.h; g = ctx.createLinearGradient(0, by - 40, 0, by + 80); g.addColorStop(0, 'rgba(242,243,245,0)'); g.addColorStop(1, 'rgba(242,243,245,.96)'); ctx.fillStyle = g; ctx.fillRect(0, by - 40, W, H - by + 40);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FBF8F3'); g.addColorStop(1, '#EFEBE3'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(20,23,28,.07)'; for (let x = 36; x < W; x += 48) for (let y = 36; y < H; y += 48) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
      }
      // rota
      const useGhost = st.ghost && d.ghost;
      drawRoute(P, useGhost ? d.ghost.colors : d.colors, st.bg === 'art');
      const extra = [];
      if (useGhost && d.ghost.markDist != null) extra.push({ ghost: true, p: P[idxAt(d.ghost.markDist)], s: d.ghost.markLabel });
      drawMoments(P, rect, st.moments, extra);
      legend(useGhost ? d.ghost.legend : d.legend, 48, top + 4);
      // cabeçalho
      if (ic) ctx.drawImage(ic, 48, 52, 72, 72);
      txt('PacePro', 136, 104, 38, 900, INK);
      txt(d.meta.date, W - 48, 100, 26, 700, MUTED, 'right');
      tl.forEach((l, k) => txt(l, 48, 196 + k * 64, fit(l, W - 96, 58, 900), 900, INK));
      // cartões
      let y = cardsTop;
      B.forEach(b => { b.draw(y); y += b.h + gap; });
      txt(st.bg === 'map' ? 'mapa © OpenStreetMap · dados: Strava' : 'dados: Strava', W / 2, H - 22, 20, 600, CLEAR ? 'rgba(255,255,255,.75)' : 'rgba(20,23,28,.45)', 'center');
      busy(false);
    }
    function syncSeg() {
      box.querySelectorAll('[data-bg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === st.bg)));
      box.querySelectorAll('[data-fmt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === st.fmt)));
    }
    box.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => { st.bg = b.dataset.bg; syncSeg(); render(); });
    box.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { st.fmt = b.dataset.fmt; syncSeg(); render(); });
    box.querySelectorAll('[data-o]').forEach(i => i.onchange = () => { st[i.dataset.o] = i.checked; render(); });
    const blob = () => new Promise(ok => cv.toBlob(ok, 'image/png'));
    const name = () => `pacepro-percurso-${d.meta.fileDate || 'corrida'}.png`;
    $('.is-dl').onclick = async () => { const b = await blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
    $('.is-sh').onclick = async () => {
      const b = await blob(); const file = new File([b], name(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: d.meta.title }); } catch (e) {} }
      else $('.is-dl').click();
    };
    render().catch(e => { busy(false); $('.vs-msg').textContent = e.message || 'Não consegui desenhar a imagem.'; });
    return { close };
  }

  root.RouteImage = { open };
})(window);
