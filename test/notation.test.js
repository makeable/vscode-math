'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildNotation } = require('../src/notation');
const { bigOpToLatex, toLatex } = require('../src/latex');
const { buildGrammar, tallPatterns } = require('../src/grammar');

test('a new big operator from settings', () => {
  const n = buildNotation('python', { bigOperators: { logsumexp: '\\operatorname{LSE}' } });
  assert.strictEqual(bigOpToLatex('logsumexp(x[i] for i in range(n))', n), '\\operatorname{LSE}_{i=0}^{n - 1} x_{i}');
  // built-ins are still there
  assert.strictEqual(bigOpToLatex('sum(x[i] for i in range(n))', n), '\\sum_{i=0}^{n - 1} x_{i}');
});

test('null turns a built-in off', () => {
  const n = buildNotation('python', { bigOperators: { sum: null } });
  assert.throws(() => bigOpToLatex('sum(x[i] for i in range(n))', n));
});

test('function templates override built-ins and match by arity', () => {
  const n = buildNotation('python', {
    functions: { sqrt: '\\operatorname{root}($1)', 'hypot/2': '\\sqrt{$1^2 + $2^2}' },
  });
  assert.strictEqual(toLatex('sqrt(x)', n), '\\operatorname{root}(x)');
  assert.strictEqual(toLatex('math.hypot(a, b)', n), '\\sqrt{a^2 + b^2}');
});

test('a list of templates falls through to one that fits', () => {
  const n = buildNotation('python', { functions: { clip: ['\\operatorname{clip}_{[$2, $3]}($1)', '\\operatorname{clip}($1)'] } });
  assert.strictEqual(toLatex('clip(x, 0, 1)', n), '\\operatorname{clip}_{[0, 1]}(x)');
  assert.strictEqual(toLatex('clip(x)', n), '\\operatorname{clip}(x)');
});

test('custom ranges are written in code and simplified', () => {
  const n = buildNotation('python', { ranges: { 'arange/2': { from: '$1', to: '$2 - 1' } } });
  assert.strictEqual(bigOpToLatex('sum(x[i] for i in np.arange(1, n + 1))', n), '\\sum_{i=1}^{n} x_{i}');
});

test('identifiers from settings', () => {
  const n = buildNotation('python', { identifiers: { hbar: '\\hbar' } });
  assert.strictEqual(toLatex('hbar * omega', n), '\\hbar \\omega');
});

test('module prefixes can be removed', () => {
  const n = buildNotation('python', { modulePrefixes: ['-np'] });
  assert.ok(!n.modulePrefixes.includes('np'));
  assert.strictEqual(toLatex('np.sqrt(x)', n), '\\operatorname{np.sqrt}\\left(x\\right)');
  assert.strictEqual(toLatex('math.sqrt(x)', n), '\\sqrt{x}');
});

test('builtinNotation false starts from nothing', () => {
  const n = buildNotation('python', { builtinNotation: false, bigOperators: { total: '\\Sigma' } });
  assert.throws(() => bigOpToLatex('sum(x for x in xs)', n));
  assert.strictEqual(bigOpToLatex('total(x for x in xs)', n), '\\Sigma_{x \\in \\mathit{xs}} x');
});

test('julia notation: base-first log and inclusive ranges', () => {
  const n = buildNotation('julia');
  assert.strictEqual(toLatex('log(2, x)', n), '\\log_{2}\\left(x\\right)');
  assert.strictEqual(bigOpToLatex('prod(x[i] for i in 2:n)', n), '\\prod_{i=2}^{n} x_{i}');
  assert.strictEqual(toLatex('a ^ b', n), 'a^{b}');
  assert.strictEqual(toLatex('a ^ b'), 'a \\oplus b'); // Python: ^ is xor
});

test('generated grammar follows the big operators', () => {
  const n = buildNotation('python', { bigOperators: { logsumexp: '\\operatorname{LSE}' } });
  const g = buildGrammar('python', n);
  assert.strictEqual(g.scopeName, 'mathview.python');
  assert.ok(g.patterns[0].match.includes('logsumexp'));
  const re = new RegExp(tallPatterns(n)[0]);
  assert.ok(re.test('y = logsumexp(z[i] for i in range(k))'));
  assert.ok(!re.test('y = logsumexp(z)'));
});

test('committed grammar files match the built-in notation', () => {
  for (const profile of ['python', 'julia']) {
    const file = require('path').join(__dirname, '..', 'syntaxes', `mathview.${profile}.json`);
    const onDisk = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    assert.deepStrictEqual(onDisk, buildGrammar(profile, buildNotation(profile)), `run npm run grammars (${profile})`);
  }
});
