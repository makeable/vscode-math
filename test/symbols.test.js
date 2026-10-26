'use strict';
// The big symbols: each Python or Julia expression and the LaTeX it should draw.
const test = require('node:test');
const assert = require('node:assert');
const { buildNotation } = require('../src/notation');
const { render } = require('../src/tex');
const { parse } = require('../src/parse/python');

const PY = buildNotation('python');
const JL = buildNotation('julia');
const latex = (src, n = PY) => render(parse(src, n.options), n).latex;

const python = [
  // big operators
  ['all(x > 0 for x in xs)', '\\forall\\, x \\in \\mathit{xs}\\colon\\ x > 0'],
  ['any(p[i] for i in range(n))', '\\exists\\, i \\in \\{0, \\ldots, n - 1\\}\\colon\\ p_{i}'],
  ['max(f(x) for x in S)', '\\max_{x \\in S} f\\left(x\\right)'],
  ['min(d[j] for j in range(1, m + 1))', '\\min_{j \\in \\{1, \\ldots, m\\}} d_{j}'],
  ['max(range(n), key=lambda i: f(i))', '\\operatorname*{arg\\,max}_{i \\in \\{0, \\ldots, n - 1\\}} f\\left(i\\right)'],
  ['set().union(*(A[i] for i in range(n)))', '\\bigcup_{i=0}^{n - 1} A_{i}'],
  ['set.intersection(*(B[k] for k in K))', '\\bigcap_{k \\in K} B_{k}'],
  ['{f(x) for x in S if p(x)}', '\\left\\{ f\\left(x\\right) \\;\\middle|\\; x \\in S,\\ p\\left(x\\right) \\right\\}'],
  ['math.prod(1 + r[t] for t in range(T))', '\\prod_{t=0}^{T - 1} \\left(1 + r_{t}\\right)'],
  ['np.sum(x[1:n])', '\\sum_{i=1}^{n - 1} x_{i}'],
  // calculus
  ['quad(lambda x: x**2, 0, 1)[0]', '\\int_{0}^{1} x^{2} \\,dx'],
  ['quad(f, a, b)', '\\int_{a}^{b} f\\left(x\\right) \\,dx'],
  ['sympy.integrate(f, (x, a, b))', '\\int_{a}^{b} f \\,dx'],
  ['sp.integrate(f, x)', '\\int f \\,dx'],
  ['sp.diff(f, x)', '\\frac{d}{dx} f'],
  ['sp.diff(f, x, 2)', '\\frac{d^{2}}{dx^{2}} f'],
  ['sympy.limit(sin(x)/x, x, 0)', '\\lim_{x \\to 0} \\frac{\\sin\\left(x\\right)}{x}'],
  ['sp.Sum(1/k**2, (k, 1, oo))', '\\sum_{k=1}^{\\infty} \\frac{1}{k^{2}}'],
  ['jax.grad(f)', '\\nabla f'],
  ['f.diff(x)', '\\frac{d}{dx} f'],
  // fractions, roots, powers
  ['(-b + math.sqrt(b**2 - 4*a*c)) / (2*a)', '\\frac{-b + \\sqrt{b^{2} - 4 a c}}{2 a}'],
  ['math.comb(n, k) * p**k * (1 - p)**(n - k)', '\\binom{n}{k} p^{k} \\left(1 - p\\right)^{n - k}'],
  ['n // 2', '\\left\\lfloor \\frac{n}{2} \\right\\rfloor'],
  ['exp(x)**2', '\\left(e^{x}\\right)^{2}'],
  ['abs(eps) <= 1e-9', '\\left|\\epsilon\\right| \\le 10^{-9}'],
  // linear algebra
  ['np.linalg.inv(A.T @ A) @ A.T @ y', '\\left(A^{\\top} A\\right)^{-1} A^{\\top} y'],
  ['np.linalg.norm(v)', '\\left\\|v\\right\\|'],
  ['np.linalg.norm(v, 1)', '\\left\\|v\\right\\|_{1}'],
  ['np.dot(a, b)', 'a \\cdot b'],
  ['a.dot(b)', 'a \\cdot b'],
  ['np.cross(e1, e2)', 'e_{1} \\times e_{2}'],
  ['np.outer(u, v)', 'u \\otimes v'],
  ['np.linalg.det(A)', '\\det A'],
  ['np.trace(A)', '\\operatorname{tr} A'],
  ['np.linalg.solve(A, b)', 'A^{-1} b'],
  ['np.array([[1, 2], [3, 4]])', '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}'],
  ['np.array([1, 2, 3])', '\\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}'],
  ['z.conjugate()', '\\overline{z}'],
  // piecewise
  ['x if x > 0 else 0', '\\begin{cases} x & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
  ['-1 if x < 0 else 0 if x == 0 else 1', '\\begin{cases} -1 & \\text{if } x < 0 \\\\ 0 & \\text{if } x = 0 \\\\ 1 & \\text{otherwise} \\end{cases}'],
  ['np.where(z > 0, z, 0)', '\\begin{cases} z & \\text{if } z > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
  // statistics, sets, names
  ['(x - np.mean(xs)) / np.std(xs)', '\\frac{x - \\overline{\\mathit{xs}}}{\\sigma_{\\mathit{xs}}}'],
  ['A.union(B)', 'A \\cup B'],
  ['A.issubset(B)', 'A \\subseteq B'],
  ['math.isclose(a, b)', 'a \\approx b'],
  ['x_hat - x_bar', '\\hat{x} - \\bar{x}'],
  ['v_vec + w_dot', '\\vec{v} + \\dot{w}'],
  ['alpha_max', '\\alpha_{\\mathrm{max}}'],
];

const julia = [
  ['sum(x[i] for i in 1:n)', '\\sum_{i=1}^{n} x_{i}'],
  ['maximum(f(x) for x in S)', '\\max_{x \\in S} f\\left(x\\right)'],
  ['quadgk(x -> x^2, 0, 1)[1]', '\\int_{0}^{1} x^{2} \\,dx'],
  ["A' * B", 'A^{\\top} B'],
  ['√(x^2 + y^2)', '\\sqrt{x^{2} + y^{2}}'],
  ['a ⋅ b', 'a \\cdot b'],
  ['a × b', 'a \\times b'],
  ['argmax(i -> f(i), 1:n)', '\\operatorname*{arg\\,max}_{i \\in \\{1, \\ldots, n\\}} f\\left(i\\right)'],
  ['x > 0 ? x : 0', '\\begin{cases} x & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
  ['2x + 1', '2 x + 1'],
  ['sum(x[1:n])', '\\sum_{i=1}^{n} x_{i}'],
  ['x ≤ y', 'x \\le y'],
  ['n ÷ 2', '\\left\\lfloor \\frac{n}{2} \\right\\rfloor'],
];

for (const [src, want] of python) test(`python: ${src}`, () => assert.strictEqual(latex(src), want));
for (const [src, want] of julia) test(`julia: ${src}`, () => assert.strictEqual(latex(src, JL), want));

test('display and height are reported', () => {
  const r = render(parse('sum(x[i] for i in range(n)) / n', PY.options), PY);
  assert.deepStrictEqual([r.display, r.height], [true, 'tall']);
  const plain = render(parse('x + y * 2', PY.options), PY);
  assert.strictEqual(plain.display, false);
  const frac = render(parse('a / b', PY.options), PY);
  assert.deepStrictEqual([frac.display, frac.height], [true, 'medium']);
});

test('syntax entries can be turned off or made quiet', () => {
  const n = buildNotation('python', { syntax: { fraction: { template: '$1 / $2', display: false }, piecewise: null } });
  const r = render(parse('a / b', n.options), n);
  assert.deepStrictEqual([r.latex, r.display], ['a / b', false]);
  assert.throws(() => render(parse('x if c else y', n.options), n));
});

test('name suffixes come from settings', () => {
  const n = buildNotation('python', { nameSuffixes: { _dag: '$1^{\\dagger}', _hat: null } });
  assert.strictEqual(latex('U_dag', n), 'U^{\\dagger}');
  assert.strictEqual(latex('x_hat', n), 'x_{\\mathrm{hat}}');
});

test('method and keyword templates from settings', () => {
  const n = buildNotation('python', { functions: { '.softmax/0': '\\operatorname{softmax}\\left($0\\right)', 'clip[a_min]': '\\max\\left($1, $a_min\\right)' } });
  assert.strictEqual(latex('z.softmax()', n), '\\operatorname{softmax}\\left(z\\right)');
  assert.strictEqual(latex('np.clip(x, a_min=0)', n), '\\max\\left(x, 0\\right)');
});
