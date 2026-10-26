'use strict';
// Turns a parsed expression into LaTeX, using a notation (see notation/).
//
// While rendering it notes whether it met a "display" construct (a big
// operator, an integral, a fraction, a matrix...). Only expressions that
// contain one are drawn in the editor; the rest stay as code.

const { fill, MissingValue } = require('./template');
const { simplify } = require('./simplify');
const parsers = { python: require('./parse/python'), cfamily: require('./parse/cfamily') };

class RenderError extends Error {}

const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

// ---------- table entries ----------
//
// An entry is a template string, a list of templates tried in order, or an
// object {template | templates | symbol, display, height, firstOfTuple}.

// Every template an entry offers, each with its own options.
function alternatives(entry) {
  if (entry === null || entry === undefined) return [];
  if (typeof entry === 'string') return [{ template: entry, display: true }];
  if (Array.isArray(entry)) return entry.flatMap(alternatives);
  const list = [].concat(entry.templates || entry.template || entry.symbol || []);
  return list.map(template => ({ ...entry, template, display: entry.display !== false }));
}

const HEIGHT_RANK = { normal: 0, medium: 1, tall: 2 };

function entryInfo(entry) {
  const alts = alternatives(entry);
  if (!alts.length && !(entry && entry.cases)) return null;
  const tallest = alts.reduce((h, a) => (HEIGHT_RANK[a.height] > HEIGHT_RANK[h || 'normal'] ? a.height : h), undefined);
  const first = alts[0] || {};
  return {
    ...(typeof entry === 'object' && !Array.isArray(entry) ? entry : {}),
    alts,
    templates: alts.map(a => a.template),
    display: alts.length ? alts.some(a => a.display) : entry.display !== false,
    height: tallest || (typeof entry === 'object' && entry.height),
    firstOfTuple: alts.some(a => a.firstOfTuple),
    lineHint: first.lineHint,
  };
}

// Try each template until one has all its values; the one used decides
// whether the expression is worth drawing and how tall it is.
function applyTemplates(info, resolve, ctx) {
  for (const alt of info.alts || []) {
    if (typeof alt.template !== 'string') continue;
    let out;
    try { out = fill(alt.template, resolve); } catch (e) { if (e instanceof MissingValue) continue; throw e; }
    if (ctx) {
      if (alt.display) ctx.display = true;
      note(ctx, alt);
    }
    return out;
  }
  return null;
}

// ---------- names ----------

function dottedName(n) {
  if (n.k === 'name') return n.v;
  if (n.k === 'attr') { const base = dottedName(n.e); return base && `${base}.${n.name}`; }
  // set().union -> "set()"
  if (n.k === 'call' && n.args.length === 0 && !Object.keys(n.kwargs || {}).length) {
    const base = dottedName(n.fn);
    return base && `${base}()`;
  }
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

// Look a name up in a table, trying name[kwarg], name/arity, then name.
function lookup(table, name, ctx, { arity, kwargs } = {}) {
  if (!name || !table) return undefined;
  for (const c of nameCandidates(name, ctx)) {
    for (const k of kwargs || []) if (has(table, `${c}[${k}]`)) return table[`${c}[${k}]`];
    if (arity !== undefined && has(table, `${c}/${arity}`)) return table[`${c}/${arity}`];
    if (has(table, c)) return table[c];
  }
  return undefined;
}

function texName(v, ctx) {
  const id = lookup(ctx.n.identifiers, v, ctx);
  if (typeof id === 'string') return id;
  // x_hat, v_vec, f_prime ...
  for (const [suffix, template] of Object.entries(ctx.n.nameSuffixes || {})) {
    if (typeof template === 'string' && v.length > suffix.length && v.endsWith(suffix)) {
      const base = texName(v.slice(0, -suffix.length), ctx);
      return fill(template, () => base);
    }
  }
  // x_0, alpha_max -> subscripts
  const sub = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(v);
  if (sub) {
    const s = /^[A-Za-z]{2,}$/.test(sub[2]) && !has(ctx.n.identifiers, sub[2]) ? `\\mathrm{${sub[2]}}` : texName(sub[2], ctx);
    return `${texName(sub[1], ctx)}_{${s}}`;
  }
  // e1 -> e_1
  const digits = /^([A-Za-z]+?)(\d+)$/.exec(v);
  if (digits && digits[1].length <= 2) return `${texName(digits[1], ctx)}_{${digits[2]}}`;
  if (v.length === 1 || /^\d+$/.test(v)) return v;
  if (/^[^\x00-\x7F]$/.test(v)) return v; // a single Unicode letter like μ
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
    case 'lambda': case 'ternary': return 0;
    default: return 10;
  }
}

