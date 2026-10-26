'use strict';
// Finds the expressions in a document worth trying to draw: the right-hand
// side of assignments, return values, if/while conditions and expression
// statements. Statements continue over several lines inside brackets.
//
// Also returns `masked`: the text with comments and strings blanked out, so
// line-level pattern checks don't match inside them.

const SKIP = {
  python: new Set(['def', 'class', 'import', 'from', 'with', 'try', 'except', 'finally', 'pass', 'break',
    'continue', 'raise', 'del', 'global', 'nonlocal', 'async', 'for', 'else', 'match', 'case']),
  julia: new Set(['function', 'end', 'module', 'using', 'import', 'export', 'struct', 'mutable', 'abstract',
    'primitive', 'begin', 'for', 'macro', 'try', 'catch', 'finally', 'else', 'do', 'quote']),
};
const CONDITION = { python: new Set(['if', 'elif', 'while']), julia: new Set(['if', 'elseif', 'while']) };
const PREFIX = { python: new Set(['return', 'yield', 'assert', 'await']), julia: new Set(['return', 'const', 'local', 'global', 'let']) };

/**
 * @param {string} text
 * @param {'python'|'julia'} lang
 * @returns {{regions: {start: number, end: number}[], masked: string}}
 */
function scan(text, lang) {
  const julia = lang === 'julia';
  const masked = text.split('');
  const statements = [];
  let depth = 0;
  let stmtStart = 0;
  const top = []; // offsets of top-level = : ; within the current statement
  const blank = (a, b) => { for (let k = a; k < b; k++) if (masked[k] !== '\n') masked[k] = ' '; };
  const endStatement = end => { statements.push({ start: stmtStart, end, top: top.splice(0) }); };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // comments
    if (c === '#') {
      if (julia && text[i + 1] === '=') {
        let d = 1, j = i + 2;
        while (j < text.length && d > 0) {
          if (text.startsWith('#=', j)) { d++; j += 2; } else if (text.startsWith('=#', j)) { d--; j += 2; } else j++;
        }
        blank(i, j); i = j; continue;
      }
      let j = i;
      while (j < text.length && text[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    // strings
    if (c === '"' || (c === "'" && !(julia && isAdjoint(text, i)))) {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < text.length && !text.startsWith(q, j)) {
        if (text[j] === '\\') j++;
        else if (!triple && text[j] === '\n') break; // unterminated
        j++;
      }
      j = Math.min(text.length, j + q.length);
      blank(i, j); i = j; continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (c === '\n') {
        // a backslash before the newline continues the statement (Python)
        let k = i - 1;
        while (k >= stmtStart && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r')) k--;
        if (!(k >= stmtStart && text[k] === '\\')) { endStatement(i); stmtStart = i + 1; }
      } else if (c === ';') { endStatement(i); stmtStart = i + 1; }
      else if (c === '=' || c === ':') top.push(i);
    }
    i++;
  }
  endStatement(text.length);

  // Work on the masked text, so a statement that is only a comment is empty.
  const blanked = masked.join('');
  const regions = [];
  for (const st of statements) {
    const r = expressionOf(blanked, st, lang);
    if (r) regions.push(r);
  }
  return { regions, masked: blanked };
}

function isAdjoint(text, i) {
  const p = text[i - 1];
  return !!p && /[\w)\]'.]/.test(p);
}

// Is the "=" at i an assignment (not ==, <=, >=, !=, =>)?
function isAssign(text, i) {
  const prev = text[i - 1], next = text[i + 1];
  if (next === '=' || next === '>') return false;
  if (prev === '=' || prev === '!') return false;
  if (prev === '<' || prev === '>') return text[i - 2] === prev; // <<= and >>= are assignments
  return true;
}

function expressionOf(text, st, lang) {
  let start = st.start;
  const end = trimEnd(text, st.start, st.end);
  while (start < end && /\s/.test(text[start])) start++;
  if (start >= end) return null;
  if (text[start] === '@') return null; // decorators and Julia macros

  const word = /^[A-Za-z_]+/.exec(text.slice(start, Math.min(end, start + 20)));
  const kw = word && word[0];
  // a keyword (followed by a space, colon or the end), not a name that starts with one
  if (kw && SKIP[lang].has(kw) && !/[\w(.=]/.test(text[start + kw.length] || '')) return null;

  if (kw && CONDITION[lang].has(kw)) {
    const from = start + kw.length;
    const colon = lang === 'python' ? st.top.find(t => t > from && text[t] === ':') : undefined;
    return trimmed(text, from, colon !== undefined ? colon : end);
  }
  let from = start;
  if (kw && PREFIX[lang].has(kw) && /\s/.test(text[start + kw.length] || '')) from = start + kw.length;
  // the last top-level assignment
  const assigns = st.top.filter(t => t >= from && t < end && text[t] === '=' && isAssign(text, t));
  if (assigns.length) from = assigns[assigns.length - 1] + 1;
  return trimmed(text, from, end);
}

function trimEnd(text, start, end) {
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end;
}

function trimmed(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  end = trimEnd(text, start, end);
  return start < end ? { start, end } : null;
}

module.exports = { scan };
