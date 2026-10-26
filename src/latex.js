'use strict';
// Turns sum/product generator expressions from Python or Julia into LaTeX.
//
//   sum(x[i] for i in range(1, n+1))   ->  \sum_{i=1}^{n} x_{i}
//   sum(a[i]*b[i] for i in 1:n)        ->  \sum_{i=1}^{n} a_{i} b_{i}
//
// It only understands a small math-like subset of each language. Anything else
// (strings, lambdas, list literals...) throws, and the caller just skips it.

class ParseError extends Error {}

// ---------- tokenizer ----------

const OPERATORS = ['**', '//', '<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^',
  '<', '>', '(', ')', '[', ']', ',', ':', '.', '='];
const KEYWORDS = new Set(['for', 'in', 'if', 'and', 'or', 'not']);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '\\') { i++; continue; } // backslash = Python line continuation
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") throw new ParseError('strings are not supported');

    const num = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num) { tokens.push({ type: 'num', value: num[1], start: i }); i += num[1].length; continue; }

    const name = /^[A-Za-z_À-￿][\wÀ-￿]*/.exec(src.slice(i));
    if (name) {
      const type = KEYWORDS.has(name[0]) ? 'kw' : 'name';
      tokens.push({ type, value: name[0], start: i });
      i += name[0].length;
      continue;
    }

    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character '${c}'`);
    tokens.push({ type: 'op', value: op, start: i });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', start: src.length });
  return tokens;
}

// ---------- parser ----------
// Node shapes:
//   {k:'num', v}  {k:'name', v}  {k:'bin', op, l, r}  {k:'neg', e}  {k:'not', e}
//   {k:'cmp', ops:[...], items:[...]}  {k:'call', fn, args}  {k:'index', e, idx:[...]}
//   {k:'attr', e, name}  {k:'paren', e}  {k:'range', a, b, step}
//   {k:'bigop', op:'sum'|'prod', body, clauses:[{vars, iter, conds}]}

const BIG_OPS = {
  sum: 'sum', fsum: 'sum', nansum: 'sum',
  prod: 'prod', nanprod: 'prod',
};

class Parser {
  constructor(src) { this.t = tokenize(src); this.p = 0; }
  peek(o = 0) { return this.t[this.p + o]; }
  next() { return this.t[this.p++]; }
  is(value, type) { const t = this.peek(); return t.value === value && (!type || t.type === type); }
  accept(value) { if (this.is(value)) { this.p++; return true; } return false; }
  expect(value) {
    if (!this.accept(value)) throw new ParseError(`expected '${value}' but found '${this.peek().value || 'end'}'`);
  }

  parseAll() {
    const e = this.expr();
    if (this.peek().type !== 'eof') throw new ParseError(`unexpected '${this.peek().value}'`);
    return e;
  }

  expr() { return this.or(); }

  or() {
    let l = this.and();
    while (this.is('or', 'kw')) { this.next(); l = { k: 'bin', op: 'or', l, r: this.and() }; }
    return l;
  }

  and() {
    let l = this.not();
    while (this.is('and', 'kw')) { this.next(); l = { k: 'bin', op: 'and', l, r: this.not() }; }
    return l;
  }

  not() {
    if (this.is('not', 'kw')) { this.next(); return { k: 'not', e: this.not() }; }
    return this.comparison();
  }

  comparison() {
    const first = this.arith();
    const ops = [], items = [first];
    for (;;) {
      const t = this.peek();
      let op = null;
      if (t.type === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.value)) { op = t.value; this.next(); }
      else if (t.type === 'kw' && t.value === 'in' && !this.inForTarget) { op = 'in'; this.next(); }
      else if (t.type === 'kw' && t.value === 'not' && this.peek(1).value === 'in') { op = 'not in'; this.p += 2; }
      if (!op) break;
      ops.push(op);
      items.push(this.arith());
    }
    return ops.length ? { k: 'cmp', ops, items } : first;
  }

  arith() {
    let l = this.term();
    while (this.is('+', 'op') || this.is('-', 'op')) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.term() };
    }
    return l;
  }

  term() {
    let l = this.unary();
    while (['*', '/', '//', '%'].includes(this.peek().value) && this.peek().type === 'op') {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  unary() {
    if (this.is('-', 'op')) { this.next(); return { k: 'neg', e: this.unary() }; }
    if (this.is('+', 'op')) { this.next(); return this.unary(); }
    return this.power();
  }

  power() {
    const base = this.postfix();
    if (this.is('**', 'op') || this.is('^', 'op')) {
      this.next();
      return { k: 'bin', op: '^', l: base, r: this.unary() };
    }
    return base;
  }

  postfix() {
    let e = this.atom();
    for (;;) {
      if (this.accept('(')) e = this.call(e);
      else if (this.accept('[')) {
        const idx = [this.expr()];
        while (this.accept(',')) idx.push(this.expr());
        this.expect(']');
        e = { k: 'index', e, idx };
      } else if (this.is('.', 'op') && this.peek(1).type === 'name') {
        this.next();
        e = { k: 'attr', e, name: this.next().value };
      } else return e;
    }
  }

  call(fn) {
    const name = calleeName(fn);
    const big = name && BIG_OPS[name.split('.').pop()];
    if (this.accept(')')) return { k: 'call', fn, args: [] };
    const first = this.expr();
    if (this.is('for', 'kw')) {
      const clauses = this.forClauses();
      this.expect(')');
      if (!big) throw new ParseError(`generator inside ${name || 'call'}() is not supported`);
      return { k: 'bigop', op: big, body: first, clauses };
    }
    const args = [first];
    while (this.accept(',')) {
      if (this.is(')')) break;
      args.push(this.expr());
    }
    this.expect(')');
    return { k: 'call', fn, args };
  }

  forClauses() {
    const clauses = [];
    while (this.accept('for')) {
      this.inForTarget = true;
      const vars = [this.postfix()];
      while (this.accept(',')) vars.push(this.postfix());
      this.inForTarget = false;
      // Python: for i in ..., Julia also allows for i = ... and for i ∈ ...
      if (!this.accept('in') && !this.accept('=') && !this.accept('∈')) {
        throw new ParseError(`expected 'in' but found '${this.peek().value || 'end'}'`);
      }
      const iter = this.iterable();
      const conds = [];
      while (this.is('if', 'kw')) { this.next(); conds.push(this.or()); }
      clauses.push({ vars, iter, conds });
    }
    return clauses;
  }

  // Julia-style a:b or a:step:b; otherwise an ordinary expression.
  iterable() {
    const a = this.arith();
    if (!this.accept(':')) return a;
    const b = this.arith();
    if (!this.accept(':')) return { k: 'range', a, b };
    return { k: 'range', a, step: b, b: this.arith() };
  }

  atom() {
    const t = this.next();
    if (t.type === 'num') return { k: 'num', v: t.value };
    if (t.type === 'name') return { k: 'name', v: t.value };
    if (t.value === '(') {
      const e = this.expr();
      if (this.is('for', 'kw')) throw new ParseError('bare generator in parentheses');
      this.expect(')');
      return { k: 'paren', e };
    }
    throw new ParseError(`unexpected '${t.value || 'end'}'`);
  }
}

function calleeName(fn) {
  if (fn.k === 'name') return fn.v;
  if (fn.k === 'attr') { const base = calleeName(fn.e); return base && `${base}.${fn.name}`; }
  return null;
}

// ---------- LaTeX output ----------

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi',
  'Pi', 'Sigma', 'Phi', 'Psi', 'Omega']);
const CONSTANTS = { pi: '\\pi', e: 'e', inf: '\\infty', Inf: '\\infty', Infinity: '\\infty', tau: '\\tau' };
const MODULES = new Set(['math', 'np', 'numpy', 'torch', 'cmath', 'jnp', 'scipy', 'sp', 'Base']);
const NAMED_FUNCS = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos',
  'arctan', 'log', 'ln', 'exp', 'max', 'min', 'det', 'gcd']);
const FUNC_ALIASES = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', log10: 'log_{10}', log2: 'log_{2}' };
const CMP = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', in: '\\in', 'not in': '\\notin' };

// Higher binds tighter.
function prec(n) {
  switch (n.k) {
    case 'bin':
      if (n.op === 'or') return 1;
      if (n.op === 'and') return 2;
      if (n.op === '+' || n.op === '-') return 5;
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

function wrap(n, minPrec) {
  const s = tex(n);
  return prec(n) < minPrec ? `\\left(${s}\\right)` : s;
}

function texName(v) {
  const stripped = v.replace(/^(?:math|np|numpy)\./, '');
  if (Object.prototype.hasOwnProperty.call(CONSTANTS, stripped)) return CONSTANTS[stripped];
  if (GREEK.has(v)) return `\\${v}`;
  // x_0, alpha_max -> subscripts
  const sub = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(v);
  if (sub) return `${texName(sub[1])}_{${texName(sub[2])}}`;
  if (v.length === 1 || /^\d+$/.test(v)) return v;
  return `\\mathit{${v.replace(/_/g, '\\_')}}`;
}

function texCall(n) {
  let name = calleeName(n.fn);
  if (name) {
    const parts = name.split('.');
    if (parts.length > 1 && MODULES.has(parts[0])) name = parts.slice(1).join('.');
  }
  const args = n.args.map(tex);
  const one = n.args.length === 1;
  if (name === 'sqrt' && one) return `\\sqrt{${args[0]}}`;
  if (name === 'cbrt' && one) return `\\sqrt[3]{${args[0]}}`;
  if ((name === 'abs' || name === 'fabs') && one) return `\\left|${args[0]}\\right|`;
  if ((name === 'norm') && one) return `\\left\\|${args[0]}\\right\\|`;
  if (name === 'exp' && one) return `e^{${args[0]}}`;
  if (name === 'floor' && one) return `\\left\\lfloor ${args[0]}\\right\\rfloor`;
  if (name === 'ceil' && one) return `\\left\\lceil ${args[0]}\\right\\rceil`;
  if (name === 'factorial' && one) return `${wrap(n.args[0], 10)}!`;
  if ((name === 'comb' || name === 'binomial') && n.args.length === 2) return `\\binom{${args[0]}}{${args[1]}}`;
  if (name === 'pow' && n.args.length === 2) return `${wrap(n.args[0], 10)}^{${args[1]}}`;

  let head;
  if (name && FUNC_ALIASES[name]) head = `\\${FUNC_ALIASES[name]}`;
  else if (name && NAMED_FUNCS.has(name)) head = `\\${name}`;
  else if (name && /^[A-Za-z]$/.test(name)) head = name;
  else if (name) head = `\\operatorname{${name.replace(/_/g, '\\_')}}`;
  else head = wrap(n.fn, 10);
  return `${head}\\left(${args.join(', ')}\\right)`;
}

// a_{i} b_{i} reads like math; fall back to \cdot where juxtaposition would be ambiguous.
function texTimes(l, r) {
  const ls = wrap(l, 6), rs = wrap(r, 7);
  const startsWithDigit = /^[\d.]/.test(rs) || r.k === 'neg';
  return startsWithDigit ? `${ls} \\cdot ${rs}` : `${ls} ${rs}`;
}

function tex(n) {
  switch (n.k) {
    case 'num': return n.v;
    case 'name': return texName(n.v);
    case 'paren': return `\\left(${tex(n.e)}\\right)`;
    case 'neg': return `-${wrap(n.e, 7)}`;
    case 'not': return `\\lnot ${wrap(n.e, 3)}`;
    case 'attr': {
      const full = calleeName(n);
      if (full) return texName(full);
      return `${wrap(n.e, 10)}.\\mathit{${n.name}}`;
    }
    case 'index': {
      const base = wrap(n.e, 10);
      const sub = n.idx.map(tex).join(',');
      // x[i][j] -> x_{i,j}
      if (n.e.k === 'index') return base.replace(/\}$/, `,${sub}}`);
      return `${base}_{${sub}}`;
    }
    case 'call': return texCall(n);
    case 'cmp': return n.items.map((it, i) => (i ? ` ${CMP[n.ops[i - 1]]} ` : '') + wrap(it, 5)).join('');
    case 'range': throw new ParseError('range outside a for clause');
    case 'bigop': return texBigOp(n);
    case 'bin': {
      switch (n.op) {
        case '+': return `${wrap(n.l, 5)} + ${wrap(n.r, 5)}`;
        case '-': return `${wrap(n.l, 5)} - ${wrap(n.r, 6)}`;
        case '*': return texTimes(n.l, n.r);
        case '/': return `\\frac{${tex(n.l)}}{${tex(n.r)}}`;
        case '//': return `\\left\\lfloor \\frac{${tex(n.l)}}{${tex(n.r)}} \\right\\rfloor`;
        case '%': return `${wrap(n.l, 6)} \\bmod ${wrap(n.r, 7)}`;
        case '^': {
          // x_{i}^{2}, but (a+b)^{2}; sqrt(x)^2 also needs brackets
          const base = n.l.k === 'call' && calleeName(n.l.fn) !== null && !/^\\sqrt|^\\left/.test(tex(n.l))
            ? `\\left(${tex(n.l)}\\right)` : wrap(n.l, 9);
          return `${base}^{${tex(n.r)}}`;
        }
        case 'and': return `${wrap(n.l, 2)} \\land ${wrap(n.r, 2)}`;
        case 'or': return `${wrap(n.l, 1)} \\lor ${wrap(n.r, 1)}`;
      }
    }
  }
  throw new ParseError(`cannot render ${n.k}`);
}

// ---------- limits ----------

function num(n) { return n.k === 'num' && /^\d+$/.test(n.v) ? Number(n.v) : null; }

// b - 1, simplified: n+1 -> n, 10 -> 9, n -> n-1
function minusOne(b) {
  const nb = num(b);
  if (nb !== null) return { k: 'num', v: String(nb - 1) };
  if (b.k === 'bin' && b.op === '+') {
    const k = num(b.r);
    if (k === 1) return b.l;
    if (k !== null) return { k: 'bin', op: '+', l: b.l, r: { k: 'num', v: String(k - 1) } };
  }
  if (b.k === 'paren') return minusOne(b.e);
  return { k: 'bin', op: '-', l: b, r: { k: 'num', v: '1' } };
}

// Returns {lower, upper} for "i=lower ... upper", or null if the iterable is not a simple range.
function rangeLimits(iter) {
  if (iter.k === 'range' && !iter.step) return { lower: iter.a, upper: iter.b };
  if (iter.k === 'call' && calleeName(iter.fn) === 'range') {
    const a = iter.args;
    if (a.length === 1) return { lower: { k: 'num', v: '0' }, upper: minusOne(a[0]) };
    if (a.length === 2) return { lower: a[0], upper: minusOne(a[1]) };
  }
  return null;
}

function texBigOp(n) {
  const sym = n.op === 'sum' ? '\\sum' : '\\prod';
  let out = '';
  for (const c of n.clauses) {
    const vars = c.vars.map(tex).join(', ');
    const limits = c.vars.length === 1 ? rangeLimits(c.iter) : null;
    const rows = [];
    let upper = '';
    if (limits) {
      rows.push(`${vars}=${tex(limits.lower)}`);
      upper = `^{${tex(limits.upper)}}`;
    } else {
      const iter = c.iter.k === 'range'
        ? `\\{${tex(c.iter.a)}, ${tex({ k: 'bin', op: '+', l: c.iter.a, r: c.iter.step })}, \\ldots, ${tex(c.iter.b)}\\}`
        : tex(c.iter);
      rows.push(`${c.vars.length > 1 ? `(${vars})` : vars} \\in ${iter}`);
    }
    for (const cond of c.conds) rows.push(tex(cond));
    const under = rows.length > 1 ? `\\substack{${rows.join(' \\\\ ')}}` : rows[0];
    out += `${sym}_{${under}}${upper} `;
  }
  return out + wrap(n.body, 5);
}

// ---------- public API ----------

/** Parse one expression and return LaTeX, or throw ParseError. */
function toLatex(src) {
  return tex(new Parser(src).parseAll());
}

/** Like toLatex, but only succeeds when the expression is a sum/product with a generator. */
function bigOpToLatex(src) {
  const ast = new Parser(src).parseAll();
  if (ast.k !== 'bigop') throw new ParseError('not a sum or product');
  return tex(ast);
}

const CALL_START = /(?<![\w.])(?:(?:math|np|numpy|torch|jnp|Base)\.)?(?:sum|fsum|nansum|prod|nanprod)\s*\(/g;

/**
 * Find sum(...)/prod(...) calls in a document. Returns [{start, end}] offsets,
 * where the text between them is the whole call including the closing paren.
 * Skips calls inside strings and # comments well enough for hovers.
 */
function findBigOpCalls(text) {
  const found = [];
  CALL_START.lastIndex = 0;
  let m;
  while ((m = CALL_START.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(text, open);
    if (close !== -1) found.push({ start: m.index, end: close + 1 });
  }
  return found;
}

function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") return -1; // strings inside: give up
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (depth === 0) return c === ')' ? i : -1; }
    if (depth > 0 && i - open > 5000) return -1;
  }
  return -1;
}

module.exports = { toLatex, bigOpToLatex, findBigOpCalls, ParseError };
