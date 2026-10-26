'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bigOpToLatex, findBigOpCalls } = require('../src/latex');

const cases = [
  // the example from the chat: sum of x_i for i = 1..n
  ['sum(x[i] for i in range(1, n+1))', '\\sum_{i=1}^{n} x_{i}'],
  ['sum(x[i] for i in range(n))', '\\sum_{i=0}^{n - 1} x_{i}'],
  ['sum(x[i] for i in range(10))', '\\sum_{i=0}^{9} x_{i}'],
  ['sum(x[i] for i in range(0, n + 2))', '\\sum_{i=0}^{n + 1} x_{i}'],
  // Julia
  ['sum(x[i] for i in 1:n)', '\\sum_{i=1}^{n} x_{i}'],
  ['sum(x[i] for i = 1:n)', '\\sum_{i=1}^{n} x_{i}'],
  ['sum(x[i] for i ∈ 1:n)', '\\sum_{i=1}^{n} x_{i}'],
  ['sum(i for i in 1:2:n)', '\\sum_{i \\in \\{1, 1 + 2, \\ldots, n\\}} i'],
  // arithmetic
  ['sum(a[i]*b[i] for i in range(n))', '\\sum_{i=0}^{n - 1} a_{i} b_{i}'],
  ['sum(x[i]**2 for i in range(n))', '\\sum_{i=0}^{n - 1} x_{i}^{2}'],
  ['sum((x[i] - mu)**2 for i in range(n)) / n', null],
  ['sum(1/k**2 for k in range(1, N+1))', '\\sum_{k=1}^{N} \\frac{1}{k^{2}}'],
  ['sum(2*x[i] for i in range(n))', '\\sum_{i=0}^{n - 1} 2 x_{i}'],
  ['sum(x[i]*2 for i in range(n))', '\\sum_{i=0}^{n - 1} x_{i} \\cdot 2'],
  ['sum(math.sqrt(x[i]) for i in range(n))', '\\sum_{i=0}^{n - 1} \\sqrt{x_{i}}'],
  ['sum(abs(x[i] - y[i]) for i in range(n))', '\\sum_{i=0}^{n - 1} \\left|x_{i} - y_{i}\\right|'],
  ['sum(alpha**k for k in range(n))', '\\sum_{k=0}^{n - 1} \\alpha^{k}'],
  ['np.sum(np.exp(-x[i]) for i in range(n))', '\\sum_{i=0}^{n - 1} e^{-x_{i}}'],
  // nesting, conditions, sets, products
  ['sum(A[i][j] for i in range(n) for j in range(m))', '\\sum_{i=0}^{n - 1} \\sum_{j=0}^{m - 1} A_{i,j}'],
  ['sum(A[i, j] for i in range(n) for j in range(m))', '\\sum_{i=0}^{n - 1} \\sum_{j=0}^{m - 1} A_{i,j}'],
  ['sum(sum(A[i][j] for j in range(m)) for i in range(n))', '\\sum_{i=0}^{n - 1} \\sum_{j=0}^{m - 1} A_{i,j}'],
  ['sum(x[i] for i in range(n) if i % 2 == 0)', '\\sum_{\\substack{i=0 \\\\ i \\bmod 2 = 0}}^{n - 1} x_{i}'],
  ['sum(w for w in weights)', '\\sum_{w \\in \\mathit{weights}} w'],
  ['sum(p * v for p, v in pairs)', '\\sum_{(p, v) \\in \\mathit{pairs}} p v'],
  ['math.prod(x[i] for i in range(1, n+1))', '\\prod_{i=1}^{n} x_{i}'],
  ['sum(x[i] for i in range(1, n+1)  # total\n)', '\\sum_{i=1}^{n} x_{i}'],
];

for (const [src, want] of cases) {
  test(src, () => {
    if (want === null) {
      // not a bare sum (it's divided by n), so the hover should skip it
      assert.throws(() => bigOpToLatex(src));
    } else {
      assert.strictEqual(bigOpToLatex(src), want);
    }
  });
}

test('mean/variance-style division by a sum renders the sum as a fraction part', () => {
  const { toLatex } = require('../src/latex');
  assert.strictEqual(
    toLatex('sum((x[i] - mu)**2 for i in range(n)) / n'),
    '\\frac{\\sum_{i=0}^{n - 1} \\left(x_{i} - \\mu\\right)^{2}}{n}');
});

test('rejects things that are not math', () => {
  assert.throws(() => bigOpToLatex('sum(len(s) for s in "abc")'));
  assert.throws(() => bigOpToLatex('sum(values)'));
  assert.throws(() => bigOpToLatex('sum([x for x in xs])'));
});

test('findBigOpCalls finds outer and nested calls with offsets', () => {
  const text = 'total = sum(sum(A[i][j] for j in range(m)) for i in range(n))\nother(sum)';
  const calls = findBigOpCalls(text).map(c => text.slice(c.start, c.end));
  assert.deepStrictEqual(calls, [
    'sum(sum(A[i][j] for j in range(m)) for i in range(n))',
    'sum(A[i][j] for j in range(m))',
  ]);
});

test('findBigOpCalls ignores method calls on other objects and np.sum is included', () => {
  const text = 'df.sum(axis=0); np.sum(x[i] for i in range(n)); mysum(x)';
  const calls = findBigOpCalls(text).map(c => text.slice(c.start, c.end));
  assert.deepStrictEqual(calls, ['np.sum(x[i] for i in range(n))']);
});
