// Import von Original-Moebius-Dateien (*.prg, Kennung "MOEBIUS30").
// Das Binärformat ist nicht dokumentiert; dieser Leser wurde an den
// Beispieldateien vom Erzgebirgskolleg ermittelt:
//   Simulation: str Name, i32 Zeilenzahl, je Zeile str, i32 (0), i32 Variablenzahl
//   Variable  : str Name, str Simulationsname, u8 Startwert?, f64 Startwert,
//               u16 Flags (Bit0 = auf y-Achse gewählt), i32 n, n×f64 Verlauf, 53 Byte Rest
//   str = i32 Länge + Latin-1-Text
'use strict';
(() => {
  const latin1 = new TextDecoder('latin1');

  function printable(u8, a, b) {
    for (let i = a; i < b; i++) {
      const c = u8[i];
      if (!((c >= 32 && c < 127) || c >= 0xa0 || c === 9)) return false;
    }
    return true;
  }

  function trySim(dv, u8, p) {
    const len = u8.length;
    const i32 = (q) => (q + 4 <= len ? dv.getInt32(q, true) : -1);
    const L = i32(p);
    if (L < 1 || L > 64 || p + 4 + L > len || !printable(u8, p + 4, p + 4 + L)) return null;
    const name = latin1.decode(u8.subarray(p + 4, p + 4 + L));
    let r = p + 4 + L;
    const N = i32(r); r += 4;
    if (N < 1 || N > 5000) return null;
    const lines = [];
    for (let k = 0; k < N; k++) {
      const l = i32(r);
      if (l < 0 || l > 1000 || r + 4 + l > len || !printable(u8, r + 4, r + 4 + l)) return null;
      lines.push(latin1.decode(u8.subarray(r + 4, r + 4 + l)));
      r += 4 + l;
    }
    if (!lines.some((x) => x.includes('='))) return null;
    r += 4; // unbekannt (bisher immer 0)
    const nv = i32(r); r += 4;
    if (nv < 0 || nv > 5000) return null;
    const vars = [];
    for (let k = 0; k < nv; k++) {
      const l = i32(r);
      if (l < 1 || l > 200 || r + 4 + l > len) return null;
      const vname = latin1.decode(u8.subarray(r + 4, r + 4 + l)); r += 4 + l;
      const sl = i32(r);
      if (sl < 0 || sl > 200) return null;
      r += 4 + sl;
      if (r + 15 > len) return null;
      const isStart = u8[r] === 1;
      const start = dv.getFloat64(r + 1, true);
      const flags = dv.getUint16(r + 9, true);
      const cnt = dv.getInt32(r + 11, true);
      r += 15;
      if (cnt < 0 || r + cnt * 8 > len) return null;
      r += cnt * 8 + 53;
      vars.push({ name: vname, isStart, start, selected: (flags & 1) === 1, cnt });
    }
    return { sim: { name, lines, vars }, end: r };
  }

  function parsePrg(buffer) {
    const u8 = new Uint8Array(buffer);
    const magic = latin1.decode(u8.subarray(0, 7));
    if (magic !== 'MOEBIUS') throw new Error('Keine Moebius-Datei (Kennung „MOEBIUS“ fehlt).');
    const dv = new DataView(buffer);
    const sims = [];
    let p = 9;
    let scanLimit = u8.length; // erste Simulation: ganze Datei durchsuchen
    while (p < u8.length - 12 && p < scanLimit) {
      const res = trySim(dv, u8, p);
      if (res) {
        sims.push(res.sim);
        p = res.end;
        scanLimit = p + 4096; // folgende Simulationen schließen sich direkt an
      } else p++;
    }
    if (!sims.length) throw new Error('In der Datei wurden keine Gleichungen gefunden.');

    return sims.map((s) => {
      // Groß-/Kleinschreibung nötig, wenn sich Namen nur darin unterscheiden (z. B. A und a)
      const lower = new Set();
      let caseSensitive = false;
      for (const v of s.vars) {
        const k = v.name.toLowerCase();
        if (lower.has(k)) caseSensitive = true;
        lower.add(k);
      }
      const reps = Math.max(0, ...s.vars.map((v) => v.cnt)) || 100;
      const startValues = {};
      s.vars.forEach((v) => {
        if (v.isStart) startValues[caseSensitive ? v.name : v.name.toLowerCase()] = MoebiusParser.formatNumber(v.start, 10);
      });
      return {
        name: s.name,
        text: s.lines.join('\n').replace(/\s+$/, ''),
        reps,
        caseSensitive,
        startValues,
        selected: s.vars.filter((v) => v.selected).map((v) => v.name),
      };
    });
  }

  window.MoebiusPrg = { parsePrg };
})();
