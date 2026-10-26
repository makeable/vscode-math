'use strict';
// Runs the generated grammars inside VS Code's real TextMate engine, injected
// into VS Code's own Python / TypeScript / JavaScript grammars, and checks the
// lines that get taller match what the extension expects.
// Skipped when VS Code isn't installed in /Applications.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');
const { buildNotation } = require('../src/notation');
const { lineLevelTester } = require('../src/grammar');

const EXT = process.env.VSCODE_EXTENSIONS || '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions';
const ROOT = path.join(__dirname, '..');
const HOSTS = {
  'source.python': { file: `${EXT}/python/syntaxes/MagicPython.tmLanguage.json`, ours: 'mathview.python', profile: 'python' },
  'source.ts': { file: `${EXT}/typescript-basics/syntaxes/TypeScript.tmLanguage.json`, ours: 'mathview.javascript', profile: 'javascript' },
  'source.js': { file: `${EXT}/javascript/syntaxes/JavaScript.tmLanguage.json`, ours: 'mathview.javascript', profile: 'javascript' },
  'source.julia': { file: `${EXT}/julia/syntaxes/julia.tmLanguage.json`, ours: 'mathview.julia', profile: 'julia' },
};
const OURS = {
  'mathview.python': path.join(ROOT, 'syntaxes/mathview.python.json'),
  'mathview.javascript': path.join(ROOT, 'syntaxes/mathview.javascript.json'),
  'mathview.julia': path.join(ROOT, 'syntaxes/mathview.julia.json'),
};

let registry = null;
async function grammar(scope) {
  if (!registry) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
    await oniguruma.loadWASM(wasm);
    registry = new vsctm.Registry({
      onigLib: Promise.resolve({ createOnigScanner: p => new oniguruma.OnigScanner(p), createOnigString: s => new oniguruma.OnigString(s) }),
      loadGrammar: async s => {
        const file = (HOSTS[s] && HOSTS[s].file) || OURS[s];
        return file && fs.existsSync(file) ? vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
      },
      getInjections: s => (HOSTS[s] ? [HOSTS[s].ours] : []),
    });
  }
  return registry.loadGrammar(scope);
}

// The tallest mathview level the real grammar gives each line.
async function levels(scope, lines) {
  const g = await grammar(scope);
  let stack = vsctm.INITIAL;
  return lines.map(line => {
    const r = g.tokenizeLine(line, stack);
    stack = r.ruleStack;
    const found = r.tokens.flatMap(t => t.scopes).filter(s => s.startsWith('meta.mathview.')).map(s => s.split('.').pop());
    return found.includes('tall') ? 'tall' : found.includes('medium') ? 'medium' : 'normal';
  });
}

const SAMPLES = {
  'source.python': [
    'total = sum(x[i] for i in range(1, n + 1))',
    'mu = sum(x[i] for i in range(n)) / n',
    'r = a / b',
    'k = n // 2',
    'y = x if x > 0 else 0',
    'ok = all(v > 0 for v in xs)',
    'A = np.array([[1, 2], [3, 4]])',
    'A = np.array(data)',
    'area = quad(lambda x: x**2, 0, 1)[0]',
    'evens = {2 * k for k in range(n)}',
    'density = math.exp(-x / 2) / math.sqrt(2)',
    'x = y + 2 * z',
    '# r = a / b',
    's = "a / b"',
    'if x > 0:',
  ],
  'source.ts': [
    'const total = xs.reduce((s, x) => s + x, 0);',
    'const r = a / b;',
    'const r2 = a/b;',
    'const bits = Math.log(x) / Math.LN2;',
    '// the line after a call divided by something must still be a comment',
    'const z = f(x) / g(y) + 1;',
    'const d = Math.exp(-x / 2) / Math.sqrt(2);',
    'const y = x > 0 ? x : 0;',
    'const ok = xs.every(x => x > 0);',
    'const m = d3.sum(data, d => d.v);',
    'const M = math.matrix([[1, 2], [3, 4]]);',
    'const t = a?.b ?? c;',
    'const re = /ab+c/g;',
    '// a / b',
    'const s = "a / b";',
    'let n = 1;',
  ],
};
SAMPLES['source.js'] = SAMPLES['source.ts'];
SAMPLES['source.julia'] = [
  'total = sum(x[i] for i in 1:n)',
  'r = a / b',
  'y = x > 0 ? x : 0',
  'A = [1 2; 3 4]',
  'R = [cos(θ) -sin(θ); sin(θ) cos(θ)]',
  'v = [1 2 3]',
  "B = A' * A",
  'ok = all(v > 0 for v in xs)',
  '# r = a / b',
  's = "a / b"',
  'x = y + 2z',
];

for (const [scope, lines] of Object.entries(SAMPLES)) {
  test(`real grammar agrees with the extension: ${scope}`, { skip: !fs.existsSync(HOSTS[scope].file) && 'VS Code not installed' }, async () => {
    const real = await levels(scope, lines);
    const ours = lineLevelTester(buildNotation(HOSTS[scope].profile), HOSTS[scope].profile);
    // the extension blanks comments and strings before testing, like the grammar's -comment -string
    const { scan } = require('../src/scan');
    const lang = { javascript: 'js', julia: 'julia' }[HOSTS[scope].profile] || 'python';
    const masked = scan(lines.join('\n'), lang).masked.split('\n');
    const expected = masked.map(l => (/\S/.test(l) ? ours(l) : 'normal'));
    assert.deepStrictEqual(lines.map((l, i) => `${real[i]}  ${l}`), lines.map((l, i) => `${expected[i]}  ${l}`));
    // and a sanity check that the patterns do fire
    assert.ok(real.includes('tall') && real.includes('medium'));
  });

  test(`our injection never leaves the host grammar in a different state: ${scope}`, { skip: !fs.existsSync(HOSTS[scope].file) && 'VS Code not installed' }, async () => {
    // After each sample line, a probe line must tokenize exactly as it does
    // without our grammar; otherwise we've broken colouring for the rest of the file.
    const plainRegistry = new vsctm.Registry({
      onigLib: Promise.resolve({ createOnigScanner: p => new oniguruma.OnigScanner(p), createOnigString: s => new oniguruma.OnigString(s) }),
      loadGrammar: async s => (HOSTS[s] ? vsctm.parseRawGrammar(fs.readFileSync(HOSTS[s].file, 'utf8'), HOSTS[s].file) : null),
    });
    const withUs = await grammar(scope);
    const plain = await plainRegistry.loadGrammar(scope);
    const probe = scope === 'source.python' || scope === 'source.julia' ? '# probe comment' : '// probe comment';
    const probeScopes = (g, line) => {
      const first = g.tokenizeLine(line, vsctm.INITIAL);
      return g.tokenizeLine(probe, first.ruleStack).tokens.map(t => t.scopes.join(' ')).join(' | ');
    };
    for (const line of lines) {
      assert.strictEqual(probeScopes(withUs, line), probeScopes(plain, line), `the line after: ${line}`);
    }
  });
}
