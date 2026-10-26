'use strict';
// Expression parser for Python, and Julia through options.
//
// It understands the math-like part of each language. Anything else throws
// ParseError and the caller skips that piece of code.
//
// Every node records start/end: its offsets in the parsed source.
//
// Node shapes:
//   {k:'num', v}  {k:'name', v}  {k:'str', v}
//   {k:'bin', op, l, r}      op: + - * / // % ^ @ xor and or dot cross
//   {k:'neg', e}  {k:'not', e}  {k:'adjoint', e}  {k:'sqrt', e}   (Julia ' and √)
//   {k:'cmp', ops:[...], items:[...]}
//   {k:'call', fn, args, kwargs}     args may contain {k:'star', e} and {k:'gen', ...}
//   {k:'index', e, idx:[...]}  {k:'attr', e, name}  {k:'paren', e}
//   {k:'tuple', items}  {k:'list', items}  {k:'set', items}
//   {k:'slice', a, b, step}          (Python x[a:b])
//   {k:'range', a, b, step}          (Julia a:b)
//   {k:'gen', body, clauses:[{vars, iter, conds}]}   generator expression
//   {k:'comp', kind:'list'|'set', body, clauses}     comprehension
//   {k:'lambda', params:[names], body}
//   {k:'ternary', cond, a, b}        a if cond else b  /  cond ? a : b
//   {k:'matrix', rows:[[...]]}       Julia [1 2; 3 4]

class ParseError extends Error {}

const OPERATORS = ['**', '//', '<=', '>=', '==', '!=', '->', '.*', './', '.^', '.+', '.-', '&&', '||',
  '+', '-', '*', '/', '%', '^', '@', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', ';', '.', '=', '!',
  '?', "'", '≤', '≥', '≠', '∈', '∉', '√', '∛', '⋅', '×', '÷', '∘'];
const KEYWORDS = new Set(['for', 'in', 'if', 'else', 'and', 'or', 'not', 'lambda', 'is']);
// Julia broadcasting operators behave like the plain ones for display
const BROADCAST = { '.*': '*', './': '/', '.^': '^', '.+': '+', '.-': '-' };
const UNICODE_CMP = { '≤': '<=', '≥': '>=', '≠': '!=' };

// Letters, including Unicode ones like μ or ℯ, but not the operator symbols above.
const NAME = new RegExp('^(?:(?![×÷√∛⋅∘≤≥≠∈∉])[A-Za-z_\\u00C0-\\uFFFF])(?:(?![×÷√∛⋅∘≤≥≠∈∉])[\\w\\u00C0-\\uFFFF])*');

