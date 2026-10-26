'use strict';
// Entry points: code -> LaTeX for one language's notation.

const { buildNotation } = require('./notation');
const { toTex } = require('./tex');
const parsers = { python: require('./parse/python') };

const defaults = {};
function defaultNotation(profile = 'python') {
  if (!defaults[profile]) defaults[profile] = buildNotation(profile);
  return defaults[profile];
}

function parseWith(src, notation) {
  return parsers[notation.parser].parse(src, notation.options);
}

/** Parse one expression and return LaTeX, or throw. */
function toLatex(src, notation = defaultNotation()) {
  return toTex(parseWith(src, notation), notation);
}

/** Like toLatex, but only succeeds for a big operator call such as sum(... for ...). */
function bigOpToLatex(src, notation = defaultNotation()) {
  const ast = parseWith(src, notation);
  const a = ast.k === 'call' && ast.args.length === 1 ? ast.args[0] : null;
  if (!a || !(a.k === 'gen' || (a.k === 'star' && a.e.k === 'gen'))) {
    throw new Error('not a big operator call');
  }
  return toTex(ast, notation);
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regex source matching the start of a big operator call, e.g. "np.sum(".
function bigOpCallPattern(notation) {
  const names = Object.keys(notation.bigOperators).filter(k => notation.bigOperators[k] !== null);
  if (!names.length) return null;
  const prefixes = notation.modulePrefixes.map(escape);
  const prefix = prefixes.length ? `(?:(?:${prefixes.join('|')})\\.)?` : '';
  return `(?<![\\w.])${prefix}(?:${names.map(escape).sort((a, b) => b.length - a.length).join('|')})\\s*\\(`;
}

/**
 * Find big operator calls in a document. Returns [{start, end}] offsets
 * covering the whole call including its closing paren.
 */
function findBigOpCalls(text, notation = defaultNotation()) {
  const source = bigOpCallPattern(notation);
  if (!source) return [];
  const re = new RegExp(source, 'g');
  const found = [];
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(text, open);
    if (close !== -1) found.push({ start: m.index, end: close + 1 });
  }
  return found;
}

function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") return -1; // strings inside: give up
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (depth === 0) return c === ')' ? i : -1; }
    if (depth > 0 && i - open > 5000) return -1;
  }
  return -1;
}

module.exports = { toLatex, bigOpToLatex, findBigOpCalls, bigOpCallPattern, defaultNotation };
