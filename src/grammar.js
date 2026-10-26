'use strict';
// Generates the TextMate injection grammars that make lines taller where the
// maths needs room. A token rule (configurationDefaults in package.json) gives
// meta.mathview.tall and meta.mathview.medium lines a bigger line height.
//
// Grammars are static files that VS Code reads at startup, so the extension
// regenerates them when the notation settings change and offers a reload.
//
// The patterns use the regex syntax that both Oniguruma (TextMate) and
// JavaScript understand, so the extension can run the same patterns to know
// how tall each line is.

const { entryInfo } = require('./tex');

const LEVELS = ['tall', 'medium'];
const MULTIPLIER = { tall: 2.4, medium: 1.7, normal: 1 };

const GRAMMARS = {
  python: { file: 'syntaxes/mathview.python.json', scopeName: 'mathview.python', injectTo: ['source.python'] },
  julia: { file: 'syntaxes/mathview.julia.json', scopeName: 'mathview.julia', injectTo: ['source.julia'] },
  javascript: {
    file: 'syntaxes/mathview.javascript.json',
    scopeName: 'mathview.javascript',
    injectTo: ['source.js', 'source.ts', 'source.tsx', 'source.js.jsx'],
  },
};

// Patterns for syntax, per language. Only used when the syntax entry exists.
const SYNTAX_PATTERNS = {
  python: {
    fraction: [
      // two fractions on a line usually means one inside the other: give it more room
      { match: '(?<![/*])/(?![/=*])(?=[^#\n]*[^/*]/[^/=*])', scope: 'keyword.operator.arithmetic.mathview', level: 'tall' },
      { match: '(?<![/*])/(?![/=*])', scope: 'keyword.operator.arithmetic.mathview' },
    ],
    floorDiv: { match: '//(?!=)', scope: 'keyword.operator.arithmetic.mathview' },
    piecewise: { match: '(?<=[\\w)\\]\'"] )if\\b(?=[^#\\n]*\\belse\\b)', scope: 'keyword.control.conditional.mathview' },
    setComprehension: { match: '\\{(?=[^#\\n]*\\bfor\\b)', scope: 'punctuation.definition.set.mathview' },
  },
  javascript: {
    // TypeScript's own division rule starts at the whitespace before "/", so ours must too or it loses
    fraction: [
      { match: '(?<=[\\w$)\\]])\\s*/(?![/=*])(?=[^\\n]*[^/*]/[^/=*])', scope: 'keyword.operator.arithmetic.mathview', level: 'tall' },
      { match: '(?<=[\\w$)\\]])\\s*/(?![/=*])', scope: 'keyword.operator.arithmetic.mathview' },
    ],
    piecewise: { match: '(?<= )\\?(?= )', scope: 'keyword.operator.ternary.mathview' },
  },
  julia: {
    fraction: { match: '(?<![/*])\\.?/(?![/=*])', scope: 'keyword.operator.arithmetic.mathview' },
    floorDiv: { match: '÷', scope: 'keyword.operator.arithmetic.mathview' },
    piecewise: { match: '(?<= )\\?(?= )', scope: 'keyword.operator.ternary.mathview' },
  },
};

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function prefixGroup(notation) {
  const prefixes = notation.modulePrefixes.map(escape);
  return prefixes.length ? `(?:(?:${prefixes.join('|')})\\.)?` : '';
}

// Split a table key: "max[key]" -> {name: "max", kw: "key"}, "comb/2" -> {name: "comb"}
function parseKey(key) {
  const m = /^(\.?)([^/[\]]+)(?:\[(\w+)\])?(?:\/(\w+))?$/.exec(key);
  return m && { method: !!m[1], name: m[2], kw: m[3] };
}

/** [{level, match, scope}] for one notation. */
function linePatterns(notation, profile) {
  const out = [];
  const prefix = prefixGroup(notation);

  // big operators: name( ... for ... on one line
  const bigByLevel = {};
  for (const [key, entry] of Object.entries(notation.bigOperators || {})) {
    const info = entryInfo(entry);
    if (!info) continue;
    const level = info.height || 'tall';
    if (!LEVELS.includes(level)) continue;
    (bigByLevel[level] = bigByLevel[level] || []).push(key);
  }
  for (const level of LEVELS) {
    const names = bigByLevel[level];
    if (!names) continue;
    const alt = names.map(escape).sort((a, b) => b.length - a.length).join('|');
    out.push({ level, match: `(?<![\\w.])${prefix}(?:${alt})(?=\\s*\\([^\\n]*\\bfor\\b)`, scope: 'support.function.mathview' });
  }

  // functions with a height: name( on the line, or a custom hint
  const fnByLevel = {};
  for (const [key, entry] of Object.entries(notation.functions || {})) {
    const info = entryInfo(entry);
    const k = parseKey(key);
    if (!info || !k || !LEVELS.includes(info.height)) continue;
    const after = info.lineHint || (k.kw ? `\\s*\\([^\\n]*\\b${k.kw}\\s*=` : '\\s*\\(');
    const head = k.method ? `(?<=\\.)${escape(k.name)}` : `(?<![\\w.])${prefix}${escape(k.name)}`;
    const pattern = `${head}(?=${after})`;
    const list = fnByLevel[info.height] = fnByLevel[info.height] || [];
    if (!list.includes(pattern)) list.push(pattern);
  }
  for (const level of LEVELS) {
    if (fnByLevel[level]) out.push({ level, match: fnByLevel[level].join('|'), scope: 'support.function.mathview' });
  }

  // JavaScript reduce pipelines become big operators (see shapes.js)
  if (notation.shapes) {
    out.push({ level: 'tall', match: '(?<=\\.)reduce(?:Right)?(?=\\s*\\()', scope: 'support.function.mathview' });
  }

  // syntax: fractions, piecewise...
  for (const [key, list] of Object.entries(SYNTAX_PATTERNS[profile] || {})) {
    const info = entryInfo(notation.syntax && notation.syntax[key]);
    if (!info || !info.display || !LEVELS.includes(info.height)) continue;
    for (const p of [].concat(list)) out.push({ level: p.level || info.height, match: p.match, scope: p.scope });
  }
  // tall before medium, so a line with both is matched as tall first
  return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

function buildGrammar(profile, notation) {
  const g = GRAMMARS[profile];
  return {
    scopeName: g.scopeName,
    injectionSelector: g.injectTo.map(s => `L:${s} -comment -string`).join(', '),
    comment: 'Generated by Math View from its notation settings. Do not edit.',
    patterns: linePatterns(notation, profile).map(p => ({ match: p.match, name: `${p.scope} meta.mathview.${p.level}` })),
  };
}

/** A function from a line of (masked) text to 'tall' | 'medium' | 'normal'. */
function lineLevelTester(notation, profile) {
  const tests = linePatterns(notation, profile).map(p => ({ level: p.level, re: new RegExp(p.match) }));
  return line => {
    for (const t of tests) if (t.re.test(line)) return t.level;
    return 'normal';
  };
}

module.exports = { GRAMMARS, MULTIPLIER, linePatterns, buildGrammar, lineLevelTester };
