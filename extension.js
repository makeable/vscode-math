'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { selectSpans } = require('./src/select');
const { renderDataUri, renderInline } = require('./src/render');
const { buildNotation, profileFor, TABLES, LANGUAGES } = require('./src/notation');
const builtinSymbols = require('./src/notation/symbols');
const { GRAMMARS, MULTIPLIER, multipliersFor, buildGrammar, lineLevelTester } = require('./src/grammar');

const TALL_SCOPE = 'meta.mathview.tall';
const MEDIUM_SCOPE = 'meta.mathview.medium';

// ---------- decorations ----------
//
// Hidden text gets a decoration whose CSS (slipped in through textDecoration,
// the trick Prettify Symbols Mode uses) removes it from the line. Symbols and
// maths images are drawn just before the hidden text. The file is untouched.

const hideType = vscode.window.createTextEditorDecorationType({
  textDecoration: 'none; display: none;',
});
const showType = vscode.window.createTextEditorDecorationType({});
const mathType = vscode.window.createTextEditorDecorationType({});

let storageDir = null; // where inline SVGs are written; set in activate()

// ---------- settings and notation ----------

let rulesCache = new Map(); // languageId -> [{re, symbol}]
let notationCache = new Map(); // languageId -> notation

function config(scope) {
  return vscode.workspace.getConfiguration('mathView', scope);
}

// The user's notation settings for a document or language, e.g. {languageId: 'python'}.
function userNotation(scope) {
  const cfg = config(scope);
  const user = { builtinNotation: cfg.get('builtinNotation', true), modulePrefixes: cfg.get('modulePrefixes', []) };
  for (const t of TABLES) user[t] = cfg.get(t, {});
  return user;
}

function notationFor(doc) {
  const profile = profileFor(doc.languageId);
  if (!profile) return null;
  if (!notationCache.has(doc.languageId)) {
    const notation = buildNotation(profile, userNotation(doc));
    notation.lineLevel = lineLevelTester(notation, profile);
    notationCache.set(doc.languageId, notation);
  }
  return notationCache.get(doc.languageId);
}

function symbolTable(scope, profile) {
  const cfg = config(scope);
  const builtin = cfg.get('builtinSymbols', true);
  return {
    ...(builtin ? builtinSymbols.common : {}),
    ...(builtin && profile ? builtinSymbols.byProfile[profile] || {} : {}),
    ...cfg.get('symbols', {}),
  };
}

