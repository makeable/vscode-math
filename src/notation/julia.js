'use strict';
// Built-in notation for Julia. Same table format as python.js, and most of
// the function templates are shared with it.

const common = require('./common');
const python = require('./python');

const tall = (template, extra) => ({ templates: [].concat(template), height: 'tall', ...extra });
const medium = (template, extra) => ({ templates: [].concat(template), height: 'medium', ...extra });

module.exports = {
  parser: 'python', // Julia's expression syntax is close enough; options cover the differences
  options: { power: ['^'], juliaRanges: true, juliaFor: true, adjoint: true, oneBased: true },

  modulePrefixes: ['Base', 'LinearAlgebra', 'Statistics', 'QuadGK', 'ForwardDiff', 'SpecialFunctions', 'Calculus', 'Zygote'],

  bigOperators: {
    sum: tall('\\sum'),
    prod: tall('\\prod'),
    all: python.bigOperators.all,
    any: python.bigOperators.any,
    maximum: python.bigOperators.max,
    minimum: python.bigOperators.min,
    union: tall(['\\bigcup_{$under}^{$over} $body', '\\bigcup_{$under} $body']),
    intersect: tall(['\\bigcap_{$under}^{$over} $body', '\\bigcap_{$under} $body']),
  },

  functions: {
    ...python.functions,
    'binomial/2': medium('\\binom{$1}{$2}'),
    'log/2': '\\log_{$1}\\left($2\\right)', // Julia puts the base first
    tr: '\\operatorname{tr} $1|atom',
    adjoint: '$1|atom^{\\dagger}',
    'argmax/2': tall('\\operatorname*{arg\\,max}_{$1.var \\in $2|domain} $1.body'),
    'argmin/2': tall('\\operatorname*{arg\\,min}_{$1.var \\in $2|domain} $1.body'),
    quadgk: tall(['\\int_{$2}^{$3} $1.body \\,d$1.var', '\\int_{$2}^{$3} $1\\left(x\\right) \\,dx'], { firstOfTuple: true }),
    'derivative/2': medium(['\\left.\\frac{d}{d$1.var} $1.body\\right|_{$1.var=$2}', "$1'\\left($2\\right)"]),
    'gradient/2': '\\nabla $1\\left($2\\right)',
    'hessian/2': '\\nabla^{2} $1\\left($2\\right)',
    'ifelse/3': python.functions['where/3'],
  },

  identifiers: {
    ...common.identifiers,
    ℯ: 'e',
    im: 'i',
    NaN: '\\mathrm{NaN}',
  },

  nameSuffixes: python.nameSuffixes,

  ranges: {
    ':/2': { from: '$1', to: '$2' },
    ':/3': { set: '\\{$1, $1 + $2, \\ldots, $3\\}' },
    'range/2': { from: '$1', to: '$2' },
    'eachindex/1': { from: '1', to: 'length($1)' },
  },

  syntax: {
    ...python.syntax,
    matmul: null,
    adjoint: '$1|atom^{\\top}',
  },
};
