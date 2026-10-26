'use strict';
// Turns a parsed expression into LaTeX, using a notation (see notation/).

const { fill, MissingValue } = require('./template');
const { simplify } = require('./simplify');
const parsers = { python: require('./parse/python') };

class RenderError extends Error {}

// ---------- names ----------

function dottedName(n) {
  if (n.k === 'name') return n.v;
  if (n.k === 'attr') { const base = dottedName(n.e); return base && `${base}.${n.name}`; }
  return null;
}

// "np.linalg.norm" -> ["np.linalg.norm", "linalg.norm" (if np is a prefix), "norm" (if np.linalg is)]
function nameCandidates(name, ctx) {
  const out = [name];
  for (const p of ctx.n.modulePrefixes) {
    if (name.startsWith(`${p}.`)) out.push(name.slice(p.length + 1));
  }
  return out;
}

function lookup(table, name, ctx, arity) {
  if (!name) return undefined;
  for (const c of nameCandidates(name, ctx)) {
    if (arity !== undefined && Object.prototype.hasOwnProperty.call(table, `${c}/${arity}`)) return table[`${c}/${arity}`];
    if (Object.prototype.hasOwnProperty.call(table, c)) return table[c];
  }
  return undefined;
}

function texName(v, ctx) {
  const id = lookup(ctx.n.identifiers, v, ctx);
  if (typeof id === 'string') return id;
  // x_0, alpha_max -> subscripts
  const sub = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(v);
  if (sub) return `${texName(sub[1], ctx)}_{${texName(sub[2], ctx)}}`;
  if (v.length === 1 || /^\d+$/.test(v)) return v;
  return `\\mathit{${v.replace(/_/g, '\\_')}}`;
}

// ---------- precedence ----------

// Higher binds tighter.
function prec(n) {
  switch (n.k) {
    case 'bin':
      if (n.op === 'or') return 1;
      if (n.op === 'and') return 2;
      if (n.op === '+' || n.op === '-' || n.op === 'xor') return 5;
      if (n.op === '/') return 9; // \frac groups itself
      if (n.op === '^') return 8;
      return 6;
    case 'not': return 3;
    case 'cmp': return 4;
    case 'neg': return 7;
    case 'bigop': return 5; // a sum swallows everything to its right
    default: return 10;
  }
}

function wrap(n, minPrec, ctx) {
  const s = tex(n, ctx);
  return prec(n) < minPrec ? `\\left(${s}\\right)` : s;
}

function isAtom(n) {
  return n.k === 'num' || n.k === 'name' || n.k === 'paren' || n.k === 'index';
}

// ---------- templates ----------

// Try a template, or each of a list of templates, until one has all its values.
function applyTemplate(entry, resolve) {
  const list = Array.isArray(entry) ? entry : [entry];
  for (const t of list) {
    const template = typeof t === 'string' ? t : t && t.template;
    if (typeof template !== 'string') continue;
    try { return fill(template, resolve); } catch (e) { if (!(e instanceof MissingValue)) throw e; }
  }
  return null;
}

function argResolver(args, ctx) {
  return (key, path, filter) => {
    let node;
    if (/^\d+$/.test(key)) node = args[Number(key) - 1];
    else if (key === 'args') return args.map(a => tex(a, ctx)).join(', ');
    if (!node) throw new MissingValue(key);
    if (filter === 'atom') return isAtom(node) || node.k === 'call' ? tex(node, ctx) : `\\left(${tex(node, ctx)}\\right)`;
    return tex(node, ctx);
  };
}

// ---------- calls ----------

const CMP = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', in: '\\in', 'not in': '\\notin' };

function texCall(n, ctx) {
  const name = dottedName(n.fn);
  // sum(... for ...) and friends
  if (n.args.length === 1 && n.args[0].k === 'gen') {
    const op = lookup(ctx.n.bigOperators, name, ctx);
    if (op === undefined || op === null) throw new RenderError(`${name || 'call'}() with a generator is not a known big operator`);
    return texBigOp(op, n.args[0], ctx);
  }
  if (n.args.some(a => a.k === 'gen')) throw new RenderError('generator in a multi-argument call');

  const fn = lookup(ctx.n.functions, name, ctx, n.args.length);
  if (fn !== undefined && fn !== null) {
    const out = applyTemplate(fn, argResolver(n.args, ctx));
    if (out !== null) return out;
  }

  const args = n.args.map(a => tex(a, ctx)).join(', ');
  let head;
  if (name && /^[A-Za-z]$/.test(name)) head = name;
  else if (name) {
    const short = nameCandidates(name, ctx).pop();
    head = `\\operatorname{${short.replace(/_/g, '\\_')}}`;
  } else head = wrap(n.fn, 10, ctx);
  return `${head}\\left(${args}\\right)`;
}

// a_{i} b_{i} reads like math; fall back to \cdot where juxtaposition would be ambiguous.
function texTimes(l, r, ctx) {
  const ls = wrap(l, 6, ctx), rs = wrap(r, 7, ctx);
  const startsWithDigit = /^[\d.]/.test(rs) || r.k === 'neg';
  return startsWithDigit ? `${ls} \\cdot ${rs}` : `${ls} ${rs}`;
}

// ---------- big operators ----------

// Code templates like "$2 - 1" are parsed in the document's language, filled with
// the argument nodes, and simplified.
function codeTemplate(code, args, ctx) {
  const src = String(code).replace(/\$(\d+)/g, '__arg$1');
  const tree = parsers[ctx.n.parser].parse(src, ctx.n.options);
  const subst = node => {
    if (!node || typeof node !== 'object') return node;
    if (node.k === 'name' && /^__arg\d+$/.test(node.v)) {
      const a = args[Number(node.v.slice(5)) - 1];
      if (!a) throw new MissingValue(node.v);
      return a.k === 'bin' || a.k === 'neg' ? { k: 'paren', e: a } : a;
    }
    const out = Array.isArray(node) ? [] : {};
    for (const [k, v] of Object.entries(node)) out[k] = typeof v === 'object' ? subst(v) : v;
    return out;
  };
  return simplify(subst(tree));
}

