'use strict';
// Built-in notation for Python. Every table here can be extended or overridden
// from settings (mathView.bigOperators, mathView.functions, ...), and an entry
// set to null in settings turns the built-in one off.
//
// Templates are LaTeX with placeholders:
//   $1, $2 ...   arguments, already converted to LaTeX
//   $0           the object a method is called on: A.dot(B) -> $0 = A
//   $args        all arguments, comma separated
//   $key         a keyword argument: max(S, key=...) -> $key
//   $1.var       a lambda argument's parameters; $1.body its body
//   $2.0         an item of a tuple argument: integrate(f, (x, a, b)) -> $2.0 = x
//   $1|atom      the argument, bracketed unless it is a single symbol
//   $1|rows      a list of lists as matrix rows: a & b \\ c & d
//
// Keys: "name", "name/arity" (number of arguments), "name[kw]" (called with
// that keyword argument), ".method" (called on an object), ".attr" for A.T.
//
// An entry can also be an object:
//   { template: "...", templates: [...], display: false, height: "medium" | "tall", firstOfTuple: true }
//   display: false   don't draw a line in the editor just because of this
//   height           how much room it needs; lines with tall/medium notation are made taller
//   firstOfTuple     quad(...)[0] is drawn the same as quad(...)
//
// Range limits ("from"/"to") are written in Python, not LaTeX, and simplified,
// so range(1, n+1) gets an upper limit of n.

const common = require('./common');

// Entries that render nicely but shouldn't on their own make a line render.
const quiet = template => ({ template, display: false });
const medium = (template, extra) => ({ templates: [].concat(template), height: 'medium', ...extra });
const tall = (template, extra) => ({ templates: [].concat(template), height: 'tall', ...extra });

