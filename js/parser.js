// Moebius-kompatibler Gleichungs-Parser (ohne eval).
//
// Schreibweise wie im Original:
//   v=v+a*dt                       Zuweisung
//   s=s+v*dt: t=t+dt               mehrere Anweisungen pro Zeile (":" oder ";")
//   if s<=1000 then A=25; c_W=1,35 Bedingung – gilt für den REST DER ZEILE
//   ... else ...                   optionaler Sonst-Zweig
//   Dezimalkomma (0,01) und Dezimalpunkt (0.01), Exponent 1E-5
//   + - * / ^, Vergleiche = <> < > <= >=, and/or/not
//   sin cos tan arcsin arccos arctan exp ln sqr (Quadrat) sqrt abs ...
//   Keine eingebauten Konstanten: pi, e, g usw. sind Startwerte.
'use strict';

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, ln: Math.log, log: Math.log10, lg: Math.log10,
  sqr: (x) => x * x, sqrt: Math.sqrt, abs: Math.abs,
  sgn: Math.sign, sign: Math.sign, int: Math.trunc, trunc: Math.trunc,
  round: Math.round, frac: (x) => x - Math.trunc(x),
  random: (x) => Math.random() * (x === undefined ? 1 : x), rnd: (x) => Math.random() * (x === undefined ? 1 : x),
};
const KEYWORDS = new Set(['if', 'then', 'else', 'and', 'or', 'not', 'div', 'mod']);

class MoebiusError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

const ID_START = /[A-Za-z_À-ɏ]/;
const ID_CHAR = /[A-Za-z0-9_À-ɏ]/;

function tokenize(src, lineNo) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(\d*[.,]?\d+|\d+[.,]?)([eE][+-]?\d+)?/.exec(src.slice(i));
      toks.push({ t: 'num', v: parseFloat(m[0].replace(',', '.')), pos: i });
      i += m[0].length; continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_CHAR.test(src[j])) j++;
      const word = src.slice(i, j);
      const low = word.toLowerCase();
      toks.push(KEYWORDS.has(low) ? { t: 'kw', v: low, pos: i } : { t: 'id', v: word, pos: i });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '=<', '=>', '!=', '==', ':='].includes(two)) {
      const norm = { '=<': '<=', '=>': '>=', '!=': '<>', '==': '=', ':=': '=' }[two] || two;
      toks.push({ t: 'op', v: norm, pos: i }); i += 2; continue;
    }
    if ('+-*/^()<>=;:'.includes(c)) { toks.push({ t: 'op', v: c, pos: i }); i++; continue; }
    throw new MoebiusError(`Zeile ${lineNo}: unbekanntes Zeichen „${c}“`, lineNo);
  }
  return toks;
}

/**
 * Übersetzt den Gleichungstext.
 * @returns {{vars: {name, key, isStart}[], lines: Function[], keyOf: Function}}
 *   lines[k](mem) führt Zeile k aus; mem ist Float64Array mit einem Platz je Variable.
 */