function rulesFor(doc) {
  const languageId = doc.languageId;
  if (rulesCache.has(languageId)) return rulesCache.get(languageId);
  const rules = [];
  for (const [pattern, symbol] of Object.entries(symbolTable(doc, profileFor(languageId)))) {
    if (typeof symbol !== 'string' || !symbol) continue; // null turns a built-in off
    try {
      rules.push({ re: new RegExp(pattern, 'g'), symbol });
    } catch (e) {
      console.warn(`Math View: skipping bad pattern ${pattern}: ${e.message}`);
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

// ---------- analysis ----------
//
// For each document version: the pieces of maths to draw, and how tall each
// line is (the same patterns as the generated grammar, run on the text with
// comments and strings blanked out).

const MAX_LINES = 20000;
const analysisCache = new Map(); // uri -> {version, notation, spans, levels}

function analyse(doc) {
  const notation = notationFor(doc);
  if (!notation || doc.lineCount > MAX_LINES) return null;
  const key = doc.uri.toString();
  const cached = analysisCache.get(key);
  if (cached && cached.version === doc.version && cached.notation === notation) return cached;
  const text = doc.getText();
  const { spans, masked } = selectSpans(text, notation);
  const lines = masked.split('\n');
  const levels = lines.map(l => (/[^\s]/.test(l) ? notation.lineLevel(l) : 'normal'));
  const result = {
    version: doc.version,
    notation,
    levels,
    spans: spans.map(s => {
      const range = new vscode.Range(doc.positionAt(s.start), doc.positionAt(s.end));
      return { ...s, range };
    }),
  };
  analysisCache.set(key, result);
  return result;
}

// ---------- drawing ----------

function revealedLines(editor) {
  const lines = new Set();
  if (!config(editor.document).get('revealOnCursorLine', true)) return lines;
  for (const sel of editor.selections) {
    for (let l = sel.start.line; l <= sel.end.line; l++) lines.add(l);
  }
  return lines;
}

function updateEditor(editor) {
  if (!editor) return;
  const doc = editor.document;
  if (!config(doc).get('enabled', true) || doc.uri.scheme === 'output') {
    editor.setDecorations(hideType, []);
    editor.setDecorations(showType, []);
    editor.setDecorations(mathType, []);
    return;
  }
  const text = doc.getText();
  const reveal = revealedLines(editor);
  const hidden = [], shown = [], math = [];

  const drawn = mathDecorations(editor, reveal);
  for (const d of drawn) {
    hidden.push(d.range);
    math.push(d.decoration);
  }
  // symbols aren't drawn inside maths pictures
  const inside = (start, end) => drawn.some(d => start < d.end && end > d.start);

  for (const m of findMatches(text, rulesFor(doc))) {
    if (inside(m.start, m.end)) continue;
    const range = new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end));
    if (reveal.has(range.start.line) || reveal.has(range.end.line)) continue;
    hidden.push(range);
    shown.push({ range, renderOptions: { before: { contentText: m.symbol } } });
  }
  editor.setDecorations(hideType, hidden);
  editor.setDecorations(showType, shown);
  editor.setDecorations(mathType, math);
}

function editorMetrics(editor) {
  const ed = vscode.workspace.getConfiguration('editor', editor.document);
  const fontSize = ed.get('fontSize', 14);
  let lineHeight = ed.get('lineHeight', 0);
  if (lineHeight === 0) lineHeight = Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
  else if (lineHeight < 8) lineHeight = Math.round(lineHeight * fontSize);
  return { fontSize, lineHeight, scale: config(editor.document).get('scale', 1) };
}

const inlineCache = new Map(); // key -> {uri, width, height, descent}

function inlineImage(latex, { display, maxHeight }, metrics) {
  const color = mathColor();
  const key = `${display}|${maxHeight}|${latex}|${color}|${metrics.fontSize}|${metrics.scale}`;
  if (inlineCache.has(key)) return inlineCache.get(key);
  // Display maths is drawn bigger than the code so limits and scripts stay readable,
  // then shrunk if it doesn't fit the room the line has.
  const fontSize = metrics.fontSize * (display ? 1.35 * metrics.scale : 1);
  const r = renderInline(latex, { color, fontSize, maxHeight, display });
  const file = path.join(storageDir, `${crypto.createHash('sha1').update(key).digest('hex')}.svg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, r.svg);
  const img = { uri: vscode.Uri.file(file), width: r.width, height: r.height, descent: r.descent };
  if (inlineCache.size > 1000) inlineCache.clear();
  inlineCache.set(key, img);
  return img;
}

// Tall mode relies on token colour rules that make lines taller (see syntaxes/
// and configurationDefaults in package.json). If the user's own
// tokenColorCustomizations replace them, fall back to compact.
function tallLinesActive() {
  const v = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations');
  return JSON.stringify(v || {}).includes(TALL_SCOPE);
}

// The line heights VS Code is actually using for tall and medium lines: from the
// token rules in effect (ours by default, or the user's), so pictures fit them.
function activeMultipliers() {
  const v = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations') || {};
  const out = { ...MULTIPLIER };
  const rules = [];
  (function collect(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.textMateRules)) rules.push(...o.textMateRules);
    for (const [k, x] of Object.entries(o)) if (k.startsWith('[')) collect(x); // theme-specific blocks
  })(v);
  for (const r of rules) {
    const scopes = [].concat(r && r.scope || []);
    const h = r && r.settings && Number(r.settings.lineHeight);
    if (!h) continue;
    if (scopes.includes(TALL_SCOPE)) out.tall = h;
    if (scopes.includes(MEDIUM_SCOPE)) out.medium = h;
  }
  return out;
}

const isOurRule = r => r && [].concat(r.scope || []).some(x => x === TALL_SCOPE || x === MEDIUM_SCOPE);

// Write our line-height rules into the user's tokenColorCustomizations, or take
// them out again when the defaults (from package.json) would do the same job.
async function writeLineHeightRules(scale) {
  const editorCfg = vscode.workspace.getConfiguration('editor');
  const current = editorCfg.inspect('tokenColorCustomizations').globalValue || {};
  const others = (Array.isArray(current.textMateRules) ? current.textMateRules : []).filter(r => !isOurRule(r));
  const ownSettings = others.length > 0 || Object.keys(current).some(k => k !== 'textMateRules');
  const m = multipliersFor(scale);
  let next;
  if (scale === 1 && !ownSettings) {
    next = undefined; // the built-in defaults apply
  } else {
    next = {
      ...current,
      textMateRules: [
        ...others,
        { scope: TALL_SCOPE, settings: { lineHeight: m.tall } },
        { scope: MEDIUM_SCOPE, settings: { lineHeight: m.medium } },
      ],
    };
  }
  const before = editorCfg.inspect('tokenColorCustomizations').globalValue;
  if (JSON.stringify(next) !== JSON.stringify(before)) {
    await editorCfg.update('tokenColorCustomizations', next, vscode.ConfigurationTarget.Global);
  }
}

// Your own editor.tokenColorCustomizations replace our default, so offer to add the rules.
async function offerTallLineRule() {
  if (config().get('inline', 'tall') !== 'tall' || tallLinesActive()) return;
  const add = 'Add rules';
  const pick = await vscode.window.showInformationMessage(
    'Math View needs line-height rules in editor.tokenColorCustomizations to show maths full size. ' +
    'Your own token colour settings currently replace them, so maths is shown compact.',
    add, 'Use compact');
  if (pick === add) await writeLineHeightRules(config().get('scale', 1));
  else if (pick === 'Use compact') await config().update('inline', 'compact', vscode.ConfigurationTarget.Global);
}

// Decorations that replace each piece of maths with its picture.
//   tall:    lines with big notation are taller (token rules) and the maths fills them
//   compact: everything fits a normal line
// A piece over several lines fills all of them; their code is hidden.
function mathDecorations(editor, reveal) {
  const doc = editor.document;
  const mode = config(doc).get('inline', 'tall');
  if (mode === 'off' || !storageDir) return [];
  const analysis = analyse(doc);
  if (!analysis) return [];
  const metrics = editorMetrics(editor);
  const tall = mode === 'tall' && tallLinesActive();
  const multipliers = activeMultipliers();
  const heightOf = line => metrics.lineHeight * (tall ? multipliers[analysis.levels[line]] || 1 : 1);
  const out = [];
  for (const s of analysis.spans) {
    const first = s.range.start.line, last = s.range.end.line;
    let revealed = false;
    for (let l = first; l <= last; l++) if (reveal.has(l)) revealed = true;
    if (revealed) continue;

    let room = 0;
    for (let l = first; l <= last; l++) room += heightOf(l);
    const multiLine = last > first;
    const display = multiLine || (tall && analysis.levels[first] !== 'normal');
    let img;
    try {
      img = inlineImage(s.latex, { display, maxHeight: Math.max(8, Math.floor(room - (display ? 6 : 0))) }, metrics);
    } catch (e) {
      console.warn(`Math View: ${e.message}`);
      continue;
    }
    let css;
    if (multiLine) {
      // Hang the picture from the first line and let it fill the lines below,
      // without making the first line taller.
      const top = Math.max(0, (room - img.height) / 2);
      const bottom = heightOf(first) - img.height - top;
      css = `vertical-align: top; margin-top: ${top.toFixed(1)}px; margin-bottom: ${bottom.toFixed(1)}px;`;
    } else {
      css = `vertical-align: ${(-img.descent).toFixed(1)}px;`; // maths baseline on the text baseline
    }
    out.push({
      start: s.start,
      end: s.end,
      range: s.range,
      decoration: {
        range: s.range,
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

// ---------- hover ----------

const svgCache = new Map(); // `${latex}|${color}|${scale}` -> data URI

function mathColor() {
  const kind = vscode.window.activeColorTheme.kind;
  const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  return dark ? '#d4d4d4' : '#1f1f1f';
}

function hoverImage(latex, scope) {
  const color = mathColor();
  const scale = config(scope).get('hoverScale', 1.4);
  const key = `${latex}|${color}|${scale}`;
  if (!svgCache.has(key)) {
    if (svgCache.size > 200) svgCache.clear();
    svgCache.set(key, renderDataUri(latex, { color, scale }));
  }
  return svgCache.get(key);
}

const hoverProvider = {
  provideHover(doc, position) {
    if (!config(doc).get('hover', true)) return null;
    const analysis = analyse(doc);
    if (!analysis) return null;
    const offset = doc.offsetAt(position);
    const s = analysis.spans.find(x => x.start <= offset && offset < x.end);
    if (!s) return null;
    let uri;
    try { uri = hoverImage(s.latex, doc); } catch (e) { console.warn(`Math View: ${e.message}`); return null; }
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`![${s.latex.replace(/[[\]]/g, '')}](${uri})\n\n`);
    md.appendCodeblock(s.latex, 'latex');
    return new vscode.Hover(md, s.range);
  },
};

// ---------- generated grammars ----------
//
// The grammars that make lines taller are built from the notation. VS Code
// only reads grammar files at startup, so when the settings change them we
// rewrite the file and offer a reload.

function syncGrammars(context, { prompt }) {
  let changed = false;
  for (const [profile, g] of Object.entries(GRAMMARS)) {
    const languageId = Object.keys(LANGUAGES).find(l => LANGUAGES[l] === profile);
    const notation = buildNotation(profile, userNotation({ languageId }));
    const json = `${JSON.stringify(buildGrammar(profile, notation), null, 2)}\n`;
    const file = path.join(context.extensionPath, g.file);
    let current = '';
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (current === json) continue;
    try { fs.writeFileSync(file, json); changed = true; } catch (e) { console.warn(`Math View: cannot update ${g.file}: ${e.message}`); }
  }
  if (changed && prompt) {
    vscode.window.showInformationMessage(
      'Math View: notation changed. Reload the window to update which lines are made taller.', 'Reload Window',
    ).then(pick => { if (pick) vscode.commands.executeCommand('workbench.action.reloadWindow'); });
  }
  return changed;
}

async function showNotation() {
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  const languageId = doc ? doc.languageId : 'python';
  const profile = profileFor(languageId) || 'python';
  const n = buildNotation(profile, userNotation(doc || { languageId }));
  const tables = {};
  for (const t of TABLES) tables[t] = n[t];
  const content = JSON.stringify({
    '// Effective Math View notation': `${languageId} (built-ins merged with your settings)`,
    modulePrefixes: n.modulePrefixes,
    ...tables,
    symbols: symbolTable(doc || { languageId }, profile),
  }, null, 2);
  const out = await vscode.workspace.openTextDocument({ language: 'jsonc', content });
  await vscode.window.showTextDocument(out, { preview: true });
}

// ---------- activation ----------

const NOTATION_KEYS = ['bigOperators', 'functions', 'syntax', 'modulePrefixes', 'builtinNotation'];

function activate(context) {
  storageDir = path.join(context.globalStorageUri.fsPath, 'inline-svg');
  try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) { storageDir = null; console.warn(e); }
  context.subscriptions.push(
    hideType,
    showType,
    mathType,
    vscode.languages.registerHoverProvider({ scheme: '*' }, hoverProvider),
    vscode.commands.registerCommand('mathView.showNotation', showNotation),
    vscode.commands.registerCommand('mathView.toggle', async () => {
      const now = config().get('enabled', true);
      await config().update('enabled', !now, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Math View ${now ? 'off' : 'on'}`, 2000);
    }),
    vscode.window.onDidChangeVisibleTextEditors(updateAll),
    vscode.window.onDidChangeTextEditorSelection(e => scheduleUpdate(e.textEditor, 0)),
    vscode.workspace.onDidChangeTextDocument(e => {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document === e.document) scheduleUpdate(ed, 50);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(d => analysisCache.delete(d.uri.toString())),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mathView') || e.affectsConfiguration('editor.fontSize') || e.affectsConfiguration('editor.lineHeight')) {
        rulesCache = new Map(); notationCache = new Map(); analysisCache.clear(); svgCache.clear(); inlineCache.clear(); updateAll();
      }
      if (NOTATION_KEYS.some(k => e.affectsConfiguration(`mathView.${k}`))) {
        syncGrammars(context, { prompt: true });
      }
      if (e.affectsConfiguration('editor.tokenColorCustomizations')) { inlineCache.clear(); updateAll(); }
      if (e.affectsConfiguration('mathView.scale')) writeLineHeightRules(config().get('scale', 1));
    }),
    vscode.window.onDidChangeActiveColorTheme(() => { svgCache.clear(); inlineCache.clear(); updateAll(); }),
  );
  // Settings may have changed while VS Code was closed.
  syncGrammars(context, { prompt: true });
  updateAll();
  offerTallLineRule();
  // used by the tests
  return {
    get storageDir() { return storageDir; },
    spansFor: doc => (analyse(doc) || { spans: [] }).spans.map(s => ({ start: s.start, end: s.end, latex: s.latex, height: s.height })),
    levelsFor: doc => (analyse(doc) || { levels: [] }).levels,
  };
}

function deactivate() {
  for (const t of pending.values()) clearTimeout(t);
}

module.exports = { activate, deactivate };
