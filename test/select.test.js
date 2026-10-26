'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { selectSpans } = require('../src/select');
const { scan } = require('../src/scan');
const { buildNotation } = require('../src/notation');

const pieces = (text, profile = 'python') =>
  selectSpans(text, buildNotation(profile)).spans.map(s => text.slice(s.start, s.end));

test('assignments draw their right-hand side', () => {
  assert.deepStrictEqual(pieces('mu = sum(x[i] for i in range(n)) / n\n'), ['sum(x[i] for i in range(n)) / n']);
});

test('tuples and unknown calls draw only their maths parts', () => {
  assert.deepStrictEqual(pieces('return mu, math.sqrt(var)\n'), ['math.sqrt(var)']);
  assert.deepStrictEqual(pieces('print("total", sum(x[i] for i in range(n)))\n'), ['sum(x[i] for i in range(n))']);
});

test('plain code is left alone', () => {
  assert.deepStrictEqual(pieces('x = y + 2 * z\nfor i in range(n):\n    total += x[i]\nimport math\n'), []);
});

test('comments and strings are skipped', () => {
  assert.deepStrictEqual(pieces('# sum(x[i] for i in range(n))\ns = "a / b"\n'), []);
  assert.deepStrictEqual(pieces('"""\nsum(x[i] for i in range(n))\n"""\n'), []);
});

test('if conditions and keyword prefixes', () => {
  assert.deepStrictEqual(pieces('if abs(a - b) / b < tol:\n    pass\n'), ['abs(a - b) / b < tol']);
});

test('multi-line expressions are one piece', () => {
  const text = 'R = np.array([[1, 2],\n              [3, 4]])\n';
  const { spans } = selectSpans(text, buildNotation('python'));
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(spans[0].latex, '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}');
  assert.ok(text.slice(spans[0].start, spans[0].end).includes('\n'));
});

test('unparseable statements still find their sums', () => {
  assert.deepStrictEqual(pieces('d = {k: sum(v[i] for i in range(n)) for k in ks}\n'), ['sum(v[i] for i in range(n))']);
});

test('julia: one-line functions and ternaries', () => {
  assert.deepStrictEqual(pieces('f(x) = x > 0 ? x : 0\n', 'julia'), ['x > 0 ? x : 0']);
  assert.deepStrictEqual(pieces('s = sum(x[i] for i in 1:n)  # total\n', 'julia'), ['sum(x[i] for i in 1:n)']);
});

test('julia: a matrix over several lines is one piece', () => {
  const text = 'R = [cos(θ) -sin(θ)\n     sin(θ)  cos(θ)]\n';
  assert.deepStrictEqual(pieces(text, 'julia'), ['[cos(θ) -sin(θ)\n     sin(θ)  cos(θ)]']);
});

test('scan masks comments and strings', () => {
  const { masked } = scan('a = 1  # b / c\nt = "x / y"\n', 'python');
  assert.ok(!masked.includes('/'));
  assert.strictEqual(masked.length, 'a = 1  # b / c\nt = "x / y"\n'.length);
});
