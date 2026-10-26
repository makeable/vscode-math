'use strict';
// Built-in notation for JavaScript and TypeScript: Math, lodash, d3, mathjs,
// simple-statistics, TensorFlow.js, numeric.js and ml-matrix.
// Same table format as python.js; see there for the template syntax.

const common = require('./common');
const python = require('./python');

const quiet = template => ({ template, display: false });
const medium = (template, extra) => ({ templates: [].concat(template), height: 'medium', ...extra });
const tall = (template, extra) => ({ templates: [].concat(template), height: 'tall', ...extra });

// collection + accessor: d3.sum(xs, d => d.value), _.sumBy(xs, x => x.price)
const SUM_BY = tall(['\\sum_{$2.var \\in $1|domain} $2.body', '\\sum_{x \\in $1|domain} $2\\left(x\\right)']);
const MEAN_BY = tall(['\\frac{1}{\\left|$1\\right|} \\sum_{$2.var \\in $1} $2.body']);
const MAX_BY = tall(['\\max_{$2.var \\in $1|domain} $2.body']);
const MIN_BY = tall(['\\min_{$2.var \\in $1|domain} $2.body']);
const ARGMAX_BY = tall(['\\operatorname*{arg\\,max}_{$2.var \\in $1|domain} $2.body']);
const ARGMIN_BY = tall(['\\operatorname*{arg\\,min}_{$2.var \\in $1|domain} $2.body']);
const MATRIX = tall('\\begin{bmatrix} $1|rows \\end{bmatrix}', { lineHint: '\\s*\\(\\s*\\[' });

