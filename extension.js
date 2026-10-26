'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bigOpToLatex, findBigOpCalls } = require('./src/latex');
const { renderDataUri, renderInline } = require('./src/render');

// ---------- symbol substitution ----------
//
// Each match gets two decorations: one hides the original characters (CSS
// slipped in through textDecoration, the same trick Prettify Symbols Mode uses),
// the other draws the symbol just before them. The file itself is untouched.

const hideType = vscode.window.createTextEditorDecorationType({
  textDecoration: 'none; display: none;',
});
const showType = vscode.window.createTextEditorDecorationType({});
const mathType = vscode.window.createTextEditorDecorationType({});

let storageDir = null; // where inline SVGs are written; set in activate()

let rulesCache = null; // languageId -> [{re, symbol}]

function config() {
  return vscode.workspace.getConfiguration('mathView');
}

function rulesFor(languageId) {
  if (!rulesCache) rulesCache = new Map();
  if (rulesCache.has(languageId)) return rulesCache.get(languageId);
  const rules = [];
  for (const r of config().get('substitutions', [])) {
    if (!r || !r.pattern || !r.symbol) continue;
    if (Array.isArray(r.languages) && r.languages.length && !r.languages.includes(languageId)) continue;
    try {
      rules.push({ re: new RegExp(r.pattern, 'g'), symbol: r.symbol });
    } catch (e) {
      console.warn(`Math View: skipping bad pattern ${r.pattern}: ${e.message}`);
    }
  }
  rulesCache.set(languageId, rules);
  return rules;
}

function findMatches(text, rules) {
  const all = [];
  for (const { re, symbol } of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      all.push({ start: m.index, end: m.index + m[0].length, symbol });
    }
  }
  // Keep the earliest match, and the longest one when two start together; drop overlaps.
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) { kept.push(m); lastEnd = m.end; }
  }
  return kept;
}

function revealedLines(editor) {
  const lines = new Set();
  if (!config().get('revealOnCursorLine', true)) return lines;
  for (const sel of editor.selections) {
    for (let l = sel.start.line; l <= sel.end.line; l++) lines.add(l);
  }
  return lines;
}

function updateEditor(editor) {
  if (!editor) return;
  if (!config().get('enabled', true) || editor.document.uri.scheme === 'output') {
    editor.setDecorations(hideType, []);
    editor.setDecorations(showType, []);
    editor.setDecorations(mathType, []);
    return;
  }
  const doc = editor.document;
  const text = doc.getText();
  const reveal = revealedLines(editor);
  const hidden = [], shown = [], math = [];

  const sums = inlineSums(editor, text, reveal);
  for (const s of sums) {
    hidden.push(s.range);
    math.push(s.decoration);
  }
  const insideSum = (start, end) => sums.some(s => start < s.end && end > s.start);

  for (const m of findMatches(text, rulesFor(doc.languageId))) {
    if (insideSum(m.start, m.end)) continue;
    const range = new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end));
    if (reveal.has(range.start.line) || reveal.has(range.end.line)) continue;
    hidden.push(range);
    shown.push({ range, renderOptions: { before: { contentText: m.symbol } } });
  }
  editor.setDecorations(hideType, hidden);
  editor.setDecorations(showType, shown);
  editor.setDecorations(mathType, math);
}

// ---------- inline sums ----------
//
// On lines without a cursor, a whole sum(...) call is hidden and an SVG of the
// typeset sum is drawn in its place. Lines can't grow taller, so:
//   tall:    stacked limits; the line itself is made taller by a token rule
//   compact: inline-style maths (limits beside the Σ), fits a normal line

function editorMetrics(editor) {
  const ed = vscode.workspace.getConfiguration('editor', editor.document);
  const fontSize = ed.get('fontSize', 14);
  let lineHeight = ed.get('lineHeight', 0);
  if (lineHeight === 0) lineHeight = Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
  else if (lineHeight < 8) lineHeight = Math.round(lineHeight * fontSize);
  return { fontSize, lineHeight };
}

