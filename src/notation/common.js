'use strict';
// Notation shared by every language: Greek letters and common constants.

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi',
  'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'];

const identifiers = {};
for (const g of GREEK) identifiers[g] = `\\${g}`;
Object.assign(identifiers, {
  inf: '\\infty',
  Inf: '\\infty',
  Infinity: '\\infty',
  eps: '\\epsilon',
});

module.exports = { identifiers };