// Returns {from, to} nodes, {set} LaTeX, or null for an iterable that isn't a known range.
function rangeOf(iter, ctx) {
  let key, args;
  if (iter.k === 'range') { key = iter.step ? ':/3' : ':/2'; args = iter.step ? [iter.a, iter.step, iter.b] : [iter.a, iter.b]; }
  else if (iter.k === 'call') {
    const name = dottedName(iter.fn);
    if (!name) return null;
    for (const c of nameCandidates(name, ctx)) {
      const k = `${c}/${iter.args.length}`;
      if (ctx.n.ranges[k]) { key = k; break; }
    }
    args = iter.args;
  }
  const r = key && ctx.n.ranges[key];
  if (!r) return null;
  try {
    if (r.set) return { set: fill(r.set, argResolver(args, ctx)) };
    return { from: codeTemplate(r.from, args, ctx), to: codeTemplate(r.to, args, ctx) };
  } catch (e) {
    if (e instanceof MissingValue) return null;
    throw e;
  }
}

function texBigOp(op, gen, ctx) {
  const symbol = typeof op === 'string' ? op : op.symbol;
  let out = '';
  for (const c of gen.clauses) {
    const vars = c.vars.map(v => tex(v, ctx)).join(', ');
    const range = c.vars.length === 1 ? rangeOf(c.iter, ctx) : null;
    const rows = [];
    let over = '';
    if (range && range.from) {
      rows.push(`${vars}=${tex(range.from, ctx)}`);
      over = `^{${tex(range.to, ctx)}}`;
    } else {
      const domain = range && range.set ? range.set : tex(c.iter, ctx);
      rows.push(`${c.vars.length > 1 ? `(${vars})` : vars} \\in ${domain}`);
    }
    for (const cond of c.conds) rows.push(tex(cond, ctx));
    const under = rows.length > 1 ? `\\substack{${rows.join(' \\\\ ')}}` : rows[0];
    out += `${symbol}_{${under}}${over} `;
  }
  return out + wrap(gen.body, 5, ctx);
}

// ---------- main ----------

function tex(n, ctx) {
  switch (n.k) {
    case 'num': return n.v;
    case 'name': return texName(n.v, ctx);
    case 'paren': return `\\left(${tex(n.e, ctx)}\\right)`;
    case 'neg': return `-${wrap(n.e, 7, ctx)}`;
    case 'not': return `\\lnot ${wrap(n.e, 3, ctx)}`;
    case 'attr': {
      const full = dottedName(n);
      if (full) return texName(full, ctx);
      return `${wrap(n.e, 10, ctx)}.\\mathit{${n.name}}`;
    }
    case 'index': {
      const base = wrap(n.e, 10, ctx);
      const sub = n.idx.map(i => tex(i, ctx)).join(',');
      // x[i][j] -> x_{i,j}
      if (n.e.k === 'index') return base.replace(/\}$/, `,${sub}}`);
      return `${base}_{${sub}}`;
    }
    case 'call': return texCall(n, ctx);
    case 'cmp': return n.items.map((it, i) => (i ? ` ${CMP[n.ops[i - 1]]} ` : '') + wrap(it, 5, ctx)).join('');
    case 'range': {
      const r = rangeOf(n, ctx);
      if (r && r.from) return `${tex(r.from, ctx)}, \\ldots, ${tex(r.to, ctx)}`;
      if (r && r.set) return r.set;
      throw new RenderError('range');
    }
    case 'gen': throw new RenderError('generator outside a big operator');
    case 'bin': {
      switch (n.op) {
        case '+': return `${wrap(n.l, 5, ctx)} + ${wrap(n.r, 5, ctx)}`;
        case '-': return `${wrap(n.l, 5, ctx)} - ${wrap(n.r, 6, ctx)}`;
        case '*': return texTimes(n.l, n.r, ctx);
        case '/': return `\\frac{${tex(n.l, ctx)}}{${tex(n.r, ctx)}}`;
        case '//': return `\\left\\lfloor \\frac{${tex(n.l, ctx)}}{${tex(n.r, ctx)}} \\right\\rfloor`;
        case '%': return `${wrap(n.l, 6, ctx)} \\bmod ${wrap(n.r, 7, ctx)}`;
        case 'xor': return `${wrap(n.l, 5, ctx)} \\oplus ${wrap(n.r, 6, ctx)}`;
        case '^': {
          // x_{i}^{2}, but (a+b)^{2}; f(x)^2 also needs brackets unless it draws its own
          const l = tex(n.l, ctx);
          const base = n.l.k === 'call' && !/^\\sqrt|^\\left/.test(l)
            ? `\\left(${l}\\right)` : wrap(n.l, 9, ctx);
          return `${base}^{${tex(n.r, ctx)}}`;
        }
        case 'and': return `${wrap(n.l, 2, ctx)} \\land ${wrap(n.r, 2, ctx)}`;
        case 'or': return `${wrap(n.l, 1, ctx)} \\lor ${wrap(n.r, 1, ctx)}`;
      }
    }
  }
  throw new RenderError(`cannot render ${n.k}`);
}

/** Render a parsed node with a notation. Throws on anything it can't render. */
function toTex(node, notation) {
  return tex(node, { n: notation });
}

module.exports = { toTex, dottedName, nameCandidates, lookup, RenderError };