const trig = {};
for (const f of ['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'cot', 'sec', 'csc']) {
  trig[f] = quiet(`\\${f}\\left($1\\right)`);
}

// Only drawn for a literal list argument; the line hint keeps np.array(data) lines normal height.
const MATRIX = tall('\\begin{bmatrix} $1|rows \\end{bmatrix}', { lineHint: '\\s*\\(\\s*\\[' });

module.exports = {
  parser: 'python',
  options: { power: ['**'] },

  modulePrefixes: [
    'math', 'cmath', 'np', 'numpy', 'torch', 'jnp', 'jax', 'jax.numpy', 'scipy', 'sp', 'sympy', 'sy',
    'np.linalg', 'numpy.linalg', 'linalg', 'la', 'scipy.linalg', 'torch.linalg', 'jnp.linalg',
    'scipy.integrate', 'integrate', 'scipy.special', 'special', 'scipy.stats', 'stats', 'statistics',
    'torch.nn.functional', 'F',
  ],

  // Called with a generator: op(body for x in xs if cond).
  // A plain symbol is drawn with limits under and over; a template gets
  //   $body, $vars, $domain, $conds, $in ("x ∈ S, cond"), $under, $over.
  bigOperators: {
    sum: tall('\\sum'),
    fsum: tall('\\sum'),
    nansum: tall('\\sum'),
    prod: tall('\\prod'),
    nanprod: tall('\\prod'),
    all: medium('\\forall\\, $in\\colon\\ $body'),
    any: medium('\\exists\\, $in\\colon\\ $body'),
    max: tall('\\max_{$in} $body'),
    min: tall('\\min_{$in} $body'),
    'set().union': tall('\\bigcup_{$under}^{$over} $body'),
    'set.union': tall(['\\bigcup_{$under}^{$over} $body', '\\bigcup_{$under} $body']),
    'set().intersection': tall(['\\bigcap_{$under}^{$over} $body', '\\bigcap_{$under} $body']),
    'set.intersection': tall(['\\bigcap_{$under}^{$over} $body', '\\bigcap_{$under} $body']),
    logsumexp: tall('\\log \\sum_{$under} e^{$body}'),
  },

  functions: {
    // roots, powers, rounding
    sqrt: '\\sqrt{$1}',
    cbrt: '\\sqrt[3]{$1}',
    'pow/2': '$1|atom^{$2}',
    'power/2': '$1|atom^{$2}',
    exp: 'e^{$1}',
    expm1: 'e^{$1} - 1',
    abs: '\\left|$1\\right|',
    fabs: '\\left|$1\\right|',
    absolute: '\\left|$1\\right|',
    floor: '\\left\\lfloor $1\\right\\rfloor',
    ceil: '\\left\\lceil $1\\right\\rceil',
    'round/1': '\\left\\lfloor $1\\right\\rceil',
    factorial: '$1|atom!',
    'comb/2': medium('\\binom{$1}{$2}'),
    'binom/2': medium('\\binom{$1}{$2}'),
    'hypot/2': '\\sqrt{$1^{2} + $2^{2}}',
    'dist/2': '\\left\\|$1 - $2\\right\\|',
    'isclose/2': '$1 \\approx $2',
    'copysign/2': quiet('\\operatorname{sgn}\\left($2\\right) \\left|$1\\right|'),
    sign: quiet('\\operatorname{sgn}\\left($1\\right)'),

    // logs and special functions
    'log/1': quiet('\\log\\left($1\\right)'),
    'log/2': '\\log_{$2}\\left($1\\right)',
    log10: '\\log_{10}\\left($1\\right)',
    log2: '\\log_{2}\\left($1\\right)',
    log1p: quiet('\\log\\left(1 + $1\\right)'),
    'logsumexp/1': '\\log \\sum e^{$1}',
    asin: quiet('\\arcsin\\left($1\\right)'),
    acos: quiet('\\arccos\\left($1\\right)'),
    atan: quiet('\\arctan\\left($1\\right)'),
    'atan2/2': quiet('\\arctan\\left(\\frac{$1}{$2}\\right)'),
    gamma: '\\Gamma\\left($1\\right)',
    lgamma: '\\ln \\Gamma\\left($1\\right)',
    gammaln: '\\ln \\Gamma\\left($1\\right)',
    digamma: '\\psi\\left($1\\right)',
    'beta/2': '\\mathrm{B}\\left($1, $2\\right)',
    erf: quiet('\\operatorname{erf}\\left($1\\right)'),
    erfc: quiet('\\operatorname{erfc}\\left($1\\right)'),
    zeta: '\\zeta\\left($args\\right)',
    expit: '\\sigma\\left($1\\right)',
    sigmoid: '\\sigma\\left($1\\right)',
    gcd: quiet('\\gcd\\left($args\\right)'),
    max: quiet('\\max\\left($args\\right)'),
    min: quiet('\\min\\left($args\\right)'),
    'maximum/2': quiet('\\max\\left($1, $2\\right)'),
    'minimum/2': quiet('\\min\\left($1, $2\\right)'),
    ...trig,

    // argmax / argmin
    'max[key]': tall('\\operatorname*{arg\\,max}_{$key.var \\in $1|domain} $key.body'),
    'min[key]': tall('\\operatorname*{arg\\,min}_{$key.var \\in $1|domain} $key.body'),
    'argmax/1': '\\operatorname*{arg\\,max}\\ $1',
    'argmin/1': '\\operatorname*{arg\\,min}\\ $1',

    // calculus: scipy.integrate, sympy, jax
    quad: tall(['\\int_{$2}^{$3} $1.body \\,d$1.var', '\\int_{$2}^{$3} $1\\left(x\\right) \\,dx'], { firstOfTuple: true }),
    fixed_quad: tall(['\\int_{$2}^{$3} $1.body \\,d$1.var', '\\int_{$2}^{$3} $1\\left(x\\right) \\,dx'], { firstOfTuple: true }),
    'trapezoid/2': tall('\\int $1 \\,d$2'),
    'trapz/2': tall('\\int $1 \\,d$2'),
    'simpson/2': tall('\\int $1 \\,d$2'),
    integrate: tall(['\\int_{$2.1}^{$2.2} $1 \\,d$2.0', '\\int $1 \\,d$2']),
    Integral: tall(['\\int_{$2.1}^{$2.2} $1 \\,d$2.0', '\\int $1 \\,d$2']),
    'diff/2': medium('\\frac{d}{d$2} $1|atom'),
    'diff/3': medium('\\frac{d^{$3}}{d$2^{$3}} $1|atom'),
    'Derivative/2': medium('\\frac{d}{d$2} $1|atom'),
    'limit/3': tall('\\lim_{$2 \\to $3} $1|atom'),
    'Limit/3': tall('\\lim_{$2 \\to $3} $1|atom'),
    'Sum/2': tall('\\sum_{$2.0=$2.1}^{$2.2} $1|atom'),
    'Product/2': tall('\\prod_{$2.0=$2.1}^{$2.2} $1|atom'),
    'Rational/2': medium('\\frac{$1}{$2}'),
    'Eq/2': '$1 = $2',
    grad: '\\nabla $1',
    gradient: '\\nabla $1',
    jacobian: 'J_{$1}',
    jacfwd: 'J_{$1}',
    jacrev: 'J_{$1}',
    hessian: '\\nabla^{2} $1',

    // linear algebra
    inv: '$1|atom^{-1}',
    pinv: '$1|atom^{+}',
    det: '\\det $1|atom',
    'norm/1': '\\left\\|$1\\right\\|',
    'norm/2': '\\left\\|$1\\right\\|_{$2}',
    'dot/2': '$1|atom \\cdot $2|atom',
    'vdot/2': '\\overline{$1} \\cdot $2|atom',
    'inner/2': '\\left\\langle $1, $2 \\right\\rangle',
    'outer/2': '$1|atom \\otimes $2|atom',
    'kron/2': '$1|atom \\otimes $2|atom',
    'cross/2': '$1|atom \\times $2|atom',
    'matmul/2': '$1|atom $2|atom',
    trace: '\\operatorname{tr} $1|atom',
    transpose: '$1|atom^{\\top}',
    'solve/2': '$1|atom^{-1} $2|atom',
    'matrix_power/2': '$1|atom^{$2}',
    expm: 'e^{$1}',
    'eye/1': quiet('I_{$1}'),
    'identity/1': quiet('I_{$1}'),
    array: MATRIX,
    asarray: MATRIX,
    matrix: MATRIX,
    Matrix: MATRIX,
    tensor: MATRIX,

    // statistics
    'mean/1': '\\overline{$1}',
    'var/1': '\\operatorname{Var}\\left($1\\right)',
    'variance/1': '\\operatorname{Var}\\left($1\\right)',
    'std/1': '\\sigma_{$1}',
    'stdev/1': '\\sigma_{$1}',
    'cov/2': '\\operatorname{Cov}\\left($1, $2\\right)',
    'where/3': tall('\\begin{cases} $2 & \\text{if } $1 \\\\ $3 & \\text{otherwise} \\end{cases}'),

    // sets
    'set/0': quiet('\\emptyset'),
    len: quiet('\\left|$1\\right|'),

    // methods and attributes: $0 is the object
    '.T': '$0|atom^{\\top}',
    '.H': '$0|atom^{\\dagger}',
    '.mT': '$0|atom^{\\top}',
    '.dot/1': '$0|atom \\cdot $1|atom',
    '.conj/0': '\\overline{$0}',
    '.conjugate/0': '\\overline{$0}',
    '.transpose/0': '$0|atom^{\\top}',
    '.inv/0': '$0|atom^{-1}',
    '.det/0': '\\det $0|atom',
    '.norm/0': '\\left\\|$0\\right\\|',
    '.mean/0': '\\overline{$0}',
    '.sum/0': '\\sum $0|atom',
    '.prod/0': '\\prod $0|atom',
    '.diff/1': medium('\\frac{d}{d$1} $0|atom'),
    '.integrate/1': tall(['\\int_{$1.1}^{$1.2} $0 \\,d$1.0', '\\int $0 \\,d$1']),
    '.union/1': '$0 \\cup $1',
    '.intersection/1': '$0 \\cap $1',
    '.difference/1': '$0 \\setminus $1',
    '.symmetric_difference/1': '$0 \\triangle $1',
    '.issubset/1': '$0 \\subseteq $1',
    '.issuperset/1': '$0 \\supseteq $1',
  },

  identifiers: {
    ...common.identifiers,
    e: 'e',
    nan: '\\mathrm{NaN}',
    oo: '\\infty',
    'S.Infinity': '\\infty',
    'S.EmptySet': '\\emptyset',
    newaxis: '',
  },

  // x_hat -> x̂ and so on. $1 is the name before the suffix.
  nameSuffixes: {
    _hat: '\\hat{$1}',
    _bar: '\\bar{$1}',
    _tilde: '\\tilde{$1}',
    _vec: '\\vec{$1}',
    _dot: '\\dot{$1}',
    _ddot: '\\ddot{$1}',
    _prime: "$1'",
    _star: '$1^{*}',
    _inv: '$1^{-1}',
    _T: '$1^{\\top}',
    _sq: '$1^{2}',
  },

  ranges: {
    'range/1': { from: '0', to: '$1 - 1' },
    'range/2': { from: '$1', to: '$2 - 1' },
    'arange/1': { from: '0', to: '$1 - 1' },
    'arange/2': { from: '$1', to: '$2 - 1' },
    'slice/2': { from: '$1', to: '$2 - 1' },
  },

  // Operators and other syntax.
  syntax: {
    fraction: medium('\\frac{$1}{$2}'),
    floorDiv: medium('\\left\\lfloor \\frac{$1}{$2} \\right\\rfloor'),
    matmul: quiet('$1 $2'),
    piecewise: tall('', { cases: { begin: '\\begin{cases}', row: '$1 & \\text{if } $2', otherwise: '$1 & \\text{otherwise}', end: '\\end{cases}' } }),
    setComprehension: medium('\\left\\{ $body \\;\\middle|\\; $in \\right\\}'),
    listComprehension: null,
    lambda: quiet('$params \\mapsto $body'),
    adjoint: '$1|atom^{\\top}',
  },
};