function compile(text, caseSensitive) {
  const keyOf = caseSensitive ? (n) => n : (n) => n.toLowerCase();
  const vars = [];             // Reihenfolge des ersten Auftretens (rechts vor links)
  const index = new Map();     // key -> slot
  const assigned = new Set();  // keys, die bereits (textuell) zugewiesen wurden
  const edges = [];            // [vonSlot, nachSlot] – für das grafische Modell
  let reads = null;            // Leseliste der aktuellen Anweisung
  const condStack = [];        // Lesezugriffe umgebender if-Bedingungen
  const slot = (name) => {
    const k = keyOf(name);
    if (!index.has(k)) { index.set(k, vars.length); vars.push({ name, key: k, isStart: false }); }
    return index.get(k);
  };
  const read = (name) => {
    const s = slot(name);
    if (!assigned.has(vars[s].key)) vars[s].isStart = true; // gelesen, bevor zugewiesen
    if (reads) reads.add(s);
    return s;
  };

  const lines = [];
  const srcLines = text.split('\n');
  srcLines.forEach((raw, li) => {
    const lineNo = li + 1;
    const code = raw.replace(/(\{.*?\}|\/\/.*$)/g, ''); // Kommentare {..} oder //
    const toks = tokenize(code, lineNo);
    if (!toks.length) return;
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => p < toks.length && toks[p].t === 'op' && toks[p].v === v;
    const isKw = (v) => p < toks.length && toks[p].t === 'kw' && toks[p].v === v;
    const fail = (msg) => { throw new MoebiusError(`Zeile ${lineNo}: ${msg}`, lineNo); };
    const expectOp = (v) => { if (!isOp(v)) fail(`„${v}“ erwartet`); p++; };

    // ----- Ausdrücke -----
    function orExpr() {
      let l = andExpr();
      while (isKw('or')) { p++; const a = l, b = andExpr(); l = (m) => (a(m) || b(m) ? 1 : 0); }
      return l;
    }
    function andExpr() {
      let l = notExpr();
      while (isKw('and')) { p++; const a = l, b = notExpr(); l = (m) => (a(m) && b(m) ? 1 : 0); }
      return l;
    }
    function notExpr() {
      if (isKw('not')) { p++; const a = notExpr(); return (m) => (a(m) ? 0 : 1); }
      return cmpExpr();
    }
    function cmpExpr() {
      const l = addExpr();
      const tk = peek();
      if (tk && tk.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(tk.v)) {
        p++; const r = addExpr(), a = l;
        switch (tk.v) {
          case '=': return (m) => +(a(m) === r(m));
          case '<>': return (m) => +(a(m) !== r(m));
          case '<': return (m) => +(a(m) < r(m));
          case '>': return (m) => +(a(m) > r(m));
          case '<=': return (m) => +(a(m) <= r(m));
          default: return (m) => +(a(m) >= r(m));
        }
      }
      return l;
    }
    function addExpr() {
      let l = mulExpr();
      while (isOp('+') || isOp('-')) {
        const op = toks[p++].v; const a = l, b = mulExpr();
        l = op === '+' ? (m) => a(m) + b(m) : (m) => a(m) - b(m);
      }
      return l;
    }
    function mulExpr() {
      let l = unary();
      while (isOp('*') || isOp('/') || isKw('div') || isKw('mod')) {
        const op = toks[p++].v; const a = l, b = unary();
        if (op === '*') l = (m) => a(m) * b(m);
        else if (op === '/') l = (m) => a(m) / b(m);
        else if (op === 'div') l = (m) => Math.trunc(a(m) / b(m));
        else l = (m) => a(m) % b(m);
      }
      return l;
    }
    function unary() {
      if (isOp('-')) { p++; const a = unary(); return (m) => -a(m); }
      if (isOp('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      const b = primary();
      if (isOp('^')) { p++; const e = unary(); return (m) => Math.pow(b(m), e(m)); }
      return b;
    }
    function primary() {
      const tk = peek();
      if (!tk) fail('Ausdruck unvollständig');
      if (tk.t === 'num') { p++; const v = tk.v; return () => v; }
      if (isOp('(')) { p++; const e = orExpr(); expectOp(')'); return e; }
      if (tk.t === 'id') {
        p++;
        const fname = tk.v.toLowerCase();
        if (isOp('(') && FUNCS[fname]) {
          p++; const f = FUNCS[fname];
          if (isOp(')')) { p++; return () => f(); }
          const a = orExpr(); expectOp(')');
          return (m) => f(a(m));
        }
        if (isOp('(')) fail(`unbekannte Funktion „${tk.v}“`);
        const s = read(tk.v);
        return (m) => m[s];
      }
      fail(`unerwartetes Symbol „${tk.v}“`);
    }

    // ----- Anweisungen -----
    function statement() {
      if (isKw('if')) {
        p++;
        reads = new Set();
        const cond = orExpr();
        condStack.push(reads); reads = null;
        if (!isKw('then')) fail('„then“ erwartet');
        p++;
        const thenPart = stmtList(true);
        let elsePart = null;
        if (isKw('else')) { p++; elsePart = stmtList(false); }
        condStack.pop();
        return elsePart
          ? (m) => { if (cond(m)) thenPart(m); else elsePart(m); }
          : (m) => { if (cond(m)) thenPart(m); };
      }
      const tk = peek();
      if (!tk || tk.t !== 'id') fail('Zuweisung „Name = Ausdruck“ erwartet');
      p++;
      if (!isOp('=')) fail(`„=“ nach „${tk.v}“ erwartet`);
      p++;
      reads = new Set();
      const e = orExpr();               // rechte Seite zuerst (Reihenfolge wie im Original)
      const s = slot(tk.v);
      const deps = new Set(reads); reads = null;
      condStack.forEach((c) => c.forEach((x) => deps.add(x)));
      deps.forEach((d) => edges.push([d, s]));
      assigned.add(vars[s].key);
      return (m) => { m[s] = e(m); };
    }
    function stmtList(stopAtElse) {
      const list = [];
      for (;;) {
        while (isOp(';') || isOp(':')) p++;
        if (p >= toks.length || (stopAtElse && isKw('else'))) break;
        list.push(statement());
        if (p < toks.length && !isOp(';') && !isOp(':') && !(stopAtElse && isKw('else'))) {
          fail(`unerwartetes „${peek().v}“ – fehlt „:“ zwischen zwei Anweisungen?`);
        }
      }
      if (list.length === 1) return list[0];
      return (m) => { for (let k = 0; k < list.length; k++) list[k](m); };
    }

    const fn = stmtList(false);
    fn.lineNo = lineNo;
    lines.push(fn);
  });
  return { vars, lines, keyOf, edges };
}

/** Zahl im deutschen oder englischen Format lesen ("3,1416", "1E-5"). */
function parseNumber(s) {
  if (typeof s === 'number') return s;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return 0;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** Zahl wie Moebius anzeigen: Dezimalkomma, Exponent bei sehr kleinen/großen Werten. */
function formatNumber(v, digits = 6) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  let s;
  if (a >= 1e7 || a < 1e-4) s = v.toExponential(digits - 1).replace(/\.?0+e/, 'E').replace('e', 'E').replace('E+', 'E');
  else s = String(+v.toPrecision(digits));
  return s.replace('.', ',');
}

window.MoebiusParser = { compile, parseNumber, formatNumber, FUNCS, MoebiusError };
