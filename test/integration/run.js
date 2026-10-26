'use strict';
// Runs suite.js inside a real VS Code with this extension loaded.
// Uses the installed VS Code by default (VSCODE_PATH to override) and a
// throwaway profile, so your normal settings and extensions are not touched.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const installed = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const vscodeExecutablePath = process.env.VSCODE_PATH || (fs.existsSync(installed) ? installed : undefined);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mathview-test-'));
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [
        path.join(root, 'examples'),
        '--disable-extensions',
        `--user-data-dir=${path.join(profile, 'data')}`,
        `--extensions-dir=${path.join(profile, 'ext')}`,
        '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
      ],
    });
  } catch (e) {
    console.error('Integration tests failed:', e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
