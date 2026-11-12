'use strict';

const data = require('./unicode-data.js');
const categories = new Uint8Array(65536);
for (const [start, end, category] of data.categories) categories.fill(category, start, end);
const casing = new Map();
for (const group of data.caseGroups) for (const ch of group) casing.set(ch, group);
// RegexCaseBehavior.Invariant's special I handling.
casing.set('I', 'Ii'); casing.set('i', 'Ii'); casing.delete('\u0130'); casing.delete('\u0131');
const categoryNames = ['Lu','Ll','Lt','Lm','Lo','Mn','Mc','Me','Nd','Nl','No','Zs','Zl','Zp','Cc','Cf','Cs','Co','Pc','Pd','Ps','Pe','Pi','Pf','Po','Sm','Sc','Sk','So','Cn'];
function equivalent(ch) { return casing.get(ch) || ch; }
function same(a, b, ignoreCase) {
  if (a === b) return true;
  if (!ignoreCase || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!equivalent(a[i]).includes(b[i])) return false;
  return true;
}
function word(ch) { const category = ch === undefined ? -1 : categories[ch.charCodeAt(0)]; return category >= 0 && category <= 5 || category === 8 || category === 18; }
function digit(ch) { return categories[ch.charCodeAt(0)] === 8; }
function space(ch) { const code = ch.charCodeAt(0), category = categories[code]; return category >= 11 && category <= 13 || code >= 9 && code <= 13 || code === 0x85; }
function property(name) {
  if (Object.hasOwn(data.blocks, name)) {
    const ranges = data.blocks[name]; return c => { const code = c.charCodeAt(0); for (let i = 0; i < ranges.length; i += 2) if (code >= ranges[i] && code < ranges[i + 1]) return true; return false; };
  }
  const matches = categoryNames.map((n, i) => n === name || name.length === 1 && n[0] === name ? i : -1).filter(n => n >= 0);
  if (!matches.length) throw new SyntaxError('Unknown .NET Unicode property ' + name);
  return ch => matches.includes(categories[ch.charCodeAt(0)]);
}
module.exports = { equivalent, same, word, digit, space, property };
