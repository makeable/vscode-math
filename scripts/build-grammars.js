'use strict';
// Writes syntaxes/*.json from the built-in notation. Run after changing src/notation.
const fs = require('fs');
const path = require('path');
const { GRAMMARS, buildGrammar } = require('../src/grammar');
const { buildNotation } = require('../src/notation');

for (const profile of Object.keys(GRAMMARS)) {
  const file = path.join(__dirname, '..', GRAMMARS[profile].file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(buildGrammar(profile, buildNotation(profile)), null, 2)}\n`);
  console.log(`wrote ${GRAMMARS[profile].file}`);
}
