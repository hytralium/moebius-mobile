'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.MoebiusParser;
  const fmtN = P.formatNumber;
  const STORE = 'moebius-web-doc-v2';
  // Standardfarben wie im Original: schwarz, dunkelblau, dann weitere
  const COLORS = ['#000000', '#000080', '#c00000', '#008000', '#800080', '#008080', '#806000', '#ff6600', '#0066ff', '#666666'];
  const MAX_VALUES = 25e6; // Speichergrenze (Anzahl gespeicherter Zahlen)

  // ================================================================
  // Dokument
  // ================================================================
  const newSim = (name = 'Standard') => ({ name, text: '', reps: 100, caseSensitive: false, startValues: {} });
  const defaultView = () => ({
    x: 't', z: '', y: [], separate: false, threeD: false, grid: true, panel: true,
    styles: {}, axes: { x: { auto: true }, y: { auto: true }, z: { auto: true } }, texts: [],
    rot: { yaw: -0.6, pitch: 0.45 },
  });
  let doc = { sims: [newSim()], view: defaultView(), current: 0, fileName: 'Unbenannt' };
  let results = [];      // je Simulation: { vars, cols, n, stride, error }
  const ui = {
    tab: 'graph', tool: 'select', selText: -1, anim: { frac: 1, playing: false, raf: 0, t0: 0 },
    plots: [], dragging: null,
  };

  const refLabel = (r) => (doc.sims.length > 1 ? `${r.name} [${r.sim}]` : r.name);
  const refKey = (r) => `${r.sim}\u0001${r.name}`;
  const simByName = (n) => doc.sims.find((s) => s.name === n);
  const keyOf = (sim, name) => (sim.caseSensitive ? name : name.toLowerCase());

  function status(msg, err = false) {
    const el = $('status');
    el.textContent = msg || 'Klicken Sie auf die Kurve oder Achse, die bearbeitet werden soll.';
    el.classList.toggle('err', !!err);
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch (_) { /* Speicher voll oder gesperrt */ }
  }

  // ================================================================
  // Simulation (Kleinschrittverfahren)
  // ================================================================
  function simulate(sim) {
    const res = { vars: [], cols: [], n: 0, stride: 1, error: null, sim };
    let c;
    try { c = P.compile(sim.text, sim.caseSensitive); } catch (e) { res.error = e.message; return res; }
    res.vars = c.vars;
    res.edges = c.edges;
    const nv = c.vars.length;
    const mem = new Float64Array(nv);
    c.vars.forEach((v, i) => {
      if (v.isStart) {
        const raw = sim.startValues[v.key];
        const val = raw === undefined ? 0 : P.parseNumber(raw);
        if (Number.isNaN(val)) res.error = res.error || `Startwert von ${v.name} ist keine Zahl: „${raw}“`;
        mem[i] = Number.isNaN(val) ? 0 : val;
      }
    });
    if (res.error) return res;
    const reps = Math.max(1, Math.floor(sim.reps) || 1);
    const stride = Math.max(1, Math.ceil((reps * nv) / MAX_VALUES));
    const rows = Math.floor(reps / stride);
    res.stride = stride;
    res.cols = c.vars.map(() => new Float64Array(rows));
    const lines = c.lines;
    const nl = lines.length;
    let n = 0;
    for (let k = 1; k <= reps; k++) {
      for (let j = 0; j < nl; j++) lines[j](mem);
      if (k % stride === 0 && n < rows) {
        for (let i = 0; i < nv; i++) {
          const v = mem[i];
          if (!Number.isFinite(v)) {
            res.error = `Rechenfehler im ${k}. Durchlauf: ${c.vars[i].name} = ${v > 0 ? '∞' : v < 0 ? '-∞' : 'nicht definiert'} (Division durch 0?)`;
            res.n = n; return res;
          }
          res.cols[i][n] = v;
        }
        n++;
      }
    }
    res.n = n;
    return res;
  }

  function runAll() {
    const t0 = performance.now();
    results = doc.sims.map(simulate);
    const errs = results.filter((r) => r.error);
    // Auswahl bereinigen
    const exists = (r) => { const i = doc.sims.findIndex((s) => s.name === r.sim); return i >= 0 && findVar(i, r.name) >= 0; };
    doc.view.y = doc.view.y.filter(exists);
    buildPanel();
    const ms = Math.round(performance.now() - t0);
    if (errs.length) status(`${errs[0].sim.name}: ${errs[0].error}`, true);
    else {
      const total = results.reduce((a, r) => a + r.n * r.stride, 0);
      const dec = results.some((r) => r.stride > 1) ? ' (für die Anzeige ausgedünnt)' : '';
      status(`${total.toLocaleString('de-DE')} Durchläufe in ${ms} ms berechnet${dec}. Klicken Sie auf die Kurve oder Achse, die bearbeitet werden soll.`);
    }
    persist();
    redraw();
  }
  function findVar(simIdx, name) {
    const r = results[simIdx];
    if (!r) return -1;
    const k = keyOf(doc.sims[simIdx], name);
    return r.vars.findIndex((v) => v.key === k);
  }

  // ================================================================
  // Seitenleiste
  // ================================================================
  function buildPanel() {
    const sel = $('simSelect');
    sel.innerHTML = doc.sims.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
    sel.value = String(doc.current);

    // x-/z-Achse: Vereinigung aller Variablennamen
    const names = [];
    const seen = new Set();
    results.forEach((r) => r.vars.forEach((v) => { const k = v.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); names.push(v.name); } }));
    const fill = (el, val, allowEmpty) => {
      el.innerHTML = (allowEmpty ? '<option value="">–</option>' : '') + names.map((n) => `<option>${esc(n)}</option>`).join('');
      const match = names.find((n) => n === val) || names.find((n) => n.toLowerCase() === String(val).toLowerCase());
      el.value = match || (allowEmpty ? '' : names.find((n) => n.toLowerCase() === 't') || names[0] || '');
      return el.value;
    };
    doc.view.x = fill($('xAxis'), doc.view.x, false);
    doc.view.z = fill($('zAxis'), doc.view.z, true);

    const yl = $('yList');
    yl.innerHTML = '';
    results.forEach((r, si) => r.vars.forEach((v) => {
      const ref = { sim: doc.sims[si].name, name: v.name };
      const b = document.createElement('div');
      b.className = 'yitem'; b.setAttribute('role', 'option');
      b.textContent = refLabel(ref);
      const on = doc.view.y.some((y) => y.sim === ref.sim && y.name === ref.name);
      b.setAttribute('aria-selected', on);
      b.addEventListener('click', () => {
        const i = doc.view.y.findIndex((y) => y.sim === ref.sim && y.name === ref.name);
        if (i >= 0) doc.view.y.splice(i, 1); else doc.view.y.push(ref);
        b.setAttribute('aria-selected', i < 0);
        syncOptions(); persist(); redraw();
      });
      yl.appendChild(b);
    }));
    syncOptions();
  }
  function syncOptions() {
    const v = doc.view;
    $('opt3d').checked = v.threeD;
    $('zWrap').hidden = !v.threeD;
    const sepOk = v.y.length > 1 && !v.threeD;
    $('optSeparate').disabled = !sepOk;
    $('optSeparate').checked = v.separate && sepOk;
    $('side').classList.toggle('collapsed', !v.panel);
  }

  // ================================================================
  // Schaubild
  // ================================================================
  const canvas = $('graph');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  function seriesList() {
    const out = [];
    doc.view.y.forEach((ref, idx) => {
      const si = doc.sims.findIndex((s) => s.name === ref.sim);
      if (si < 0) return;
      const r = results[si];
      const yi = findVar(si, ref.name), xi = findVar(si, doc.view.x);
      const zi = doc.view.threeD && doc.view.z ? findVar(si, doc.view.z) : -1;
      if (yi < 0 || xi < 0 || !r.n) return;
      const st = doc.view.styles[refKey(ref)] || {};
      out.push({
        ref, label: refLabel(ref), n: r.n,
        xs: r.cols[xi], ys: r.cols[yi], zs: zi >= 0 ? r.cols[zi] : null,
        color: st.color || COLORS[idx % COLORS.length], width: st.width || 1, dash: st.dash || 'solid',
      });
    });
    return out;
  }

  function niceStep(span, target) {
    if (!(span > 0)) return 1;
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  }
  function tickLabel(v, step) {
    if (Math.abs(v) < step * 1e-9) return '0';
    const a = Math.abs(v);
    if (a >= 1e7 || a < 1e-4) return fmtN(v, 3);
    const dec = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5 ? 1 : 0)));
    const out = v.toFixed(dec).replace('.', ',');
    return /^-0(,0*)?$/.test(out) ? out.slice(1) : out;
  }
  function dataRange(arrs, n) {
    let lo = Infinity, hi = -Infinity;
    const end = Math.max(1, Math.ceil(n));
    for (const a of arrs) {
      const m = Math.min(end, a.length);
      for (let i = 0; i < m; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (lo === Infinity) return [0, 1];
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; }
    return [lo, hi];
  }
  function axisRange(name, arrs, n) {
    const ax = doc.view.axes[name];
    if (!ax.auto && Number.isFinite(ax.min) && Number.isFinite(ax.max) && ax.max > ax.min) return [ax.min, ax.max];
    const [lo, hi] = dataRange(arrs, n);
    const pad = (hi - lo) * 0.04;
    return [lo - (lo === 0 ? 0 : pad), hi + pad];
  }

  function resizeCanvas() {
    const area = $('graphArea');
    const dpr = window.devicePixelRatio || 1;
    W = area.clientWidth; H = area.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGraph(target = ctx, w = W, h = H) {
    const c = target;
    c.save();
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    ui.plots = [];
    const series = seriesList();
    const legendH = drawLegend(c, series, w);
    if (!series.length) {
      c.fillStyle = '#444'; c.font = '14px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const anyVars = results.some((r) => r.vars.length);
      c.fillText(anyVars ? 'Wählen Sie rechts unter „y-Achse“ die darzustellenden Größen.' : 'Über „Eingabe“ die Gleichungen des Modells eingeben.', w / 2, h / 2);
      drawTexts(c, w, h); c.restore(); return;
    }
    const nFrac = (s) => Math.max(1, Math.ceil(s.n * ui.anim.frac));
    const maxN = Math.max(...series.map((s) => s.n));
    const scaleN = maxN; // Achsen bleiben während der Animation fest
    if (doc.view.threeD && doc.view.z) { draw3D(c, series, w, h, legendH, nFrac); drawTexts(c, w, h); c.restore(); return; }

    const groups = doc.view.separate && series.length > 1 ? series.map((s) => [s]) : [series];
    const xr = axisRange('x', series.map((s) => s.xs), scaleN);
    const top = legendH + 6, gap = 8;
    const gh = (h - top) / groups.length;
    groups.forEach((g, gi) => {
      const yr = axisRange('y', g.map((s) => s.ys), scaleN);
      const m = { l: 64, r: 26, t: 16, b: 32 };
      const x0 = m.l, y0 = top + gi * gh + m.t + (gi ? gap : 0);
      const pw = w - m.l - m.r, ph = gh - m.t - m.b - (gi ? gap : 0);
      if (pw < 30 || ph < 30) return;
      const sx = (v) => x0 + ((v - xr[0]) / (xr[1] - xr[0])) * pw;
      const sy = (v) => y0 + ph - ((v - yr[0]) / (yr[1] - yr[0])) * ph;
      // Fläche
      c.fillStyle = '#c0c0c0'; c.fillRect(x0, y0, pw, ph);
      const xstep = doc.view.axes.x.auto || !(doc.view.axes.x.step > 0) ? niceStep(xr[1] - xr[0], pw / 80) : doc.view.axes.x.step;
      const ystep = doc.view.axes.y.auto || !(doc.view.axes.y.step > 0) ? niceStep(yr[1] - yr[0], ph / 45) : doc.view.axes.y.step;
      const xt = ticks(xr, xstep), yt = ticks(yr, ystep);
      if (doc.view.grid) {
        c.strokeStyle = '#7a7a7a'; c.lineWidth = 1; c.setLineDash([6, 4]);
        xt.forEach((v) => { const px = Math.round(sx(v)) + 0.5; c.beginPath(); c.moveTo(px, y0); c.lineTo(px, y0 + ph); c.stroke(); });
        yt.forEach((v) => { const py = Math.round(sy(v)) + 0.5; c.beginPath(); c.moveTo(x0, py); c.lineTo(x0 + pw, py); c.stroke(); });
        c.setLineDash([]);
      }
      // Achsen durch den Nullpunkt (sonst am Rand)
      const axY = yr[0] <= 0 && yr[1] >= 0 ? Math.round(sy(0)) + 0.5 : y0 + ph + 0.5;
      const axX = xr[0] <= 0 && xr[1] >= 0 ? Math.round(sx(0)) + 0.5 : x0 + 0.5;
      const origin = yr[0] <= 0 && yr[1] >= 0 && xr[0] <= 0 && xr[1] >= 0; // Achsen schneiden sich im Nullpunkt
      c.strokeStyle = '#000'; c.fillStyle = '#000'; c.lineWidth = 2;
      arrow(c, x0, axY, x0 + pw + 16, axY);
      arrow(c, axX, y0 + ph, axX, y0 - 12);
      c.lineWidth = 1;
      // Teilstriche + Beschriftung
      c.font = '13px Arial';
      const minor = 5;
      c.textAlign = 'center'; c.textBaseline = 'top';
      xt.forEach((v, i) => {
        const px = Math.round(sx(v)) + 0.5;
        c.beginPath(); c.moveTo(px, axY - 5); c.lineTo(px, axY + 5); c.stroke();
        if (Math.abs(v) > xstep * 1e-9 || !origin) c.fillText(tickLabel(v, xstep), px, axY + 7);
        for (let k = 1; k < minor && i < xt.length; k++) {
          const mx = Math.round(sx(v + (k * xstep) / minor)) + 0.5;
          if (mx > x0 + pw) break;
          c.beginPath(); c.moveTo(mx, axY - 2.5); c.lineTo(mx, axY + 2.5); c.stroke();
        }
      });
      c.textAlign = 'right'; c.textBaseline = 'middle';
      yt.forEach((v) => {
        const py = Math.round(sy(v)) + 0.5;
        c.beginPath(); c.moveTo(axX - 5, py); c.lineTo(axX + 5, py); c.stroke();
        if (Math.abs(v) > ystep * 1e-9 || !origin) c.fillText(tickLabel(v, ystep), axX - 8, py);
        for (let k = 1; k < minor; k++) {
          const my = Math.round(sy(v + (k * ystep) / minor)) + 0.5;
          if (my < y0) break;
          c.beginPath(); c.moveTo(axX - 2.5, my); c.lineTo(axX + 2.5, my); c.stroke();
        }
      });
      // Achsennamen
      c.font = 'italic 13px Arial';
      c.textAlign = 'right'; c.textBaseline = 'bottom';
      c.fillText(doc.view.axes.x.label || doc.view.x, x0 + pw + 16, axY - 6);
      c.textAlign = 'left'; c.textBaseline = 'top';
      if (groups.length > 1) c.fillText(g[0].label, axX + 8, y0 - 12);
      // Kurven
      c.save(); c.beginPath(); c.rect(x0, y0 - 1, pw, ph + 2); c.clip();
      g.forEach((s) => drawSeries(c, s, nFrac(s), sx, sy));
      c.restore();
      ui.plots.push({ x0, y0, pw, ph, sx, sy, xr, yr, series: g, axX, axY, mode: '2d' });
    });
    drawTexts(c, w, h);
    c.restore();
  }
  function ticks(r, step) {
    const out = [];
    const start = Math.ceil(r[0] / step - 1e-9) * step;
    for (let v = start, k = 0; v <= r[1] + step * 1e-9 && k < 500; k++, v = start + k * step) out.push(v);
    return out;
  }
  function drawSeries(c, s, n, sx, sy) {
    c.strokeStyle = s.color; c.fillStyle = s.color; c.lineWidth = s.width;
    c.setLineDash(s.dash === 'dash' ? [8, 5] : s.dash === 'dot' ? [2, 4] : []);
    const stride = Math.max(1, Math.floor(n / 20000));
    if (s.dash === 'points') {
      const ps = Math.max(2, s.width + 1.5);
      const st = Math.max(stride, Math.floor(n / 600));
      for (let i = 0; i < n; i += st) c.fillRect(sx(s.xs[i]) - ps / 2, sy(s.ys[i]) - ps / 2, ps, ps);
    } else {
      c.beginPath();
      c.moveTo(sx(s.xs[0]), sy(s.ys[0]));
      for (let i = stride; i < n; i += stride) c.lineTo(sx(s.xs[i]), sy(s.ys[i]));
      c.lineTo(sx(s.xs[n - 1]), sy(s.ys[n - 1]));
      c.stroke();
    }
    c.setLineDash([]);
    if (ui.anim.frac < 1) { // aktueller Punkt während der Animation
      c.beginPath(); c.arc(sx(s.xs[n - 1]), sy(s.ys[n - 1]), 4, 0, Math.PI * 2); c.fill();
    }
  }
  function arrow(c, x1, y1, x2, y2) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1), s = 11;
    c.beginPath(); c.moveTo(x2 + Math.cos(a) * 2, y2 + Math.sin(a) * 2);
    c.lineTo(x2 - s * Math.cos(a - 0.35), y2 - s * Math.sin(a - 0.35));
    c.lineTo(x2 - s * Math.cos(a + 0.35), y2 - s * Math.sin(a + 0.35));
    c.closePath(); c.fill();
  }
  function drawLegend(c, series, w) {
    c.font = '20px Arial'; c.textBaseline = 'middle'; c.textAlign = 'left';
    let x = 12, y = 22;
    const rowH = 28;
    ui.legend = [];
    series.forEach((s) => {
      const tw = c.measureText(s.label).width;
      const itemW = 70 + tw + 16;
      if (x + itemW > w - 8 && x > 12) { x = 12; y += rowH; }
      c.strokeStyle = s.color; c.lineWidth = Math.max(1, s.width);
      c.setLineDash(s.dash === 'dash' ? [8, 5] : s.dash === 'dot' ? [2, 4] : []);
      c.beginPath(); c.moveTo(x, y + 0.5); c.lineTo(x + 62, y + 0.5); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#000'; c.fillText(s.label, x + 70, y);
      ui.legend.push({ x, y: y - 12, w: itemW, h: 24, s });
      x += itemW;
    });
    return series.length ? y + 16 : 0;
  }

  // ---------- 3D ----------
  function draw3D(c, series, w, h, top, nFrac) {
    const n = Math.max(...series.map((s) => s.n));
    const xr = axisRange('x', series.map((s) => s.xs), n);
    const yr = axisRange('y', series.map((s) => s.ys), n);
    const zr = axisRange('z', series.map((s) => s.zs).filter(Boolean), n);
    const { yaw, pitch } = doc.view.rot;
    const cy = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = Math.min(w, h - top) * 0.32;
    const ox = w / 2, oy = top + (h - top) / 2;
    const norm = (v, r) => ((v - r[0]) / (r[1] - r[0])) * 2 - 1;
    // Weltkoordinaten: x → rechts, y (Wert) → oben, z → Tiefe
    const proj = (X, Y, Z) => {
      const x1 = X * cy - Z * syw, z1 = X * syw + Z * cy;
      const y1 = Y * cp - z1 * sp;
      return [ox + x1 * scale, oy - y1 * scale];
    };
    const P3 = (xv, yv, zv) => proj(norm(xv, xr), norm(yv, yr), norm(zv, zr));
    c.fillStyle = '#c0c0c0';
    const fl = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]].map((p) => proj(...p));
    c.beginPath(); fl.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath(); c.fill();
    c.strokeStyle = '#7a7a7a'; c.setLineDash([5, 4]); c.lineWidth = 1;
    const edges = [[[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
      [[-1, 1, -1], [1, 1, -1]], [[-1, 1, 1], [1, 1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]];
    edges.forEach(([a, b]) => { c.beginPath(); c.moveTo(...proj(...a)); c.lineTo(...proj(...b)); c.stroke(); });
    c.setLineDash([]);
    c.strokeStyle = '#000'; c.fillStyle = '#000'; c.lineWidth = 2;
    const o = proj(-1, -1, -1);
    const ax = [[proj(1.25, -1, -1), doc.view.x, xr], [proj(-1, 1.25, -1), series.map((s) => s.ref.name).join(', '), yr], [proj(-1, -1, 1.25), doc.view.z, zr]];
    c.font = '12px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    ax.forEach(([p, name, r], k) => {
      arrow(c, o[0], o[1], p[0], p[1]);
      c.font = 'italic 13px Arial'; c.fillText(name, p[0] + (k === 1 ? 0 : 10), p[1] + (k === 1 ? -10 : 10));
      c.font = '12px Arial';
      const e = k === 0 ? proj(1, -1, -1) : k === 1 ? proj(-1, 1, -1) : proj(-1, -1, 1);
      c.fillText(tickLabel(r[1], niceStep(r[1] - r[0], 5)), e[0] - 12, e[1] - 10);
    });
    c.fillText(tickLabel(xr[0], niceStep(xr[1] - xr[0], 5)), o[0] - 14, o[1] + 12);
    c.lineWidth = 1;
    series.forEach((s) => {
      if (!s.zs) return;
      const nn = nFrac(s), stride = Math.max(1, Math.floor(nn / 20000));
      c.strokeStyle = s.color; c.lineWidth = s.width; c.beginPath();
      c.moveTo(...P3(s.xs[0], s.ys[0], s.zs[0]));
      for (let i = stride; i < nn; i += stride) c.lineTo(...P3(s.xs[i], s.ys[i], s.zs[i]));
      c.stroke();
    });
    ui.plots.push({ mode: '3d' });
    c.fillStyle = '#555'; c.font = '12px Arial'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('Ziehen zum Drehen', w - 8, h - 6);
  }

  // ---------- Texte ----------
  function textFont(t) {
    return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size || 12}px "${t.font || 'Arial'}"`;
  }
  function textRuns(str) { // ^{…} hoch, _{…} tief
    const runs = [];
    const re = /([\^_])\{([^}]*)\}/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) runs.push({ s: str.slice(last, m.index), k: 0 });
      runs.push({ s: m[2], k: m[1] === '^' ? 1 : -1 });
      last = re.lastIndex;
    }
    if (last < str.length) runs.push({ s: str.slice(last), k: 0 });
    return runs;
  }
  function measureText(c, t) {
    const lines = t.text.split('\n');
    const size = t.size || 12;
    let wmax = 0;
    lines.forEach((ln) => {
      let wsum = 0;
      textRuns(ln).forEach((r) => {
        c.font = textFont({ ...t, size: r.k ? size * 0.7 : size });
        wsum += c.measureText(r.s).width;
      });
      wmax = Math.max(wmax, wsum);
    });
    return { w: wmax, h: lines.length * size * 1.25, lh: size * 1.25 };
  }
  function drawTexts(c, w, h) {
    doc.view.texts.forEach((t, i) => {
      const x = t.x * w, y = t.y * h, size = t.size || 12;
      const m = measureText(c, t);
      c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = t.color || '#000';
      t.text.split('\n').forEach((ln, li) => {
        let cx = x;
        const by = y + (li + 1) * m.lh - size * 0.25;
        textRuns(ln).forEach((r) => {
          const fs = r.k ? size * 0.7 : size;
          c.font = textFont({ ...t, size: fs });
          const dy = r.k === 1 ? -size * 0.4 : r.k === -1 ? size * 0.2 : 0;
          c.fillText(r.s, cx, by + dy);
          const tw = c.measureText(r.s).width;
          if (t.underline) { c.fillRect(cx, by + 2, tw, Math.max(1, size / 14)); }
          cx += tw;
        });
      });
      t._box = { x: x - 3, y: y - 2, w: m.w + 6, h: m.h + 4 };
      if (i === ui.selText && c === ctx) {
        c.strokeStyle = '#0050d0'; c.setLineDash([3, 2]); c.lineWidth = 1;
        c.strokeRect(t._box.x, t._box.y, t._box.w, t._box.h); c.setLineDash([]);
      }
    });
  }

  function redraw() {
    if (ui.tab === 'graph') { resizeCanvas(); drawGraph(); }
    else renderTable();
  }

  // ================================================================
  // Mausinteraktion im Schaubild
  // ================================================================
  function pos(ev) { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function hitText(p) {
    for (let i = doc.view.texts.length - 1; i >= 0; i--) {
      const b = doc.view.texts[i]._box;
      if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
    }
    return -1;
  }
  function hitCurve(p, tol = 7) {
    let best = null;
    for (const pl of ui.plots) {
      if (pl.mode !== '2d') continue;
      if (p.x < pl.x0 - tol || p.x > pl.x0 + pl.pw + tol || p.y < pl.y0 - tol || p.y > pl.y0 + pl.ph + tol) continue;
      for (const s of pl.series) {
        const n = Math.max(1, Math.ceil(s.n * ui.anim.frac));
        const stride = Math.max(1, Math.floor(n / 20000));
        let px = pl.sx(s.xs[0]), py = pl.sy(s.ys[0]);
        for (let i = stride; i < n + stride; i += stride) {
          const j = Math.min(i, n - 1);
          const qx = pl.sx(s.xs[j]), qy = pl.sy(s.ys[j]);
          const d = segDist(p.x, p.y, px, py, qx, qy);
          if (d < tol && (!best || d < best.d)) best = { d, s, pl, i: j };
          px = qx; py = qy;
          if (j === n - 1) break;
        }
      }
    }
    return best;
  }
  function segDist(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  }
  function hitAxis(p) {
    for (const pl of ui.plots) {
      if (pl.mode !== '2d') continue;
      if (Math.abs(p.y - pl.axY) < 9 && p.x >= pl.x0 - 4 && p.x <= pl.x0 + pl.pw + 20) return 'x';
      if (Math.abs(p.x - pl.axX) < 9 && p.y >= pl.y0 - 14 && p.y <= pl.y0 + pl.ph + 4) return 'y';
      if (p.y > pl.axY + 4 && p.y < pl.axY + 26 && p.x >= pl.x0 && p.x <= pl.x0 + pl.pw) return 'x';
      if (p.x < pl.axX - 4 && p.x > pl.axX - 62 && p.y >= pl.y0 && p.y <= pl.y0 + pl.ph) return 'y';
    }
    return null;
  }
  function nearestPoint(p) {
    let best = null;
    for (const pl of ui.plots) {
      if (pl.mode !== '2d' || p.x < pl.x0 || p.x > pl.x0 + pl.pw || p.y < pl.y0 || p.y > pl.y0 + pl.ph) continue;
      for (const s of pl.series) {
        const n = Math.max(1, Math.ceil(s.n * ui.anim.frac));
        const stride = Math.max(1, Math.floor(n / 5000));
        for (let i = 0; i < n; i += stride) {
          const dx = pl.sx(s.xs[i]) - p.x, dy = pl.sy(s.ys[i]) - p.y, d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { d, s, pl, i };
        }
      }
    }
    return best && best.d < 30 * 30 ? best : null;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const p = pos(ev);
    hideTip();
    if (doc.view.threeD && doc.view.z && ui.tool !== 'text') {
      ui.dragging = { kind: 'rot', x: p.x, y: p.y, yaw: doc.view.rot.yaw, pitch: doc.view.rot.pitch };
      canvas.setPointerCapture(ev.pointerId); return;
    }
    if (ui.tool === 'text') {
      ev.preventDefault(); // Fokus bleibt im Texteditor
      const hit = hitText(p);
      if (hit >= 0) { editText(hit); return; }
      const t = { x: p.x / W, y: p.y / H, text: '', bold: false, italic: false, underline: false, size: +$('fontSize').value, font: $('fontFamily').value };
      doc.view.texts.push(t);
      editText(doc.view.texts.length - 1, true);
      return;
    }
    const ti = hitText(p);
    if (ti >= 0) {
      ui.selText = ti;
      const t = doc.view.texts[ti];
      syncFormatButtons(t);
      ui.dragging = { kind: 'text', i: ti, dx: p.x - t.x * W, dy: p.y - t.y * H, moved: false };
      canvas.setPointerCapture(ev.pointerId);
      drawGraph(); return;
    }
    if (ui.selText >= 0) { ui.selText = -1; drawGraph(); }
    const c = hitCurve(p, ev.pointerType === 'touch' ? 14 : 7);
    if (c) { curveDialog(c.s.ref); return; }
    const a = hitAxis(p);
    if (a) { axisDialog(a); return; }
    // Wert anzeigen
    const np = nearestPoint(p);
    if (np) showTip(np);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = pos(ev);
    const d = ui.dragging;
    if (d && d.kind === 'rot') {
      doc.view.rot.yaw = d.yaw + (p.x - d.x) * 0.01;
      doc.view.rot.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + (p.y - d.y) * 0.01));
      drawGraph(); return;
    }
    if (d && d.kind === 'text') {
      const t = doc.view.texts[d.i];
      t.x = (p.x - d.dx) / W; t.y = (p.y - d.dy) / H; d.moved = true;
      drawGraph(); return;
    }
    if (ev.pointerType !== 'mouse') return;
    if (ui.tool === 'text') { canvas.style.cursor = 'text'; return; }
    const over = hitText(p) >= 0 ? 'move' : hitCurve(p) || hitAxis(p) ? 'pointer' : 'crosshair';
    canvas.style.cursor = over;
    const np = over === 'crosshair' ? nearestPoint(p) : null;
    if (np) showTip(np); else hideTip();
  });
  const endDrag = () => { if (ui.dragging) { ui.dragging = null; persist(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') { hideTip(); } });
  canvas.addEventListener('dblclick', (ev) => { const i = hitText(pos(ev)); if (i >= 0) editText(i); });

  function showTip(np) {
    const tip = $('tip');
    const xv = np.s.xs[np.i], yv = np.s.ys[np.i];
    tip.innerHTML = `<b style="color:${np.s.color}">${esc(np.s.label)}</b> = ${fmtN(yv)}<br>${esc(doc.view.x)} = ${fmtN(xv)}`;
    tip.hidden = false;
    const px = np.pl.sx(xv), py = np.pl.sy(yv);
    tip.style.left = Math.min(px + 12, W - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(py - tip.offsetHeight - 10, 4) + 'px';
    drawGraph();
    ctx.strokeStyle = np.s.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
  }
  function hideTip() { if (!$('tip').hidden) { $('tip').hidden = true; drawGraph(); } }

  // ---------- Text bearbeiten ----------
  function editText(i, isNew = false) {
    const t = doc.view.texts[i];
    ui.selText = i;
    drawGraph();
    const ed = $('textEditor');
    ed.hidden = false;
    ed.value = t.text;
    ed.style.left = t.x * W + 'px'; ed.style.top = t.y * H + 'px';
    ed.style.font = textFont(t);
    ed.style.fontWeight = t.bold ? 'bold' : 'normal';
    ed.focus();
    syncFormatButtons(t);
    const commit = () => {
      if (ed.hidden) return;
      ed.removeEventListener('blur', commit);
      ed.hidden = true;
      t.text = ed.value.replace(/\s+$/, '');
      if (!t.text) { doc.view.texts.splice(i, 1); ui.selText = -1; }
      persist(); drawGraph();
      if (isNew) setTool('select');
    };
    setTimeout(() => ed.addEventListener('blur', commit), 10);
    ed.onkeydown = (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); ed.blur(); }
    };
  }
  function syncFormatButtons(t) {
    document.querySelectorAll('[data-fmt]').forEach((b) => {
      const f = b.dataset.fmt;
      b.classList.toggle('on', !!(t && (f === 'bold' || f === 'italic' || f === 'underline') && t[f]));
    });
    if (t) { $('fontSize').value = String(t.size || 12); $('fontFamily').value = t.font || 'Arial'; }
  }
  document.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  document.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.fmt;
    const ed = $('textEditor');
    const t = doc.view.texts[ui.selText];
    if (f === 'sup' || f === 'sub') {
      if (!ed.hidden) {
        const a = ed.selectionStart, z = ed.selectionEnd, sel = ed.value.slice(a, z) || '2';
        ed.setRangeText(`${f === 'sup' ? '^' : '_'}{${sel}}`, a, z, 'end');
      } else status('Hoch-/Tiefstellen: Text bearbeiten (Doppelklick) und Zeichen markieren.');
      return;
    }
    if (!t) { status('Zuerst einen Text auswählen oder mit dem Textwerkzeug einfügen.'); return; }
    t[f] = !t[f];
    syncFormatButtons(t);
    if (!ed.hidden) { ed.style.font = textFont(t); }
    persist(); drawGraph();
  }));
  ['fontSize', 'fontFamily'].forEach((id) => $(id).addEventListener('change', () => {
    const t = doc.view.texts[ui.selText];
    if (!t) return;
    t.size = +$('fontSize').value; t.font = $('fontFamily').value;
    const ed = $('textEditor'); if (!ed.hidden) ed.style.font = textFont(t);
    persist(); drawGraph();
  }));

  function setTool(tool) {
    ui.tool = tool;
    $('tbSelect').classList.toggle('on', tool === 'select');
    $('tbText').classList.toggle('on', tool === 'text');
    canvas.style.cursor = tool === 'text' ? 'text' : 'default';
    status(tool === 'text' ? 'Klicken Sie in das Schaubild, um einen Text einzufügen.' : '');
  }

  // ================================================================
  // Tabelle
  // ================================================================
  function tableColumns() {
    const cols = [];
    if ($('tblAll').checked) {
      results.forEach((r, si) => r.vars.forEach((v, vi) => cols.push({ label: doc.sims.length > 1 ? `${v.name} [${doc.sims[si].name}]` : v.name, a: r.cols[vi], n: r.n })));
    } else {
      const series = seriesList();
      const xsDone = new Set();
      series.forEach((s) => {
        if (!xsDone.has(s.ref.sim)) { xsDone.add(s.ref.sim); cols.push({ label: doc.sims.length > 1 ? `${doc.view.x} [${s.ref.sim}]` : doc.view.x, a: s.xs, n: s.n }); }
        cols.push({ label: s.label, a: s.ys, n: s.n });
      });
    }
    return cols;
  }
  function renderTable() {
    const t = $('table');
    const cols = tableColumns();
    if (!cols.length) { t.innerHTML = '<tbody><tr><td class="empty">Keine Größen ausgewählt. Wählen Sie rechts y-Größen oder „alle Größen“.</td></tr></tbody>'; return; }
    const every = Math.max(1, Math.floor(+$('tblEvery').value) || 1);
    const n = Math.max(...cols.map((c) => c.n));
    const LIMIT = 5000;
    let html = '<thead><tr><th>Nr.</th>' + cols.map((c) => `<th>${esc(c.label)}</th>`).join('') + '</tr></thead><tbody>';
    let count = 0;
    const stride = results[0] ? results[0].stride : 1;
    for (let i = 0; i < n && count < LIMIT; i += every, count++) {
      html += `<tr><td>${(i + 1) * stride}</td>` + cols.map((c) => `<td>${i < c.n ? fmtN(c.a[i], 8) : ''}</td>`).join('') + '</tr>';
    }
    html += '</tbody>';
    t.innerHTML = html;
    if (count >= LIMIT) status(`Tabelle zeigt die ersten ${LIMIT} Zeilen – Schrittweite „jeder … Wert“ erhöhen oder CSV exportieren.`);
  }
  $('tblAll').addEventListener('change', renderTable);
  $('tblEvery').addEventListener('input', renderTable);

  function showTab(tab) {
    ui.tab = tab;
    $('graphArea').hidden = tab !== 'graph';
    $('tableArea').hidden = tab !== 'table';
    $('tbGraph').classList.toggle('on', tab === 'graph');
    $('tbTable').classList.toggle('on', tab === 'table');
    redraw();
  }

  // ================================================================
  // Animation (Start / Stopp / Pause)
  // ================================================================
  function play() {
    const a = ui.anim;
    if (ui.tab !== 'graph') showTab('graph');
    if (a.frac >= 1) a.frac = 0;
    a.playing = true;
    const dur = 6000;
    let last = performance.now();
    cancelAnimationFrame(a.raf);
    const tick = (t) => {
      if (!a.playing) return;
      a.frac = Math.min(1, a.frac + (t - last) / dur); last = t;
      drawGraph();
      if (a.frac < 1) a.raf = requestAnimationFrame(tick); else a.playing = false;
    };
    a.raf = requestAnimationFrame(tick);
  }
  function stop() { ui.anim.playing = false; cancelAnimationFrame(ui.anim.raf); ui.anim.frac = 1; drawGraph(); }
  function pause() { ui.anim.playing = false; cancelAnimationFrame(ui.anim.raf); }

  // ================================================================
  // Eingabemaske
  // ================================================================
  const mask = $('maskDlg');
  let maskState = null;
  function openMask() {
    const sim = doc.sims[doc.current];
    maskState = { values: { ...sim.startValues }, vars: [] };
    $('mReps').value = sim.reps;
    $('mName').value = sim.name;
    $('mText').value = sim.text;
    $('mCase').checked = sim.caseSensitive;
    setMaskMode('text');
    updateMask();
    mask.showModal();
    setTimeout(() => $('mText').focus(), 30);
  }
  function updateMask() {
    const text = $('mText').value;
    const cs = $('mCase').checked;
    // Gutter mit Zeilennummern
    const nLines = text.split('\n').length;
    let err = null, compiled = null;
    try { compiled = P.compile(text, cs); } catch (e) { err = e; }
    $('mGutter').innerHTML = Array.from({ length: nLines }, (_, i) => `<div class="${err && err.line === i + 1 ? 'bad' : ''}">${i + 1}</div>`).join('');
    $('mErr').textContent = err ? err.message : '';
    if (compiled) {
      maskState.vars = compiled.vars;
      maskState.edges = compiled.edges;
      renderStartGrid();
      if (!$('mGraphic').hidden) renderGraphicModel();
    }
  }
  function renderStartGrid() {
    const grid = $('mStart');
    const starts = maskState.vars.filter((v) => v.isStart);
    const cs = $('mCase').checked;
    const lookup = (v) => {
      if (v.key in maskState.values) return maskState.values[v.key];
      const alt = Object.keys(maskState.values).find((k) => k.toLowerCase() === v.key.toLowerCase());
      return alt !== undefined ? maskState.values[alt] : '';
    };
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    let html = '';
    starts.forEach((v) => {
      html += `<div class="sv-name" title="${esc(v.name)}">${esc(v.name)}</div><input class="sv-val" data-key="${esc(v.key)}" inputmode="decimal" value="${esc(lookup(v))}" aria-label="Startwert ${esc(v.name)}">`;
    });
    for (let i = starts.length; i < 14; i++) html += '<div class="sv-name"></div><div class="sv-val empty"></div>';
    grid.innerHTML = html;
    grid.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => { maskState.values[inp.dataset.key] = inp.value; inp.classList.toggle('bad', Number.isNaN(P.parseNumber(inp.value))); });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const all = [...grid.querySelectorAll('input')]; const nx = all[all.indexOf(inp) + 1]; if (nx) nx.focus(); }
      });
      if (inp.dataset.key === focused) { inp.focus(); }
    });
    void cs;
  }
  let maskTimer = 0;
  $('mText').addEventListener('input', () => { clearTimeout(maskTimer); maskTimer = setTimeout(updateMask, 200); });
  $('mText').addEventListener('scroll', () => { $('mGutter').scrollTop = $('mText').scrollTop; });
  $('mText').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end'); }
  });
  $('mCase').addEventListener('change', updateMask);
  $('mCancel').addEventListener('click', () => mask.close('cancel'));
  $('mHelp').addEventListener('click', () => helpDialog());
  mask.addEventListener('cancel', () => { /* Esc = Abbrechen */ });
  $('maskForm').addEventListener('submit', (e) => {
    const sim = doc.sims[doc.current];
    const text = $('mText').value;
    const cs = $('mCase').checked;
    let compiled;
    try { compiled = P.compile(text, cs); } catch (err) {
      e.preventDefault(); $('mErr').textContent = err.message; return;
    }
    const bad = compiled.vars.filter((v) => v.isStart && Number.isNaN(P.parseNumber(maskState.values[v.key] ?? '')));
    if (bad.length) { e.preventDefault(); $('mErr').textContent = `Startwert von ${bad[0].name} ist keine gültige Zahl.`; return; }
    const reps = Math.floor(P.parseNumber($('mReps').value));
    if (!(reps >= 1)) { e.preventDefault(); $('mErr').textContent = 'Die Anzahl der Wiederholungen muss mindestens 1 sein.'; return; }
    let name = $('mName').value.trim() || 'Standard';
    if (doc.sims.some((s, i) => i !== doc.current && s.name === name)) name += ' (2)';
    // Startwerte: nur gültige Schlüssel behalten
    const values = {};
    compiled.vars.forEach((v) => {
      if (!v.isStart) return;
      let val = maskState.values[v.key];
      if (val === undefined) {
        const alt = Object.keys(maskState.values).find((k) => k.toLowerCase() === v.key.toLowerCase());
        val = alt !== undefined ? maskState.values[alt] : '0';
      }
      values[v.key] = val === '' ? '0' : val;
    });
    const oldName = sim.name;
    Object.assign(sim, { name, text, caseSensitive: cs, reps, startValues: values });
    if (oldName !== name) doc.view.y.forEach((y) => { if (y.sim === oldName) y.sim = name; });
    if (!doc.view.y.length && compiled.vars.length) autoSelect();
    ui.anim.frac = 1;
    runAll();
  });
  function autoSelect() {
    // Wie im Original: nichts vorgeben außer sinnvoller x-Achse; hier zusätzlich erste Zustandsgröße
    const sim = doc.sims[doc.current];
    const r = simulate(sim);
    const tVar = r.vars.find((v) => v.name.toLowerCase() === 't');
    if (tVar) doc.view.x = tVar.name;
    const cand = r.vars.find((v) => v.isStart && v !== tVar && !/^dt$/i.test(v.name) && r.edges.some(([a, b]) => a === b && r.vars[a] === v));
    if (cand) doc.view.y.push({ sim: sim.name, name: cand.name });
  }

  // ---------- Grafisches Modell (aus den Gleichungen erzeugt) ----------
  function setMaskMode(mode) {
    document.querySelectorAll('.mtab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('mGraphic').hidden = mode !== 'graphic';
    document.querySelector('.editor-wrap').hidden = mode !== 'text';
    if (mode === 'graphic') renderGraphicModel();
  }
  document.querySelectorAll('.mtab').forEach((b) => b.addEventListener('click', () => setMaskMode(b.dataset.mode)));
  function renderGraphicModel() {
    const vars = maskState.vars || [];
    const edges = maskState.edges || [];
    if (!vars.length) { $('mGraphic').innerHTML = '<p class="gm-note">Noch keine Gleichungen eingegeben.</p>'; return; }
    // Klassifizierung: Zustandsgröße (x=x+…), Änderungsrate (wirkt auf Zustandsgröße), Einflussgröße (Startwert ohne Veränderung)
    const selfLoop = new Set(edges.filter(([a, b]) => a === b).map(([a]) => a));
    const assignedSet = new Set(edges.map(([, b]) => b));
    const kind = vars.map((v, i) => {
      if (selfLoop.has(i)) return 'state';
      if (v.isStart && !assignedSet.has(i)) return 'param';
      return 'aux';
    });
    vars.forEach((v, i) => { if (kind[i] === 'aux' && edges.some(([a, b]) => a === i && kind[b] === 'state')) kind[i] = 'rate'; });
    const cols = { param: [], aux: [], rate: [], state: [] };
    vars.forEach((v, i) => cols[kind[i]].push(i));
    const order = ['param', 'aux', 'rate', 'state'];
    const titles = { param: 'Einflussgrößen', aux: 'Zwischengrößen', rate: 'Änderungsraten', state: 'Zustandsgrößen' };
    const used = order.filter((k) => cols[k].length);
    const cw = 150, rh = 46, W2 = used.length * cw + 20;
    const H2 = Math.max(...used.map((k) => cols[k].length)) * rh + 50;
    const posOf = {};
    used.forEach((k, ci) => cols[k].forEach((vi, ri) => { posOf[vi] = { x: 20 + ci * cw + 55, y: 44 + ri * rh + 14, k }; }));
    let svg = `<svg viewBox="0 0 ${W2} ${H2}" width="${W2}" height="${H2}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#444"/></marker></defs>`;
    used.forEach((k, ci) => { svg += `<text x="${20 + ci * cw + 55}" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="#333">${titles[k]}</text>`; });
    edges.forEach(([a, b]) => {
      if (a === b) return;
      const p = posOf[a], q = posOf[b];
      if (!p || !q) return;
      const mx = (p.x + q.x) / 2;
      svg += `<path d="M${p.x + 30} ${p.y} C${mx} ${p.y} ${mx} ${q.y} ${q.x - 32} ${q.y}" fill="none" stroke="#888" stroke-width="1.2" marker-end="url(#ah)"/>`;
    });
    vars.forEach((v, i) => {
      const p = posOf[i];
      if (!p) return;
      const label = esc(v.name.length > 11 ? v.name.slice(0, 10) + '…' : v.name);
      if (p.k === 'state') svg += `<rect x="${p.x - 32}" y="${p.y - 14}" width="64" height="28" fill="#cfe0ff" stroke="#1f4fd6"/>`;
      else if (p.k === 'rate') svg += `<path d="M${p.x - 30} ${p.y}L${p.x} ${p.y - 14}L${p.x + 30} ${p.y}L${p.x} ${p.y + 14}z" fill="#ffe4b8" stroke="#c07000"/>`;
      else svg += `<ellipse cx="${p.x}" cy="${p.y}" rx="32" ry="14" fill="${p.k === 'param' ? '#eee' : '#e6f5e6'}" stroke="${p.k === 'param' ? '#666' : '#2a8a2a'}"/>`;
      svg += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="12" fill="#000">${label}</text>`;
    });
    svg += '</svg>';
    $('mGraphic').innerHTML = `<p class="gm-note">Aus den Gleichungen erzeugte Übersicht (nur Ansicht). Rückkopplungen x = x + … kennzeichnen Zustandsgrößen.</p><div class="gm-scroll">${svg}</div>`;
  }

  // ================================================================
  // Dialoge
  // ================================================================
  const gen = $('genDlg');
  function dialog(title, bodyHtml, onOk, { okOnly = false, wide = false } = {}) {
    $('genTitle').textContent = title;
    $('genBody').innerHTML = bodyHtml;
    gen.classList.toggle('wide', wide);
    $('genButtons').querySelector('[value=cancel]').hidden = okOnly;
    gen.returnValue = '';
    gen.onclose = () => { if (gen.returnValue === 'ok' && onOk) onOk($('genBody')); };
    gen.showModal();
  }
  function axisDialog(which) {
    const ax = doc.view.axes[which];
    const pl = ui.plots.find((p) => p.mode === '2d');
    const cur = pl ? (which === 'x' ? pl.xr : pl.yr) : [0, 1];
    const name = which === 'x' ? doc.view.x : 'y';
    dialog(`${which}-Achse bearbeiten`, `
      <label class="chk"><input type="checkbox" name="auto" ${ax.auto ? 'checked' : ''}> automatisch skalieren</label>
      <div class="form-grid">
        <label>Minimum <input name="min" inputmode="decimal" value="${fmtN(ax.auto ? cur[0] : ax.min, 6)}"></label>
        <label>Maximum <input name="max" inputmode="decimal" value="${fmtN(ax.auto ? cur[1] : ax.max, 6)}"></label>
        <label>Teilung <input name="step" inputmode="decimal" placeholder="automatisch" value="${ax.step ? fmtN(ax.step) : ''}"></label>
        ${which === 'x' ? `<label>Beschriftung <input name="label" value="${esc(ax.label || '')}" placeholder="${esc(name)}"></label>` : ''}
      </div>
      <label class="chk"><input type="checkbox" name="grid" ${doc.view.grid ? 'checked' : ''}> Gitternetz anzeigen</label>`,
    (b) => {
      const f = (n) => b.querySelector(`[name=${n}]`);
      const min = P.parseNumber(f('min').value), max = P.parseNumber(f('max').value), step = P.parseNumber(f('step').value);
      ax.auto = f('auto').checked;
      if (!ax.auto) {
        if (!(max > min)) { status('Maximum muss größer als Minimum sein.', true); ax.auto = true; }
        else { ax.min = min; ax.max = max; }
      }
      ax.step = step > 0 ? step : 0;
      if (f('label')) ax.label = f('label').value.trim();
      doc.view.grid = f('grid').checked;
      persist(); redraw();
    });
    // manuelle Eingabe schaltet Automatik ab
    $('genBody').querySelectorAll('[name=min],[name=max]').forEach((i) => i.addEventListener('input', () => { $('genBody').querySelector('[name=auto]').checked = false; }));
  }
  function curveDialog(focusRef) {
    const series = seriesList();
    if (!series.length) { status('Keine Kurven vorhanden.'); return; }
    const rows = series.map((s, i) => `
      <div class="curve-row ${focusRef && refKey(focusRef) === refKey(s.ref) ? 'focus' : ''}">
        <span class="curve-name">${esc(s.label)}</span>
        <input type="color" name="c${i}" value="${s.color}" aria-label="Farbe">
        <select name="w${i}" aria-label="Linienstärke">${[1, 2, 3, 4, 5].map((w) => `<option ${w === s.width ? 'selected' : ''}>${w}</option>`).join('')}</select>
        <select name="d${i}" aria-label="Linienart">
          ${[['solid', 'durchgezogen'], ['dash', 'gestrichelt'], ['dot', 'gepunktet'], ['points', 'nur Punkte']].map(([v, l]) => `<option value="${v}" ${v === s.dash ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`).join('');
    dialog('Kurven bearbeiten', `<div class="curves">${rows}</div><p class="hint">Farbe, Linienstärke und Linienart der Kurven.</p>`, (b) => {
      series.forEach((s, i) => {
        doc.view.styles[refKey(s.ref)] = {
          color: b.querySelector(`[name=c${i}]`).value,
          width: +b.querySelector(`[name=w${i}]`).value,
          dash: b.querySelector(`[name=d${i}]`).value,
        };
      });
      persist(); redraw();
    }, { wide: true });
  }
  function helpDialog() {
    dialog('Kurzanleitung', `
      <div class="help">
      <p><b>Moebius</b> = <b>Mo</b>delle <b>e</b>infach <b>bi</b>lden <b>u</b>nd <b>s</b>imulieren. Gerechnet wird im Kleinschrittverfahren: Alle Gleichungen werden von oben nach unten durchlaufen und so oft wiederholt, wie unter „Wiederhole … mal“ angegeben. Nach jedem Durchlauf werden alle Werte gespeichert.</p>
      <h3>Eingabe</h3>
      <ul>
        <li>Eine Anweisung pro Zeile, z. B. <code>v=v+a*dt</code>. Mehrere Anweisungen in einer Zeile mit <code>:</code> (oder <code>;</code>) trennen. Eine Anweisung darf nicht über mehrere Zeilen gehen.</li>
        <li>Größen, die gelesen werden, bevor sie berechnet werden, erscheinen rechts als <b>Startwerte</b>. Dezimalkomma ist erlaubt: <code>0,01</code>, ebenso <code>1E-5</code>.</li>
        <li>Rechenzeichen: <code>+ - * / ^</code> und Klammern. Funktionen: <code>sin cos tan arcsin arccos arctan exp ln sqr</code> (Quadrat) <code>sqrt</code> (Wurzel) <code>abs</code>. Winkel im Bogenmaß.</li>
        <li>Bedingungen: <code>if s&lt;=1000 then A=25; c_W=1,35</code> – alles nach <code>then</code> bis zum Zeilenende gehört zur Bedingung. Vergleiche: <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, Verknüpfungen <code>and or not</code>, optional <code>else</code>.</li>
        <li>Es gibt keine eingebauten Konstanten: <code>pi</code>, <code>e</code>, <code>g</code> … als Startwert eintragen (z. B. pi = 3,1416).</li>
        <li>„Groß-, Kleinschreibung“ anhaken, wenn z. B. <code>A</code> (Fläche) und <code>a</code> (Beschleunigung) verschiedene Größen sein sollen.</li>
      </ul>
      <h3>Schaubild</h3>
      <ul>
        <li>Rechts x-Achse wählen und in der Liste „y-Achse“ eine oder mehrere Größen anklicken.</li>
        <li>Rechner-Knopf: Wiederholungen verdoppeln und neu rechnen.</li>
        <li>Kurve oder Achse anklicken, um sie zu bearbeiten. Neben eine Kurve klicken zeigt den Messwert.</li>
        <li>Textwerkzeug <b>T</b>: in das Schaubild klicken und schreiben; <b>F K U</b>, x², x₂, Größe und Schriftart formatieren. Texte lassen sich verschieben (ziehen) und per Doppelklick bearbeiten.</li>
        <li>Mehrere Simulationen in einer Datei: „Neue Simulation“; die Größen erscheinen als <code>v [Name]</code>.</li>
        <li>Original-Dateien (<code>.prg</code>) können geöffnet werden; gespeichert wird als <code>.json</code>.</li>
      </ul>
      <p>Tastatur: F2 Eingabe · Strg+O Öffnen · Strg+S Speichern · Strg+P Drucken · Entf markierten Text löschen</p>
      </div>`, null, { okOnly: true, wide: true });
  }

  // ================================================================
  // Dateien
  // ================================================================
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function saveDoc() {
    const data = { format: 'moebius-web', version: 2, sims: doc.sims, view: { ...doc.view, texts: doc.view.texts.map(({ _box, ...t }) => t) }, current: doc.current };
    const base = (doc.fileName || doc.sims[0].name || 'modell').replace(/\.(prg|json)$/i, '');
    download(`${base}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    status(`Gespeichert als „${base}.json“.`);
  }
  async function openFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
      let nd;
      if (head.startsWith('MOEBIUS')) {
        const sims = MoebiusPrg.parsePrg(buf);
        const seen = {}; // Simulationsnamen eindeutig machen
        sims.forEach((s) => { if (seen[s.name]) s.name = `${s.name} (${++seen[s.name]})`; else seen[s.name] = 1; });
        nd = { sims: sims.map(({ selected, ...s }) => s), view: defaultView(), current: 0 };
        sims.forEach((s) => s.selected.forEach((n) => nd.view.y.push({ sim: s.name, name: n })));
      } else {
        const j = JSON.parse(new TextDecoder().decode(buf));
        if (!j || !Array.isArray(j.sims)) throw new Error('Unbekanntes Dateiformat.');
        nd = { sims: j.sims, view: { ...defaultView(), ...j.view }, current: j.current || 0 };
      }
      nd.fileName = file.name;
      loadDoc(nd);
      status(`„${file.name}“ geöffnet – ${nd.sims.length} Simulation${nd.sims.length > 1 ? 'en' : ''}.`);
    } catch (e) {
      status(`Datei konnte nicht geöffnet werden: ${e.message}`, true);
    }
  }
  function loadDoc(nd) {
    nd.sims = nd.sims.map((s) => ({ ...newSim(), ...s }));
    if (!nd.sims.length) nd.sims = [newSim()];
    nd.view = { ...defaultView(), ...nd.view, axes: { ...defaultView().axes, ...(nd.view && nd.view.axes) } };
    nd.current = Math.min(nd.current || 0, nd.sims.length - 1);
    doc = nd;
    ui.selText = -1; ui.anim.frac = 1;
    document.title = `Moebius Web – ${doc.fileName || doc.sims[0].name}`;
    runAll();
  }
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
  // Drag & Drop von Dateien
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

  function exportCsv() {
    const cols = tableColumns();
    if (!cols.length) { status('Keine Größen ausgewählt.', true); return; }
    const n = Math.max(...cols.map((c) => c.n));
    const lines = [cols.map((c) => c.label).join(';')];
    for (let i = 0; i < n; i++) lines.push(cols.map((c) => (i < c.n ? String(c.a[i]).replace('.', ',') : '')).join(';'));
    download(`${doc.sims[doc.current].name}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  }
  function exportPng() {
    const off = document.createElement('canvas');
    const scale = 2;
    off.width = W * scale; off.height = H * scale;
    const c2 = off.getContext('2d'); c2.scale(scale, scale);
    const sel = ui.selText; ui.selText = -1;
    drawGraph(c2, W, H);
    ui.selText = sel;
    drawGraph();
    off.toBlob((b) => download(`${doc.sims[doc.current].name}.png`, b), 'image/png');
  }
  function printDoc() {
    if (ui.tab === 'graph') {
      const off = document.createElement('canvas');
      off.width = W * 2; off.height = H * 2;
      const c2 = off.getContext('2d'); c2.scale(2, 2);
      const sel = ui.selText; ui.selText = -1; drawGraph(c2, W, H); ui.selText = sel;
      $('printImg').src = off.toDataURL('image/png');
      document.body.classList.add('print-graph');
    } else document.body.classList.remove('print-graph');
    setTimeout(() => window.print(), 60);
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('print-graph'));

  // ================================================================
  // Aktionen / Menüs
  // ================================================================
  const actions = {
    new() {
      if (!confirm('Neues Modell anlegen? Nicht gespeicherte Änderungen gehen verloren.')) return;
      loadDoc({ sims: [newSim()], view: defaultView(), current: 0, fileName: 'Unbenannt' });
      openMask();
    },
    open() { $('fileInput').click(); },
    save: saveDoc,
    print: printDoc,
    exportCsv, exportPng,
    input: openMask,
    double() {
      const sims = doc.sims;
      sims.forEach((s) => { s.reps = Math.min(1e7, s.reps * 2); });
      runAll();
      status(`Wiederholungen verdoppelt: ${sims.map((s) => `${s.name} ${s.reps.toLocaleString('de-DE')}×`).join(', ')}. ${$('status').textContent}`);
    },
    newSim() {
      let k = doc.sims.length + 1, name = `Simulation ${k}`;
      while (simByName(name)) name = `Simulation ${++k}`;
      doc.sims.push(newSim(name));
      doc.current = doc.sims.length - 1;
      runAll(); openMask();
    },
    dupSim() {
      const s = doc.sims[doc.current];
      let name = `${s.name} (1)`, k = 1;
      while (simByName(name)) name = `${s.name} (${++k})`;
      doc.sims.push(JSON.parse(JSON.stringify({ ...s, name })));
      doc.current = doc.sims.length - 1;
      runAll(); openMask();
    },
    delSim() {
      if (doc.sims.length < 2) { status('Die letzte Simulation kann nicht gelöscht werden.', true); return; }
      const s = doc.sims[doc.current];
      if (!confirm(`Simulation „${s.name}“ löschen?`)) return;
      doc.sims.splice(doc.current, 1);
      doc.view.y = doc.view.y.filter((y) => y.sim !== s.name);
      doc.current = 0; runAll();
    },
    deleteText() {
      if (ui.selText < 0) { status('Kein Text markiert.'); return; }
      doc.view.texts.splice(ui.selText, 1); ui.selText = -1; persist(); drawGraph();
    },
    showGraph: () => showTab('graph'),
    showTable: () => showTab('table'),
    toggleSeparate() { if (!$('optSeparate').disabled) { doc.view.separate = !doc.view.separate; syncOptions(); persist(); redraw(); } },
    toggle3d() { doc.view.threeD = !doc.view.threeD; syncOptions(); persist(); redraw(); },
    toggleGrid() { doc.view.grid = !doc.view.grid; persist(); redraw(); },
    togglePanel() { doc.view.panel = !doc.view.panel; syncOptions(); persist(); setTimeout(redraw, 50); },
    insertText: () => { showTab('graph'); setTool('text'); },
    toolSelect: () => setTool('select'),
    toolText: () => setTool('text'),
    formatX: () => axisDialog('x'),
    formatY: () => axisDialog('y'),
    formatCurves: () => curveDialog(null),
    autoScale() { ['x', 'y', 'z'].forEach((a) => { doc.view.axes[a].auto = true; doc.view.axes[a].step = 0; }); persist(); redraw(); },
    play, stop, pause,
    help: helpDialog,
    about() {
      dialog('Über Moebius Web', `<p><b>Moebius Web</b> – eine Web-Umsetzung des Modellbildungsprogramms Moebius („Modelle einfach bilden und simulieren“) für den Physikunterricht.</p>
        <p>Eigenständige Neuentwicklung; nicht mit dem Originalprogramm verbunden. Original-Dateien (*.prg) werden gelesen, soweit das Format bekannt ist.</p>
        <p>Läuft vollständig im Browser, keine Daten verlassen das Gerät.</p>`, null, { okOnly: true });
    },
  };
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
    const a = actions[b.dataset.act];
    closeMenus();
    if (a) { e.preventDefault(); a(); }
  }));

  // Menüleiste: Klick öffnet, Überfahren wechselt
  let menuOpen = false;
  function closeMenus() { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); menuOpen = false; }
  document.querySelectorAll('.menu').forEach((m) => {
    const btn = m.querySelector('.menu-btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); const was = m.classList.contains('open'); closeMenus(); if (!was) { m.classList.add('open'); menuOpen = true; } });
    btn.addEventListener('mouseenter', () => { if (menuOpen && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); menuOpen = true; } });
  });
  document.querySelectorAll('.submenu > button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); b.parentElement.classList.toggle('open'); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

  // Beispiele
  $('exampleMenu').innerHTML = window.MOEBIUS_EXAMPLES.map((x, i) => `<button data-ex="${i}">${esc(x.title)}</button>`).join('');
  $('exampleMenu').querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    closeMenus();
    const ex = window.MOEBIUS_EXAMPLES[+b.dataset.ex];
    const nd = { sims: JSON.parse(JSON.stringify(ex.sims)), view: defaultView(), current: 0, fileName: ex.title };
    nd.view.x = ex.view.x;
    nd.view.y = ex.view.y.map((lbl) => {
      const m = /^(.*) \[(.*)\]$/.exec(lbl);
      return m ? { name: m[1], sim: m[2] } : { name: lbl, sim: nd.sims[0].name };
    });
    loadDoc(nd);
    status(`Beispiel „${ex.title}“ geladen. Über „Eingabe“ die Gleichungen ansehen.`);
  }));

  // Seitenleiste
  $('simSelect').addEventListener('change', (e) => { doc.current = +e.target.value; persist(); });
  $('xAxis').addEventListener('change', (e) => { doc.view.x = e.target.value; doc.view.axes.x.auto = true; persist(); redraw(); });
  $('zAxis').addEventListener('change', (e) => { doc.view.z = e.target.value; persist(); redraw(); });
  $('opt3d').addEventListener('change', (e) => {
    doc.view.threeD = e.target.checked;
    if (doc.view.threeD && !doc.view.z) {
      const names = [...$('zAxis').options].map((o) => o.value).filter((v) => v && v !== doc.view.x && !doc.view.y.some((y) => y.name === v));
      doc.view.z = names[0] || '';
    }
    buildPanel(); persist(); redraw();
  });
  $('optSeparate').addEventListener('change', (e) => { doc.view.separate = e.target.checked; persist(); redraw(); });
  $('sideHandle').addEventListener('click', () => { $('side').classList.toggle('open'); setTimeout(redraw, 260); });

  // Tastatur
  window.addEventListener('keydown', (e) => {
    if (mask.open || gen.open) return;
    const k = e.key.toLowerCase();
    if (e.key === 'F2') { e.preventDefault(); openMask(); }
    else if (e.ctrlKey && k === 's') { e.preventDefault(); saveDoc(); }
    else if (e.ctrlKey && k === 'o') { e.preventDefault(); actions.open(); }
    else if (e.ctrlKey && k === 'p') { e.preventDefault(); printDoc(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selText >= 0 && $('textEditor').hidden && document.activeElement === document.body) { e.preventDefault(); actions.deleteText(); }
    else if (e.key === 'Escape') closeMenus();
  });

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  new ResizeObserver(() => { if (ui.tab === 'graph') redraw(); }).observe($('graphArea'));

  // ================================================================
  // Start
  // ================================================================
  setTool('select');
  showTab('graph');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (_) { saved = null; }
  if (saved && Array.isArray(saved.sims)) loadDoc(saved);
  else $('exampleMenu').querySelector('[data-ex="0"]').click();

  // Offline-Nutzung
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
