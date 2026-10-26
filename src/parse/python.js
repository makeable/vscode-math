'use strict';
// Expression parser for Python, and Julia through options.
//
// Only a math-like subset is understood. Anything else throws ParseError and
// the caller skips that piece of code.
//
// Every node records start/end: its offsets in the parsed source.
//
// Node shapes:
//   {k:'num', v}  {k:'name', v}  {k:'bin', op, l, r}  {k:'neg', e}  {k:'not', e}
//   {k:'cmp', ops:[...], items:[...]}  {k:'call', fn, args, kwargs}
//   {k:'index', e, idx:[...]}  {k:'attr', e, name}  {k:'paren', e}
//   {k:'range', a, b, step}          (Julia a:b)
//   {k:'gen', body, clauses:[{vars, iter, conds}]}   (generator, only as a call argument)

class ParseError extends Error {}

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
    if (num) { tokens.push({ type: 'num', value: num[1], start: i, end: i + num[1].length }); i += num[1].length; continue; }

    const name = /^[A-Za-z_À-∇∉-￿][\wÀ-∇∉-￿]*/.exec(src.slice(i));
    if (name) {
      const type = KEYWORDS.has(name[0]) ? 'kw' : 'name';
      tokens.push({ type, value: name[0], start: i, end: i + name[0].length });
      i += name[0].length;
      continue;
    }
    if (c === '∈') { tokens.push({ type: 'kw', value: 'in', start: i, end: i + 1 }); i++; continue; }

    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character '${c}'`);
    tokens.push({ type: 'op', value: op, start: i, end: i + op.length });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', start: src.length, end: src.length });
  return tokens;
}

class Parser {
  constructor(src, options = {}) {
    this.t = tokenize(src);
    this.p = 0;
    this.power = new Set(options.power || ['**']);
    this.juliaRanges = !!options.juliaRanges;
    this.juliaFor = !!options.juliaFor;
  }

  peek(o = 0) { return this.t[this.p + o]; }
  next() { return this.t[this.p++]; }
  last() { return this.t[this.p - 1]; }
  is(value, type) { const t = this.peek(); return t.value === value && (!type || t.type === type); }
  accept(value) { if (this.is(value)) { this.p++; return true; } return false; }
  expect(value) {
    if (!this.accept(value)) throw new ParseError(`expected '${value}' but found '${this.peek().value || 'end'}'`);
  }
  // Give a node its source span: from `start` (a token index) to the last token read.
  node(n, start) { n.start = this.t[start].start; n.end = this.last().end; return n; }

  parseAll() {
    const e = this.expr();
    if (this.peek().type !== 'eof') throw new ParseError(`unexpected '${this.peek().value}'`);
    return e;
  }

  expr() { return this.or(); }

  or() {
    const s = this.p;
    let l = this.and();
    while (this.is('or', 'kw')) { this.next(); l = this.node({ k: 'bin', op: 'or', l, r: this.and() }, s); }
    return l;
  }

  and() {
    const s = this.p;
    let l = this.not();
    while (this.is('and', 'kw')) { this.next(); l = this.node({ k: 'bin', op: 'and', l, r: this.not() }, s); }
    return l;
  }

  not() {
    const s = this.p;
    if (this.is('not', 'kw')) { this.next(); return this.node({ k: 'not', e: this.not() }, s); }
    return this.comparison();
  }

  comparison() {
    const s = this.p;
    const first = this.arith();
    const ops = [], items = [first];
    for (;;) {
      const t = this.peek();
      let op = null;
      if (t.type === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.value)) { op = t.value; this.next(); }
      else if (t.type === 'kw' && t.value === 'in') { op = 'in'; this.next(); }
      else if (t.type === 'kw' && t.value === 'not' && this.peek(1).value === 'in') { op = 'not in'; this.p += 2; }
      if (!op) break;
      ops.push(op);
      items.push(this.arith());
    }
    return ops.length ? this.node({ k: 'cmp', ops, items }, s) : first;
  }

  arith() {
    const s = this.p;
    let l = this.term();
    while (this.is('+', 'op') || this.is('-', 'op')) {
      const op = this.next().value;
      l = this.node({ k: 'bin', op, l, r: this.term() }, s);
    }
    return l;
  }

  term() {
    const s = this.p;
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      let op = t.value;
      if (op === '^' && !this.power.has('^')) op = 'xor';
      else if (!['*', '/', '//', '%'].includes(op)) break;
      this.next();
      l = this.node({ k: 'bin', op, l, r: this.unary() }, s);
    }
    return l;
  }

  unary() {
    const s = this.p;
    if (this.is('-', 'op')) { this.next(); return this.node({ k: 'neg', e: this.unary() }, s); }
    if (this.is('+', 'op')) { this.next(); return this.unary(); }
    return this.power_();
  }

  power_() {
    const s = this.p;
    const base = this.postfix();
    const t = this.peek();
    if (t.type === 'op' && this.power.has(t.value)) {
      this.next();
      return this.node({ k: 'bin', op: '^', l: base, r: this.unary() }, s);
    }
    return base;
  }

  postfix() {
    const s = this.p;
    let e = this.atom();
    for (;;) {
      if (this.accept('(')) e = this.node(this.call(e), s);
      else if (this.accept('[')) {
        const idx = [this.subscript()];
        while (this.accept(',')) idx.push(this.subscript());
        this.expect(']');
        e = this.node({ k: 'index', e, idx }, s);
      } else if (this.is('.', 'op') && this.peek(1).type === 'name') {
        this.next();
        e = this.node({ k: 'attr', e, name: this.next().value }, s);
      } else return e;
    }
  }

  // Inside [...]: Julia allows ranges like x[1:n]
  subscript() {
    return this.juliaRanges ? this.iterable() : this.expr();
  }

  call(fn) {
    const args = [], kwargs = {};
    if (this.accept(')')) return { k: 'call', fn, args, kwargs };
    for (;;) {
      if (this.peek().type === 'name' && this.peek(1).value === '=' ) {
        const key = this.next().value;
        this.next();
        kwargs[key] = this.expr();
      } else {
        const s = this.p;
        const first = this.expr();
        if (this.is('for', 'kw')) {
          const clauses = this.forClauses();
          args.push(this.node({ k: 'gen', body: first, clauses }, s));
        } else args.push(first);
      }
      if (!this.accept(',')) break;
      if (this.is(')')) break;
    }
    this.expect(')');
    return { k: 'call', fn, args, kwargs };
  }

  forClauses() {
    const clauses = [];
    while (this.accept('for')) {
      const vars = [this.postfix()];
      while (this.accept(',')) vars.push(this.postfix());
      // Python: for i in ...; Julia also allows for i = ... and for i ∈ ...
      if (!this.accept('in') && !(this.juliaFor && this.accept('='))) {
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
    const s = this.p;
    const a = this.arith();
    if (!this.juliaRanges || !this.accept(':')) return a;
    const b = this.arith();
    if (!this.accept(':')) return this.node({ k: 'range', a, b }, s);
    return this.node({ k: 'range', a, step: b, b: this.arith() }, s);
  }

  atom() {
    const s = this.p;
    const t = this.next();
    if (t.type === 'num') return this.node({ k: 'num', v: t.value }, s);
    if (t.type === 'name') return this.node({ k: 'name', v: t.value }, s);
    if (t.value === '(') {
      const e = this.expr();
      if (this.is('for', 'kw')) throw new ParseError('bare generator in parentheses');
      this.expect(')');
      return this.node({ k: 'paren', e }, s);
    }
    throw new ParseError(`unexpected '${t.value || 'end'}'`);
  }
}

function parse(src, options) {
  return new Parser(src, options).parseAll();
}

module.exports = { parse, tokenize, ParseError };
