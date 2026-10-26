'use strict';
// Builds the notation for one language: the built-in tables for its profile,
// with the user's settings merged on top.

const PROFILES = {
  python: require('./python'),
  julia: require('./julia'),
};

// VS Code language id -> profile name
const LANGUAGES = {
  python: 'python',
  julia: 'julia',
};

const TABLES = ['bigOperators', 'functions', 'identifiers', 'ranges'];

function profileFor(languageId) {
  return LANGUAGES[languageId] || null;
}

// Copy `over` onto `base`; a null value removes the key.
function mergeTable(base, over) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over || {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

// Arrays: user entries are added; an entry starting with "-" removes one.
function mergeList(base, over) {
  const out = new Set(base || []);
  for (const v of over || []) {
    if (typeof v !== 'string') continue;
    if (v.startsWith('-')) out.delete(v.slice(1));
    else out.add(v);
  }
  return [...out];
}

/**
 * @param {string} profileName  'python' | 'julia'
 * @param {object} user  settings: {bigOperators, functions, identifiers, ranges, modulePrefixes, builtinNotation}
 */
function buildNotation(profileName, user = {}) {
  const profile = PROFILES[profileName];
  if (!profile) return null;
  const builtin = user.builtinNotation === false ? {} : profile;
  const n = {
    profile: profileName,
    parser: profile.parser,
    options: profile.options || {},
    modulePrefixes: mergeList(builtin.modulePrefixes, user.modulePrefixes)
      .sort((a, b) => b.length - a.length), // longest first, so np.linalg wins over np
  };
  for (const t of TABLES) n[t] = mergeTable(builtin[t], user[t]);
  return n;
}

module.exports = { buildNotation, profileFor, PROFILES, LANGUAGES, TABLES };