// Rendered LaTeX that reads as one symbol needs no brackets around it.
function isAtomic(n, ctx, s) {
  if (['num', 'name', 'paren', 'index', 'sqrt'].includes(n.k)) return true;
  if (n.k === 'attr' && dottedName(n)) return true;
  if (n.k === 'bin' && n.op === '/') return true;
  if (n.k === 'call') return /^\\(?:left|sqrt|frac|binom|overline|begin)|^\\[A-Za-z]+\\left/.test(s) || !hasTopLevelSpace(s);
  return false;
}

// "A^{\\top}" is one symbol, "\\det A" is not
function hasTopLevelSpace(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ' ' && depth === 0) return true;
  }
  return false;
}

function wrap(n, minPrec, ctx) {
  const s = tex(n, ctx);
  return prec(n) < minPrec || (n.k === 'call' && minPrec >= 10 && !isAtomic(n, ctx, s)) ? `\\left(${s}\\right)` : s;
}

const unparen = n => (n && n.k === 'paren' ? unparen(n.e) : n);

function atom(n, ctx) {
  const s = tex(n, ctx);
  return isAtomic(n, ctx, s) ? s : `\\left(${s}\\right)`;
}

// ---------- template values ----------

// Follow a placeholder path: $1.var, $1.body (lambdas), $2.0 (tuple items)
function walk(node, path) {
  let n = node;
  for (const step of path) {
    if (!n) break;
    if (step === 'var' && n.k === 'lambda') { n = { k: 'raw', s: n.params.join(', '), params: n.params }; continue; }
    if (step === 'body' && n.k === 'lambda') { n = n.body; continue; }
    if (/^\d+$/.test(step) && (n.k === 'tuple' || n.k === 'list')) { n = n.items[Number(step)]; continue; }
    n = null;
  }
  if (!n) throw new MissingValue(path.join('.'));
  return n;
}

function applyFilter(node, filter, ctx) {
  if (!filter) return node.k === 'raw' ? texRawParams(node, ctx) : tex(unparen(node), ctx);
  if (filter === 'atom') return atom(node, ctx);
  if (filter === 'spread') {
    // Math.max(...xs) -> max xs
    if (node.k !== 'star') throw new MissingValue('spread');
    return atom(node.e, ctx);
  }
  if (filter === 'domain') {
    // range(n) -> {0, ..., n-1}; anything else as it is
    const r = rangeOf(node, ctx);
    if (r && r.from) return `\\{${tex(r.from, ctx)}, \\ldots, ${tex(r.to, ctx)}\\}`;
    if (r && r.set) return r.set;
    return tex(node, ctx);
  }
  if (filter === 'rows') {
    // [[a, b], [c, d]] -> a & b \\ c & d; [a, b] -> a \\ b (a column)
    if (node.k !== 'list' || !node.items.length) throw new MissingValue('rows');
    if (node.items.every(r => r.k === 'list')) {
      return node.items.map(r => r.items.map(x => tex(x, ctx)).join(' & ')).join(' \\\\ ');
    }
    return node.items.map(x => tex(x, ctx)).join(' \\\\ ');
  }
  throw new RenderError(`unknown filter ${filter}`);
}

function texRawParams(node, ctx) {
  return node.params.map(p => texName(p, ctx)).join(', ');
}

function callResolver(args, kwargs, receiver, ctx) {
  return (key, path, filter) => {
    let node;
    if (key === 'args') return args.map(a => tex(a, ctx)).join(', ');
    if (/^\d+$/.test(key)) node = Number(key) === 0 ? receiver : args[Number(key) - 1];
    else node = kwargs && kwargs[key];
    if (!node) throw new MissingValue(key);
    return applyFilter(walk(node, path), filter, ctx);
  };
}

// ---------- calls ----------

const CMP = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', in: '\\in', 'not in': '\\notin' };

