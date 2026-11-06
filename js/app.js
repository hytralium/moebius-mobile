'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.MoebiusParser;
  const fmtN = P.formatNumber;
  const STORE = 'moebius-web-doc-v3';
  const MAX_VALUES = 25e6; // Speichergrenze (Anzahl gespeicherter Zahlen)
  const PX_PER_CM = 37.8;

  // Die 16 Farben des Originals (Delphi-Grundfarben)
  const NAMED_COLORS = [
    ['schwarz', '#000000'], ['dunkelblau', '#000080'], ['dunkelgrün', '#008000'], ['blaugrün', '#008080'],
    ['purpur', '#800000'], ['violett', '#800080'], ['braun', '#808000'], ['silber', '#c0c0c0'],
    ['grau', '#808080'], ['blau', '#0000ff'], ['limonengrün', '#00ff00'], ['hellblau', '#00ffff'],
    ['rot', '#ff0000'], ['pink', '#ff00ff'], ['gelb', '#ffff00'], ['weiß', '#ffffff'],
  ];
  // Reihenfolge der Kurvenfarben (Original: schwarz, dunkelblau, …)
  const CURVE_COLORS = ['#000000']; // Original: alle Kurven zunächst schwarz
  const LINE_STYLES = [['solid', 'durchgezogen'], ['dash', 'gestrichelt'], ['dot', 'gepunktet'], ['dashdot', 'Strich-Punkt'], ['dashdotdot', 'Strich-Punkt-Punkt'], ['none', 'unsichtbar']];
  const DASH = { solid: [], dash: [9, 5], dot: [2, 4], dashdot: [9, 4, 2, 4], dashdotdot: [9, 3, 2, 3, 2, 3], none: [] };
  const ANIM_IMAGES = [['kugel-rot', 'Kugel rot'], ['kugel-gruen', 'Kugel grün'], ['kugel-blau', 'Kugel blau'], ['kreis-rot', 'Kreis rot'], ['kreis-gruen', 'Kreis grün'], ['kreis-blau', 'Kreis blau'], ['erde', 'Erde'], ['satellit', 'Satellit'], ['auto', 'Auto']];
  const DEFAULT_STATUS = 'Klicken Sie auf die Kurve oder Achse, die bearbeitet werden soll.';

  // ================================================================
  // Dokument
  // ================================================================
  const newSim = (name = 'Standard') => ({ name, text: '', reps: 100, caseSensitive: false, startValues: {} });
  const defaultAxis = () => ({ from: 0, to: 1, pos: null, log: false, step: 0, minor: 4, grid: true, gridColor: '#808080', gridStyle: 'dash', visible: true });
  const defaultView = () => ({
    x: 't', z: '', y: [], table: [], separate: false, threeD: false, panel: true,
    immediate: true, autoScale: true, legend: true,
    graph: { winBg: '#ffffff', plotBg: '#c0c0c0', w: 100, h: 100, l: 0, t: 0, timer: 20 },
    axes: { x: defaultAxis(), y: defaultAxis(), z: defaultAxis() },
    axisFmt: { dec: null, norm: false }, tableFmt: { dec: 4, norm: false },
    styles: {}, texts: [], images: [], rot: { yaw: -0.6, pitch: 0.45 },
  });
  let doc = { sims: [newSim()], view: defaultView(), current: 0, fileName: 'Unbenannt', dirty: false };
  let results = [];
  const ui = {
    tab: 'graph', tool: 'select', sel: null, plots: [], dragging: null, pending: false,
    anim: { state: 'off', idx: 0, dir: 1, timer: 0 }, clip: null, imgCache: new Map(),
  };

  const refLabel = (r) => (doc.sims.length > 1 ? `${r.name} [${r.sim}]` : r.name);
  const simCS = (name) => { const s = doc.sims.find((x) => x.name === name); return !!(s && s.caseSensitive); };
  const refKey = (r) => `${r.sim}\u0001${simCS(r.sim) ? r.name : r.name.toLowerCase()}`;
  const sameRef = (a, b) => a.sim === b.sim && (simCS(a.sim) ? a.name === b.name : a.name.toLowerCase() === b.name.toLowerCase());
  const simByName = (n) => doc.sims.find((s) => s.name === n);
  const keyOf = (sim, name) => (sim.caseSensitive ? name : name.toLowerCase());
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function status(msg, err = false) {
    const el = $('status');
    el.textContent = msg || DEFAULT_STATUS;
    el.classList.toggle('err', !!err);
  }
  function persist(dirty = true) {
    if (dirty) doc.dirty = true;
    try { localStorage.setItem(STORE, JSON.stringify(serializeDoc())); } catch (_) { /* Speicher voll oder gesperrt */ }
  }
  function serializeDoc() {
    return {
      format: 'moebius-web', version: 3, sims: doc.sims, current: doc.current, fileName: doc.fileName, dirty: doc.dirty,
      view: { ...doc.view, texts: doc.view.texts.map(({ _box, ...t }) => t), images: doc.view.images.map(({ _box, ...t }) => t) },
    };
  }

  // ================================================================
  // Simulation (Kleinschrittverfahren)
  // ================================================================
  function simulate(sim) {
    const res = { vars: [], cols: [], n: 0, stride: 1, error: null, sim, edges: [] };
    let c;
    try { c = P.compile(sim.text, sim.caseSensitive); } catch (e) { res.error = e.message; return res; }
    res.vars = c.vars; res.edges = c.edges;
    if (c.vars.length > 2000) { res.error = 'Zuviele Variablen.'; return res; }
    const nv = c.vars.length;
    const mem = new Float64Array(nv);
    for (let i = 0; i < nv; i++) {
      const v = c.vars[i];
      if (!v.isStart) continue;
      const raw = sim.startValues[v.key];
      const val = raw === undefined ? 0 : P.parseNumber(raw);
      if (Number.isNaN(val)) { res.error = `Die Startwerte sind nicht in Ordnung! (${v.name} = „${raw}“)`; return res; }
      mem[i] = val;
    }
    const reps = Math.max(1, Math.floor(sim.reps) || 1);
    const stride = Math.max(1, Math.ceil((reps * nv) / MAX_VALUES));
    const rows = Math.floor(reps / stride);
    res.stride = stride;
    res.cols = c.vars.map(() => new Float64Array(rows));
    const lines = c.lines, nl = lines.length;
    let n = 0;
    for (let k = 1; k <= reps; k++) {
      for (let j = 0; j < nl; j++) lines[j](mem);
      if (k % stride === 0 && n < rows) {
        for (let i = 0; i < nv; i++) {
          const v = mem[i];
          if (!Number.isFinite(v)) {
            res.error = `Rechenfehler im ${k}. Durchlauf: ${c.vars[i].name} ist nicht definiert. Häufig liegt es an einem Startwert 0.`;
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
    animStop(true);
    results = doc.sims.map(simulate);
    const exists = (r) => { const i = doc.sims.findIndex((s) => s.name === r.sim); return i >= 0 && findVar(i, r.name) >= 0; };
    doc.view.y = doc.view.y.filter(exists);
    doc.view.table = doc.view.table.filter(exists);
    buildPanel();
    const err = results.find((r) => r.error);
    const ms = Math.round(performance.now() - t0);
    if (err) status(`${err.sim.name}: ${err.error}`, true);
    else if (!results.some((r) => r.vars.length)) status('Klicken Sie auf Eingabe, um eine neue Simulation zu programmieren');
    else status(`${DEFAULT_STATUS}   (${results.reduce((a, r) => a + r.n * r.stride, 0).toLocaleString('de-DE')} Werte, ${ms} ms${results.some((r) => r.stride > 1) ? ', für die Anzeige ausgedünnt' : ''})`);
    ui.pending = false;
    persist(false);
    redraw();
  }
  function findVar(simIdx, name) {
    const r = results[simIdx];
    if (!r || !name) return -1;
    const k = keyOf(doc.sims[simIdx], name);
    let i = r.vars.findIndex((v) => v.key === k);
    if (i < 0 && !doc.sims[simIdx].caseSensitive) i = r.vars.findIndex((v) => v.key.toLowerCase() === name.toLowerCase());
    if (i < 0 && doc.sims[simIdx].caseSensitive) i = r.vars.findIndex((v) => v.key.toLowerCase() === name.toLowerCase() && !r.vars.some((w) => w !== v && w.key.toLowerCase() === name.toLowerCase()));
    return i;
  }

  // ================================================================
  // Seitenleiste
  // ================================================================
  function allNames() {
    const names = [], seen = new Set();
    results.forEach((r) => r.vars.forEach((v) => { const k = v.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); names.push(v.name); } }));
    return names;
  }
  function buildPanel() {
    const sel = $('simSelect');
    sel.innerHTML = doc.sims.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
    sel.value = String(doc.current);
    const names = allNames();
    const fill = (el, val, allowEmpty) => {
      el.innerHTML = (allowEmpty ? '<option value="">–</option>' : '') + names.map((n) => `<option>${esc(n)}</option>`).join('');
      const match = names.find((n) => n.toLowerCase() === String(val || '').toLowerCase());
      el.value = match || (allowEmpty ? '' : names[0] || '');
      return el.value;
    };
    doc.view.x = fill($('xAxis'), doc.view.x, false);
    doc.view.z = fill($('zAxis'), doc.view.z, true);
    buildList();
    syncOptions();
  }
  function listTarget() { return ui.tab === 'table' ? doc.view.table : doc.view.y; }
  function buildList() {
    const yl = $('yList');
    yl.innerHTML = '';
    const target = listTarget();
    results.forEach((r, si) => r.vars.forEach((v) => {
      const ref = { sim: doc.sims[si].name, name: v.name };
      const b = document.createElement('div');
      b.className = 'yitem'; b.setAttribute('role', 'option');
      b.textContent = refLabel(ref);
      b.setAttribute('aria-selected', target.some((y) => sameRef(y, ref)));
      b.addEventListener('click', () => {
        const t = listTarget();
        const i = t.findIndex((y) => sameRef(y, ref));
        if (i >= 0) t.splice(i, 1); else t.push(ref);
        b.setAttribute('aria-selected', i < 0);
        syncOptions(); persist();
        changed();
      });
      yl.appendChild(b);
    }));
  }
  // Änderung der Achsenwahl: sofort anzeigen oder auf „Anzeigen“ warten
  function changed() {
    if (doc.view.immediate || ui.tab === 'table') { ui.pending = false; redraw(); } else { ui.pending = true; }
    syncOptions();
  }
  function syncOptions() {
    const v = doc.view;
    $('opt3d').checked = v.threeD;
    $('zWrap').hidden = !v.threeD;
    $('listLabel').textContent = ui.tab === 'table' ? 'Tabelle:' : v.threeD ? 'z-Achse:' : 'y-Achse:';
    const sepOk = v.y.length > 1 && !v.threeD;
    $('optSeparate').disabled = !sepOk;
    $('optSeparate').checked = v.separate && sepOk;
    $('side').classList.toggle('collapsed', !v.panel);
    $('btnInput').textContent = ui.pending ? 'Anzeigen' : 'Eingabe';
    $('miImmediate').classList.toggle('checked', v.immediate);
    $('miAutoScale').classList.toggle('checked', v.autoScale);
    $('miLegend').classList.toggle('checked', v.legend);
    const running = ui.anim.state !== 'off';
    $('tbAnimStop').disabled = !running; $('tbAnimPause').disabled = !running;
    document.querySelectorAll('.needs-anim').forEach((b) => { b.disabled = !running; });
  }

  // ================================================================
  // Schaubild: Hilfsfunktionen
  // ================================================================
  const canvas = $('graph');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  function styleOf(ref, idx) {
    const s = doc.view.styles[refKey(ref)] || {};
    return {
      color: s.color || CURVE_COLORS[idx % CURVE_COLORS.length], width: s.width || 1, style: s.style || 'solid',
      splines: !!s.splines, type: s.type || 'line', ptSize: s.ptSize || 4, ptColor: s.ptColor || s.color || CURVE_COLORS[idx % CURVE_COLORS.length],
      ptForm: s.ptForm || 'cross', anim: { on: false, img: 'kugel-rot', build: 'animated', type: 'linear', ...(s.anim || {}) },
    };
  }
  function seriesList() {
    const out = [];
    doc.view.y.forEach((ref, idx) => {
      const si = doc.sims.findIndex((s) => s.name === ref.sim);
      if (si < 0) return;
      const r = results[si];
      const yi = findVar(si, ref.name), xi = findVar(si, doc.view.x);
      const zi = doc.view.threeD && doc.view.z ? findVar(si, doc.view.z) : -1;
      if (yi < 0 || xi < 0 || !r.n) return;
      out.push({ ref, label: refLabel(ref), n: r.n, xs: r.cols[xi], ys: r.cols[yi], zs: zi >= 0 ? r.cols[zi] : null, ...styleOf(ref, idx) });
    });
    return out;
  }
  function niceStep(span, target) {
    if (!(span > 0)) return 1;
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }
  function axisNumber(v, step) {
    const f = doc.view.axisFmt;
    if (Math.abs(v) < Math.abs(step) * 1e-9) v = 0;
    if (f.norm) return v.toExponential(f.dec ?? 2).replace('.', ',').replace('e+', 'E').replace('e', 'E');
    let dec = f.dec;
    if (dec === null || dec === undefined) {
      const a = Math.abs(v);
      if (a >= 1e7 || (a < 1e-4 && a > 0)) return fmtN(v, 3);
      dec = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
      if (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5) dec++;
    }
    const out = v.toFixed(dec).replace('.', ',');
    return /^-0(,0*)?$/.test(out) ? out.slice(1) : out;
  }
  function dataRange(arrs, log) {
    let lo = Infinity, hi = -Infinity;
    for (const a of arrs) for (let i = 0; i < a.length; i++) { const v = a[i]; if (log && v <= 0) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === Infinity) return log ? [1, 10] : [0, 1];
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; return log ? [lo / 2, hi * 2] : [lo - d, hi + d]; }
    return [lo, hi];
  }
  function axisRange(name, arrs) {
    const ax = doc.view.axes[name];
    if (!doc.view.autoScale && ax.to > ax.from && (!ax.log || ax.from > 0)) return [ax.from, ax.to];
    let [lo, hi] = dataRange(arrs, ax.log);
    if (!ax.log) { const pad = (hi - lo) * 0.04; lo = lo === 0 ? 0 : lo - pad; hi += pad; }
    if (doc.view.autoScale) { ax.from = lo; ax.to = hi; }
    return [lo, hi];
  }
  function mapper(range, a, b, log) {
    if (log) { const l0 = Math.log10(range[0]), l1 = Math.log10(range[1]); return (v) => a + ((Math.log10(v) - l0) / (l1 - l0)) * (b - a); }
    return (v) => a + ((v - range[0]) / (range[1] - range[0])) * (b - a);
  }
  function ticksFor(r, ax, px, target) {
    if (ax.log) {
      const out = [];
      for (let e = Math.floor(Math.log10(r[0])); e <= Math.ceil(Math.log10(r[1])); e++) { const v = Math.pow(10, e); if (v >= r[0] * 0.999 && v <= r[1] * 1.001) out.push(v); }
      return { major: out, step: 1, minorOf: (v) => [2, 3, 4, 5, 6, 7, 8, 9].map((k) => v * k).filter((m) => m < r[1]) };
    }
    const step = ax.step > 0 && (r[1] - r[0]) / ax.step < 1000 ? ax.step : niceStep(r[1] - r[0], px / target);
    const out = [];
    const start = Math.ceil(r[0] / step - 1e-9);
    for (let k = start; k * step <= r[1] + step * 1e-9 && out.length < 1000; k++) out.push(k * step);
    const nm = Math.max(0, Math.round(ax.minor ?? 4));
    return { major: out, step, minorOf: (v) => Array.from({ length: nm }, (_, i) => v + ((i + 1) * step) / (nm + 1)).concat(v === out[0] ? Array.from({ length: nm }, (_, i) => v - ((i + 1) * step) / (nm + 1)) : []).filter((m) => m >= r[0] && m <= r[1]) };
  }

  function resizeCanvas() {
    const area = $('graphArea');
    const dpr = window.devicePixelRatio || 1;
    W = area.clientWidth; H = area.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ================================================================
  // Schaubild zeichnen
  // ================================================================
  function drawGraph(c = ctx, w = W, h = H, forExport = false) {
    c.save();
    const g = doc.view.graph;
    c.fillStyle = g.winBg; c.fillRect(0, 0, w, h);
    ui.plots = [];
    const series = seriesList();
    const legendH = doc.view.legend ? drawLegend(c, series, w) : 0;
    // Bereich des Schaubilds (Breite/Höhe/Links/Oben in % des Fensters)
    const ax0 = (g.l / 100) * w, ay0 = legendH + (g.t / 100) * (h - legendH);
    const aw = (g.w / 100) * w, ah = (g.h / 100) * (h - legendH);
    if (!series.length) {
      c.fillStyle = '#444'; c.font = '14px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const anyVars = results.some((r) => r.vars.length);
      c.fillText(anyVars ? 'Klicken Sie auf die Variablen, die auf der y-Achse angezeigt werden sollen.' : 'Klicken Sie auf Eingabe, um eine neue Simulation zu programmieren', w / 2, h / 2);
    } else if (doc.view.threeD && doc.view.z) {
      draw3D(c, series, ax0, ay0, aw, ah);
    } else {
      const groups = doc.view.separate && series.length > 1 ? series.map((s) => [s]) : [series];
      const axX = doc.view.axes.x, axY = doc.view.axes.y;
      const xr = axisRange('x', series.map((s) => s.xs));
      const gh = ah / groups.length;
      groups.forEach((grp, gi) => {
        const yr = axisRange('y', grp.map((s) => s.ys));
        const m = { l: 64, r: 26, t: 18, b: 32 };
        const x0 = ax0 + m.l, y0 = ay0 + gi * gh + m.t;
        const pw = aw - m.l - m.r, ph = gh - m.t - m.b;
        if (pw < 30 || ph < 30) return;
        const sx = mapper(xr, x0, x0 + pw, axX.log), sy = mapper(yr, y0 + ph, y0, axY.log);
        c.fillStyle = g.plotBg; c.fillRect(x0, y0, pw, ph);
        const xt = ticksFor(xr, axX, pw, 80), yt = ticksFor(yr, axY, ph, 45);
        // Lage der Achsen (auf der jeweils anderen Achse)
        const inR = (v, r, log) => v >= r[0] && v <= r[1] && (!log || v > 0);
        const xPosV = axX.pos !== null && axX.pos !== undefined ? axX.pos : (inR(0, yr, axY.log) ? 0 : yr[0]);
        const yPosV = axY.pos !== null && axY.pos !== undefined ? axY.pos : (inR(0, xr, axX.log) ? 0 : xr[0]);
        const lineY = Math.round(Math.min(y0 + ph, Math.max(y0, inR(xPosV, yr, axY.log) ? sy(xPosV) : y0 + ph))) + 0.5;
        const lineX = Math.round(Math.min(x0 + pw, Math.max(x0, inR(yPosV, xr, axX.log) ? sx(yPosV) : x0))) + 0.5;
        // Hilfslinien
        const gridLines = (ax, ticks, vert) => {
          if (!ax.grid) return;
          c.strokeStyle = ax.gridColor || '#808080'; c.lineWidth = 1; c.setLineDash(DASH[ax.gridStyle || 'dash'] || []);
          if (ax.gridStyle === 'none') return;
          ticks.major.forEach((v) => {
            c.beginPath();
            if (vert) { const px = Math.round(sx(v)) + 0.5; c.moveTo(px, y0); c.lineTo(px, y0 + ph); }
            else { const py = Math.round(sy(v)) + 0.5; c.moveTo(x0, py); c.lineTo(x0 + pw, py); }
            c.stroke();
          });
          c.setLineDash([]);
        };
        gridLines(axX, xt, true); gridLines(axY, yt, false);
        // Achsen
        const origin = xPosV === 0 && yPosV === 0 && inR(0, xr, axX.log) && inR(0, yr, axY.log);
        c.strokeStyle = '#000'; c.fillStyle = '#000'; c.font = '13px Arial';
        if (axX.visible !== false) {
          c.lineWidth = 2; arrow(c, x0, lineY, x0 + pw + 16, lineY); c.lineWidth = 1;
          c.textAlign = 'center'; c.textBaseline = 'top';
          xt.major.forEach((v) => {
            const px = Math.round(sx(v)) + 0.5;
            c.beginPath(); c.moveTo(px, lineY - 5); c.lineTo(px, lineY + 5); c.stroke();
            if (!(origin && Math.abs(v) < xt.step * 1e-9)) c.fillText(axisNumber(v, xt.step), px, lineY + 7);
            xt.minorOf(v).forEach((mv) => { const mx = Math.round(sx(mv)) + 0.5; c.beginPath(); c.moveTo(mx, lineY - 2.5); c.lineTo(mx, lineY + 2.5); c.stroke(); });
          });
          c.font = 'italic 13px Arial'; c.textAlign = 'right'; c.textBaseline = 'bottom';
          c.fillText(doc.view.x, x0 + pw + 16, lineY - 6);
          c.font = '13px Arial';
        }
        if (axY.visible !== false) {
          c.lineWidth = 2; arrow(c, lineX, y0 + ph, lineX, y0 - 12); c.lineWidth = 1;
          c.textAlign = 'right'; c.textBaseline = 'middle';
          yt.major.forEach((v) => {
            const py = Math.round(sy(v)) + 0.5;
            c.beginPath(); c.moveTo(lineX - 5, py); c.lineTo(lineX + 5, py); c.stroke();
            if (!(origin && Math.abs(v) < yt.step * 1e-9)) c.fillText(axisNumber(v, yt.step), lineX - 8, py);
            yt.minorOf(v).forEach((mv) => { const my = Math.round(sy(mv)) + 0.5; c.beginPath(); c.moveTo(lineX - 2.5, my); c.lineTo(lineX + 2.5, my); c.stroke(); });
          });
          if (groups.length > 1) { c.font = 'italic 13px Arial'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(grp[0].label, lineX + 8, y0 - 14); }
        }
        // Kurven
        c.save(); c.beginPath(); c.rect(x0, y0 - 1, pw, ph + 2); c.clip();
        grp.forEach((s) => drawSeries(c, s, sx, sy, lineY));
        c.restore();
        ui.plots.push({ x0, y0, pw, ph, sx, sy, xr, yr, series: grp, lineX, lineY, mode: '2d' });
      });
    }
    drawImages(c, w, h, forExport);
    drawTexts(c, w, h, forExport);
    c.restore();
  }
  function visibleCount(s) {
    const a = ui.anim;
    if (a.state === 'off' || !s.anim.on) return s.n;
    if (s.anim.build === 'immediate') return s.n;
    if (s.anim.build === 'invisible') return 0;
    return Math.max(1, Math.min(s.n, a.idx + 1));
  }
  function drawSeries(c, s, sx, sy, baseY) {
    const n = visibleCount(s);
    const stride = Math.max(1, Math.floor(n / 20000));
    const showLine = (s.type === 'line' || s.type === 'pointline') && s.style !== 'none';
    const showPts = s.type === 'point' || s.type === 'pointline';
    if (n > 0 && showLine) {
      c.strokeStyle = s.color; c.lineWidth = s.width; c.setLineDash(DASH[s.style] || []);
      c.beginPath();
      let px = sx(s.xs[0]), py = sy(s.ys[0]);
      c.moveTo(px, py);
      for (let i = stride; i < n; i += stride) {
        const qx = sx(s.xs[i]), qy = sy(s.ys[i]);
        if (s.splines) c.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2); else c.lineTo(qx, qy);
        px = qx; py = qy;
      }
      if (n > 1) c.lineTo(sx(s.xs[n - 1]), sy(s.ys[n - 1]));
      c.stroke(); c.setLineDash([]);
    }
    if (n > 0 && s.type === 'bar') {
      c.fillStyle = s.color;
      const st = Math.max(stride, Math.floor(n / 400));
      const bw = Math.max(1, s.width * 2);
      for (let i = 0; i < n; i += st) { const x = sx(s.xs[i]), y = sy(s.ys[i]); c.fillRect(x - bw / 2, Math.min(y, baseY), bw, Math.abs(baseY - y)); }
    }
    if (n > 0 && showPts) {
      const st = Math.max(stride, Math.floor(n / 600));
      for (let i = 0; i < n; i += st) drawPoint(c, sx(s.xs[i]), sy(s.ys[i]), s);
    }
    // Animationsgrafik
    if (ui.anim.state !== 'off' && s.anim.on) {
      const i = Math.min(s.n - 1, ui.anim.idx);
      drawAnimImage(c, s.anim.img, sx(s.xs[i]), sy(s.ys[i]));
    }
  }
  function drawPoint(c, x, y, s) {
    const r = Math.max(1.5, (s.ptSize * 1.33) / 2);
    c.strokeStyle = s.ptColor; c.fillStyle = s.ptColor; c.lineWidth = 1;
    if (s.ptForm === 'cross') { c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke(); }
    else { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (s.ptForm === 'disc') c.fill(); else c.stroke(); }
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
    series.forEach((s) => {
      const tw = c.measureText(s.label).width, itemW = 70 + tw + 16;
      if (x + itemW > w - 8 && x > 12) { x = 12; y += 28; }
      if (s.type === 'point') drawPoint(c, x + 31, y, s);
      else if (s.type === 'bar') { c.fillStyle = s.color; c.fillRect(x + 20, y - 6, 22, 12); }
      else {
        c.strokeStyle = s.color; c.lineWidth = Math.max(1, s.width); c.setLineDash(DASH[s.style] || []);
        c.beginPath(); c.moveTo(x, y + 0.5); c.lineTo(x + 62, y + 0.5); c.stroke(); c.setLineDash([]);
        if (s.type === 'pointline') drawPoint(c, x + 31, y, s);
      }
      c.fillStyle = '#000'; c.fillText(s.label, x + 70, y);
      x += itemW;
    });
    return series.length ? y + 16 : 0;
  }

  // ---------- 3D ----------
  function draw3D(c, series, ax0, ay0, aw, ah) {
    const xr = axisRange('x', series.map((s) => s.xs));
    const yr = axisRange('y', series.map((s) => s.ys));
    const zr = axisRange('z', series.map((s) => s.zs).filter(Boolean));
    const { yaw, pitch } = doc.view.rot;
    const cy = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = Math.min(aw, ah) * 0.32, ox = ax0 + aw / 2, oy = ay0 + ah / 2;
    const norm = (v, r) => ((v - r[0]) / (r[1] - r[0])) * 2 - 1;
    const proj = (X, Y, Z) => { const x1 = X * cy - Z * syw, z1 = X * syw + Z * cy; return [ox + x1 * scale, oy - (Y * cp - z1 * sp) * scale]; };
    const P3 = (xv, yv, zv) => proj(norm(xv, xr), norm(yv, yr), norm(zv, zr));
    c.fillStyle = doc.view.graph.plotBg;
    const fl = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]].map((p) => proj(...p));
    c.beginPath(); fl.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath(); c.fill();
    c.strokeStyle = '#808080'; c.setLineDash([5, 4]); c.lineWidth = 1;
    [[[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]], [[-1, 1, -1], [1, 1, -1]], [[-1, 1, 1], [1, 1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]]
      .forEach(([a, b]) => { c.beginPath(); c.moveTo(...proj(...a)); c.lineTo(...proj(...b)); c.stroke(); });
    c.setLineDash([]);
    c.strokeStyle = '#000'; c.fillStyle = '#000'; c.lineWidth = 2;
    const o = proj(-1, -1, -1);
    const names = [doc.view.x, series.map((s) => s.ref.name).join(', '), doc.view.z];
    [[proj(1.25, -1, -1), xr, proj(1, -1, -1)], [proj(-1, 1.25, -1), yr, proj(-1, 1, -1)], [proj(-1, -1, 1.25), zr, proj(-1, -1, 1)]].forEach(([p, r, e], k) => {
      arrow(c, o[0], o[1], p[0], p[1]);
      c.font = 'italic 13px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(names[k], p[0] + (k === 1 ? 0 : 12), p[1] + (k === 1 ? -10 : 10));
      c.font = '12px Arial'; c.fillText(axisNumber(r[1], niceStep(r[1] - r[0], 5)), e[0] - 12, e[1] - 10);
    });
    c.lineWidth = 1;
    series.forEach((s) => {
      if (!s.zs) return;
      const n = visibleCount(s), stride = Math.max(1, Math.floor(n / 20000));
      if (n > 0 && s.style !== 'none') {
        c.strokeStyle = s.color; c.lineWidth = s.width; c.setLineDash(DASH[s.style] || []); c.beginPath();
        c.moveTo(...P3(s.xs[0], s.ys[0], s.zs[0]));
        for (let i = stride; i < n; i += stride) c.lineTo(...P3(s.xs[i], s.ys[i], s.zs[i]));
        c.stroke(); c.setLineDash([]);
      }
      if (ui.anim.state !== 'off' && s.anim.on) { const i = Math.min(s.n - 1, ui.anim.idx); drawAnimImage(c, s.anim.img, ...P3(s.xs[i], s.ys[i], s.zs[i])); }
    });
    ui.plots.push({ mode: '3d' });
    c.fillStyle = '#555'; c.font = '12px Arial'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('Ziehen zum Drehen', ax0 + aw - 8, ay0 + ah - 6);
  }

  // ---------- Animationsgrafiken (eigene Zeichnungen) ----------
  function drawAnimImage(c, img, x, y) {
    c.save();
    const col = { rot: '#e01010', gruen: '#10a010', blau: '#1040e0' };
    if (img && img.startsWith('data:')) {
      const im = cachedImage(img);
      if (im.complete && im.naturalWidth) { const s = Math.min(1, 48 / Math.max(im.naturalWidth, im.naturalHeight)); const iw = im.naturalWidth * s, ih = im.naturalHeight * s; c.drawImage(im, x - iw / 2, y - ih / 2, iw, ih); }
    } else if (img && img.startsWith('kugel-')) {
      const base = col[img.slice(6)] || '#e01010';
      const grd = c.createRadialGradient(x - 3, y - 3, 1, x, y, 9);
      grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, base); grd.addColorStop(1, '#000');
      c.fillStyle = grd; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
    } else if (img && img.startsWith('kreis-')) {
      c.fillStyle = col[img.slice(6)] || '#e01010'; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    } else if (img === 'erde') {
      c.fillStyle = '#2a6fd6'; c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2e9a3a';
      c.beginPath(); c.ellipse(x - 4, y - 3, 6, 4, 0.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(x + 5, y + 5, 4, 3, -0.3, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#123a80'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.stroke();
    } else if (img === 'satellit') {
      c.fillStyle = '#999'; c.fillRect(x - 4, y - 4, 8, 8);
      c.fillStyle = '#2050b0'; c.fillRect(x - 16, y - 3, 10, 6); c.fillRect(x + 6, y - 3, 10, 6);
      c.strokeStyle = '#333'; c.lineWidth = 1; c.strokeRect(x - 4, y - 4, 8, 8);
    } else if (img === 'auto') {
      c.fillStyle = '#d02020'; c.fillRect(x - 14, y - 9, 28, 8); c.fillRect(x - 8, y - 15, 14, 7);
      c.fillStyle = '#111'; c.beginPath(); c.arc(x - 8, y, 4, 0, Math.PI * 2); c.arc(x + 8, y, 4, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function cachedImage(src) {
    let im = ui.imgCache.get(src);
    if (!im) { im = new Image(); im.onload = () => drawGraph(); im.src = src; ui.imgCache.set(src, im); }
    return im;
  }

  // ---------- Texte und Grafiken ----------
  function textFont(t, size) { return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${size || t.size || 12}px "${t.font || 'Arial'}"`; }
  function textRuns(str) {
    const runs = []; const re = /([\^_])\{([^}]*)\}/g; let last = 0, m;
    while ((m = re.exec(str))) { if (m.index > last) runs.push({ s: str.slice(last, m.index), k: 0 }); runs.push({ s: m[2], k: m[1] === '^' ? 1 : -1 }); last = re.lastIndex; }
    if (last < str.length) runs.push({ s: str.slice(last), k: 0 });
    return runs;
  }
  function drawTexts(c, w, h, forExport) {
    doc.view.texts.forEach((t) => {
      const x = t.x * w, y = t.y * h, size = t.size || 12, lh = size * 1.25;
      const lines = t.text.split('\n');
      let wmax = 0;
      c.save(); c.translate(x, y); c.rotate(-((t.rot || 0) * Math.PI) / 180);
      c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = t.color || '#000';
      lines.forEach((ln, li) => {
        let cx = 0; const by = (li + 1) * lh - size * 0.25;
        textRuns(ln).forEach((r) => {
          const fs = r.k ? size * 0.7 : size; c.font = textFont(t, fs);
          c.fillText(r.s, cx, by + (r.k === 1 ? -size * 0.4 : r.k === -1 ? size * 0.2 : 0));
          const tw = c.measureText(r.s).width;
          if (t.underline) c.fillRect(cx, by + 2, tw, Math.max(1, size / 14));
          cx += tw;
        });
        wmax = Math.max(wmax, cx);
      });
      t._box = { x: x - 3, y: y - 2, w: wmax + 6, h: lines.length * lh + 4 };
      if (!forExport && ui.sel && ui.sel.kind === 'text' && doc.view.texts[ui.sel.i] === t) {
        c.strokeStyle = '#0050d0'; c.setLineDash([3, 2]); c.lineWidth = 1; c.strokeRect(-3, -2, wmax + 6, lines.length * lh + 4); c.setLineDash([]);
      }
      c.restore();
    });
  }
  function drawImages(c, w, h, forExport) {
    doc.view.images.forEach((g, i) => {
      const im = cachedImage(g.src);
      const x = g.x * w, y = g.y * h, iw = g.w, ih = g.h;
      g._box = { x, y, w: iw, h: ih };
      if (!im.complete || !im.naturalWidth) return;
      c.save();
      c.translate(x + iw / 2, y + ih / 2);
      c.rotate(-(((g.rot || 0) + (g.rot90 ? 90 : 0)) * Math.PI) / 180);
      c.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1);
      if (g.gray) c.filter = 'grayscale(1)';
      c.drawImage(im, -iw / 2, -ih / 2, iw, ih);
      c.restore();
      if (!forExport && ui.sel && ui.sel.kind === 'image' && ui.sel.i === i) {
        c.strokeStyle = '#0050d0'; c.setLineDash([3, 2]); c.strokeRect(x - 2, y - 2, iw + 4, ih + 4); c.setLineDash([]);
        c.fillStyle = '#0050d0'; c.fillRect(x + iw - 3, y + ih - 3, 8, 8); // Ziehpunkt für Größe
      }
    });
  }

  function redraw() {
    if (ui.tab === 'graph') { resizeCanvas(); drawGraph(); } else renderTable();
  }

  // ================================================================
  // Maus / Touch im Schaubild
  // ================================================================
  function pos(ev) { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function hitObj(p) {
    for (let i = doc.view.texts.length - 1; i >= 0; i--) { const b = doc.view.texts[i]._box; if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind: 'text', i }; }
    for (let i = doc.view.images.length - 1; i >= 0; i--) {
      const b = doc.view.images[i]._box;
      if (!b) continue;
      if (Math.abs(p.x - (b.x + b.w)) < 9 && Math.abs(p.y - (b.y + b.h)) < 9) return { kind: 'image', i, resize: true };
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind: 'image', i };
    }
    return null;
  }
  function hitCurve(p, tol = 7) {
    let best = null;
    for (const pl of ui.plots) {
      if (pl.mode !== '2d' || p.x < pl.x0 - tol || p.x > pl.x0 + pl.pw + tol || p.y < pl.y0 - tol || p.y > pl.y0 + pl.ph + tol) continue;
      for (const s of pl.series) {
        const n = s.n, stride = Math.max(1, Math.floor(n / 20000));
        let px = pl.sx(s.xs[0]), py = pl.sy(s.ys[0]);
        if (n === 1 && Math.hypot(p.x - px, p.y - py) < tol) best = { d: 0, s, pl, i: 0 };
        for (let i = stride; i < n + stride; i += stride) {
          const j = Math.min(i, n - 1), qx = pl.sx(s.xs[j]), qy = pl.sy(s.ys[j]);
          const d = s.type === 'line' || s.type === 'pointline' ? segDist(p.x, p.y, px, py, qx, qy) : Math.hypot(p.x - qx, p.y - qy);
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
      if (Math.abs(p.y - pl.lineY) < 9 && p.x >= pl.x0 - 4 && p.x <= pl.x0 + pl.pw + 20) return 'x';
      if (Math.abs(p.x - pl.lineX) < 9 && p.y >= pl.y0 - 14 && p.y <= pl.y0 + pl.ph + 4) return 'y';
      if (p.y > pl.lineY + 4 && p.y < pl.lineY + 26 && p.x >= pl.x0 && p.x <= pl.x0 + pl.pw) return 'x';
      if (p.x < pl.lineX - 4 && p.x > pl.lineX - 62 && p.y >= pl.y0 && p.y <= pl.y0 + pl.ph) return 'y';
    }
    return null;
  }
  function nearestPoint(p) {
    let best = null;
    for (const pl of ui.plots) {
      if (pl.mode !== '2d' || p.x < pl.x0 || p.x > pl.x0 + pl.pw || p.y < pl.y0 || p.y > pl.y0 + pl.ph) continue;
      for (const s of pl.series) {
        const stride = Math.max(1, Math.floor(s.n / 5000));
        for (let i = 0; i < s.n; i += stride) {
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
    if (ui.tool === 'text') {
      ev.preventDefault();
      const hit = hitObj(p);
      if (hit && hit.kind === 'text') { editText(hit.i); return; }
      doc.view.texts.push({ x: p.x / W, y: p.y / H, text: '', bold: false, italic: false, underline: false, size: +$('fontSize').value, font: $('fontFamily').value, rot: 0 });
      editText(doc.view.texts.length - 1, true);
      return;
    }
    const hit = hitObj(p);
    if (hit) {
      ui.sel = { kind: hit.kind, i: hit.i };
      const o = hit.kind === 'text' ? doc.view.texts[hit.i] : doc.view.images[hit.i];
      if (hit.kind === 'text') syncFormatButtons(o);
      ui.dragging = { kind: hit.resize ? 'resize' : 'move', obj: o, dx: p.x - o.x * W, dy: p.y - o.y * H, w0: o.w, h0: o.h, px: p.x, py: p.y };
      canvas.setPointerCapture(ev.pointerId); drawGraph(); return;
    }
    if (ui.sel) { ui.sel = null; drawGraph(); }
    if (doc.view.threeD && doc.view.z) {
      ui.dragging = { kind: 'rot', x: p.x, y: p.y, yaw: doc.view.rot.yaw, pitch: doc.view.rot.pitch };
      canvas.setPointerCapture(ev.pointerId); return;
    }
    const c = hitCurve(p, ev.pointerType === 'touch' ? 14 : 7);
    if (c) { curveDialog(c.s.ref); return; }
    const a = hitAxis(p);
    if (a) { axisDialog(a); return; }
    const np = nearestPoint(p);
    if (np) showTip(np);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = pos(ev), d = ui.dragging;
    if (d && d.kind === 'rot') {
      doc.view.rot.yaw = d.yaw + (p.x - d.x) * 0.01;
      doc.view.rot.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + (p.y - d.y) * 0.01));
      drawGraph(); return;
    }
    if (d && d.kind === 'move') { d.obj.x = (p.x - d.dx) / W; d.obj.y = (p.y - d.dy) / H; drawGraph(); return; }
    if (d && d.kind === 'resize') {
      const nw = Math.max(10, d.w0 + p.x - d.px);
      d.obj.w = nw; d.obj.h = d.obj.keepRatio === false ? Math.max(10, d.h0 + p.y - d.py) : (nw * d.h0) / d.w0;
      drawGraph(); return;
    }
    if (ev.pointerType !== 'mouse') return;
    if (ui.tool === 'text') { canvas.style.cursor = 'text'; return; }
    const ho = hitObj(p);
    const over = ho ? (ho.resize ? 'nwse-resize' : 'move') : hitCurve(p) || hitAxis(p) ? 'pointer' : 'default';
    canvas.style.cursor = over;
    const np = over === 'default' ? nearestPoint(p) : null;
    if (np) showTip(np); else hideTip();
  });
  const endDrag = () => { if (ui.dragging) { ui.dragging = null; persist(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(); });
  canvas.addEventListener('dblclick', (ev) => {
    const h = hitObj(pos(ev));
    if (h && h.kind === 'text') editText(h.i);
    else if (h && h.kind === 'image') imageDialog(h.i);
  });

  function showTip(np) {
    const tip = $('tip');
    const xv = np.s.xs[np.i], yv = np.s.ys[np.i];
    tip.innerHTML = `<b style="color:${np.s.color}">${esc(np.s.label)}</b> = ${fmtN(yv)}<br>${esc(doc.view.x)} = ${fmtN(xv)}`;
    tip.hidden = false;
    const px = np.pl.sx(xv), py = np.pl.sy(yv);
    tip.style.left = Math.min(px + 12, W - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(py - tip.offsetHeight - 10, 4) + 'px';
    drawGraph();
    ctx.strokeStyle = np.s.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
  }
  function hideTip() { if (!$('tip').hidden) { $('tip').hidden = true; drawGraph(); } }

  // ---------- Text bearbeiten ----------
  function editText(i, isNew = false) {
    const t = doc.view.texts[i];
    ui.sel = { kind: 'text', i };
    drawGraph();
    const ed = $('textEditor');
    ed.hidden = false; ed.value = t.text;
    ed.style.left = t.x * W + 'px'; ed.style.top = t.y * H + 'px';
    ed.style.font = textFont(t);
    ed.focus();
    syncFormatButtons(t);
    status('Text eingeben. Ende: Auf Pfeil klicken.');
    const commit = () => {
      if (ed.hidden) return;
      ed.removeEventListener('blur', commit);
      ed.hidden = true;
      t.text = ed.value.replace(/\s+$/, '');
      if (!t.text) { doc.view.texts.splice(doc.view.texts.indexOf(t), 1); ui.sel = null; }
      persist(); drawGraph(); status();
      if (isNew) setTool('select');
    };
    setTimeout(() => ed.addEventListener('blur', commit), 10);
    ed.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); ed.blur(); } };
  }
  function selText() { return ui.sel && ui.sel.kind === 'text' ? doc.view.texts[ui.sel.i] : null; }
  function syncFormatButtons(t) {
    document.querySelectorAll('[data-fmt]').forEach((b) => { const f = b.dataset.fmt; b.classList.toggle('on', !!(t && ['bold', 'italic', 'underline'].includes(f) && t[f])); });
    if (t) {
      const fs = $('fontSize');
      if (![...fs.options].some((o) => o.value === String(t.size))) fs.add(new Option(String(t.size)));
      fs.value = String(t.size || 12); $('fontFamily').value = t.font || 'Arial';
    }
  }
  document.querySelectorAll('[data-fmt]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const f = b.dataset.fmt, ed = $('textEditor'), t = selText();
      if (f === 'sup' || f === 'sub') {
        if (!ed.hidden) { const a = ed.selectionStart, z = ed.selectionEnd, sel = ed.value.slice(a, z) || '2'; ed.setRangeText(`${f === 'sup' ? '^' : '_'}{${sel}}`, a, z, 'end'); }
        else status('Hoch-/Tiefstellen: Text bearbeiten (Doppelklick) und Zeichen markieren.');
        return;
      }
      if (!t) { status('Auf vorhandenen Text oder an neue Position klicken...'); return; }
      t[f] = !t[f]; syncFormatButtons(t);
      if (!ed.hidden) ed.style.font = textFont(t);
      persist(); drawGraph();
    });
  });
  ['fontSize', 'fontFamily'].forEach((id) => $(id).addEventListener('change', () => {
    const t = selText(); if (!t) return;
    t.size = +$('fontSize').value; t.font = $('fontFamily').value;
    const ed = $('textEditor'); if (!ed.hidden) ed.style.font = textFont(t);
    persist(); drawGraph();
  }));
  function setTool(tool) {
    ui.tool = tool;
    $('tbSelect').classList.toggle('on', tool === 'select');
    $('tbText').classList.toggle('on', tool === 'text');
    canvas.style.cursor = tool === 'text' ? 'text' : 'default';
    status(tool === 'text' ? 'Auf vorhandenen Text oder an neue Position klicken...' : '');
  }

  // ================================================================
  // Tabelle
  // ================================================================
  function tableColumns() {
    const cols = [];
    const refs = doc.view.table.length ? doc.view.table : [];
    const sims = [...new Set(refs.map((r) => r.sim))];
    sims.forEach((sn) => {
      const si = doc.sims.findIndex((s) => s.name === sn);
      if (si < 0) return;
      const r = results[si];
      refs.filter((x) => x.sim === sn).forEach((ref) => { const vi = findVar(si, ref.name); if (vi >= 0) cols.push({ label: refLabel(ref), a: r.cols[vi], n: r.n, stride: r.stride }); });
    });
    return cols;
  }
  function fmtTable(v) {
    const f = doc.view.tableFmt;
    if (!Number.isFinite(v)) return '';
    if (f.norm) return v.toExponential(f.dec).replace('.', ',').replace('e+', 'E').replace('e', 'E');
    return v.toFixed(f.dec).replace('.', ',');
  }
  function renderTable() {
    const t = $('table');
    const cols = tableColumns();
    if (!cols.length) { t.innerHTML = '<tbody><tr><td class="empty">Klicken Sie auf die Variablen, die in der Tabelle angezeigt werden sollen.</td></tr></tbody>'; return; }
    const n = Math.max(...cols.map((c) => c.n));
    const LIMIT = 10000;
    let html = '<thead><tr><th></th>' + cols.map((c) => `<th>${esc(c.label)}</th>`).join('') + '</tr></thead><tbody>';
    for (let i = 0; i < n && i < LIMIT; i++) html += `<tr><td>${(i + 1) * cols[0].stride}</td>` + cols.map((c) => `<td>${i < c.n ? fmtTable(c.a[i]) : ''}</td>`).join('') + '</tr>';
    t.innerHTML = html + '</tbody>';
    status(n > LIMIT ? `Die Tabelle zeigt die ersten ${LIMIT} Werte – „Nach Excel exportieren“ liefert alle.` : 'Klicken Sie auf die Tabelle, um das Zahlenformat einzustellen.');
  }
  $('table').addEventListener('click', () => numberFormatDialog('table'));

  function showTab(tab) {
    ui.tab = tab;
    $('graphArea').hidden = tab !== 'graph';
    $('tableArea').hidden = tab !== 'table';
    $('tbGraph').classList.toggle('on', tab === 'graph');
    $('tbTable').classList.toggle('on', tab === 'table');
    if (tab === 'table' && !doc.view.table.length) {
      const sers = doc.view.y;
      if (sers.length) {
        const xs = [...new Set(sers.map((r) => r.sim))].map((sim) => ({ sim, name: doc.view.x }));
        doc.view.table = [...xs, ...sers.map((r) => ({ ...r }))];
      }
    }
    buildList(); syncOptions();
    if (tab === 'graph') status();
    redraw();
  }

  // ================================================================
  // Animation (Timer wie im Original)
  // ================================================================
  function animStart() {
    const sers = seriesList().filter((s) => s.anim.on);
    if (!sers.length) {
      alertDialog('Animation', 'Klicken Sie zuerst auf die Kurve, die Sie animieren wollen, und markieren Sie dort das Feld Animation. Wählen Sie dann noch eine Grafik aus.');
      return;
    }
    if (ui.tab !== 'graph') showTab('graph');
    const a = ui.anim;
    const n = Math.max(...sers.map((s) => s.n));
    if (a.state === 'off') { a.idx = 0; a.dir = 1; }
    a.state = 'run';
    const step = Math.max(1, Math.ceil(n / 3000)); // sehr lange Verläufe werden schneller abgespielt
    clearInterval(a.timer);
    a.timer = setInterval(() => {
      a.idx += a.dir * step;
      const type = sers[0].anim.type;
      if (a.idx >= n - 1) {
        if (type === 'cyclic') a.idx = 0;
        else if (type === 'autoreverse') { a.idx = n - 1; a.dir = -1; }
        else { a.idx = n - 1; drawGraph(); clearInterval(a.timer); a.state = 'pause'; status('Animation beendet. Erneut starten mit „Animation starten“.'); syncOptions(); return; }
      } else if (a.idx <= 0 && a.dir < 0) { a.idx = 0; a.dir = 1; }
      drawGraph();
    }, Math.max(1, doc.view.graph.timer || 20));
    status('Animation läuft...');
    syncOptions();
  }
  function animPause() {
    const a = ui.anim;
    if (a.state === 'run') { clearInterval(a.timer); a.state = 'pause'; status('Animation Pause...'); }
    else if (a.state === 'pause') animStart();
    syncOptions();
  }
  function animStop(silent) {
    const a = ui.anim;
    clearInterval(a.timer);
    const was = a.state !== 'off';
    a.state = 'off'; a.idx = 0;
    if (was && !silent) { status(); drawGraph(); }
    if ($('tbAnimStop')) syncOptions();
  }

  // ================================================================
  // Eingabemaske (Algorithmische Modellierung)
  // ================================================================
  const mask = $('maskDlg');
  let maskState = null;
  function openMask() {
    if (ui.pending) { ui.pending = false; syncOptions(); redraw(); return; } // Knopf zeigt „Anzeigen“
    const sim = doc.sims[doc.current];
    maskState = { values: { ...sim.startValues }, vars: [], edges: [] };
    $('mReps').value = sim.reps; $('mName').value = sim.name; $('mText').value = sim.text; $('mCase').checked = sim.caseSensitive;
    setMaskMode('text');
    updateMask();
    mask.showModal();
    setTimeout(() => $('mText').focus(), 30);
  }
  function updateMask() {
    const text = $('mText').value, cs = $('mCase').checked;
    let err = null, compiled = null;
    try { compiled = P.compile(text, cs); } catch (e) { err = e; }
    const nLines = text.split('\n').length;
    $('mGutter').innerHTML = Array.from({ length: nLines }, (_, i) => `<div class="${err && err.line === i + 1 ? 'bad' : ''}">${i + 1}</div>`).join('');
    $('mErr').textContent = err ? err.message : '';
    if (compiled) {
      maskState.vars = compiled.vars; maskState.edges = compiled.edges;
      renderStartGrid();
      if (maskMode !== 'text') renderModelView();
    }
  }
  function lookupStart(v) {
    if (v.key in maskState.values) return maskState.values[v.key];
    const alt = Object.keys(maskState.values).find((k) => k.toLowerCase() === v.key.toLowerCase());
    return alt !== undefined ? maskState.values[alt] : '';
  }
  function renderStartGrid() {
    const grid = $('mStart');
    const starts = maskState.vars.filter((v) => v.isStart);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    let html = '';
    starts.forEach((v) => { html += `<div class="sv-name" title="${esc(v.name)}">${esc(v.name)}</div><input class="sv-val" data-key="${esc(v.key)}" inputmode="decimal" value="${esc(lookupStart(v))}" aria-label="Startwert ${esc(v.name)}">`; });
    for (let i = starts.length; i < 14; i++) html += '<div class="sv-name"></div><div class="sv-val empty"></div>';
    grid.innerHTML = html;
    grid.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => { maskState.values[inp.dataset.key] = inp.value; inp.classList.toggle('bad', Number.isNaN(P.parseNumber(inp.value))); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = [...grid.querySelectorAll('input')]; const nx = all[all.indexOf(inp) + 1]; if (nx) nx.focus(); } });
      if (inp.dataset.key === focused) inp.focus();
    });
  }
  let maskTimer = 0;
  $('mText').addEventListener('input', () => { clearTimeout(maskTimer); maskTimer = setTimeout(updateMask, 200); });
  $('mText').addEventListener('scroll', () => { $('mGutter').scrollTop = $('mText').scrollTop; });
  $('mText').addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end'); } });
  $('mCase').addEventListener('change', updateMask);
  $('mCancel').addEventListener('click', () => mask.close('cancel'));
  $('mHelp').addEventListener('click', () => helpDialog('syntax'));
  $('maskForm').addEventListener('submit', (e) => {
    const sim = doc.sims[doc.current];
    const text = $('mText').value, cs = $('mCase').checked;
    let compiled;
    try { compiled = P.compile(text, cs); } catch (err) { e.preventDefault(); $('mErr').textContent = err.message; return; }
    const bad = compiled.vars.filter((v) => v.isStart && Number.isNaN(P.parseNumber(lookupStart(v))));
    if (bad.length) { e.preventDefault(); $('mErr').textContent = `Die Startwerte sind nicht in Ordnung! (${bad[0].name})`; return; }
    const reps = Math.floor(P.parseNumber($('mReps').value));
    if (!(reps >= 1)) { e.preventDefault(); $('mErr').textContent = 'Die Anzahl der Wiederholungen muss mindestens 1 sein.'; return; }
    const name = $('mName').value.trim();
    if (!name) { e.preventDefault(); $('mErr').textContent = 'Geben Sie der Simulation einen Namen!'; $('mName').focus(); return; }
    if (doc.sims.some((s, i) => i !== doc.current && s.name === name)) { e.preventDefault(); $('mErr').textContent = 'Eine andere Simulation hat bereits diesen Namen.'; return; }
    const values = {};
    compiled.vars.forEach((v) => { if (v.isStart) { const val = lookupStart(v); values[v.key] = val === '' ? '0' : val; } });
    const oldName = sim.name;
    Object.assign(sim, { name, text, caseSensitive: cs, reps, startValues: values });
    if (oldName !== name) [doc.view.y, doc.view.table].forEach((l) => l.forEach((y) => { if (y.sim === oldName) y.sim = name; }));
    if (!doc.view.y.length && !compiled.vars.some((v) => v.name.toLowerCase() === String(doc.view.x).toLowerCase())) doc.view.x = compiled.vars.length ? compiled.vars[0].name : ''; // Original: erste Variable
    persist();
    runAll();
  });

  // ---------- Sprachliches / Grafisches Modell (aus den Gleichungen erzeugt) ----------
  let maskMode = 'text';
  function setMaskMode(mode) {
    maskMode = mode;
    $('mTabText').hidden = mode === 'text';
    $('mTabVerbal').classList.toggle('active', mode === 'verbal');
    $('mTabGraphic').classList.toggle('active', mode === 'graphic');
    document.querySelector('.editor-wrap').hidden = mode !== 'text';
    $('mGraphic').hidden = mode === 'text';
    if (mode !== 'text') renderModelView();
  }
  $('mTabText').addEventListener('click', () => setMaskMode('text'));
  $('mTabVerbal').addEventListener('click', () => setMaskMode(maskMode === 'verbal' ? 'text' : 'verbal'));
  $('mTabGraphic').addEventListener('click', () => setMaskMode(maskMode === 'graphic' ? 'text' : 'graphic'));
  function renderModelView() { if (maskMode === 'verbal') renderVerbalModel(); else renderGraphicModel(); }
  function renderVerbalModel() {
    const rows = [];
    $('mText').value.split('\n').forEach((raw) => {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) return;
      line.split(/[:;](?!=)/).map((x) => x.trim()).filter(Boolean).forEach((st) => {
        let m;
        if ((m = /^if\s+(.+?)\s+then\s+(.+)$/i.exec(st))) { rows.push(['', `Wenn ${m[1]}, dann`, m[2]]); return; }
        if (!(m = /^([\wÀ-ɏ]+)\s*:?=\s*(.+)$/.exec(st))) { rows.push(['', '', st]); return; }
        const [, lhs, rhs] = m;
        const esc2 = lhs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let mm;
        if ((mm = new RegExp(`^${esc2}\\s*\\+\\s*(.+)$`, 'i').exec(rhs))) rows.push([lhs, 'nimmt zu um', mm[1]]);
        else if ((mm = new RegExp(`^${esc2}\\s*-\\s*(.+)$`, 'i').exec(rhs))) rows.push([lhs, 'nimmt ab um', mm[1]]);
        else if (/^[-+]?[\d.,]+(E[-+]?\d+)?$/i.test(rhs)) rows.push([lhs, 'ist konstant gleich', rhs]);
        else if ((mm = /^([-+]?[\d.,]+)\s*\*\s*([\wÀ-ɏ]+)$/.exec(rhs)) || (mm = /^([\wÀ-ɏ]+)\s*\*\s*([\wÀ-ɏ]+)$/.exec(rhs))) rows.push([lhs, 'ist proportional zu', `${mm[2]}  (Faktor ${mm[1]})`]);
        else rows.push([lhs, 'ist gleich', rhs]);
      });
    });
    $('mGraphic').innerHTML = `<p class="gm-note">Sprachliches Modell – aus den Gleichungen erzeugt (nur Ansicht).</p><table class="verbal">${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="pred">${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>`;
  }
  function renderGraphicModel() {
    const vars = maskState.vars || [], edges = maskState.edges || [];
    if (!vars.length) { $('mGraphic').innerHTML = '<p class="gm-note">Noch keine Gleichungen eingegeben.</p>'; return; }
    const selfLoop = new Set(edges.filter(([a, b]) => a === b).map(([a]) => a));
    const assignedSet = new Set(edges.map(([, b]) => b));
    const kind = vars.map((v, i) => (selfLoop.has(i) ? 'state' : v.isStart && !assignedSet.has(i) ? 'param' : 'aux'));
    vars.forEach((v, i) => { if (kind[i] === 'aux' && edges.some(([a, b]) => a === i && kind[b] === 'state')) kind[i] = 'rate'; });
    const cols = { param: [], aux: [], rate: [], state: [] };
    vars.forEach((v, i) => cols[kind[i]].push(i));
    const titles = { param: 'Konstanten', aux: 'Zwischengrößen', rate: 'Veränderungsraten', state: 'Zustandsgrößen' };
    const used = ['param', 'aux', 'rate', 'state'].filter((k) => cols[k].length);
    const cw = 150, rh = 46, W2 = used.length * cw + 20, H2 = Math.max(...used.map((k) => cols[k].length)) * rh + 50;
    const posOf = {};
    used.forEach((k, ci) => cols[k].forEach((vi, ri) => { posOf[vi] = { x: 20 + ci * cw + 55, y: 58 + ri * rh, k }; }));
    let svg = `<svg viewBox="0 0 ${W2} ${H2}" width="${W2}" height="${H2}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#444"/></marker></defs>`;
    used.forEach((k, ci) => { svg += `<text x="${20 + ci * cw + 55}" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="#333">${titles[k]}</text>`; });
    edges.forEach(([a, b]) => {
      if (a === b) return; const p = posOf[a], q = posOf[b]; if (!p || !q) return;
      const mx = (p.x + q.x) / 2;
      svg += `<path d="M${p.x + 30} ${p.y} C${mx} ${p.y} ${mx} ${q.y} ${q.x - 32} ${q.y}" fill="none" stroke="${p.k === 'rate' && q.k === 'state' ? '#1f4fd6' : '#999'}" stroke-width="${p.k === 'rate' && q.k === 'state' ? 2.5 : 1.2}" marker-end="url(#ah)"/>`;
    });
    vars.forEach((v, i) => {
      const p = posOf[i]; if (!p) return;
      const label = esc(v.name.length > 11 ? v.name.slice(0, 10) + '…' : v.name);
      if (p.k === 'state') svg += `<rect x="${p.x - 32}" y="${p.y - 14}" width="64" height="28" fill="#cfe0ff" stroke="#1f4fd6"/>`;
      else if (p.k === 'rate') svg += `<path d="M${p.x - 30} ${p.y}L${p.x - 10} ${p.y - 12}L${p.x + 10} ${p.y + 12}L${p.x + 30} ${p.y}" fill="none" stroke="#c07000" stroke-width="2"/><circle cx="${p.x}" cy="${p.y}" r="12" fill="#ffe4b8" stroke="#c07000"/>`;
      else svg += `<ellipse cx="${p.x}" cy="${p.y}" rx="32" ry="14" fill="${p.k === 'param' ? '#eee' : '#e6f5e6'}" stroke="${p.k === 'param' ? '#666' : '#2a8a2a'}"/>`;
      svg += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="12" fill="#000">${label}</text>`;
    });
    $('mGraphic').innerHTML = `<p class="gm-note">Grafisches Modell – aus den Gleichungen erzeugt (nur Ansicht). Zustandsgrößen (Kästen), Veränderungsraten (Ventile), Konstanten (Ellipsen).</p><div class="gm-scroll">${svg}</div></svg>`;
  }

  // ================================================================
  // Dialoge
  // ================================================================
  const gen = $('genDlg');
  const dlgStack = [];
  function dialog(title, bodyHtml, onOk, { okOnly = false, wide = false, help = null, onOpen = null } = {}) {
    if (gen.open) { dlgStack.push(null); }
    $('genTitle').textContent = title;
    $('genBody').innerHTML = bodyHtml;
    gen.classList.toggle('wide', wide);
    $('genButtons').querySelector('[value=cancel]').hidden = okOnly;
    const hb = $('genHelp'); hb.hidden = !help; hb.onclick = help ? () => helpDialog(help) : null;
    gen.returnValue = '';
    gen.onclose = () => { if (gen.returnValue === 'ok' && onOk) onOk($('genBody')); };
    if (!gen.open) gen.showModal();
    if (onOpen) onOpen($('genBody'));
  }
  function alertDialog(title, msg) { dialog(title, `<p>${esc(msg)}</p>`, null, { okOnly: true }); }
  const colorSelect = (name, val) => {
    const known = NAMED_COLORS.some(([, c]) => c === (val || '').toLowerCase());
    return `<select name="${name}" class="colsel">${NAMED_COLORS.map(([n, c]) => `<option value="${c}" ${c === (val || '').toLowerCase() ? 'selected' : ''} style="background:${c};color:${['#000000', '#000080', '#800000', '#800080', '#008080', '#008000', '#808000', '#808080', '#0000ff'].includes(c) ? '#fff' : '#000'}">${n}</option>`).join('')}${known ? '' : `<option value="${val}" selected>benutzerdefiniert</option>`}</select>`;
  };
  const numIn = (name, val, extra = '') => `<input name="${name}" inputmode="decimal" value="${val === null || val === undefined || val === '' ? '' : esc(typeof val === 'number' ? fmtN(val, 8) : val)}" ${extra}>`;
  const field = (b, n) => b.querySelector(`[name="${n}"]`);

  function axisDialog(which) {
    const ax = doc.view.axes[which];
    if (doc.view.autoScale) redraw(); // aktuelle Werte übernehmen
    dialog(`${which}-Achse`, `
      <fieldset><legend></legend>
        <div class="form-grid">
          <label><u>V</u>on ${numIn('from', ax.from, 'title="Beginn der Skalierung"')}</label>
          <label><u>B</u>is ${numIn('to', ax.to, 'title="Ende der Skalierung"')}</label>
          <label><u>L</u>age ${numIn('pos', ax.pos, 'title="Position auf der anderen Achse" placeholder="automatisch"')}</label>
          <label class="chk"><input type="checkbox" name="log" ${ax.log ? 'checked' : ''}> L<u>o</u>garithmische Skala</label>
        </div>
      </fieldset>
      <fieldset><legend>Striche</legend>
        <div class="form-grid">
          <label>Ab<u>s</u>tand ${numIn('step', ax.step || '', 'title="gemessen in Einheiten der Achse" placeholder="automatisch"')}</label>
          <label><u>K</u>leine ${numIn('minor', ax.minor ?? 4, 'title="Anzahl der Striche zwischen zwei großen Strichen."')}</label>
        </div>
      </fieldset>
      <fieldset><legend>Optionen</legend>
        <label class="chk"><input type="checkbox" name="grid" ${ax.grid ? 'checked' : ''} title="Verlängerung der großen Striche"> <u>H</u>ilfslinien</label>
        <div class="form-row"><span>H<u>i</u>lfslinienattribute:</span> ${colorSelect('gridColor', ax.gridColor)}
          <select name="gridStyle">${LINE_STYLES.map(([v, l]) => `<option value="${v}" ${v === (ax.gridStyle || 'dash') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </fieldset>
      <label class="chk"><input type="checkbox" name="visible" ${ax.visible !== false ? 'checked' : ''}> sichtbar</label>`,
    (b) => {
      const from = P.parseNumber(field(b, 'from').value), to = P.parseNumber(field(b, 'to').value);
      const step = P.parseNumber(field(b, 'step').value), minor = P.parseNumber(field(b, 'minor').value);
      const posRaw = field(b, 'pos').value.trim();
      const log = field(b, 'log').checked;
      if (log && !(from > 0)) { alertDialog('Achse', 'Logarithmische Skala nur mit positiven Achsenwerten erlaubt!'); return; }
      if (field(b, 'step').value.trim() && !(step > 0)) { alertDialog('Achse', 'Achsenfortschritt muss größer als 0 sein!'); return; }
      if (!(to > from)) { alertDialog('Achse', '„Bis“ muss größer als „Von“ sein.'); return; }
      // Manuelle Skalierung: alle Achsen fest
      if (doc.view.autoScale) doc.view.autoScale = false;
      Object.assign(ax, { from, to, log, step: step > 0 ? step : 0, minor: minor >= 0 ? Math.round(minor) : 4, pos: posRaw === '' ? null : P.parseNumber(posRaw),
        grid: field(b, 'grid').checked, gridColor: field(b, 'gridColor').value, gridStyle: field(b, 'gridStyle').value, visible: field(b, 'visible').checked });
      persist(); syncOptions(); redraw();
    }, { help: 'graph' });
  }

  function curveDialog(ref) {
    const idx = doc.view.y.findIndex((y) => sameRef(y, ref));
    const s = styleOf(ref, Math.max(0, idx));
    dialog(`Kurven-Parameter – ${refLabel(ref)}`, `
      <div class="two-col">
        <fieldset><legend>Linien</legend>
          <div class="form-row">Stil: <select name="style">${LINE_STYLES.map(([v, l]) => `<option value="${v}" ${v === s.style ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="form-row">Dicke: <input name="width" type="number" min="1" max="20" value="${s.width}" title="in Pixel"></div>
          <div class="form-row">Farbe: ${colorSelect('color', s.color)}</div>
          <label class="chk" title="quadratische Interpolation"><input type="checkbox" name="splines" ${s.splines ? 'checked' : ''}> Splines</label>
        </fieldset>
        <fieldset><legend>Punkte</legend>
          <div class="form-row">Größe <input name="ptSize" type="number" min="1" max="40" value="${s.ptSize}" title="gemessen in Pt."></div>
          <div class="form-row">Farbe: ${colorSelect('ptColor', s.ptColor)}</div>
          <div class="radio-group" title="Form">${[['cross', 'Kreuz'], ['circle', 'Kreis'], ['disc', 'Scheibe']].map(([v, l]) => `<label><input type="radio" name="ptForm" value="${v}" ${v === s.ptForm ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        </fieldset>
      </div>
      <fieldset><legend>Typ</legend><div class="radio-group">${[['line', 'Linien-Diagramm'], ['point', 'Punkt-Diagramm'], ['pointline', 'Punkt-Linien-Diagramm'], ['bar', 'Balken-Diagramm']].map(([v, l]) => `<label><input type="radio" name="type" value="${v}" ${v === s.type ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Animation</legend>
        <div class="anim-row">
          <canvas class="anim-preview" width="56" height="56"></canvas>
          <div>
            <label class="chk"><input type="checkbox" name="animOn" ${s.anim.on ? 'checked' : ''}> an</label>
            <div class="form-row">Bild: <select name="animImg">${ANIM_IMAGES.map(([v, l]) => `<option value="${v}" ${v === s.anim.img ? 'selected' : ''}>${l}</option>`).join('')}${s.anim.img && s.anim.img.startsWith('data:') ? '<option value="custom" selected>eigenes Bild</option>' : ''}</select>
              <button type="button" class="btn" name="animOpen" title="Bild auswählen">Öffnen</button></div>
          </div>
        </div>
        <div class="two-col">
          <div class="radio-group"><b>Entstehung der Kurve</b>${[['invisible', 'unsichtbar'], ['immediate', 'sofort zeichnen'], ['animated', 'animiert zeichnen']].map(([v, l]) => `<label><input type="radio" name="build" value="${v}" ${v === s.anim.build ? 'checked' : ''}> ${l}</label>`).join('')}</div>
          <div class="radio-group"><b>Animationstyp</b>${[['linear', 'linear'], ['cyclic', 'zyklisch'], ['autoreverse', 'autoreverse']].map(([v, l]) => `<label><input type="radio" name="atype" value="${v}" ${v === s.anim.type ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        </div>
      </fieldset>`,
    (b) => {
      let img = field(b, 'animImg').value;
      if (img === 'custom') img = b.dataset.customImg || s.anim.img;
      doc.view.styles[refKey(ref)] = {
        style: field(b, 'style').value, width: Math.max(1, +field(b, 'width').value || 1), color: field(b, 'color').value, splines: field(b, 'splines').checked,
        ptSize: Math.max(1, +field(b, 'ptSize').value || 4), ptColor: field(b, 'ptColor').value, ptForm: b.querySelector('[name=ptForm]:checked').value,
        type: b.querySelector('[name=type]:checked').value,
        anim: { on: field(b, 'animOn').checked, img, build: b.querySelector('[name=build]:checked').value, type: b.querySelector('[name=atype]:checked').value },
      };
      persist(); redraw();
    }, {
      wide: true, help: 'graph',
      onOpen: (b) => {
        const pv = b.querySelector('.anim-preview');
        const paint = () => { const c2 = pv.getContext('2d'); c2.clearRect(0, 0, 56, 56); let v = field(b, 'animImg').value; if (v === 'custom') v = b.dataset.customImg || s.anim.img; drawAnimImage(c2, v, 28, 28); };
        paint();
        field(b, 'animImg').addEventListener('change', paint);
        field(b, 'animOpen').addEventListener('click', () => pickImage((url) => {
          b.dataset.customImg = url;
          const sel = field(b, 'animImg');
          if (![...sel.options].some((o) => o.value === 'custom')) sel.add(new Option('eigenes Bild', 'custom'));
          sel.value = 'custom'; field(b, 'animOn').checked = true;
          cachedImage(url).onload = paint; paint();
        }));
      },
    });
  }

  function graphDialog() {
    const g = doc.view.graph;
    dialog('Eigenschaften des Schaubilds', `
      <div class="form-row"><span><u>F</u>ensterhintergrund</span> ${colorSelect('winBg', g.winBg)}</div>
      <fieldset><legend>Schaubild</legend>
        <div class="form-grid">
          <label><u>B</u>reite (%) <input name="w" type="number" min="10" max="100" value="${g.w}" title="100=ganzes Fenster"></label>
          <label><u>H</u>öhe (%) <input name="h" type="number" min="10" max="100" value="${g.h}" title="100=ganzes Fenster"></label>
          <label><u>L</u>inks (%) <input name="l" type="number" min="0" max="90" value="${g.l}" title="0=links 100=rechts"></label>
          <label><u>O</u>ben (%) <input name="t" type="number" min="0" max="90" value="${g.t}" title="0=oben 100=unten"></label>
          <label>F<u>a</u>rbe ${colorSelect('plotBg', g.plotBg)}</label>
          <label>Timer-Intervall (ms) <input name="timer" type="number" min="1" max="2000" value="${g.timer}"></label>
        </div>
        <label class="chk"><input type="checkbox" name="legend" ${doc.view.legend ? 'checked' : ''}> Le<u>g</u>ende</label>
        <div class="form-row"><button type="button" class="btn" data-axis="x" title="Skalierung ändern"><u>x</u>-Achse</button><button type="button" class="btn" data-axis="y" title="Skalierung ändern"><u>y</u>-Achse</button><button type="button" class="btn" data-axis="z" title="Skalierung ändern" ${doc.view.threeD ? '' : 'disabled'}><u>z</u>-Achse</button></div>
      </fieldset>`,
    (b) => {
      const num = (n, d, lo, hi) => Math.min(hi, Math.max(lo, +field(b, n).value || d));
      Object.assign(g, { winBg: field(b, 'winBg').value, plotBg: field(b, 'plotBg').value, w: num('w', 100, 10, 100), h: num('h', 100, 10, 100), l: num('l', 0, 0, 90), t: num('t', 0, 0, 90), timer: num('timer', 20, 1, 2000) });
      if (g.l + g.w > 100) g.l = 100 - g.w;
      if (g.t + g.h > 100) g.t = 100 - g.h;
      doc.view.legend = field(b, 'legend').checked;
      persist(); syncOptions(); redraw();
    }, {
      help: 'graph',
      onOpen: (b) => b.querySelectorAll('[data-axis]').forEach((btn) => btn.addEventListener('click', () => { gen.close('cancel'); setTimeout(() => axisDialog(btn.dataset.axis), 0); })),
    });
  }

  function numberFormatDialog(which) {
    const f = which === 'table' ? doc.view.tableFmt : doc.view.axisFmt;
    dialog('Zahlenformat', `
      <div class="form-row">Nachkommastellen: <input name="dec" type="number" min="0" max="15" value="${f.dec ?? ''}" placeholder="${which === 'axis' ? 'automatisch' : ''}"></div>
      <label class="chk" title="Wissenschaftliche Darstellung mit Exponent"><input type="checkbox" name="norm" ${f.norm ? 'checked' : ''}> Normdarstellung</label>`,
    (b) => {
      const raw = field(b, 'dec').value.trim();
      f.dec = raw === '' ? (which === 'table' ? 4 : null) : Math.max(0, Math.min(15, Math.round(+raw)));
      f.norm = field(b, 'norm').checked;
      persist(); redraw();
    }, { help: 'table' });
  }

  function rotateDialog() {
    const o = ui.sel ? (ui.sel.kind === 'text' ? doc.view.texts[ui.sel.i] : doc.view.images[ui.sel.i]) : null;
    if (!o) { alertDialog('Drehen', 'Markieren Sie zuerst einen Text oder eine Grafik (Pfeil-Werkzeug).'); return; }
    dialog('Drehen', `<div class="form-row">Winkel: <input name="rot" inputmode="decimal" value="${fmtN(o.rot || 0)}" title="in Grad"> °</div>`, (b) => {
      const v = P.parseNumber(field(b, 'rot').value);
      if (Number.isFinite(v)) { o.rot = v; persist(); drawGraph(); }
    });
  }

  function pickImage(cb) {
    const inp = $('imageInput');
    inp.onchange = () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      if (!f.type.startsWith('image/')) { alertDialog('Grafik', 'Diese Datei ist keine Bitmap-Datei.'); return; }
      const rd = new FileReader();
      rd.onload = () => cb(rd.result);
      rd.readAsDataURL(f);
    };
    inp.click();
  }
  function insertImage() {
    showTab('graph');
    pickImage((url) => {
      const im = cachedImage(url);
      const place = () => {
        const s = Math.min(1, (W * 0.4) / im.naturalWidth, (H * 0.4) / im.naturalHeight);
        doc.view.images.push({ src: url, x: 0.3, y: 0.3, w: im.naturalWidth * s, h: im.naturalHeight * s, keepRatio: true, rot: 0 });
        ui.sel = { kind: 'image', i: doc.view.images.length - 1 };
        setTool('select'); persist(); drawGraph();
      };
      if (im.complete && im.naturalWidth) place(); else im.addEventListener('load', place, { once: true });
    });
  }
  function imageDialog(i) {
    if (i === undefined) i = ui.sel && ui.sel.kind === 'image' ? ui.sel.i : -1;
    const g = doc.view.images[i];
    if (!g) { alertDialog('Grafik', 'Markieren Sie zuerst eine Grafik (Pfeil-Werkzeug) oder fügen Sie eine über Einfügen › Grafik ein.'); return; }
    const cm = (px) => fmtN(px / PX_PER_CM, 4);
    dialog('Grafik', `
      <fieldset><legend>Maße</legend><div class="form-grid">
        <label>x= (cm) ${numIn('x', cm(g.x * W), 'title="Position auf dem Blatt"')}</label>
        <label>y= (cm) ${numIn('y', cm(g.y * H), 'title="Position auf dem Blatt"')}</label>
        <label>Breite: (cm) ${numIn('w', cm(g.w), 'title="x-Richtung"')}</label>
        <label>Höhe: (cm) ${numIn('h', cm(g.h), 'title="y-Richtung"')}</label>
      </div>
      <label class="chk"><input type="checkbox" name="keep" ${g.keepRatio !== false ? 'checked' : ''}> Seitenverhältnis behalten</label></fieldset>
      <label class="chk"><input type="checkbox" name="rot90" ${g.rot90 ? 'checked' : ''}> Um 90° drehen</label>
      <label class="chk"><input type="checkbox" name="flipH" ${g.flipH ? 'checked' : ''}> Spiegeln: Links &lt;--&gt; Rechts</label>
      <label class="chk"><input type="checkbox" name="flipV" ${g.flipV ? 'checked' : ''}> Spiegeln: Oben &lt;--&gt; Unten</label>
      <label class="chk"><input type="checkbox" name="gray" ${g.gray ? 'checked' : ''}> Graustufen</label>`,
    (b) => {
      const v = (n) => P.parseNumber(field(b, n).value) * PX_PER_CM;
      const keep = field(b, 'keep').checked;
      let nw = v('w'), nh = v('h');
      if (keep && nw > 0 && Math.abs(nw - g.w) > 0.5) nh = (nw * g.h) / g.w;
      else if (keep && nh > 0 && Math.abs(nh - g.h) > 0.5) nw = (nh * g.w) / g.h;
      Object.assign(g, { x: v('x') / W, y: v('y') / H, w: nw > 0 ? nw : g.w, h: nh > 0 ? nh : g.h, keepRatio: keep,
        rot90: field(b, 'rot90').checked, flipH: field(b, 'flipH').checked, flipV: field(b, 'flipV').checked, gray: field(b, 'gray').checked });
      persist(); drawGraph();
    }, { help: 'graph' });
  }
  function textDialog() {
    const t = selText();
    if (!t) { alertDialog('Text', 'Markieren Sie zuerst einen Text (Pfeil-Werkzeug) oder schreiben Sie einen mit dem Text-Werkzeug.'); return; }
    dialog('Text', `
      <label>Text<textarea name="text" rows="3">${esc(t.text)}</textarea></label>
      <div class="form-grid">
        <label>Schriftart <select name="font">${[...$('fontFamily').options].map((o) => `<option ${o.value === t.font ? 'selected' : ''}>${esc(o.value)}</option>`).join('')}</select></label>
        <label>Größe <input name="size" type="number" min="4" max="200" value="${t.size || 12}"></label>
        <label>Farbe ${colorSelect('color', t.color || '#000000')}</label>
        <label>Winkel (°) ${numIn('rot', t.rot || 0)}</label>
      </div>
      <div class="form-row"><label class="chk"><input type="checkbox" name="bold" ${t.bold ? 'checked' : ''}> fett</label><label class="chk"><input type="checkbox" name="italic" ${t.italic ? 'checked' : ''}> kursiv</label><label class="chk"><input type="checkbox" name="underline" ${t.underline ? 'checked' : ''}> unterstrichen</label></div>
      <p class="hint">Hochstellen: ^{…}, tiefstellen: _{…}</p>`,
    (b) => {
      Object.assign(t, { text: field(b, 'text').value, font: field(b, 'font').value, size: Math.max(4, +field(b, 'size').value || 12), color: field(b, 'color').value,
        rot: P.parseNumber(field(b, 'rot').value) || 0, bold: field(b, 'bold').checked, italic: field(b, 'italic').checked, underline: field(b, 'underline').checked });
      if (!t.text.trim()) { doc.view.texts.splice(ui.sel.i, 1); ui.sel = null; }
      persist(); drawGraph();
    });
  }

  // ---------- Drucken ----------
  function printDialog() {
    dialog('Drucken...', `
      <fieldset title="Was soll gedruckt werden?"><legend>Drucken</legend>
        <label class="chk"><input type="checkbox" name="prog" checked> Programm</label>
        <label class="chk"><input type="checkbox" name="start" checked> Startwerte</label>
        <label class="chk"><input type="checkbox" name="graph" ${ui.tab === 'graph' ? 'checked' : ''}> Schaubild</label>
        <label class="chk"><input type="checkbox" name="table" ${ui.tab === 'table' ? 'checked' : ''}> Tabelle</label>
        <label class="chk"><input type="checkbox" name="verbal"> sprachlich</label>
        <label class="chk"><input type="checkbox" name="graphic"> grafisch</label>
      </fieldset>
      <fieldset title="Rand auf dem Papier"><legend>Rand</legend><div class="form-grid">
        <label>links (cm) ${numIn('mx', '2,0')}</label><label>oben (cm) ${numIn('my', '2,0')}</label></div></fieldset>
      <label class="chk"><input type="checkbox" name="bg" checked> Hintergrundfarbe drucken</label>`,
    (b) => {
      const o = (n) => field(b, n).checked;
      const mx = P.parseNumber(field(b, 'mx').value) || 2, my = P.parseNumber(field(b, 'my').value) || 2;
      const area = $('printArea');
      let html = '';
      doc.sims.forEach((s, si) => {
        if (!(o('prog') || o('start') || o('verbal') || o('graphic'))) return;
        html += `<h2>${esc(s.name)}</h2>`;
        if (o('prog')) html += `<h3>Programm (Wiederhole ${s.reps} mal)</h3><pre>${esc(s.text)}</pre>`;
        if (o('start')) {
          const r = results[si];
          const starts = r ? r.vars.filter((v) => v.isStart) : [];
          html += `<h3>Startwerte</h3><table class="pt">${starts.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(s.startValues[v.key] ?? '0')}</td></tr>`).join('')}</table>`;
        }
        if (o('verbal') || o('graphic')) {
          const keep = { mode: maskMode, st: maskState, text: $('mText').value };
          const r = results[si];
          maskState = { vars: r.vars, edges: r.edges, values: s.startValues };
          $('mText').value = s.text;
          if (o('verbal')) { maskMode = 'verbal'; renderVerbalModel(); html += `<h3>Sprachliches Modell</h3>${$('mGraphic').innerHTML}`; }
          if (o('graphic')) { maskMode = 'graphic'; renderGraphicModel(); html += `<h3>Grafisches Modell</h3>${$('mGraphic').innerHTML}`; }
          maskMode = keep.mode; maskState = keep.st; $('mText').value = keep.text;
        }
      });
      if (o('graph')) {
        const wasTab = ui.tab;
        if (wasTab !== 'graph') { showTab('graph'); }
        const off = document.createElement('canvas'); off.width = W * 2; off.height = H * 2;
        const c2 = off.getContext('2d'); c2.scale(2, 2);
        const bg = doc.view.graph.winBg, pb = doc.view.graph.plotBg;
        if (!o('bg')) { doc.view.graph.winBg = '#ffffff'; doc.view.graph.plotBg = '#ffffff'; }
        drawGraph(c2, W, H, true);
        doc.view.graph.winBg = bg; doc.view.graph.plotBg = pb;
        html += `<img src="${off.toDataURL('image/png')}" alt="Schaubild" style="width:100%">`;
        if (wasTab !== 'graph') showTab(wasTab);
      }
      if (o('table')) {
        const cols = tableColumns();
        if (cols.length) {
          const n = Math.max(...cols.map((c) => c.n));
          html += '<h3>Tabelle</h3><table class="pt"><tr><th></th>' + cols.map((c) => `<th>${esc(c.label)}</th>`).join('') + '</tr>';
          for (let i = 0; i < n && i < 5000; i++) html += `<tr><td>${(i + 1) * cols[0].stride}</td>${cols.map((c) => `<td>${i < c.n ? fmtTable(c.a[i]) : ''}</td>`).join('')}</tr>`;
          html += '</table>';
        }
      }
      area.innerHTML = html;
      area.style.padding = `${my}cm 0 0 ${mx}cm`;
      document.body.classList.add('printing');
      setTimeout(() => window.print(), 80);
    }, { help: 'usage' });
  }
  window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); $('printArea').innerHTML = ''; });

  // ---------- Hilfe ----------
  const HELP = {
    syntax: ['Eingabe der Simulation', `
      <p>Alle Anweisungen werden in einer Schleife von oben nach unten durchlaufen und so oft wiederholt, wie unter „Wiederhole … mal“ angegeben (Kleinschrittverfahren). Nach jedem Durchlauf werden die Werte aller Größen gespeichert.</p>
      <ul>
        <li>Zuweisung: <code>v=v+a*dt</code> oder <code>v:=v+a*dt</code>. Mehrere Anweisungen in einer Zeile mit <code>:</code> oder <code>;</code> trennen. Eine Anweisung darf nicht über mehrere Zeilen gehen.</li>
        <li>Kommentare: <code>// …</code></li>
        <li>Größen, die gelesen werden, bevor sie berechnet werden, erscheinen rechts als <b>Startwerte</b>. Zahlen mit Dezimalkomma (<code>0,01</code>) oder Exponent (<code>1E-5</code>).</li>
        <li>Rechenzeichen <code>+ - * / ^</code> und Klammern.</li>
        <li>Funktionen: <code>sqr</code> (Quadrat), <code>sqrt</code> (Wurzel), <code>sin cos tan arcsin arccos arctan</code> (Bogenmaß), <code>ln exp</code>, <code>frac</code> (Nachkommateil), <code>int</code> (ganzzahliger Teil), <code>abs</code> (Betrag), <code>random</code> (Zufallszahl).</li>
        <li>Bedingungen: <code>if s&lt;=1000 then A=25; c_W=1,35</code> – alles nach <code>then</code> bis zum Zeilenende gehört zur Bedingung (optional <code>else</code>). Vergleiche <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, Verknüpfungen <code>and or not</code>.</li>
        <li>Keine eingebauten Konstanten: <code>pi</code>, <code>e</code>, <code>g</code> … als Startwert eintragen.</li>
        <li><b>Groß-, Kleinschreibung</b> anhaken, wenn z. B. <code>A</code> (Fläche) und <code>a</code> (Beschleunigung) verschiedene Größen sein sollen. Ohne Haken werden alle Namen in Großbuchstaben angezeigt.</li>
      </ul>`],
    graph: ['Schaubild', `
      <ul>
        <li>Rechts unter <b>x-Achse</b> die Größe für die Rechtsachse wählen, in der Liste <b>y-Achse</b> eine oder mehrere Größen anklicken.</li>
        <li><b>Kurve anklicken</b>: Kurven-Parameter (Linienattribute, Punkte, Diagrammtyp, Animation).</li>
        <li><b>Achse anklicken</b>: Von, Bis, Lage, logarithmische Skala, Abstand der Striche, Hilfslinien.</li>
        <li>Neben die Kurve klicken zeigt den Wert des nächsten Punktes.</li>
        <li><b>3-dimensional</b>: x-Achse und y-Achse wählen, die Liste gibt die z-Achse (Hochachse) an. Mit der Maus drehen.</li>
        <li><b>getrennte Schaubilder</b>: jede Größe in einem eigenen Schaubild.</li>
        <li>Rechner-Knopf: Wiederholungen verdoppeln und weiter rechnen.</li>
        <li>Animation: Kurve anklicken, unter „Animation“ <i>an</i> ankreuzen und eine Grafik wählen, dann <i>Animation starten</i>.</li>
      </ul>`],
    table: ['Tabelle', '<p>In der Tabellenansicht wählt die Liste rechts die Spalten aus. Ein Klick in die Tabelle stellt das Zahlenformat ein (Nachkommastellen, Normdarstellung). „Nach Excel exportieren“ speichert eine CSV-Datei, die Excel öffnen kann.</p>'],
    usage: ['Bedienung', `
      <ul>
        <li><b>Datei</b>: Neu, Öffnen (Moebius-Dateien *.prg und *.json), Beispiel öffnen, Speichern, Nach Excel exportieren, Drucken.</li>
        <li><b>Bearbeiten</b>: Ausschneiden, Kopieren, Einfügen, Löschen von Texten und Grafiken; ohne Auswahl kopiert „Kopieren“ das Schaubild bzw. die Tabelle in die Zwischenablage. Drehen; Simulation (Eingabe).</li>
        <li><b>Ansicht</b>: Schaubild/Tabelle, sofort anzeigen, automatisch skalieren, Animation, neu zeichnen.</li>
        <li><b>Einfügen</b>: neue Simulation, Kopie der Simulation, Grafik.</li>
        <li><b>Format</b>: Text, Grafik, Zahlen an Achsen, Legende, Schaubild, Zahlen in Tabelle.</li>
        <li>Werkzeuge: Pfeil (Objekte bearbeiten, Texte und Grafiken verschieben), T (Text schreiben); F K U, x², x₂, Schriftgröße und Schriftart.</li>
        <li>Tastatur: F1 Hilfe · F2 Simulation · Strg+O/S/P · Strg+X/C/V · Entf</li>
      </ul>`],
    intro: ['Einführung in Moebius', `
      <p><b>Moebius</b> = <b>Mo</b>delle <b>e</b>infach <b>bi</b>lden <b>u</b>nd <b>s</b>imulieren.</p>
      <p>Größen, die sich ständig ändern, werden im <b>Kleinschrittverfahren</b> berechnet: Der betrachtete Zeitraum wird in kleine Zeitschritte <code>dt</code> zerlegt. In jedem Schritt wird aus der Änderungsrate die neue Zustandsgröße berechnet, z. B.</p>
      <pre>a=F/m
v=v+a*dt
s=s+v*dt
t=t+dt</pre>
      <p><b>Zustandsgrößen</b> (s, v) ändern sich mit der Zeit, <b>Änderungsraten</b> (a) bestimmen die Änderung pro Zeiteinheit, <b>Einflussgrößen</b> (m, g, c_W …) sind Konstanten.</p>
      <p>Faustregel: dt so klein wie nötig – wenn die Ergebnisse ungenau sind, dt um eine Kommastelle verkleinern und die Wiederholungen erhöhen.</p>`],
    school: ['Moebius im Unterricht', `
      <ul>
        <li>Läuft im Browser auf Computer, Tablet und Handy; Dateien bleiben auf dem Gerät.</li>
        <li>Vorhandene Moebius-Dateien (*.prg) lassen sich öffnen und wieder als *.prg speichern.</li>
        <li>Beispiele über Datei › Beispiel öffnen.</li>
      </ul>`],
  };
  function helpDialog(topic = 'syntax') {
    const tabs = [['syntax', 'Eingabe'], ['graph', 'Schaubild'], ['table', 'Tabelle'], ['usage', 'Bedienung'], ['intro', 'Einführung'], ['school', 'Unterricht']];
    const show = (b, t) => {
      b.querySelector('.help-body').innerHTML = HELP[t][1];
      b.querySelectorAll('.help-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.t === t));
    };
    dialog('Hilfe', `<div class="help-tabs">${tabs.map(([t, l]) => `<button type="button" class="mtab" data-t="${t}">${l}</button>`).join('')}</div><div class="help help-body"></div>`, null, {
      okOnly: true, wide: true,
      onOpen: (b) => { show(b, topic); b.querySelectorAll('.help-tabs button').forEach((x) => x.addEventListener('click', () => show(b, x.dataset.t))); },
    });
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
  function baseName() { return (doc.fileName || doc.sims[0].name || 'Simulation').replace(/\.(prg|json)$/i, ''); }
  function saveDoc(asName) {
    let name = asName || doc.fileName || '';
    if (!/\.(prg|json)$/i.test(name)) name = `${baseName()}.prg`;
    if (/\.json$/i.test(name)) {
      download(name, new Blob([JSON.stringify(serializeDoc(), null, 2)], { type: 'application/json' }));
    } else {
      if (!window.MoebiusPrgWriter) { alertDialog('Speichern', 'Speichern als .prg ist nicht verfügbar.'); return; }
      let bytes;
      try { bytes = window.MoebiusPrgWriter.write(doc); } catch (e) { alertDialog('Speichern', `Fehler beim Speichern: ${e.message}`); return; }
      download(name, new Blob([bytes], { type: 'application/octet-stream' }));
    }
    doc.fileName = name; doc.dirty = false; persist(false);
    document.title = `Moebius – ${name}`;
    status(`Gespeichert als „${name}“.`);
  }
  function saveAs() {
    dialog('Speichern unter', `
      <label>Dateiname <input name="fn" value="${esc(baseName())}"></label>
      <div class="radio-group"><label><input type="radio" name="fmt" value="prg" ${/\.json$/i.test(doc.fileName || '') ? '' : 'checked'}> Moebius-Datei (*.prg)</label><label><input type="radio" name="fmt" value="json" ${/\.json$/i.test(doc.fileName || '') ? 'checked' : ''}> Moebius Web (*.json – mit allen Einstellungen)</label></div>`,
    (b) => {
      const fn = field(b, 'fn').value.trim().replace(/\.(prg|json)$/i, '') || 'Simulation';
      saveDoc(`${fn}.${b.querySelector('[name=fmt]:checked').value}`);
    });
  }
  function confirmDiscard(next) {
    if (!doc.dirty) { next(); return; }
    dialog('Moebius', '<p>Die aktuelle Datei wurde noch nicht gespeichert. Speichern?</p>', () => { saveDoc(); next(); }, {});
    const btns = $('genButtons');
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn'; no.textContent = 'Nein';
    no.onclick = () => { gen.onclose = null; gen.close(); no.remove(); next(); };
    btns.insertBefore(no, btns.querySelector('[value=cancel]'));
    gen.addEventListener('close', () => no.remove(), { once: true });
  }
  async function openFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
      let nd;
      if (head.startsWith('MOEBIUS')) {
        const sims = MoebiusPrg.parsePrg(buf);
        const seen = {};
        sims.forEach((s) => { if (seen[s.name]) s.name = `${s.name} (${++seen[s.name]})`; else seen[s.name] = 1; });
        nd = { sims: sims.map(({ selected, x, ...s }) => s), view: defaultView(), current: 0 };
        sims.forEach((s) => s.selected.forEach((n) => nd.view.y.push({ sim: s.name, name: n })));
        if (sims[0].x) nd.view.x = sims[0].x;
      } else {
        let j;
        try { j = JSON.parse(new TextDecoder().decode(buf)); } catch (_) { j = null; }
        if (!j || !Array.isArray(j.sims)) throw new Error('Dies ist keine Moebius-Datei, oder Datei defekt.');
        nd = { sims: j.sims, view: j.view || {}, current: j.current || 0 };
      }
      nd.fileName = file.name;
      loadDoc(nd);
      status(`„${file.name}“ geöffnet.`);
    } catch (e) {
      alertDialog('Öffnen', e.message.startsWith('Dies ist') ? e.message : `Dies ist keine Moebius-Datei, oder Datei defekt. (${e.message})`);
    }
  }
  function loadDoc(nd) {
    nd.sims = (nd.sims || []).map((s) => ({ ...newSim(), ...s }));
    if (!nd.sims.length) nd.sims = [newSim()];
    const dv = defaultView(), v = nd.view || {};
    nd.view = { ...dv, ...v, graph: { ...dv.graph, ...(v.graph || {}) }, axisFmt: { ...dv.axisFmt, ...(v.axisFmt || {}) }, tableFmt: { ...dv.tableFmt, ...(v.tableFmt || {}) },
      axes: { x: { ...dv.axes.x, ...((v.axes || {}).x || {}) }, y: { ...dv.axes.y, ...((v.axes || {}).y || {}) }, z: { ...dv.axes.z, ...((v.axes || {}).z || {}) } },
      y: v.y || [], table: v.table || [], texts: v.texts || [], images: v.images || [], styles: v.styles || {} };
    nd.current = Math.min(nd.current || 0, nd.sims.length - 1);
    nd.dirty = !!nd.dirty;
    doc = nd;
    ui.sel = null;
    document.title = `Moebius – ${doc.fileName || doc.sims[0].name}`;
    runAll();
  }
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) confirmDiscard(() => openFile(f)); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) { const rd = new FileReader(); rd.onload = () => { doc.view.images.push({ src: rd.result, x: 0.3, y: 0.3, w: 160, h: 120, keepRatio: true }); const im = cachedImage(rd.result); im.onload = () => { const g = doc.view.images[doc.view.images.length - 1]; g.h = (g.w * im.naturalHeight) / im.naturalWidth; drawGraph(); }; persist(); }; rd.readAsDataURL(f); }
    else confirmDiscard(() => openFile(f));
  });

  function exportCsv() {
    let cols = tableColumns();
    if (!cols.length) cols = seriesList().length ? (() => { const t = doc.view.table; doc.view.table = [{ sim: doc.view.y[0].sim, name: doc.view.x }, ...doc.view.y]; const c = tableColumns(); doc.view.table = t; return c; })() : [];
    if (!cols.length) { alertDialog('Nach Excel exportieren', 'Klicken Sie auf die Variablen, die in der Tabelle angezeigt werden sollen.'); return; }
    const n = Math.max(...cols.map((c) => c.n));
    const lines = [cols.map((c) => c.label).join(';')];
    for (let i = 0; i < n; i++) lines.push(cols.map((c) => (i < c.n ? String(c.a[i]).replace('.', ',') : '')).join(';'));
    download(`${baseName()}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  }
  function graphPng(cb) {
    const off = document.createElement('canvas'); off.width = W * 2; off.height = H * 2;
    const c2 = off.getContext('2d'); c2.scale(2, 2);
    drawGraph(c2, W, H, true);
    off.toBlob(cb, 'image/png');
  }

  // ---------- Zwischenablage ----------
  async function copy(cut = false) {
    if (ui.sel) {
      const list = ui.sel.kind === 'text' ? doc.view.texts : doc.view.images;
      const { _box, ...o } = list[ui.sel.i];
      ui.clip = { kind: ui.sel.kind, obj: JSON.parse(JSON.stringify(o)) };
      if (ui.sel.kind === 'text') try { await navigator.clipboard.writeText(o.text); } catch (_) { /* optional */ }
      if (cut) { list.splice(ui.sel.i, 1); ui.sel = null; persist(); drawGraph(); }
      return;
    }
    if (cut) return;
    try {
      if (ui.tab === 'table') {
        const cols = tableColumns(); const n = cols.length ? Math.max(...cols.map((c) => c.n)) : 0;
        const rows = [cols.map((c) => c.label).join('\t')];
        for (let i = 0; i < n; i++) rows.push(cols.map((c) => (i < c.n ? fmtTable(c.a[i]) : '')).join('\t'));
        await navigator.clipboard.writeText(rows.join('\n'));
        status('Tabelle in die Zwischenablage kopiert.');
      } else {
        graphPng(async (blob) => {
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); status('Schaubild in die Zwischenablage kopiert.'); }
          catch (_) { status('Kopieren nicht möglich – Datei › Drucken oder „Schaubild als Bild“ verwenden.', true); }
        });
      }
    } catch (_) { status('Kopieren in die Zwischenablage ist in diesem Browser nicht erlaubt.', true); }
  }
  function paste() {
    if (!ui.clip) { status('Die Zwischenablage ist leer.'); return; }
    const o = JSON.parse(JSON.stringify(ui.clip.obj));
    o.x = Math.min(0.9, (o.x || 0) + 0.03); o.y = Math.min(0.9, (o.y || 0) + 0.03);
    const list = ui.clip.kind === 'text' ? doc.view.texts : doc.view.images;
    list.push(o);
    ui.sel = { kind: ui.clip.kind, i: list.length - 1 };
    persist(); drawGraph();
  }
  function del() {
    if (!ui.sel) { status('Markieren Sie zuerst einen Text oder eine Grafik.'); return; }
    (ui.sel.kind === 'text' ? doc.view.texts : doc.view.images).splice(ui.sel.i, 1);
    ui.sel = null; persist(); drawGraph();
  }

  // ================================================================
  // Aktionen / Menüs
  // ================================================================
  function uniqueSimName(base) { let k = 1, n = base; while (simByName(n)) n = `${base} (${k++})`; return n; }
  const actions = {
    new() { confirmDiscard(() => { loadDoc({ sims: [newSim()], view: defaultView(), current: 0, fileName: '' }); openMask(); }); },
    open() { $('fileInput').click(); },
    save: () => saveDoc(), saveAs,
    exportCsv,
    printDlg: printDialog,
    cut: () => copy(true), copy: () => copy(false), paste, del,
    rotate: rotateDialog,
    input: openMask,
    showGraph: () => showTab('graph'), showTable: () => showTab('table'),
    toggleImmediate() { doc.view.immediate = !doc.view.immediate; if (doc.view.immediate && ui.pending) { ui.pending = false; redraw(); } persist(); syncOptions(); },
    toggleAutoScale() { doc.view.autoScale = !doc.view.autoScale; persist(); syncOptions(); redraw(); },
    animStart, animPause, animStop: () => animStop(false),
    redraw: () => { ui.pending = false; syncOptions(); redraw(); },
    newSim() { doc.sims.push(newSim(uniqueSimName('Simulation'))); doc.current = doc.sims.length - 1; persist(); runAll(); openMask(); },
    dupSim() {
      const s = doc.sims[doc.current];
      doc.sims.push(JSON.parse(JSON.stringify({ ...s, name: uniqueSimName(s.name) })));
      doc.current = doc.sims.length - 1; persist(); runAll(); openMask();
    },
    insertImage,
    formatText: textDialog, formatImage: () => imageDialog(),
    axisNumbers: () => numberFormatDialog('axis'),
    toggleLegend() { doc.view.legend = !doc.view.legend; persist(); syncOptions(); redraw(); },
    graphDlg: graphDialog,
    tableNumbers: () => numberFormatDialog('table'),
    help: () => helpDialog('syntax'), helpUsage: () => helpDialog('usage'), helpIntro: () => helpDialog('intro'), helpSchool: () => helpDialog('school'),
    about() {
      dialog('Info über Moebius Web', `<p><b>Moebius Web</b><br>Web-Umsetzung für den Unterricht – kompatibel zu Moebius 3.0 (Detlef Hoche).</p>
        <p>Eigenständige Neuentwicklung, nicht vom Hersteller des Originals. Moebius-Dateien (*.prg) werden gelesen und geschrieben; das Dateiformat wurde aus Beispieldateien ermittelt.</p>
        <p>Läuft vollständig im Browser – keine Daten verlassen das Gerät.</p>`, null, { okOnly: true });
    },
    toolSelect: () => setTool('select'), toolText: () => setTool('text'),
    double() {
      doc.sims.forEach((s) => { s.reps = Math.min(1e7, s.reps * 2); });
      persist(); runAll();
      status(`Weiter gerechnet: ${doc.sims.map((s) => `${s.name} – ${s.reps.toLocaleString('de-DE')} Wiederholungen`).join(', ')}`);
    },
    togglePanel() { doc.view.panel = !doc.view.panel; syncOptions(); setTimeout(redraw, 50); },
  };
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
    const a = actions[b.dataset.act];
    closeMenus();
    if (a && !b.disabled) { e.preventDefault(); a(); }
  }));
  let menuOpen = false;
  function closeMenus() { document.querySelectorAll('.menu.open,.submenu.open').forEach((m) => m.classList.remove('open')); menuOpen = false; }
  document.querySelectorAll('.menu').forEach((m) => {
    const btn = m.querySelector('.menu-btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); const was = m.classList.contains('open'); closeMenus(); if (!was) { m.classList.add('open'); menuOpen = true; } });
    btn.addEventListener('mouseenter', () => { if (menuOpen && !m.classList.contains('open')) { closeMenus(); m.classList.add('open'); menuOpen = true; } });
  });
  document.querySelectorAll('.submenu > button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); b.parentElement.classList.toggle('open'); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

  // Beispiele
  $('exampleMenu').innerHTML = window.MOEBIUS_EXAMPLES.map((x, i) => `<button data-ex="${i}">${esc(x.title)}</button>`).join('');
  $('exampleMenu').querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { closeMenus(); confirmDiscard(() => loadExample(+b.dataset.ex)); }));
  function loadExample(i) {
    const ex = window.MOEBIUS_EXAMPLES[i];
    const nd = { sims: JSON.parse(JSON.stringify(ex.sims)), view: defaultView(), current: 0, fileName: `${ex.title}.prg` };
    nd.view.x = ex.view.x;
    nd.view.y = ex.view.y.map((lbl) => { const m = /^(.*) \[(.*)\]$/.exec(lbl); return m ? { name: m[1], sim: m[2] } : { name: lbl, sim: nd.sims[0].name }; });
    loadDoc(nd);
  }

  // Seitenleiste
  $('simSelect').addEventListener('change', (e) => { doc.current = +e.target.value; persist(); });
  $('xAxis').addEventListener('change', (e) => { doc.view.x = e.target.value; persist(); changed(); });
  $('zAxis').addEventListener('change', (e) => { doc.view.z = e.target.value; persist(); changed(); });
  $('opt3d').addEventListener('change', (e) => {
    doc.view.threeD = e.target.checked;
    if (doc.view.threeD && !doc.view.z) doc.view.z = allNames().find((v) => v !== doc.view.x && !doc.view.y.some((y) => y.name === v) && !/^dt$/i.test(v)) || '';
    buildPanel(); persist(); redraw();
  });
  $('optSeparate').addEventListener('change', (e) => { doc.view.separate = e.target.checked; persist(); changed(); });
  $('sideHandle').addEventListener('click', () => { $('side').classList.toggle('open'); setTimeout(redraw, 260); });

  window.addEventListener('keydown', (e) => {
    if (mask.open || gen.open) return;
    const k = e.key.toLowerCase();
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === 'F1') { e.preventDefault(); helpDialog('syntax'); }
    else if (e.key === 'F2') { e.preventDefault(); openMask(); }
    else if (e.ctrlKey && k === 's') { e.preventDefault(); saveDoc(); }
    else if (e.ctrlKey && k === 'o') { e.preventDefault(); actions.open(); }
    else if (e.ctrlKey && k === 'p') { e.preventDefault(); printDialog(); }
    else if (inField) return;
    else if (e.ctrlKey && k === 'c') { e.preventDefault(); copy(false); }
    else if (e.ctrlKey && k === 'x') { e.preventDefault(); copy(true); }
    else if (e.ctrlKey && k === 'v') { e.preventDefault(); paste(); }
    else if (e.key === 'Delete' && ui.sel) { e.preventDefault(); del(); }
    else if (e.key === 'Escape') closeMenus();
  });
  window.addEventListener('beforeunload', (e) => { if (doc.dirty) { e.preventDefault(); e.returnValue = ''; } });

  new ResizeObserver(() => { if (ui.tab === 'graph') redraw(); }).observe($('graphArea'));

  // ================================================================
  // Start
  // ================================================================
  setTool('select');
  showTab('graph');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (_) { saved = null; }
  if (saved && Array.isArray(saved.sims)) loadDoc(saved); else loadExample(0);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
