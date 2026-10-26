'use strict';
// Built-in symbol substitutions: regex (as a string) -> symbol shown in its place.
// Merged with the mathView.symbols setting; set an entry to null to turn it off.

const common = {
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
  '->': '→',
  '=>': '⇒',
  '\\b(?:math\\.|np\\.|numpy\\.)?sqrt\\b': '√',
  '\\binf\\b|\\bInf\\b|\\bInfinity\\b': '∞',
  '\\balpha\\b': 'α',
  '\\bbeta\\b': 'β',
  '\\bgamma\\b': 'γ',
  '\\bdelta\\b': 'δ',
  '\\bepsilon\\b': 'ε',
  '\\btheta\\b': 'θ',
  '\\bmu\\b': 'μ',
  '\\bsigma\\b': 'σ',
  '\\bomega\\b': 'ω',
};

const python = {
  '\\blambda\\b': 'λ',
  '\\b(?:math\\.|np\\.|numpy\\.)pi\\b': 'π',
  '\\bnot in\\b': '∉',
  '(?<=\\bfor \\w+ )in\\b': '∈',
};

const julia = {
  '(?<=\\bfor \\w+ )in\\b': '∈',
};

module.exports = { common, byProfile: { python, julia } };