function generatorArg(n) {
  if (n.args.length !== 1 || Object.keys(n.kwargs).length) return null;
  const a = n.args[0];
  if (a.k === 'gen') return a;
  if (a.k === 'star' && a.e.k === 'gen') return a.e; // set().union(*(A[i] for i in I))
  return null;
}

function texCall(n, ctx) {
  const name = dottedName(n.fn);
  const kwargs = Object.keys(n.kwargs || {});

  // sum(... for ...) and friends
  const gen = generatorArg(n);
  if (gen) {
    const info = entryInfo(lookup(ctx.n.bigOperators, name, ctx));
    if (!info) throw new RenderError(`${name || 'call'}() with a generator is not a known big operator`);
    if (info.display) ctx.display = true;
    note(ctx, info);
    return texBigOp(info, gen.clauses, gen.body, ctx);
  }
  if (n.args.some(a => a.k === 'gen')) throw new RenderError('generator in a multi-argument call');

  // functions table: np.linalg.norm(x), max(S, key=...)
  let info = entryInfo(lookup(ctx.n.functions, name, ctx, { arity: n.args.length, kwargs }));
  let receiver = null;
  // methods: x.dot(y) -> ".dot" with $0 = x
  if (!info && n.fn.k === 'attr' && !isModulePath(n.fn.e, ctx)) {
    info = entryInfo(lookup(ctx.n.functions, `.${n.fn.name}`, ctx, { arity: n.args.length, kwargs }));
    receiver = n.fn.e;
  }
  if (info) {
    const out = applyTemplates(info, callResolver(n.args, n.kwargs, receiver, ctx), ctx);
    if (out !== null) return out;
  }

  // sum(xs) and np.sum(x[a:b]): big operator over a collection
  const big = n.args.length === 1 && !kwargs.length && entryInfo(lookup(ctx.n.bigOperators, name, ctx));
  if (big && big.templates.length && !big.templates[0].includes('$')) return texCollection(big.templates[0], n.args[0], ctx);

  if (n.args.some(a => a.k === 'star' || a.k === 'str')) throw new RenderError('not a math call');
  if (name || n.fn.k === 'attr') ctx.opaque = ctx.opaque || ctx.depth === 0;
  const args = n.args.map(a => tex(a, ctx)).join(', ');
  let head;
  if (name && /^[A-Za-z]$/.test(name)) head = name;
  else if (name) {
    const short = nameCandidates(name, ctx).pop();
    head = /^[A-Za-z][A-Za-z0-9]*$/.test(short) ? `\\operatorname{${short}}` : `\\operatorname{${short.replace(/_/g, '\\_')}}`;
  } else head = wrap(n.fn, 10, ctx);
  return `${head}\\left(${args}\\right)`;
}

function isModulePath(n, ctx) {
  const name = dottedName(n);
  return !!name && (ctx.n.modulePrefixes.includes(name) || /^[a-z_][a-z0-9_]*$/.test(name) && ctx.n.modulePrefixes.some(p => p.startsWith(`${name}.`)));
}

// remember the tallest construct used
const HEIGHTS = { normal: 0, medium: 1, tall: 2 };
function note(ctx, info) {
  if (info && info.height && HEIGHTS[info.height] > HEIGHTS[ctx.height || 'normal']) ctx.height = info.height;
}

// sum(x[a:b]) -> sum over i of x_i; sum(xs) -> Σ xs
function texCollection(symbol, arg, ctx) {
  if (arg.k === 'index' && arg.idx.length === 1 && (arg.idx[0].k === 'slice' || arg.idx[0].k === 'range')) {
    const r = arg.idx[0].k === 'slice' ? sliceRange(arg.idx[0], ctx) : rangeOf(arg.idx[0], ctx);
    if (r && r.from) {
      const v = freshVar(arg, ctx);
      const body = { k: 'index', e: arg.e, idx: [{ k: 'name', v }] };
      return `${symbol}_{${v}=${tex(r.from, ctx)}}^{${tex(r.to, ctx)}} ${tex(body, ctx)}`;
    }
  }
  return `${symbol} ${wrap(arg, 7, ctx)}`;
}

function sliceRange(sl, ctx) {
  const r = ctx.n.ranges['slice/2'];
  if (!r || !sl.a || !sl.b || sl.step) return null;
  try { return { from: codeTemplate(r.from, [sl.a, sl.b], ctx), to: codeTemplate(r.to, [sl.a, sl.b], ctx) }; } catch { return null; }
}

