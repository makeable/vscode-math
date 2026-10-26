'use strict';
// Built-in notation for Python. Every table here can be extended or overridden
// from settings (mathView.bigOperators, mathView.functions, ...), and an entry
// set to null in settings turns the built-in one off.
//
// Templates are LaTeX with placeholders:
//   $1, $2 ...   arguments, already converted to LaTeX
//   $args        all arguments, comma separated
//   $1|atom      the argument, bracketed unless it is a single symbol
// Range limits ("from"/"to") are written in Python, not LaTeX, and simplified,
// so range(1, n+1) gets an upper limit of n.

const common = require('./common');

const trig = {};
for (const f of ['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'cot', 'sec', 'csc']) {
  trig[f] = `\\${f}\\left($1\\right)`;
}

module.exports = {
  parser: 'python',
  options: { power: ['**'] },

  modulePrefixes: ['math', 'cmath', 'np', 'numpy', 'torch', 'jnp', 'scipy', 'sp'],

  bigOperators: {
    sum: '\\sum',
    fsum: '\\sum',
    nansum: '\\sum',
    prod: '\\prod',
    nanprod: '\\prod',
  },

  functions: {
    sqrt: '\\sqrt{$1}',
    cbrt: '\\sqrt[3]{$1}',
    abs: '\\left|$1\\right|',
    fabs: '\\left|$1\\right|',
    norm: '\\left\\|$1\\right\\|',
    exp: 'e^{$1}',
    floor: '\\left\\lfloor $1\\right\\rfloor',
    ceil: '\\left\\lceil $1\\right\\rceil',
    factorial: '$1|atom!',
    'comb/2': '\\binom{$1}{$2}',
    'binom/2': '\\binom{$1}{$2}',
    'pow/2': '$1|atom^{$2}',
    'log/1': '\\log\\left($1\\right)',
    'log/2': '\\log_{$2}\\left($1\\right)',
    log10: '\\log_{10}\\left($1\\right)',
    log2: '\\log_{2}\\left($1\\right)',
    log1p: '\\log\\left(1 + $1\\right)',
    asin: '\\arcsin\\left($1\\right)',
    acos: '\\arccos\\left($1\\right)',
    atan: '\\arctan\\left($1\\right)',
    gcd: '\\gcd\\left($args\\right)',
    max: '\\max\\left($args\\right)',
    min: '\\min\\left($args\\right)',
    ...trig,
  },

  identifiers: {
    ...common.identifiers,
    e: 'e',
    nan: '\\mathrm{NaN}',
  },

  ranges: {
    'range/1': { from: '0', to: '$1 - 1' },
    'range/2': { from: '$1', to: '$2 - 1' },
  },
};
