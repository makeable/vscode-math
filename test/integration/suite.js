'use strict';
// Executed inside VS Code. No test framework, just assertions and a summary.
const vscode = require('vscode');
const assert = require('assert');
const path = require('path');

async function hoverAt(doc, needle, offsetInNeedle = 0) {
  const idx = doc.getText().indexOf(needle);
  assert.ok(idx >= 0, `"${needle}" not found in ${path.basename(doc.fileName)}`);
  const pos = doc.positionAt(idx + offsetInNeedle);
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos);
  return hovers
    .flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value)))
    .filter(s => s.includes('data:image/svg+xml'));
}

exports.run = async () => {
  const examples = path.resolve(__dirname, '../../examples');
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`ok   ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
  };

  const py = await vscode.workspace.openTextDocument(path.join(examples, 'demo.py'));
  await vscode.window.showTextDocument(py);
  const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'vscode-math');
  await ext.activate();

  await check('hover on the chat example renders a sum', async () => {
    const md = await hoverAt(py, 'sum(x[i] for i in range(1, n+1))', 5);
    assert.strictEqual(md.length, 1, 'expected one math hover');
    assert.ok(md[0].includes('\\sum_{i=1}^{n} x_{i}'), md[0].slice(-200));
  });

  await check('double sum hovers as a whole from the inner part', async () => {
    const md = await hoverAt(py, 'A[i][j] for i in range(n) for j', 2);
    assert.ok(md[0].includes('\\sum_{i=0}^{n - 1} \\sum_{j=0}^{m - 1} A_{i,j}'), md[0] && md[0].slice(-200));
  });

  await check('product renders with \\prod', async () => {
    const md = await hoverAt(py, 'math.prod(', 6);
    assert.ok(md[0].includes('\\prod_{i=1}^{n} x_{i}'));
  });

  await check('no math hover on ordinary code', async () => {
    const md = await hoverAt(py, 'def clamp', 5);
    assert.strictEqual(md.length, 0);
  });

  await check('rendered image is a valid SVG', async () => {
    const md = await hoverAt(py, 'sum(1/k**2', 1);
    const b64 = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(md[0])[1];
    const svg = Buffer.from(b64, 'base64').toString();
    assert.ok(svg.startsWith('<svg') && svg.includes('xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(/width="[\d.]+px"/.test(svg));
  });

  const jl = await vscode.workspace.openTextDocument(path.join(examples, 'demo.jl'));
  await check('Julia sum with 1:n range', async () => {
    const md = await hoverAt(jl, 'sum(a[i] * b[i] for i = 1:n)', 3);
    assert.ok(md[0].includes('\\sum_{i=1}^{n} a_{i} b_{i}'));
  });

  await check('toggle command flips the setting', async () => {
    const cfg = () => vscode.workspace.getConfiguration('mathView').get('enabled');
    const before = cfg();
    await vscode.commands.executeCommand('mathView.toggle');
    assert.strictEqual(cfg(), !before);
    await vscode.commands.executeCommand('mathView.toggle');
    assert.strictEqual(cfg(), before);
  });

  await check('tall-line rule is on by default', async () => {
    const v = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations');
    assert.ok(JSON.stringify(v).includes('meta.mathview.tall'), JSON.stringify(v));
    assert.strictEqual(vscode.workspace.getConfiguration('mathView').get('inline'), 'tall');
  });

  await check('inline SVGs are written for sums on screen', async () => {
    await vscode.window.showTextDocument(py);
    await new Promise(r => setTimeout(r, 500));
    const fs = require('fs');
    const dir = path.join(ext.exports?.storageDir || '', '');
    const files = dir ? fs.readdirSync(dir).filter(f => f.endsWith('.svg')) : [];
    assert.ok(files.length >= 5, `found ${files.length} SVGs in ${dir}`);
  });

  await check('notation settings change the hover', async () => {
    const cfg = vscode.workspace.getConfiguration('mathView');
    await cfg.update('bigOperators', { sum: '\\Sigma' }, vscode.ConfigurationTarget.Global);
    await new Promise(r => setTimeout(r, 300));
    try {
      const md = await hoverAt(py, 'sum(x[i] for i in range(1, n+1))', 5);
      assert.ok(md[0].includes('\\Sigma_{i=1}^{n} x_{i}'), md[0] && md[0].slice(-120));
    } finally {
      await cfg.update('bigOperators', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  await check('language-specific settings apply only to that language', async () => {
    const cfg = vscode.workspace.getConfiguration('mathView', { languageId: 'julia' });
    await cfg.update('functions', { sqrt: '\\operatorname{root}($1)' }, vscode.ConfigurationTarget.Global, true);
    await new Promise(r => setTimeout(r, 300));
    try {
      const pyDoc = await vscode.workspace.openTextDocument({ language: 'python', content: 'y = sum(sqrt(x[i]) for i in range(n))' });
      const pyMd = await hoverAt(pyDoc, 'sum(', 1);
      const jl2 = await vscode.workspace.openTextDocument({ language: 'julia', content: 'y = sum(sqrt(x[i]) for i in 1:n)' });
      const jlMd = await hoverAt(jl2, 'sum(', 1);
      assert.ok(jlMd[0].includes('\\operatorname{root}(x_{i})'), jlMd[0] && jlMd[0].slice(-120));
      assert.ok(pyMd[0].includes('\\sqrt{x_{i}}') && !pyMd[0].includes('root'), pyMd[0] && pyMd[0].slice(-120));
    } finally {
      await cfg.update('functions', undefined, vscode.ConfigurationTarget.Global, true);
    }
  });

  await check('changing big operators regenerates the grammar, and it is restored', async () => {
    const fs = require('fs');
    const file = path.resolve(__dirname, '../../syntaxes/mathview.python.json');
    const before = fs.readFileSync(file, 'utf8');
    const cfg = vscode.workspace.getConfiguration('mathView');
    await cfg.update('bigOperators', { logsumexp: '\\operatorname{LSE}' }, vscode.ConfigurationTarget.Global);
    await new Promise(r => setTimeout(r, 300));
    const during = fs.readFileSync(file, 'utf8');
    await cfg.update('bigOperators', undefined, vscode.ConfigurationTarget.Global);
    await new Promise(r => setTimeout(r, 300));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(during.includes('logsumexp'), 'grammar not regenerated');
    assert.strictEqual(after, before, 'grammar not restored');
  });

  await check('show notation command opens the merged tables', async () => {
    await vscode.window.showTextDocument(py);
    await vscode.commands.executeCommand('mathView.showNotation');
    const text = vscode.window.activeTextEditor.document.getText();
    assert.ok(text.includes('"bigOperators"') && text.includes('"range/2"'), text.slice(0, 200));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  const sym = await vscode.workspace.openTextDocument(path.join(examples, 'symbols.py'));
  await check('showcase: every maths line becomes a piece', async () => {
    const spans = ext.exports.spansFor(sym);
    const text = sym.getText();
    const lines = new Set(spans.map(sp => sym.positionAt(sp.start).line));
    // every assignment after the imports, except df's plain gradient
    const expected = text.split('\n').map((l, i) => [l, i]).filter(([l]) => /^\w+ = /.test(l)).map(([, i]) => i);
    const missing = expected.filter(i => !lines.has(i));
    assert.deepStrictEqual(missing.map(i => text.split('\n')[i]), []);
  });

  await check('showcase: multi-line matrix hovers from its second line', async () => {
    const md = await hoverAt(sym, '[math.sin(theta)', 2);
    assert.ok(md[0] && md[0].includes('\\begin{bmatrix}'), md[0] && md[0].slice(-150));
  });

  await check('showcase: line heights follow the notation', async () => {
    const levels = ext.exports.levelsFor(sym);
    const at = needle => levels[sym.positionAt(sym.getText().indexOf(needle)).line];
    assert.strictEqual(at('total = sum'), 'tall');
    assert.strictEqual(at('positive = all'), 'medium');
    assert.strictEqual(at('root = '), 'medium');
    assert.strictEqual(at('density = '), 'tall');
    assert.strictEqual(at('length = '), 'normal');
    assert.strictEqual(at('# Calculus'), 'normal');
  });

  const ts = await vscode.workspace.openTextDocument(path.join(examples, 'symbols.ts'));
  await check('typescript: every maths line becomes a piece', async () => {
    assert.strictEqual(ts.languageId, 'typescript');
    const spans = ext.exports.spansFor(ts);
    const lines = new Set(spans.map(sp => ts.positionAt(sp.start).line));
    const text = ts.getText().split('\n');
    const skip = /^const normal /; // normal is drawn as its inner product
    const expected = text.map((l, i) => [l, i]).filter(([l]) => /^const \w+ = /.test(l) && !skip.test(l)).map(([, i]) => i);
    assert.deepStrictEqual(expected.filter(i => !lines.has(i)).map(i => text[i]), []);
  });

  await check('typescript: reduce pipeline hovers as a sum', async () => {
    const md = await hoverAt(ts, 'xs.map(x => x * x)', 3);
    assert.ok(md[0] && md[0].includes('\\sum_{x \\in \\mathit{xs}} x \\cdot x'), md[0] && md[0].slice(-150));
  });

  await check('typescript: line heights', async () => {
    const levels = ext.exports.levelsFor(ts);
    const at = needle => levels[ts.positionAt(ts.getText().indexOf(needle)).line];
    assert.strictEqual(at('const total'), 'tall');
    assert.strictEqual(at('const allPositive'), 'medium');
    assert.strictEqual(at('const sign'), 'tall');
    assert.strictEqual(at('const area'), 'normal');
  });

  await check('scale setting writes and removes line-height rules', async () => {
    const editorCfg = () => vscode.workspace.getConfiguration('editor');
    const cfg = vscode.workspace.getConfiguration('mathView');
    await cfg.update('scale', 1.5, vscode.ConfigurationTarget.Global);
    await new Promise(r => setTimeout(r, 500));
    const rules = (editorCfg().inspect('tokenColorCustomizations').globalValue || {}).textMateRules || [];
    const tall = rules.find(r => r.scope === 'meta.mathview.tall');
    assert.ok(tall && tall.settings.lineHeight === 4, JSON.stringify(rules));
    await cfg.update('scale', undefined, vscode.ConfigurationTarget.Global);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(editorCfg().inspect('tokenColorCustomizations').globalValue, undefined);
    const effective = JSON.stringify(editorCfg().get('tokenColorCustomizations'));
    assert.ok(effective.includes('"lineHeight":3'), effective);
  });

  console.log('\n' + results.join('\n') + '\n');
  const failed = results.filter(r => r.startsWith('FAIL'));
  if (failed.length) throw new Error(`${failed.length} integration check(s) failed`);
};