function freshVar(node, ctx) {
  const used = new Set();
  (function scan(n) {
    if (!n || typeof n !== 'object') return;
    if (n.k === 'name') used.add(n.v);
    for (const v of Object.values(n)) if (typeof v === 'object') scan(v);
  })(node);
  return ['i', 'j', 'k', 'l', 'm'].find(v => !used.has(v)) || 'n';
}

// a_{i} b_{i} reads like math; fall back to \cdot where juxtaposition would be ambiguous.
function texTimes(l, r, ctx) {
  const ls = wrap(l, 6, ctx), rs = wrap(r, 7, ctx);
  const member = x => x.includes('{.}\\mathit{'); // o.price
  const ambiguous = /^[\d.]/.test(rs) || r.k === 'neg' || ls === rs || member(ls) || member(rs) ||
    /^\\(?:frac|sum|prod|int)/.test(rs) && /[\d}]$/.test(ls);
  return ambiguous ? `${ls} \\cdot ${rs}` : `${ls} ${rs}`;
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
    if (r.set) return { set: fill(r.set, callResolver(args, {}, null, ctx)) };
    return { from: codeTemplate(r.from, args, ctx), to: codeTemplate(r.to, args, ctx) };
  } catch (e) {
    if (e instanceof MissingValue) return null;
    throw e;
  }
}

// The parts of each "for" clause, for big operator templates.
function clauseParts(c, ctx) {
  const vars = c.vars.map(v => tex(v, ctx)).join(', ');
  const tuple = c.vars.length > 1 ? `(${vars})` : vars;
  const range = c.vars.length === 1 ? rangeOf(c.iter, ctx) : null;
  const conds = c.conds.map(x => tex(x, ctx));
  let domain, lower = null, upper = null;
  if (range && range.from) {
    lower = tex(range.from, ctx);
    upper = tex(range.to, ctx);
    domain = `\\{${lower}, \\ldots, ${upper}\\}`;
  } else domain = range && range.set ? range.set : tex(c.iter, ctx);
  const rows = [lower !== null ? `${vars}=${lower}` : `${tuple} \\in ${domain}`, ...conds];
  return {
    vars,
    domain,
    conds: conds.join(', '),
    in: [`${tuple} \\in ${domain}`, ...conds].join(',\\ '),
    under: rows.length > 1 ? `\\substack{${rows.join(' \\\\ ')}}` : rows[0],
    over: upper,
  };
}

function texBigOp(info, clauses, body, ctx) {
  const parts = clauses.map(c => clauseParts(c, ctx));
  const template = info.templates[0];
  // Σ (1 + r_t): a sum or difference after a plain symbol needs brackets
  const bodyTex = template.includes('$') ? tex(unparen(body), ctx) : wrap(body, 6, ctx);
  // A plain symbol like "\\sum": one operator per clause, limits under and over.
  if (!template.includes('$')) {
    return parts.map(p => `${template}_{${p.under}}${p.over !== null ? `^{${p.over}}` : ''} `).join('') + bodyTex;
  }
  const values = {
    body: bodyTex,
    vars: parts.map(p => p.vars).join(', '),
    domain: parts.map(p => p.domain).join(', '),
    conds: parts.map(p => p.conds).filter(Boolean).join(', '),
    in: parts.map(p => p.in).join(',\\ '),
    under: parts.length === 1 ? parts[0].under : `\\substack{${parts.map(p => p.under).join(' \\\\ ')}}`,
    over: parts.length === 1 ? parts[0].over : null,
  };
  const out = applyTemplates(info, key => {
    if (values[key] === null || values[key] === undefined || values[key] === '') throw new MissingValue(key);
    return values[key];
  });
  if (out === null) throw new RenderError('no big operator template fits');
  return out;
}

// ---------- syntax templates ----------

function syntax(ctx, key) {
  const info = entryInfo(ctx.n.syntax && ctx.n.syntax[key]);
  if (!info) throw new RenderError(`${key} is turned off`);
  if (info.display) ctx.display = true;
  note(ctx, info);
  return info;
}

