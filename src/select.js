'use strict';
// Picks which parts of a document to draw as maths.
//
// For each expression the scanner found, it renders the largest pieces that
// contain display notation (a sum, an integral, a fraction...). A piece whose
// top level is an unknown function call, a tuple or a list is not drawn
// whole; its arguments or items are tried instead, so `print(sum(...))`
// draws just the sum and `return mu, sqrt(v)` just the root.

const { render } = require('./tex');
const { scan } = require('./scan');
const parsers = { python: require('./parse/python') };

const LITERALS = new Set(['tuple', 'list', 'set']);

function children(n) {
  const out = [];
  for (const [k, v] of Object.entries(n)) {
    if (k === 'start' || k === 'end' || !v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && x.k) out.push(x);
        else if (x && x.vars) out.push(...x.vars, x.iter, ...x.conds); // for-clauses
      }
    } else if (v.k) out.push(v);
    else if (k === 'kwargs') out.push(...Object.values(v));
  }
  return out.filter(x => x && typeof x.start === 'number');
}

function visit(node, notation, out) {
  if (!LITERALS.has(node.k)) {
    let r = null;
    try { r = render(node, notation); } catch { r = null; }
    if (r && !r.display) return; // nothing worth drawing anywhere inside
    if (r && !r.opaque) { out.push({ start: node.start, end: node.end, latex: r.latex, height: r.height }); return; }
  }
  for (const c of children(node)) visit(c, notation, out);
}

// Calls inside an expression the parser couldn't handle as a whole.
function fallback(src, notation, out) {
  const re = /[A-Za-z_][\w.]*\s*\(/g;
  let m;
  let coveredTo = -1;
  while ((m = re.exec(src))) {
    if (m.index < coveredTo) continue;
    const open = m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    if (close < 0) continue;
    const found = [];
    try { visit(parsers[notation.parser].parse(src.slice(m.index, close + 1), notation.options), notation, found); } catch { continue; }
    for (const f of found) out.push({ ...f, start: f.start + m.index, end: f.end + m.index });
    if (found.length) coveredTo = close + 1;
  }
}

function matchBracket(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
    else if (c === '"' || c === "'") return -1;
  }
  return -1;
}

/**
 * @returns {{spans: {start, end, latex, height}[], masked: string}}
 * Offsets are into `text`.
 */
function selectSpans(text, notation) {
  const { regions, masked } = scan(text, notation.profile === 'julia' ? 'julia' : 'python');
  const spans = [];
  for (const r of regions) {
    const src = text.slice(r.start, r.end);
    const found = [];
    let tree = null;
    try { tree = parsers[notation.parser].parse(src, notation.options); } catch { tree = null; }
    if (tree) visit(tree, notation, found);
    else fallback(src, notation, found);
    for (const f of found) spans.push({ ...f, start: f.start + r.start, end: f.end + r.start });
  }
  return { spans, masked };
}

module.exports = { selectSpans };