const inlineCache = new Map(); // key -> {uri, width, height, descent}

function inlineImage(latex, mode, metrics) {
  const color = mathColor();
  const key = `${mode}|${latex}|${color}|${metrics.fontSize}|${metrics.lineHeight}`;
  if (inlineCache.has(key)) return inlineCache.get(key);
  const tall = mode === 'tall';
  const r = renderInline(latex, {
    color,
    fontSize: metrics.fontSize * (tall ? 1.1 : 1),
    maxHeight: tall ? metrics.lineHeight * LINE_MULTIPLIER - 6 : metrics.lineHeight,
    display: tall,
  });
  const file = path.join(storageDir, `${crypto.createHash('sha1').update(key).digest('hex')}.svg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, r.svg);
  const img = { uri: vscode.Uri.file(file), width: r.width, height: r.height, descent: r.descent };
  if (inlineCache.size > 500) inlineCache.clear();
  inlineCache.set(key, img);
  return img;
}

// Tall mode relies on a token colour rule that makes lines containing a sum
// taller (see syntaxes/ and configurationDefaults in package.json). If the
// user's own tokenColorCustomizations replace that rule, fall back to compact.
const TALL_SCOPE = 'meta.mathview.bigop';
const LINE_MULTIPLIER = 2.4;

function tallLinesActive() {
  const v = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations');
  return JSON.stringify(v || {}).includes(TALL_SCOPE);
}

// Your own editor.tokenColorCustomizations replace our default, so offer to add the rule.
async function offerTallLineRule() {
  if (config().get('inline', 'tall') !== 'tall' || tallLinesActive()) return;
  const add = 'Add rule';
  const pick = await vscode.window.showInformationMessage(
    'Math View needs a line-height rule in editor.tokenColorCustomizations to show sums full size. ' +
    'Your own token colour settings currently replace it, so sums are shown compact.',
    add, 'Use compact');
  const editorCfg = vscode.workspace.getConfiguration('editor');
  if (pick === add) {
    const current = editorCfg.inspect('tokenColorCustomizations').globalValue || {};
    const rules = Array.isArray(current.textMateRules) ? current.textMateRules : [];
    await editorCfg.update('tokenColorCustomizations', {
      ...current,
      textMateRules: [...rules, { scope: TALL_SCOPE, settings: { lineHeight: LINE_MULTIPLIER } }],
    }, vscode.ConfigurationTarget.Global);
  } else if (pick === 'Use compact') {
    await config().update('inline', 'compact', vscode.ConfigurationTarget.Global);
  }
}

function inlineSums(editor, text, reveal) {
  const mode = config().get('inline', 'tall');
  if (mode === 'off' || !storageDir) return [];
  const doc = editor.document;
  const metrics = editorMetrics(editor);
  const tall = mode === 'tall' && tallLinesActive();
  const out = [];
  // Outermost first, so a double sum renders as a whole and its inner sum is skipped.
  const calls = findBigOpCalls(text).sort((a, b) => a.start - b.start || b.end - a.end);
  let coveredTo = -1;
  for (const c of calls) {
    if (c.start < coveredTo) continue;
    const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
    if (range.start.line !== range.end.line || reveal.has(range.start.line)) continue;
    // The tall-line grammar skips comments, so skip them here too.
    if (/(^|\s)(#|\/\/)/.test(doc.lineAt(range.start.line).text.slice(0, range.start.character))) continue;
    let latex;
    try { latex = bigOpToLatex(text.slice(c.start, c.end)); } catch { continue; }
    let img;
    try { img = inlineImage(latex, tall ? 'tall' : 'compact', metrics); } catch (e) { console.warn(`Math View: ${e.message}`); continue; }
    // tall: centred in the taller line; compact: sits on the baseline like a word
    const css = tall ? 'vertical-align: middle;' : `vertical-align: ${(-img.descent).toFixed(1)}px;`;
    out.push({
      start: c.start,
      end: c.end,
      range,
      decoration: {
        range,
        renderOptions: {
          before: {
            contentIconPath: img.uri,
            width: `${img.width.toFixed(1)}px`,
            height: `${img.height.toFixed(1)}px`,
            textDecoration: `none; ${css}`,
          },
        },
      },
    });
    coveredTo = c.end;
  }
  return out;
}

function updateAll() {
  for (const e of vscode.window.visibleTextEditors) updateEditor(e);
}

// Typing fires lots of events; batch them per editor.
const pending = new Map();
function scheduleUpdate(editor, delay) {
  if (!editor) return;
  clearTimeout(pending.get(editor));
  pending.set(editor, setTimeout(() => { pending.delete(editor); updateEditor(editor); }, delay));
}

// ---------- hover: sums as typeset math ----------

const svgCache = new Map(); // `${latex}|${color}|${scale}` -> data URI

function mathColor() {
  const kind = vscode.window.activeColorTheme.kind;
  const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  return dark ? '#d4d4d4' : '#1f1f1f';
}

function render(latex) {
  const color = mathColor();
  const scale = config().get('hoverScale', 1.4);
  const key = `${latex}|${color}|${scale}`;
  if (!svgCache.has(key)) {
    if (svgCache.size > 200) svgCache.clear();
    svgCache.set(key, renderDataUri(latex, { color, scale }));
  }
  return svgCache.get(key);
}

const hoverProvider = {
  provideHover(doc, position) {
    if (!config().get('hover', true)) return null;
    const text = doc.getText();
    const offset = doc.offsetAt(position);
    // Outermost call under the cursor first, so a double sum shows as a whole.
    const calls = findBigOpCalls(text)
      .filter(c => c.start <= offset && offset < c.end)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start));
    for (const c of calls) {
      let latex;
      try {
        latex = bigOpToLatex(text.slice(c.start, c.end));
      } catch {
        continue; // not a math-like sum; try an inner one
      }
      let uri;
      try {
        uri = render(latex);
      } catch (e) {
        console.warn(`Math View: ${e.message}`);
        continue;
      }
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`![${latex.replace(/[[\]]/g, '')}](${uri})\n\n`);
      md.appendCodeblock(latex, 'latex');
      const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
      return new vscode.Hover(md, range);
    }
    return null;
  },
};

// ---------- activation ----------

function activate(context) {
  storageDir = path.join(context.globalStorageUri.fsPath, 'inline-svg');
  try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) { storageDir = null; console.warn(e); }
  context.subscriptions.push(
    hideType,
    showType,
    mathType,
    vscode.languages.registerHoverProvider({ scheme: '*' }, hoverProvider),
    vscode.commands.registerCommand('mathView.toggle', async () => {
      const now = config().get('enabled', true);
      await config().update('enabled', !now, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Math View symbols ${now ? 'off' : 'on'}`, 2000);
    }),
    vscode.window.onDidChangeVisibleTextEditors(updateAll),
    vscode.window.onDidChangeTextEditorSelection(e => scheduleUpdate(e.textEditor, 0)),
    vscode.workspace.onDidChangeTextDocument(e => {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document === e.document) scheduleUpdate(ed, 50);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mathView') || e.affectsConfiguration('editor.fontSize') || e.affectsConfiguration('editor.lineHeight')) {
        rulesCache = null; svgCache.clear(); inlineCache.clear(); updateAll();
      }
      if (e.affectsConfiguration('editor.tokenColorCustomizations')) updateAll();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => { svgCache.clear(); inlineCache.clear(); updateAll(); }),
  );
  updateAll();
  offerTallLineRule();
  return { get storageDir() { return storageDir; } }; // used by tests
}

function deactivate() {
  for (const t of pending.values()) clearTimeout(t);
}

module.exports = { activate, deactivate };