function texSyntax(ctx, key, values) {
  const info = syntax(ctx, key);
  const out = applyTemplates(info, (k, path, filter) => {
    const v = values[k];
    if (v === undefined) throw new MissingValue(k);
    return typeof v === 'string' ? v : applyFilter(v, filter, ctx);
  });
  if (out === null) throw new RenderError(`${key} template does not fit`);
  return out;
}

// a if c1 else b if c2 else d -> cases
function texPiecewise(n, ctx) {
  const info = syntax(ctx, 'piecewise');
  const t = info.cases || {};
  const rows = [];
  let cur = n;
  while (cur.k === 'ternary') {
    const value = tex(cur.a, ctx), cond = tex(cur.cond, ctx);
    rows.push(fill(t.row || '$1 & \\text{if } $2', k => (k === '1' ? value : cond)));
    cur = cur.b;
  }
  const last = tex(cur, ctx);
  rows.push(fill(t.otherwise || '$1 & \\text{otherwise}', () => last));
  return `${t.begin || '\\begin{cases}'} ${rows.join(' \\\\ ')} ${t.end || '\\end{cases}'}`;
}

// ---------- main ----------

function tex(n, ctx) {
  ctx.depth = (ctx.depth || 0) + 1;
  try { return texNode(n, ctx); } finally { ctx.depth--; }
}

