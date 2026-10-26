'use strict';
// Recognises the ways JavaScript writes a sum, product, max... and rewrites
// them into the generator form Python uses, so one renderer draws both:
//
//   xs.reduce((s, x) => s + f(x), 0)                    -> sum(f(x) for x in xs)
//   xs.map(x => x * x).reduce((a, b) => a + b, 0)       -> sum(x * x for x in xs)
//   xs.filter(x => x > 0).reduce((a, b) => a * b, 1)    -> prod(x for x in xs if x > 0)
//   xs.reduce((m, x) => Math.max(m, f(x)), -Infinity)   -> max(f(x) for x in xs)
//   Array.from({length: n}, (_, i) => w[i] * x[i])      ->   (i from 0 to n-1)
//   [...Array(n).keys()]                                ->   (i from 0 to n-1)
//
// Which combining operations count is the notation's `reducers` table:
// {"+": "sum", "*": "prod", "max": "max", ...}; the values are big operator names.

const { dottedName, nameCandidates } = require('./tex');

const clone = n => JSON.parse(JSON.stringify(n));

function uses(node, name) {
  if (!node || typeof node !== 'object') return false;
  if (node.k === 'name' && node.v === name) return true;
  if (node.k === 'lambda' && node.params.includes(name)) return false;
  return Object.entries(node).some(([k, v]) => k !== 'start' && k !== 'end' && typeof v === 'object' && uses(v, name));
}

// Replace every `name` in node with a copy of `value`.
function substitute(node, name, value) {
  if (!node || typeof node !== 'object') return node;
  if (node.k === 'name' && node.v === name && node.root) return clone(value);
  if (node.k === 'name' && node.v === name) {
    const v = clone(value);
    if (v.k === 'bin' || v.k === 'neg' || v.k === 'ternary') return { k: 'paren', e: v, start: node.start, end: node.end };
    return v;
  }
  if (node.k === 'lambda' && node.params.includes(name)) return node;
  const out = Array.isArray(node) ? [] : {};
  for (const [k, v] of Object.entries(node)) out[k] = typeof v === 'object' && v !== null ? substitute(v, name, value) : v;
  return out;
}

const nameNode = v => ({ k: 'name', v });
const rangeOf = n => ({ k: 'call', fn: nameNode('range'), args: [n], kwargs: {} });
const isMethod = (n, m) => n && n.k === 'call' && n.fn.k === 'attr' && n.fn.name === m;
const isLambda = n => n && n.k === 'lambda';

// The collection a pipeline starts from: {var, iter, item, conds}
// `item` is what each element is, in terms of `var` (null means the var itself).
function source(node, ctx) {
  // Array.from({length: n}, (_, i) => f(i))
  if (node.k === 'call' && dottedName(node.fn) === 'Array.from' && node.args[0] && node.args[0].k === 'object' && node.args[0].props.length) {
    const n = node.args[0].props.length;
    const fn = node.args[1];
    if (isLambda(fn)) {
      const i = fn.params[1] || 'i';
      return { var: i, iter: rangeOf(n), item: fn.params[1] ? fn.body : null, conds: [], defaultVar: !fn.params[1] };
    }
    return { var: 'i', iter: rangeOf(n), item: null, conds: [], defaultVar: true };
  }
  // [...Array(n).keys()]
  if (node.k === 'list' && node.items.length === 1 && node.items[0].k === 'star') {
    const e = node.items[0].e;
    if (isMethod(e, 'keys') && e.fn.e.k === 'call' && dottedName(e.fn.e.fn) === 'Array' && e.fn.e.args.length === 1) {
      return { var: 'i', iter: rangeOf(e.fn.e.args[0]), item: null, conds: [], defaultVar: true };
    }
  }
  // .map(x => f(x)) and .filter(x => p(x)) on another pipeline
  if ((isMethod(node, 'map') || isMethod(node, 'filter')) && isLambda(node.args[0])) {
    const inner = source(node.fn.e, ctx);
    const fn = node.args[0];
    const p = fn.params[0];
    if (!p || (fn.params[1] && uses(fn.body, fn.params[1]))) return null; // index parameters: give up
    // keep the name the code uses: [...Array(n).keys()].map(k => ...) sums over k
    const v = inner.var && !(inner.defaultVar && !inner.item) ? inner.var : p;
    const current = inner.item || nameNode(v);
    const body = substitute({ ...fn.body, root: true }, p, current);
    if (node.fn.name === 'map') return { ...inner, var: v, item: body, defaultVar: false };
    return { ...inner, var: v, conds: [...inner.conds, body], defaultVar: false };
  }
  return { var: null, iter: node, item: null, conds: [] };
}

function reducerFor(key, ctx) {
  const table = ctx.n.reducers || {};
  for (const c of nameCandidates(key, ctx)) if (Object.prototype.hasOwnProperty.call(table, c)) return table[c];
  return null;
}

// xs.reduce((acc, x) => acc OP term, init) -> {op, term, x}
function combine(fn, ctx) {
  if (!isLambda(fn) || fn.params.length < 2) return null;
  const [acc, x] = fn.params;
  if (fn.params[2] && uses(fn.body, fn.params[2])) return null;
  const b = fn.body.k === 'paren' ? fn.body.e : fn.body;
  let key = null, term = null;
  if (b.k === 'bin' && ['+', '*', 'and', 'or'].includes(b.op)) {
    const sym = { and: '&&', or: '||' }[b.op] || b.op;
    if (b.l.k === 'name' && b.l.v === acc) { key = sym; term = b.r; }
    else if (b.r.k === 'name' && b.r.v === acc) { key = sym; term = b.l; }
  } else if (b.k === 'call' && b.args.length === 2) {
    const name = dottedName(b.fn);
    const [l, r] = b.args;
    if (l.k === 'name' && l.v === acc) { key = name; term = r; }
    else if (r.k === 'name' && r.v === acc) { key = name; term = l; }
  }
  if (!key || !term || uses(term, acc)) return null;
  const op = reducerFor(key, ctx);
  return op ? { op, term, x } : null;
}

function normalizeReduce(node, ctx) {
  if (!(isMethod(node, 'reduce') || isMethod(node, 'reduceRight'))) return null;
  const c = combine(node.args[0], ctx);
  if (!c) return null;
  const src = source(node.fn.e, ctx);
  if (!src) return null;
  const v = src.var && !(src.defaultVar && !src.item) ? src.var : c.x;
  const item = src.item || nameNode(v);
  const body = substitute({ ...c.term, root: true }, c.x, item);
  return {
    k: 'call',
    fn: nameNode(c.op),
    args: [{ k: 'gen', body, clauses: [{ vars: [nameNode(v)], iter: src.iter, conds: src.conds }], start: node.start, end: node.end }],
    kwargs: {},
    start: node.start,
    end: node.end,
  };
}

/** Rewrite JavaScript reduce pipelines into generator calls, anywhere in the tree. */
function normalize(node, notation) {
  const ctx = { n: notation };
  const walk = n => {
    if (!n || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(walk);
    const r = normalizeReduce(n, ctx);
    if (r) return walk(r);
    const out = {};
    for (const [k, v] of Object.entries(n)) out[k] = typeof v === 'object' && v !== null ? walk(v) : v;
    return out;
  };
  return walk(node);
}

module.exports = { normalize };
