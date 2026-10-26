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
    assert.ok(JSON.stringify(v).includes('meta.mathview.bigop'), JSON.stringify(v));
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

  console.log('\n' + results.join('\n') + '\n');
  const failed = results.filter(r => r.startsWith('FAIL'));
  if (failed.length) throw new Error(`${failed.length} integration check(s) failed`);
};
