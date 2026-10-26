'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildNotation } = require('../src/notation');
const { render } = require('../src/tex');
const { parse } = require('../src/parse/cfamily');
const { selectSpans } = require('../src/select');
const { scan } = require('../src/scan');

const JS = buildNotation('javascript');
const latex = (src, n = JS) => render(parse(src), n).latex;

const cases = [
  // reduce pipelines
  ['xs.reduce((s, x) => s + x, 0)', '\\sum_{x \\in \\mathit{xs}} x'],
  ['xs.map(x => x * x).reduce((a, b) => a + b, 0)', '\\sum_{x \\in \\mathit{xs}} x \\cdot x'],
  ['xs.filter(x => x > 0).reduce((a, b) => a * b, 1)', '\\prod_{\\substack{x \\in \\mathit{xs} \\\\ x > 0}} x'],
  ['xs.reduce((m, x) => Math.max(m, f(x)), -Infinity)', '\\max_{x \\in \\mathit{xs}} f\\left(x\\right)'],
  ['xs.reduce((ok, x) => ok && x > 0, true)', '\\forall\\, x \\in \\mathit{xs}\\colon\\ x > 0'],
  ['Array.from({ length: n }, (_, i) => w[i] * x[i]).reduce((a, b) => a + b, 0)', '\\sum_{i=0}^{n - 1} w_{i} x_{i}'],
  ['[...Array(n).keys()].map(k => 1 / (k + 1) ** 2).reduce((s, t) => s + t, 0)', '\\sum_{k=0}^{n - 1} \\frac{1}{\\left(k + 1\\right)^{2}}'],
  ['_.range(1, n + 1).reduce((acc, k) => acc * k, 1)', '\\prod_{k=1}^{n} k'],
  ['d3.range(n).map(i => a[i]).reduce((s, v) => s + v)', '\\sum_{i=0}^{n - 1} a_{i}'],
  // quantifiers and accessors
  ['xs.every(x => x > 0)', '\\forall\\, x \\in \\mathit{xs}\\colon\\ x > 0'],
  ['xs.some(x => Math.abs(f(x)) < eps)', '\\exists\\, x \\in \\mathit{xs}\\colon\\ \\left|f\\left(x\\right)\\right| < \\epsilon'],
  ['d3.sum(data, d => d.value)', '\\sum_{d \\in \\mathit{data}} d{.}\\mathit{value}'],
  ['d3.mean(xs, x => x ** 2)', '\\frac{1}{\\left|\\mathit{xs}\\right|} \\sum_{x \\in \\mathit{xs}} x^{2}'],
  ['_.maxBy(models, m => score(m))', '\\operatorname*{arg\\,max}_{m \\in \\mathit{models}} \\operatorname{score}\\left(m\\right)'],
  // Math
  ['(-b + Math.sqrt(b ** 2 - 4 * a * c)) / (2 * a)', '\\frac{-b + \\sqrt{b^{2} - 4 a c}}{2 a}'],
  ['Math.hypot(dx, dy)', '\\sqrt{\\mathit{dx}^{2} + \\mathit{dy}^{2}}'],
  ['Math.log(x) / Math.LN2', '\\frac{\\ln\\left(x\\right)}{\\ln 2}'],
  ['Math.max(...xs)', '\\max \\mathit{xs}'],
  ['Math.PI * r ** 2', '\\pi r^{2}'],
  ['2 ** -k', '2^{-k}'],
  // linear algebra
  ['math.multiply(math.inv(math.multiply(math.transpose(A), A)), math.transpose(A))', '\\left(A^{\\top} A\\right)^{-1} A^{\\top}'],
  ['math.matrix([[1, 2], [3, 4]])', '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}'],
  ['W.matMul(x).add(b)', 'W x + b'],
  // piecewise, lambdas, TypeScript
  ['x < 0 ? -1 : x === 0 ? 0 : 1', '\\begin{cases} -1 & \\text{if } x < 0 \\\\ 0 & \\text{if } x = 0 \\\\ 1 & \\text{otherwise} \\end{cases}'],
  ['(z: number): number => z > 0 ? z : 0', 'z \\mapsto \\begin{cases} z & \\text{if } z > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
  ['(x as number) ** 2 / 2', '\\frac{x^{2}}{2}'],
  ['values!.length', '\\left|\\mathit{values}\\right|'],
  ['xHat - xBar', '\\hat{x} - \\bar{x}'],
  ['a !== b && c === d', 'a \\ne b \\land c = d'],
];
for (const [src, want] of cases) test(`js: ${src}`, () => assert.strictEqual(latex(src), want));

test('js: things that are not maths are refused', () => {
  for (const src of ['f(x) ?? 0', 'a | b', '`total ${n}` + 1', 'new Foo(x) / 2', 'x++']) {
    assert.throws(() => render(parse(src), JS), src);
  }
});

test('js: reducers come from settings', () => {
  const n = buildNotation('javascript', { reducers: { '*': null, 'Math.hypot': 'norm' }, bigOperators: { norm: '\\operatorname{N}' } });
  const off = render(parse('xs.reduce((a, b) => a * b, 1)'), n);
  assert.ok(!off.display && !off.latex.includes('\\prod'), off.latex); // left as code
  assert.strictEqual(latex('xs.reduce((h, x) => Math.hypot(h, x), 0)', n), '\\operatorname{N}_{x \\in \\mathit{xs}} x');
});

const pieces = text => selectSpans(text, JS).spans.map(s => text.slice(s.start, s.end));

test('js: statements, blocks and object properties', () => {
  const text = [
    'const total = xs.reduce((s, x) => s + x, 0);',
    'function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }',
    'if (Math.abs(a - b) / b < tol) { done = true }',
    'const stats = {',
    '  rms: Math.sqrt(sq / n),',
    '  label: "a / b",',
    '};',
    'let y = x',
    '  ? 1 / x',
    '  : 0',
  ].join('\n');
  assert.deepStrictEqual(pieces(text), [
    'xs.reduce((s, x) => s + x, 0)',
    'xs.reduce((a, b) => a + b, 0) / xs.length',
    'Math.abs(a - b) / b < tol',
    'Math.sqrt(sq / n)',
    'x\n  ? 1 / x\n  : 0',
  ]);
});

test('js: comments, strings, templates and regexes are masked', () => {
  const text = 'const re = /a\\/b/g; // x / y\nconst s = `${a / b}`; /* 1 / 2 */ const t = "p / q";\n';
  const { masked } = scan(text, 'js');
  assert.ok(!masked.includes('/'), masked);
  assert.strictEqual(masked.length, text.length);
  assert.deepStrictEqual(pieces(text), []);
});
