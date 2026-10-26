'use strict';
// Fills LaTeX templates such as "\\binom{$1}{$2}" or "\\sum_{$under}^{$over} $body".
//
//   $1, $2 ...   positional values
//   $name        named values
//   $1|atom      apply a filter (see FILTERS)
//
// If a placeholder has no value the template fails with MissingValue, so a
// list of templates can be tried in order until one fits.

class MissingValue extends Error {}

const PLACEHOLDER = /\$(\d+|[A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)(?:\|([a-z]+))?/g;

/**
 * @param {string} template
 * @param {(key: string, path: string[], filter?: string) => string} resolve
 *        returns LaTeX for a placeholder, or throws MissingValue
 */
function fill(template, resolve) {
  return template.replace(PLACEHOLDER, (_, key, path, filter) =>
    resolve(key, path ? path.slice(1).split('.') : [], filter));
}

function placeholders(template) {
  const keys = new Set();
  for (const m of template.matchAll(PLACEHOLDER)) keys.add(m[1]);
  return keys;
}

module.exports = { fill, placeholders, MissingValue };
