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

// ---------- JavaScript / TypeScript ----------

const JS_SKIP = new Set(['for', 'function', 'class', 'import', 'interface', 'type', 'enum', 'switch', 'case', 'default',
  'try', 'catch', 'finally', 'do', 'else', 'break', 'continue', 'declare', 'namespace', 'module', 'throw', 'debugger']);
const JS_PREFIX = /^(?:(?:export|default|async|declare|public|private|protected|static|readonly|override)\s+)*/;
// Characters that, ending a line, mean the statement goes on (no automatic semicolon)
const CONTINUES_AFTER = /[=+\-*/%,.?:&|^!<>(\[{]$/;
const CONTINUES_BEFORE = /^(?:[.?:+\-*/%&|^,)\]}]|=>)/;

function regexCanStart(text, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  if (k < 0) return true;
  const c = text[k];
  if (/[\w$]/.test(c)) {
    const word = /[\w$]+$/.exec(text.slice(Math.max(0, k - 12), k + 1))[0];
    return ['return', 'typeof', 'case', 'in', 'of', 'yield', 'await', 'void', 'delete'].includes(word);
  }
  return !/[)\]}]/.test(c);
}

function scanJs(text) {
  const masked = text.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (masked[k] !== '\n') masked[k] = ' '; };
  let i = 0;
  // 1. blank out comments, strings, template literals and regex literals
  while (i < text.length) {
    const c = text[i];
    if (text.startsWith('//', i)) { let j = i; while (j < text.length && text[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); const e = j < 0 ? text.length : j + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, depth = 0;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (c === '`' && text.startsWith('${', j)) { depth++; j += 2; continue; }
        if (c === '`' && depth && text[j] === '}') { depth--; j++; continue; }
        if (text[j] === c && !depth) break;
        if (c !== '`' && text[j] === '\n') break;
        j++;
      }
      j = Math.min(text.length, j + 1);
      blank(i, j); i = j; continue;
    }
    if (c === '/' && regexCanStart(text, i)) {
      let j = i + 1, cls = false;
      while (j < text.length && text[j] !== '\n' && (cls || text[j] !== '/')) {
        if (text[j] === '\\') j++;
        else if (text[j] === '[') cls = true;
        else if (text[j] === ']') cls = false;
        j++;
      }
      if (text[j] === '/') {
        j++;
        while (j < text.length && /[a-z]/.test(text[j])) j++;
        blank(i, j); i = j; continue;
      }
    }
    i++;
  }
  const m = masked.join('');

  // 2. split into statements at ; { } and line ends (outside ( and [)
  const statements = [];
  let depth = 0, start = 0;
  const top = [];
  const end = e => { statements.push({ start, end: e, top: top.splice(0) }); start = e + 1; };
  for (let k = 0; k < m.length; k++) {
    const c = m[k];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (c === ';' || c === '{' || c === '}') end(k);
    else if (c === '\n') {
      const before = m.slice(start, k).trimEnd();
      const after = m.slice(k + 1, k + 200).trimStart();
      if (before && (CONTINUES_AFTER.test(before) || CONTINUES_BEFORE.test(after))) continue;
      end(k);
    } else if (c === '=' || c === ':' || c === '?') top.push(k);
  }
  end(m.length);

  // 3. the expression part of each statement
  const regions = [];
  for (const st of statements) {
    const r = jsExpression(m, st);
    if (r) regions.push(r);
  }
  return { regions, masked: m };
}

function jsExpression(m, st) {
  let from = st.start;
  let to = trimEnd(m, st.start, st.end);
  while (from < to && /\s/.test(m[from])) from++;
  if (from >= to) return null;
  const head = m.slice(from, to);
  const prefix = JS_PREFIX.exec(head)[0];
  from += prefix.length;
  const word = (/^[A-Za-z_$][\w$]*/.exec(m.slice(from, to)) || [''])[0];
  if (m[from] === '@') return null;
  if (JS_SKIP.has(word) && !/[\w$.(]/.test(m[from + word.length] || '') ) {
    if (word !== 'else') return null;
    // else if (...)
    from += 4;
    while (/\s/.test(m[from])) from++;
    if (!m.startsWith('if', from)) return null;
  }
  const w = (/^[A-Za-z_$][\w$]*/.exec(m.slice(from, to)) || [''])[0];
  if (w === 'if' || w === 'while') {
    const open = m.indexOf('(', from);
    if (open < 0 || open >= to) return null;
    let d = 0, k = open;
    for (; k < to; k++) { if (m[k] === '(') d++; else if (m[k] === ')') { d--; if (d === 0) break; } }
    return trimmed(m, open + 1, k);
  }
  if (w === 'return' || w === 'yield' || w === 'await') from += w.length;
  else if (w === 'const' || w === 'let' || w === 'var') {
    const eq = st.top.find(t => t > from && m[t] === '=' && isAssign(m, t));
    if (eq === undefined) return null;
    from = eq + 1;
  } else {
    // object property `key: value` (not a ternary)
    const prop = /^[\w$]+\s*:(?!:)/.exec(m.slice(from, to));
    if (prop) from += prop[0].length;
    else {
      const assigns = st.top.filter(t => t >= from && t < to && m[t] === '=' && isAssign(m, t));
      if (assigns.length) from = assigns[assigns.length - 1] + 1;
    }
  }
  while (to > from && /[,\s]/.test(m[to - 1])) to--;
  return trimmed(m, from, to);
}

module.exports = { scan: (text, lang) => (lang === 'js' ? scanJs(text) : scan(text, lang)) };