function texNode(n, ctx) {
  switch (n.k) {
    case 'num': {
      if (/j$/.test(n.v)) return `${n.v.slice(0, -1)}i`;
      // 1e-9 -> 1 \times 10^{-9}
      const sci = /^([\d.]+)[eE]([+-]?\d+)$/.exec(n.v);
      if (sci) return `${sci[1] === '1' ? '' : `${sci[1]} \\times `}10^{${Number(sci[2])}}`;
      return n.v;
    }
    case 'name': return texName(n.v, ctx);
    case 'raw': return n.s;
    case 'paren': {
      const inner = tex(n.e, ctx);
      return isAtomic(n.e, ctx, inner) ? inner : `\\left(${inner}\\right)`;
    }
    case 'neg': return `-${wrap(n.e, 7, ctx)}`;
    case 'not': return `\\lnot ${wrap(n.e, 3, ctx)}`;
    case 'sqrt': ctx.display = true; return n.n ? `\\sqrt[${n.n}]{${tex(unparen(n.e), ctx)}}` : `\\sqrt{${tex(unparen(n.e), ctx)}}`;
    case 'adjoint': return texSyntax(ctx, 'adjoint', { 1: n.e });
    case 'attr': {
      const full = dottedName(n);
      if (full && lookup(ctx.n.identifiers, full, ctx) !== undefined) return texName(full, ctx);
      // A.T and friends: ".T" in the functions table, with $0 = A
      const info = !isModulePath(n.e, ctx) && entryInfo(lookup(ctx.n.functions, `.${n.name}`, ctx, { arity: 'attr' }));
      if (info) {
        const out = applyTemplates(info, callResolver([], {}, n.e, ctx), ctx);
        if (out !== null) return out;
      }
      if (full && (isModulePath(n.e, ctx) || /^[A-Z]/.test(full))) return texName(full, ctx);
      return `${wrap(n.e, 10, ctx)}{.}\\mathit{${n.name.replace(/_/g, '\\_')}}`; // {.} keeps the dot tight
    }
    case 'index': {
      // quad(f, a, b)[0]: the value of a function that returns (value, error)
      const first = ctx.n.options.oneBased ? '1' : '0';
      if (n.e.k === 'call' && n.idx.length === 1 && n.idx[0].k === 'num' && n.idx[0].v === first) {
        const info = entryInfo(lookup(ctx.n.functions, dottedName(n.e.fn), ctx, { arity: n.e.args.length }));
        if (info && info.firstOfTuple) return tex(n.e, ctx);
      }
      if (n.idx.some(i => i.k === 'slice')) throw new RenderError('slices are drawn only inside sums');
      const base = wrap(n.e, 10, ctx);
      const sub = n.idx.map(i => tex(i, ctx)).join(',');
      // x[i][j] -> x_{i,j}
      if (n.e.k === 'index' && /\}$/.test(base)) return base.replace(/\}$/, `,${sub}}`);
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
    case 'tuple': return `\\left(${n.items.map(i => tex(i, ctx)).join(', ')}\\right)`;
    case 'list': return `\\left[${n.items.map(i => tex(i, ctx)).join(', ')}\\right]`;
    case 'set': return n.items.length ? `\\left\\{${n.items.map(i => tex(i, ctx)).join(', ')}\\right\\}` : '\\emptyset';
    case 'comp': {
      const key = n.kind === 'set' ? 'setComprehension' : 'listComprehension';
      const parts = n.clauses.map(c => clauseParts(c, ctx));
      return texSyntax(ctx, key, {
        body: tex(n.body, ctx),
        in: parts.map(p => p.in).join(',\\ '),
        vars: parts.map(p => p.vars).join(', '),
      });
    }
    case 'lambda': return texSyntax(ctx, 'lambda', {
      params: n.params.map(p => texName(p, ctx)).join(', '),
      body: tex(n.body, ctx),
    });
    case 'ternary': return texPiecewise(n, ctx);
    case 'gen': throw new RenderError('generator outside a big operator');
    case 'str': throw new RenderError('strings are not math');
    case 'star': case 'slice': case 'object': throw new RenderError(n.k);
    case 'bin': {
      switch (n.op) {
        case '+': return `${wrap(n.l, 5, ctx)} + ${wrap(n.r, 5, ctx)}`;
        case '-': return `${wrap(n.l, 5, ctx)} - ${wrap(n.r, 6, ctx)}`;
        case '*': return texTimes(n.l, n.r, ctx);
        case '/': return texSyntax(ctx, 'fraction', { 1: tex(unparen(n.l), ctx), 2: tex(unparen(n.r), ctx) });
        case '//': return texSyntax(ctx, 'floorDiv', { 1: tex(unparen(n.l), ctx), 2: tex(unparen(n.r), ctx) });
        case '%': return `${wrap(n.l, 6, ctx)} \\bmod ${wrap(n.r, 7, ctx)}`;
        case '@': return texSyntax(ctx, 'matmul', { 1: wrap(n.l, 6, ctx), 2: wrap(n.r, 7, ctx) });
        case 'dot': ctx.display = true; return `${wrap(n.l, 6, ctx)} \\cdot ${wrap(n.r, 7, ctx)}`;
        case 'cross': ctx.display = true; return `${wrap(n.l, 6, ctx)} \\times ${wrap(n.r, 7, ctx)}`;
        case 'compose': return `${wrap(n.l, 6, ctx)} \\circ ${wrap(n.r, 7, ctx)}`;
        case 'xor': return `${wrap(n.l, 5, ctx)} \\oplus ${wrap(n.r, 6, ctx)}`;
        case '^': {
          const l = tex(n.l, ctx);
          const base = isAtomic(n.l, ctx, l) && !/^\\begin|^e\^/.test(l) && !(n.l.k === 'index' && /\^/.test(l))
            ? l : `\\left(${l}\\right)`;
          const exp = tex(unparen(n.r), ctx);
          // syntax.power: whether a power on its own makes a line worth drawing
          const info = entryInfo(ctx.n.syntax && ctx.n.syntax.power);
          const out = info && applyTemplates(info, k => ({ 1: base, 2: exp })[k] || '', ctx);
          return out || `${base}^{${exp}}`;
        }
        case 'and': return `${wrap(n.l, 2, ctx)} \\land ${wrap(n.r, 2, ctx)}`;
        case 'or': return `${wrap(n.l, 1, ctx)} \\lor ${wrap(n.r, 1, ctx)}`;
      }
    }
  }
  throw new RenderError(`cannot render ${n.k}`);
}

/**
 * Render a parsed node with a notation. Throws on anything it can't render.
 * Returns {latex, display, height, opaque}:
 *   display  the expression contains notation worth drawing
 *   height   the tallest construct: 'normal' | 'medium' | 'tall'
 *   opaque   the top level is an unknown function call, e.g. print(...)
 */
function render(node, notation) {
  // JavaScript: xs.reduce(...) pipelines become generators first
  if (notation.shapes) node = require('./shapes').normalize(node, notation);
  const ctx = { n: notation, depth: -1 };
  const latex = tex(node, ctx);
  return { latex, display: !!ctx.display, height: ctx.height || 'normal', opaque: !!ctx.opaque };
}

function toTex(node, notation) {
  return render(node, notation).latex;
}

module.exports = { render, toTex, dottedName, nameCandidates, lookup, entryInfo, RenderError };
