'use strict';
// Expression parser for JavaScript and TypeScript.
//
// It produces the same node shapes as parse/python.js, so the renderer and
// notation tables work the same way:
//   x => body, (a, b) => body       {k:'lambda', params, body}
//   c ? a : b                       {k:'ternary', cond, a, b}
//   a ** b                          {k:'bin', op:'^'}
//   a === b, a !== b                {k:'cmp', ops:['=='|'!=']}
//   [a, b]                          {k:'list', items}
//   {length: n}                     {k:'object', props}
//   ...xs                           {k:'star', e}
//   'text', `text`, /re/            {k:'str', v}
// TypeScript annotations (x: number, as T, x!) are skipped.

class ParseError extends Error {}

const OPERATORS = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '>>>', '...', '**', '==', '!=', '<=', '>=', '&&', '||', '??',
  '?.', '=>', '<<', '>>', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', '(', ')', '[', ']', '{', '}', ',', '.', ';', '@'];
const KEYWORDS = new Set(['new', 'function', 'class', 'typeof', 'void', 'delete', 'await', 'async', 'instanceof', 'in', 'of', 'as', 'satisfies', 'return', 'yield', 'this']);
const NAME = /^[A-Za-z_$À-￿][\w$À-￿]*/;

// A "/" starts a regex literal when it can't be division: at the start, or after an operator or keyword.
function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'num' || prev.type === 'str' || prev.type === 'name') return false;
  if (prev.type === 'kw') return !['this'].includes(prev.value);
  return ![')', ']', '}'].includes(prev.value);
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    const prev = tokens[tokens.length - 1];

    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c === '`' && src.startsWith('${', j)) { depth++; j += 2; continue; }
        if (c === '`' && depth && src[j] === '}') { depth--; j++; continue; }
        if (src[j] === c && !depth) break;
        j++;
      }
      if (j >= src.length) throw new ParseError('unterminated string');
      tokens.push({ type: 'str', value: src.slice(i + 1, j), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '/' && regexAllowed(prev)) {
      let j = i + 1, cls = false;
      while (j < src.length && (cls || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '\n') throw new ParseError('bad regex');
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      tokens.push({ type: 'str', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    const num = /^(0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?n?|\.\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num) {
      tokens.push({ type: 'num', value: num[1].replace(/_/g, '').replace(/n$/, ''), start: i, end: i + num[1].length });
      i += num[1].length;
      continue;
    }
    const name = NAME.exec(src.slice(i));
    if (name) {
      tokens.push({ type: KEYWORDS.has(name[0]) ? 'kw' : 'name', value: name[0], start: i, end: i + name[0].length });
      i += name[0].length;
      continue;
    }
    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character '${c}'`);
    tokens.push({ type: 'op', value: op, start: i, end: i + op.length });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', start: src.length, end: src.length });
  return tokens;
}

class Parser {
  constructor(src) { this.t = tokenize(src); this.p = 0; }
  peek(o = 0) { return this.t[Math.min(this.p + o, this.t.length - 1)]; }
  next() { return this.t[this.p++]; }
  last() { return this.t[this.p - 1]; }
  isOp(v) { const t = this.peek(); return t.type === 'op' && t.value === v; }
  isKw(v) { const t = this.peek(); return t.type === 'kw' && t.value === v; }
  accept(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  expect(v) { if (!this.accept(v)) throw new ParseError(`expected '${v}' but found '${this.peek().value || 'end'}'`); }
  node(n, start) { n.start = this.t[start].start; n.end = this.last().end; return n; }

  parseAll() {
    const s = this.p;
    let e = this.expr();
    if (this.isOp(',')) {
      const items = [e];
      while (this.accept(',')) items.push(this.expr());
      e = this.node({ k: 'tuple', items }, s);
    }
    this.accept(';');
    if (this.peek().type !== 'eof') throw new ParseError(`unexpected '${this.peek().value}'`);
    return e;
  }

  // ---- arrow functions ----

  // Is there an arrow function at the current position? Returns the index after its params, or -1.
  arrowAhead() {
    let j = this.p;
    if (this.t[j].type === 'kw' && this.t[j].value === 'async') j++;
    if (this.t[j].type === 'name' && this.t[j + 1].value === '=>') return j;
    if (this.t[j].value !== '(') return -1;
    let depth = 0;
    for (; j < this.t.length; j++) {
      const v = this.t[j].value;
      if (this.t[j].type === 'op' && ['(', '[', '{'].includes(v)) depth++;
      else if (this.t[j].type === 'op' && [')', ']', '}'].includes(v)) { depth--; if (depth === 0) break; }
      if (this.t[j].type === 'eof') return -1;
    }
    let k = j + 1;
    if (this.t[k] && this.t[k].value === ':') { // return type annotation
      k++;
      while (this.t[k] && this.t[k].type !== 'eof' && this.t[k].value !== '=>') k++;
    }
    return this.t[k] && this.t[k].value === '=>' ? this.p : -1;
  }

  arrow() {
    const s = this.p;
    if (this.isKw('async')) this.next();
    const params = [];
    if (this.peek().type === 'name') params.push(this.next().value);
    else {
      this.expect('(');
      while (!this.isOp(')')) {
        if (this.accept('...')) { /* rest parameter */ }
        if (this.isOp('[') || this.isOp('{')) throw new ParseError('destructuring parameters');
        if (this.peek().type !== 'name') throw new ParseError('parameter');
        params.push(this.next().value);
        this.accept('?');
        if (this.accept(':')) this.skipType([',', ')']);
        if (this.accept('=')) this.assign();
        if (!this.accept(',')) break;
      }
      this.expect(')');
      if (this.accept(':')) this.skipType(['=>']);
    }
    this.expect('=>');
    let body;
    if (this.accept('{')) {
      // { return expr; } is the only block body we draw
      if (!(this.isKw('return'))) throw new ParseError('block body');
      this.next();
      body = this.expr();
      this.accept(';');
      this.expect('}');
    } else body = this.assign();
    return this.node({ k: 'lambda', params, body }, s);
  }

  // Skip a TypeScript type up to one of the stop tokens at bracket depth 0.
  skipType(stops) {
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') return;
      if (depth === 0 && t.type === 'op' && stops.includes(t.value)) return;
      if (t.type === 'op' && ['(', '[', '{', '<'].includes(t.value)) depth++;
      if (t.type === 'op' && [')', ']', '}', '>'].includes(t.value)) { if (depth === 0) return; depth--; }
      this.next();
    }
  }

  // ---- expressions ----

  expr() { return this.assign(); }

  assign() {
    if (this.arrowAhead() >= 0) return this.arrow();
    return this.ternary();
  }

  ternary() {
    const s = this.p;
    const cond = this.nullish();
    if (!this.isOp('?')) return cond;
    this.next();
    const a = this.assign();
    this.expect(':');
    return this.node({ k: 'ternary', cond, a, b: this.assign() }, s);
  }

  nullish() {
    const l = this.or();
    if (this.isOp('??')) throw new ParseError('?? is not math');
    return l;
  }

  or() {
    const s = this.p;
    let l = this.and();
    while (this.accept('||')) l = this.node({ k: 'bin', op: 'or', l, r: this.and() }, s);
    return l;
  }

  and() {
    const s = this.p;
    let l = this.bitor();
    while (this.accept('&&')) l = this.node({ k: 'bin', op: 'and', l, r: this.bitor() }, s);
    return l;
  }

  bitor() {
    const s = this.p;
    let l = this.equality();
    for (;;) {
      if (this.isOp('^')) { this.next(); l = this.node({ k: 'bin', op: 'xor', l, r: this.equality() }, s); continue; }
      if (this.isOp('|') || this.isOp('&')) throw new ParseError('bitwise operators are not math');
      return l;
    }
  }

  equality() {
    const s = this.p;
    const first = this.relational();
    const ops = [], items = [first];
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      const op = { '===': '==', '==': '==', '!==': '!=', '!=': '!=' }[t.value];
      if (!op) break;
      this.next();
      ops.push(op);
      items.push(this.relational());
    }
    return ops.length ? this.node({ k: 'cmp', ops, items }, s) : first;
  }

  relational() {
    const s = this.p;
    const first = this.additive();
    const ops = [], items = [first];
    for (;;) {
      const t = this.peek();
      if (t.type === 'kw' && (t.value === 'instanceof' || t.value === 'in')) throw new ParseError(`${t.value} is not math`);
      if (t.type === 'kw' && (t.value === 'as' || t.value === 'satisfies')) { this.next(); this.skipType([')', ']', '}', ',', ';', '?', ':']); continue; }
      if (t.type !== 'op' || !['<', '>', '<=', '>='].includes(t.value)) break;
      this.next();
      ops.push(t.value);
      items.push(this.additive());
    }
    return ops.length ? this.node({ k: 'cmp', ops, items }, s) : first;
  }

  additive() {
    const s = this.p;
    let l = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      l = this.node({ k: 'bin', op, l, r: this.multiplicative() }, s);
    }
    if (this.isOp('<<') || this.isOp('>>') || this.isOp('>>>')) throw new ParseError('shifts are not math');
    return l;
  }

  multiplicative() {
    const s = this.p;
    let l = this.exponent();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().value;
      l = this.node({ k: 'bin', op, l, r: this.exponent() }, s);
    }
    return l;
  }

  exponent() {
    const s = this.p;
    const base = this.unary();
    if (this.accept('**')) return this.node({ k: 'bin', op: '^', l: base, r: this.exponent() }, s);
    return base;
  }

  unary() {
    const s = this.p;
    if (this.accept('-')) return this.node({ k: 'neg', e: this.unary() }, s);
    if (this.accept('+')) return this.unary();
    if (this.accept('!')) return this.node({ k: 'not', e: this.unary() }, s);
    if (this.isKw('await')) { this.next(); return this.unary(); }
    if (this.isOp('~') || this.isKw('typeof') || this.isKw('void') || this.isKw('delete') || this.isOp('++') || this.isOp('--')) {
      throw new ParseError('not math');
    }
    return this.postfix();
  }

  postfix() {
    const s = this.p;
    let e = this.atom();
    for (;;) {
      if (this.isOp('(')) {
        this.next();
        e = this.node(this.call(e), s);
      } else if (this.isOp('[')) {
        this.next();
        const idx = [this.expr()];
        this.expect(']');
        e = this.node({ k: 'index', e, idx }, s);
      } else if ((this.isOp('.') || this.isOp('?.')) && (this.peek(1).type === 'name' || this.peek(1).type === 'kw')) {
        this.next();
        e = this.node({ k: 'attr', e, name: this.next().value }, s);
      } else if (this.isOp('?.') && this.peek(1).value === '(') {
        this.next(); // a?.(x) calls like a(x)
      } else if (this.isOp('!') && !['=', '=='].includes(this.peek(1).value) && this.peek().start === this.last().end) {
        this.next(); // TypeScript non-null x!
      } else if (this.isOp('<') && this.genericCallAhead()) {
        this.skipType(['(']); // f<number>(x)
      } else if (this.isOp('++') || this.isOp('--')) {
        throw new ParseError('not math');
      } else return e;
    }
  }

  genericCallAhead() {
    let depth = 0;
    for (let j = this.p; j < this.t.length; j++) {
      const v = this.t[j].value;
      if (v === '<') depth++;
      else if (v === '>') { depth--; if (depth === 0) return this.t[j + 1] && this.t[j + 1].value === '('; }
      else if (this.t[j].type === 'eof' || [';', '=', '&&', '||'].includes(v)) return false;
    }
    return false;
  }

  call(fn) {
    const args = [];
    while (!this.isOp(')')) {
      const s = this.p;
      if (this.accept('...')) args.push(this.node({ k: 'star', e: this.assign() }, s));
      else args.push(this.assign());
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return { k: 'call', fn, args, kwargs: {} };
  }

  object() {
    const s = this.p - 1;
    const props = {};
    while (!this.isOp('}')) {
      const t = this.next();
      if (t.type !== 'name' && t.type !== 'str' && t.type !== 'kw') throw new ParseError('object key');
      const key = t.value;
      props[key] = this.accept(':') ? this.assign() : { k: 'name', v: key, start: t.start, end: t.end };
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return this.node({ k: 'object', props }, s);
  }

  atom() {
    const s = this.p;
    const t = this.next();
    if (t.type === 'num') return this.node({ k: 'num', v: t.value }, s);
    if (t.type === 'name') return this.node({ k: 'name', v: t.value }, s);
    if (t.type === 'str') return this.node({ k: 'str', v: t.value }, s);
    if (t.type === 'kw' && t.value === 'this') return this.node({ k: 'name', v: 'this' }, s);
    if (t.value === '(') {
      const e = this.expr();
      if (this.isOp(',')) {
        const items = [e];
        while (this.accept(',')) items.push(this.expr());
        this.expect(')');
        return this.node({ k: 'tuple', items }, s);
      }
      this.expect(')');
      return this.node({ k: 'paren', e }, s);
    }
    if (t.value === '[') {
      const items = [];
      while (!this.isOp(']')) {
        const is = this.p;
        if (this.accept('...')) items.push(this.node({ k: 'star', e: this.assign() }, is));
        else items.push(this.assign());
        if (!this.accept(',')) break;
      }
      this.expect(']');
      return this.node({ k: 'list', items }, s);
    }
    if (t.value === '{') return this.object();
    throw new ParseError(`unexpected '${t.value || 'end'}'`);
  }
}

function parse(src) {
  return new Parser(src).parseAll();
}

module.exports = { parse, tokenize, ParseError };