function tokenize(src, options = {}) {
  const tokens = [];
  let i = 0;
  const prevAdjoinable = () => {
    const t = tokens[tokens.length - 1];
    return t && t.end === i && (t.type === 'name' || t.type === 'num' || [')', ']', "'"].includes(t.value));
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '\\') { i++; continue; } // backslash = Python line continuation
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }

    // Julia: x' is the adjoint, not a character literal
    if (c === "'" && options.adjoint && prevAdjoinable()) {
      tokens.push({ type: 'op', value: "'", start: i, end: i + 1 });
      i++;
      continue;
    }
    // Python string prefixes (r'', b'', f''); Julia has none, and b' is b followed by an adjoint
    const str = (options.adjoint ? /^()("""|"|')/ : /^(?:[rRbBuUfF]{0,2})("""|'''|"|')/).exec(src.slice(i));
    if (str && (str[0].length === str[1].length || /^[rRbBuUfF]/.test(c))) {
      const q = str[1];
      let j = i + str[0].length;
      while (j < src.length && !src.startsWith(q, j)) j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) throw new ParseError('unterminated string');
      tokens.push({ type: 'str', value: src.slice(i + str[0].length, j), start: i, end: j + q.length });
      i = j + q.length;
      continue;
    }

    const num = /^(\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?|\.\d+(?:[eE][+-]?\d+)?j?)/.exec(src.slice(i));
    if (num) { tokens.push({ type: 'num', value: num[1].replace(/_/g, ''), start: i, end: i + num[1].length }); i += num[1].length; continue; }

    const name = NAME.exec(src.slice(i));
    if (name) {
      const type = KEYWORDS.has(name[0]) ? 'kw' : 'name';
      tokens.push({ type, value: name[0], start: i, end: i + name[0].length });
      i += name[0].length;
      continue;
    }

    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character '${c}'`);
    if (op === '∈') tokens.push({ type: 'kw', value: 'in', start: i, end: i + 1 });
    else tokens.push({ type: 'op', value: op, start: i, end: i + op.length });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', start: src.length, end: src.length });
  return tokens;
}

class Parser {
  constructor(src, options = {}) {
    this.src = src;
    this.inMatrix = 0; // inside Julia [a b; c d], a space can end an element
    this.t = tokenize(src, options);
    this.p = 0;
    this.power = new Set(options.power || ['**']);
    this.julia = !!options.juliaRanges;
    this.juliaFor = !!options.juliaFor;
    this.noTernaryColon = 0; // inside a Julia ?: branch, ':' ends the expression
  }

  peek(o = 0) { return this.t[this.p + o]; }
  next() { return this.t[this.p++]; }
  last() { return this.t[this.p - 1]; }
  is(value, type) { const t = this.peek(); return t.value === value && (!type || t.type === type); }
  isOp(value) { return this.is(value, 'op'); }
  accept(value) { if (this.is(value) && this.peek().type !== 'str') { this.p++; return true; } return false; }
  expect(value) {
    if (!this.accept(value)) throw new ParseError(`expected '${value}' but found '${this.peek().value || 'end'}'`);
  }
  // Give a node its source span: from `start` (a token index) to the last token read.
  node(n, start) { n.start = this.t[start].start; n.end = this.last().end; return n; }
  // The source text between the previous token and token i (spaces, newlines)
  gapBefore(i = this.p) { return i > 0 ? this.src.slice(this.t[i - 1].end, this.t[i].start) : ''; }
  // Brackets inside a matrix element are ordinary expressions again: [f(a -b) c]
  nested(fn) {
    const m = this.inMatrix;
    this.inMatrix = 0;
    try { return fn(); } finally { this.inMatrix = m; }
  }

  /** A whole statement-level expression: allows a bare tuple like `a, b`. */
  parseAll() {
    const s = this.p;
    const first = this.expr();
    let e = first;
    if (this.isOp(',')) {
      const items = [first];
      while (this.accept(',')) { if (this.peek().type === 'eof') break; items.push(this.expr()); }
      e = this.node({ k: 'tuple', items }, s);
    }
    if (this.peek().type !== 'eof') throw new ParseError(`unexpected '${this.peek().value}'`);
    return e;
  }

  expr() {
    if (this.is('lambda', 'kw')) return this.lambda();
    // Julia: x -> body, (x, y) -> body
    if (this.julia && this.peek().type === 'name' && this.peek(1).value === '->') return this.arrow();
    if (this.julia && this.isOp('(')) {
      let j = this.p + 1;
      while (this.t[j] && (this.t[j].type === 'name' || this.t[j].value === ',')) j++;
      if (this.t[j] && this.t[j].value === ')' && this.t[j + 1] && this.t[j + 1].value === '->') return this.arrow();
    }
    return this.ternary();
  }

  lambda() {
    const s = this.p;
    this.next();
    const params = [];
    while (this.peek().type === 'name') { params.push(this.next().value); if (!this.accept(',')) break; }
    this.expect(':');
    return this.node({ k: 'lambda', params, body: this.expr() }, s);
  }

  arrow() {
    const s = this.p;
    const params = [];
    if (this.accept('(')) {
      while (this.peek().type === 'name') { params.push(this.next().value); if (!this.accept(',')) break; }
      this.expect(')');
    } else params.push(this.next().value);
    this.expect('->');
    return this.node({ k: 'lambda', params, body: this.expr() }, s);
  }

  ternary() {
    const s = this.p;
    const a = this.or();
    // Python: a if cond else b
    if (!this.julia && this.is('if', 'kw')) {
      const save = this.p;
      this.next();
      const cond = this.or();
      if (this.accept('else')) return this.node({ k: 'ternary', cond, a, b: this.expr() }, s);
      this.p = save; // a comprehension's "if" filter, not a ternary
    }
    // Julia: cond ? a : b
    if (this.julia && this.isOp('?')) {
      this.next();
      this.noTernaryColon++;
      const yes = this.expr();
      this.noTernaryColon--;
      this.expect(':');
      return this.node({ k: 'ternary', cond: a, a: yes, b: this.expr() }, s);
    }
    return a;
  }

  or() {
    const s = this.p;
    let l = this.and();
    while (this.is('or', 'kw') || this.isOp('||')) { this.next(); l = this.node({ k: 'bin', op: 'or', l, r: this.and() }, s); }
    return l;
  }

  and() {
    const s = this.p;
    let l = this.not();
    while (this.is('and', 'kw') || this.isOp('&&')) { this.next(); l = this.node({ k: 'bin', op: 'and', l, r: this.not() }, s); }
    return l;
  }

  not() {
    const s = this.p;
    if (this.is('not', 'kw') || (this.julia && this.isOp('!'))) { this.next(); return this.node({ k: 'not', e: this.not() }, s); }
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
      else if (t.type === 'op' && UNICODE_CMP[t.value]) { op = UNICODE_CMP[t.value]; this.next(); }
      else if (t.type === 'op' && t.value === '∉') { op = 'not in'; this.next(); }
      else if (t.type === 'kw' && t.value === 'in' && !this.inForTarget) { op = 'in'; this.next(); }
      else if (t.type === 'kw' && t.value === 'not' && this.peek(1).value === 'in') { op = 'not in'; this.p += 2; }
      else if (t.type === 'kw' && t.value === 'is') throw new ParseError('"is" comparisons are not math');
      if (!op) break;
      ops.push(op);
      items.push(this.arith());
    }
    return ops.length ? this.node({ k: 'cmp', ops, items }, s) : first;
  }

  arith() {
    const s = this.p;
    let l = this.term();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      const op = BROADCAST[t.value] || t.value;
      if (op !== '+' && op !== '-') break;
      // In a matrix, `a -b` is two elements but `a - b` and `a-b` are one
      if (this.inMatrix && /\s/.test(this.gapBefore()) && !/\s/.test(this.gapBefore(this.p + 1))) break;
      this.next();
      l = this.node({ k: 'bin', op, l, r: this.term() }, s);
    }
    return l;
  }

  term() {
    const s = this.p;
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      // Julia: 2x and 2(x + 1) multiply
      if (this.julia && this.last().type === 'num' && t.start === this.last().end && (t.type === 'name' || t.value === '(')) {
        l = this.node({ k: 'bin', op: '*', l, r: this.unary() }, s);
        continue;
      }
      if (t.type !== 'op') break;
      let op = BROADCAST[t.value] || t.value;
      if (op === '^') { if (this.power.has('^')) break; op = 'xor'; }
      else if (op === '⋅') op = 'dot';
      else if (op === '×') op = 'cross';
      else if (op === '÷') op = '//';
      else if (op === '∘') op = 'compose';
      else if (!['*', '/', '//', '%', '@'].includes(op)) break;
      this.next();
      l = this.node({ k: 'bin', op, l, r: this.unary() }, s);
    }
    return l;
  }

  unary() {
    const s = this.p;
    if (this.isOp('-')) { this.next(); return this.node({ k: 'neg', e: this.unary() }, s); }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    if (this.isOp('√')) { this.next(); return this.node({ k: 'sqrt', e: this.unary() }, s); }
    if (this.isOp('∛')) { this.next(); return this.node({ k: 'sqrt', n: 3, e: this.unary() }, s); }
    return this.power_();
  }

  power_() {
    const s = this.p;
    const base = this.postfix();
    const t = this.peek();
    if (t.type === 'op' && (this.power.has(t.value) || (this.power.has('^') && t.value === '.^'))) {
      this.next();
      return this.node({ k: 'bin', op: '^', l: base, r: this.unary() }, s);
    }
    return base;
  }

  postfix() {
    const s = this.p;
    let e = this.atom();
    for (;;) {
      if (this.isOp('(') && this.peek().start === this.last().end || (this.isOp('(') && !this.julia)) {
        this.next();
        e = this.node(this.nested(() => this.call(e)), s);
      } else if (this.isOp('[') && !(this.inMatrix && this.peek().start !== this.last().end)) {
        this.next();
        const idx = this.nested(() => {
          const list = [this.subscript()];
          while (this.accept(',')) list.push(this.subscript());
          this.expect(']');
          return list;
        });
        e = this.node({ k: 'index', e, idx }, s);
      } else if (this.isOp('.') && this.peek(1).type === 'name') {
        this.next();
        e = this.node({ k: 'attr', e, name: this.next().value }, s);
      } else if (this.isOp("'")) {
        this.next();
        e = this.node({ k: 'adjoint', e }, s);
      } else return e;
    }
  }

  // Inside [...]: Python slices a:b, Julia ranges 1:n
  subscript() {
    const s = this.p;
    if (this.julia) return this.iterable();
    const a = this.isOp(':') ? null : this.expr();
    if (!this.accept(':')) return a;
    const b = this.isOp(']') || this.isOp(',') || this.isOp(':') ? null : this.expr();
    let step = null;
    if (this.accept(':') && !this.isOp(']') && !this.isOp(',')) step = this.expr();
    return this.node({ k: 'slice', a, b, step }, s);
  }

  call(fn) {
    const args = [], kwargs = {};
    if (this.accept(')')) return { k: 'call', fn, args, kwargs };
    for (;;) {
      if (this.peek().type === 'name' && this.peek(1).value === '=') {
        const key = this.next().value;
        this.next();
        kwargs[key] = this.expr();
      } else if (this.isOp('*') || this.isOp('**')) {
        const s = this.p;
        this.next();
        args.push(this.node({ k: 'star', e: this.expr() }, s));
      } else if (this.julia && this.isOp(';')) {
        this.next();
      } else {
        args.push(this.maybeGenerator(this.p, this.julia ? this.iterableExpr() : this.expr()));
      }
      if (!this.accept(',')) break;
      if (this.isOp(')')) break;
    }
    this.expect(')');
    return { k: 'call', fn, args, kwargs };
  }

  // After an expression: if "for" follows, it is the body of a generator.
  maybeGenerator(start, body, kind) {
    if (!this.is('for', 'kw')) return body;
    const clauses = this.forClauses();
    return this.node(kind ? { k: 'comp', kind, body, clauses } : { k: 'gen', body, clauses }, start);
  }

  forClauses() {
    const clauses = [];
    while (this.accept('for')) {
      this.inForTarget = true;
      const vars = [this.postfix()];
      while (this.accept(',')) vars.push(this.postfix());
      this.inForTarget = false;
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

  // A full expression, or a Julia range a:b (function arguments allow both).
  iterableExpr() {
    const s = this.p;
    const a = this.expr();
    if (this.noTernaryColon || !this.isOp(':')) return a;
    this.next();
    const b = this.arith();
    if (!this.accept(':')) return this.node({ k: 'range', a, b }, s);
    return this.node({ k: 'range', a, step: b, b: this.arith() }, s);
  }

  // Julia-style a:b or a:step:b; otherwise an ordinary expression.
  iterable() {
    const s = this.p;
    const a = this.julia ? this.arith() : this.or();
    if (!this.julia || this.noTernaryColon || !this.accept(':')) return a;
    const b = this.arith();
    if (!this.accept(':')) return this.node({ k: 'range', a, b }, s);
    return this.node({ k: 'range', a, step: b, b: this.arith() }, s);
  }

  // [a, b], [x for x in xs], {a, b}, {x for x in xs}
  // Julia: [1 2; 3 4] and [1 2
  //                         3 4] are matrices; [a, b] is a list
  juliaArray() {
    const s = this.p - 1;
    if (this.accept(']')) return this.node({ k: 'list', items: [] }, s);
    this.inMatrix++;
    let first;
    try { first = this.expr(); } finally { this.inMatrix--; }
    if (this.is('for', 'kw') || this.isOp(',') || this.isOp(']')) {
      // a comprehension or a list: parse it again as one, without matrix rules
      this.p = s + 1;
      return this.nested(() => this.collection('[', ']', 'list', true));
    }
    const rows = [[first]];
    this.inMatrix++;
    try {
      for (;;) {
        if (this.accept(']')) break;
        if (this.accept(';')) { if (rows[rows.length - 1].length) rows.push([]); continue; }
        const gap = this.gapBefore();
        if (!/\s/.test(gap) || this.peek().type === 'eof') throw new ParseError('bad matrix');
        if (/\n/.test(gap) && rows[rows.length - 1].length) rows.push([]);
        rows[rows.length - 1].push(this.expr());
      }
    } finally { this.inMatrix--; }
    if (!rows[rows.length - 1].length) rows.pop();
    if (rows.some(r => r.length !== rows[0].length)) throw new ParseError('rows of different lengths');
    return this.node({ k: 'matrix', rows }, s);
  }

  collection(open, close, kind, plainJulia) {
    if (this.julia && open === '[' && !plainJulia) return this.juliaArray();
    const s = this.p - 1;
    if (this.accept(close)) return this.node({ k: kind, items: [] }, s);
    const first = this.expr();
    if (this.is('for', 'kw')) {
      const comp = this.maybeGenerator(s, first, kind);
      this.expect(close);
      comp.end = this.last().end;
      return comp;
    }
    if (kind === 'set' && this.isOp(':')) throw new ParseError('dicts are not supported');
    const items = [first];
    while (this.accept(',')) { if (this.isOp(close)) break; items.push(this.expr()); }
    this.expect(close);
    return this.node({ k: kind, items }, s);
  }

  atom() {
    const s = this.p;
    const t = this.next();
    if (t.type === 'num') return this.node({ k: 'num', v: t.value }, s);
    if (t.type === 'name') return this.node({ k: 'name', v: t.value }, s);
    if (t.type === 'str') return this.node({ k: 'str', v: t.value }, s);
    if (t.value === '[') return this.collection('[', ']', 'list');
    if (t.value === '{') return this.collection('{', '}', 'set');
    if (t.value === '(') return this.nested(() => {
      if (this.accept(')')) return this.node({ k: 'tuple', items: [] }, s);
      const first = this.expr();
      if (this.is('for', 'kw')) {
        const gen = this.maybeGenerator(s, first);
        this.expect(')');
        gen.end = this.last().end;
        return gen;
      }
      if (this.isOp(',')) {
        const items = [first];
        while (this.accept(',')) { if (this.isOp(')')) break; items.push(this.expr()); }
        this.expect(')');
        return this.node({ k: 'tuple', items }, s);
      }
      this.expect(')');
      return this.node({ k: 'paren', e: first }, s);
        });
    throw new ParseError(`unexpected '${t.value || 'end'}'`);
  }
}

function parse(src, options) {
  return new Parser(src, options).parseAll();
}

module.exports = { parse, tokenize, ParseError };