const trig = {};
for (const f of ['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'cot', 'sec', 'csc']) trig[f] = quiet(`\\${f}\\left($1\\right)`);

module.exports = {
  parser: 'cfamily',
  options: {},
  shapes: true, // reduce pipelines, see shapes.js

  modulePrefixes: ['Math', 'math', 'mathjs', '_', 'lodash', 'd3', 'ss', 'tf', 'numeric', 'nj', 'R'],

  // Reached through reduce pipelines (see `reducers`), or a helper called with a list: sum(xs)
  bigOperators: {
    sum: tall('\\sum'),
    prod: tall('\\prod'),
    max: python.bigOperators.max,
    min: python.bigOperators.min,
    all: python.bigOperators.all,
    any: python.bigOperators.any,
  },

  // xs.reduce((acc, x) => acc OP f(x)): which OP makes which big operator
  reducers: {
    '+': 'sum',
    '*': 'prod',
    '&&': 'all',
    '||': 'any',
    max: 'max',
    min: 'min',
  },

  functions: {
    // Math
    sqrt: '\\sqrt{$1}',
    cbrt: '\\sqrt[3]{$1}',
    abs: '\\left|$1\\right|',
    exp: 'e^{$1}',
    expm1: 'e^{$1} - 1',
    'pow/2': '$1|atom^{$2}',
    'hypot/2': '\\sqrt{$1^{2} + $2^{2}}',
    'hypot/3': '\\sqrt{$1^{2} + $2^{2} + $3^{2}}',
    floor: '\\left\\lfloor $1\\right\\rfloor',
    ceil: '\\left\\lceil $1\\right\\rceil',
    round: '\\left\\lfloor $1\\right\\rceil',
    trunc: quiet('\\operatorname{trunc}\\left($1\\right)'),
    sign: quiet('\\operatorname{sgn}\\left($1\\right)'),
    'log/1': quiet('\\ln\\left($1\\right)'), // Math.log is the natural log
    log10: '\\log_{10}\\left($1\\right)',
    log2: '\\log_{2}\\left($1\\right)',
    log1p: quiet('\\ln\\left(1 + $1\\right)'),
    asin: quiet('\\arcsin\\left($1\\right)'),
    acos: quiet('\\arccos\\left($1\\right)'),
    atan: quiet('\\arctan\\left($1\\right)'),
    'atan2/2': quiet('\\arctan\\left(\\frac{$1}{$2}\\right)'),
    ...trig,
    max: [quiet('\\max $1|spread'), quiet('\\max\\left($args\\right)')],
    min: [quiet('\\min $1|spread'), quiet('\\min\\left($args\\right)')],

    // lodash
    'sum/1': '\\sum $1|atom',
    'sumBy/2': SUM_BY,
    'mean/1': '\\overline{$1}',
    'meanBy/2': MEAN_BY,
    'maxBy/2': ARGMAX_BY,
    'minBy/2': ARGMIN_BY,
    'every/2': medium('\\forall\\, $2.var \\in $1\\colon\\ $2.body'),
    'some/2': medium('\\exists\\, $2.var \\in $1\\colon\\ $2.body'),
    'clamp/3': quiet('\\min\\left(\\max\\left($1, $2\\right), $3\\right)'),

    // d3: the accessor versions
    'sum/2': SUM_BY,
    'mean/2': MEAN_BY,
    'max/2': [MAX_BY, quiet('\\max\\left($args\\right)')],
    'min/2': [MIN_BY, quiet('\\min\\left($args\\right)')],
    'deviation/1': '\\sigma_{$1}',
    'variance/1': '\\operatorname{Var}\\left($1\\right)',
    'greatest/2': ARGMAX_BY,
    'least/2': ARGMIN_BY,

    // simple-statistics
    'standardDeviation/1': '\\sigma_{$1}',
    'sampleStandardDeviation/1': 's_{$1}',
    'sampleVariance/1': 's^{2}_{$1}',
    'sampleCorrelation/2': '\\rho_{$1, $2}',
    'zScore/3': medium('\\frac{$1 - $2}{$3}'),

    // mathjs, numeric.js, TensorFlow.js
    'dot/2': '$1|atom \\cdot $2|atom',
    'cross/2': '$1|atom \\times $2|atom',
    'multiply/2': '$1|atom $2|atom',
    'matMul/2': '$1|atom $2|atom',
    'divide/2': medium('\\frac{$1}{$2}'),
    inv: '$1|atom^{-1}',
    inverse: '$1|atom^{-1}',
    det: '\\det $1|atom',
    transpose: '$1|atom^{\\top}',
    trace: '\\operatorname{tr} $1|atom',
    'norm/1': '\\left\\|$1\\right\\|',
    'norm/2': '\\left\\|$1\\right\\|_{$2}',
    norm2: '\\left\\|$1\\right\\|',
    square: '$1|atom^{2}',
    sigmoid: '\\sigma\\left($1\\right)',
    'factorial/1': '$1|atom!',
    'combinations/2': medium('\\binom{$1}{$2}'),
    'identity/1': quiet('I_{$1}'),
    'eye/1': quiet('I_{$1}'),
    matrix: MATRIX,
    tensor: MATRIX,
    tensor2d: MATRIX,

    // methods: $0 is the object
    '.length': quiet('\\left|$0\\right|'),
    '.every/1': medium('\\forall\\, $1.var \\in $0\\colon\\ $1.body'),
    '.some/1': medium('\\exists\\, $1.var \\in $0\\colon\\ $1.body'),
    '.includes/1': quiet('$1 \\in $0'),
    '.dot/1': '$0|atom \\cdot $1|atom',
    '.add/1': quiet('$0 + $1'),
    '.sub/1': quiet('$0 - $1|atom'),
    '.mul/1': quiet('$0|atom $1|atom'),
    '.div/1': medium('\\frac{$0}{$1}'),
    '.pow/1': '$0|atom^{$1}',
    '.matMul/1': '$0|atom $1|atom',
    '.mmul/1': '$0|atom $1|atom',
    '.transpose/0': '$0|atom^{\\top}',
    '.inverse/0': '$0|atom^{-1}',
    '.square/0': '$0|atom^{2}',
    '.sqrt/0': '\\sqrt{$0}',
    '.norm/0': '\\left\\|$0\\right\\|',
    '.sum/0': '\\sum $0|atom',
    '.mean/0': '\\overline{$0}',
  },

  identifiers: {
    ...common.identifiers,
    PI: '\\pi',
    E: 'e',
    SQRT2: '\\sqrt{2}',
    SQRT1_2: '\\frac{1}{\\sqrt{2}}',
    LN2: '\\ln 2',
    LN10: '\\ln 10',
    LOG2E: '\\log_{2} e',
    LOG10E: '\\log_{10} e',
    EPSILON: '\\epsilon',
    'Number.EPSILON': '\\epsilon',
    NaN: '\\mathrm{NaN}',
    'Number.POSITIVE_INFINITY': '\\infty',
    'Number.NEGATIVE_INFINITY': '-\\infty',
  },

  // xHat and x_hat both work
  nameSuffixes: {
    ...python.nameSuffixes,
    Hat: '\\hat{$1}',
    Bar: '\\bar{$1}',
    Tilde: '\\tilde{$1}',
    Vec: '\\vec{$1}',
    Prime: "$1'",
    Star: '$1^{*}',
    Inv: '$1^{-1}',
    Sq: '$1^{2}',
  },

  ranges: {
    'range/1': { from: '0', to: '$1 - 1' }, // _.range, d3.range, and Array.from({length: n})
    'range/2': { from: '$1', to: '$2 - 1' },
  },

  syntax: {
    power: python.syntax.power,
    fraction: python.syntax.fraction,
    piecewise: python.syntax.piecewise,
    lambda: quiet('$params \\mapsto $body'),
    setComprehension: null,
    listComprehension: null,
    floorDiv: null,
    matmul: null,
    adjoint: null,
  },
};
