'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DotNetRegex } = require('../regex.js');
test('.NET captures number unnamed groups first and expose canonical group names', () => {
  const groups = new DotNetRegex('(?<named>a)(b)').match('ab').groups;
  assert.equal(groups.get('1'), 'b'); assert.equal(groups.get('named'), 'a'); assert.equal(groups.has('2'), false);
});
test('balancing captures, conditionals, atomic groups and backwards lookbehind', () => {
  assert.equal(new DotNetRegex('^(?<open>a)+(?<-open>b)+(?(open)(?!))$').match('aaabbb').success, true);
  assert.equal(new DotNetRegex('^(?<open>a)+(?<-open>b)+(?(open)(?!))$').match('aaabb').success, false);
  assert.equal(new DotNetRegex('(?>a|ab)c').match('abc').success, false);
  const groups = new DotNetRegex('(?<=(a+)(b+))c').match('aaabbc').groups;
  assert.equal(groups.get('1'), 'aaa'); assert.equal(groups.get('2'), 'bb');
});
test('UTF-16 Unicode categories, invariant casing, block properties and subtraction', () => {
  assert.equal(new DotNetRegex('(?i)σ').match('Σ').success, true);
  assert.equal(new DotNetRegex('(?i)σ').match('ς').success, false);
  assert.equal(new DotNetRegex('(?i)i').match('\u0130').success, false);
  assert.equal(new DotNetRegex('\\p{IsArabic}+').match('عربي').success, true);
  assert.equal(new DotNetRegex('[a-z-[aeiou]]+').match('abce').groups.get('0'), 'bc');
  assert.equal(new DotNetRegex('\\w+').match('中文_١').groups.get('0'), '中文_١');
});
test('alternation, option scope and invalid expressions follow .NET rules', () => {
  assert.equal(new DotNetRegex('|a').match('a').groups.get('0'), '');
  assert.equal(new DotNetRegex('a.(?s)b').match('a\nb').success, false);
  assert.throws(() => new DotNetRegex('a{2}{2}'), SyntaxError);
  assert.throws(() => new DotNetRegex('\\1'), SyntaxError);
});
