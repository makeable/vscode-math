'use strict';
// Tidies + and - with whole-number constants, so limits read like maths:
// (n + 1) - 1 -> n, 10 - 1 -> 9, n + 2 - 1 -> n + 1.

const isInt = n => n.k === 'num' && /^\d+$/.test(n.v);

function terms(node, sign, out) {
  if (node.k === 'bin' && node.op === '+') { terms(node.l, sign, out); terms(node.r, sign, out); }
  else if (node.k === 'bin' && node.op === '-') { terms(node.l, sign, out); terms(node.r, -sign, out); }
  else if (node.k === 'paren') terms(node.e, sign, out);
  else if (node.k === 'neg') terms(node.e, -sign, out);
  else if (isInt(node)) out.c += sign * Number(node.v);
  else out.t.push({ sign, node });
  return out;
}

function simplify(node) {
  if (!node || !['bin', 'paren', 'neg', 'num'].includes(node.k)) return node;
  if (node.k === 'bin' && node.op !== '+' && node.op !== '-') return node;
  const { t, c } = terms(node, 1, { t: [], c: 0 });
  let out = null;
  for (const { sign, node: n } of t) {
    if (!out) out = sign > 0 ? n : { k: 'neg', e: n };
    else out = { k: 'bin', op: sign > 0 ? '+' : '-', l: out, r: n };
  }
  if (!out) return { k: 'num', v: String(c) };
  if (c > 0) out = { k: 'bin', op: '+', l: out, r: { k: 'num', v: String(c) } };
  if (c < 0) out = { k: 'bin', op: '-', l: out, r: { k: 'num', v: String(-c) } };
  return out;
}

module.exports = { simplify };
