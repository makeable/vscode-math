'use strict';
// Built-in notation for Julia. Same table format as python.js.

const common = require('./common');
const python = require('./python');

module.exports = {
  parser: 'python', // Julia's expression syntax is close enough; options cover the differences
  options: { power: ['^'], juliaRanges: true, juliaFor: true },

  modulePrefixes: ['Base', 'LinearAlgebra'],

  bigOperators: {
    sum: '\\sum',
    prod: '\\prod',
  },

  functions: {
    ...python.functions,
    'binomial/2': '\\binom{$1}{$2}',
    'log/2': '\\log_{$1}\\left($2\\right)', // Julia puts the base first
  },

  identifiers: {
    ...common.identifiers,
    ℯ: 'e',
    NaN: '\\mathrm{NaN}',
  },

  ranges: {
    ':/2': { from: '$1', to: '$2' },
    ':/3': { set: '\\{$1, $1 + $2, \\ldots, $3\\}' },
  },
};
