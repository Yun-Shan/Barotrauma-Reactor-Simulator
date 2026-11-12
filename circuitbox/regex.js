'use strict';
const U = require('./unicode.js');

// .NET RegexOptions.None, UTF-16 matching. Captures are stacks (including balancing
// groups); unnamed groups are numbered before named groups, unlike JS RegExp.
class RegexTimeout extends Error {}
class DotNetRegex {
  constructor(pattern, { maxOperations = Infinity, timeout = 50 } = {}) {
    this.pattern = pattern; this.maxOperations = maxOperations; this.timeout = timeout;
    this.i = 0; this.unnamed = 0; this.names = []; this.explicitNumbers = new Set(); this.groups = [];
    const options = { i: false, m: false, n: false, s: false, x: false };
    this.ast = this.parseAlternatives(options);
    if (this.i !== pattern.length) throw new SyntaxError('Unexpected regex closing parenthesis');
    let next = this.unnamed + 1;
    this.nameNumbers = new Map();
    for (const name of this.names) {
      if (/^\d+$/.test(name)) this.nameNumbers.set(name, Number(name));
      else if (!this.nameNumbers.has(name)) {
        while (this.explicitNumbers.has(next)) next++;
        this.nameNumbers.set(name, next++);
      }
    }
    for (const group of this.groups) group.number = typeof group.name === 'number' ? group.name : this.nameNumbers.get(group.name);
    const check = node => {
      const exists = name => name === '0' || this.groups.some(g => g.number === captureNumber(name, this));
      if (node.type === 'backreference' && !exists(node.name) && (!node.numeric || Number(node.name) < 10 || !/^[0-7]/.test(node.name))) throw new SyntaxError('Undefined backreference ' + node.name);
      if (node.type === 'hasCapture' && !exists(node.name)) {
        if (/^\d+$/.test(node.name)) throw new SyntaxError('Undefined conditional group ' + node.name);
        node.type = 'ahead'; node.child = { type: 'literal', text: node.name, ignoreCase: node.ignoreCase };
      }
      if (node.subtract && !exists(node.subtract)) throw new SyntaxError('Undefined balancing group ' + node.subtract);
      if (node.child) check(node.child);
      for (const sub of [...(node.nodes || []), ...(node.branches || []), ...[node.condition, node.yes, node.no].filter(Boolean)]) check(sub);
    };
    check(this.ast);
  }
  skip(o) {
    while (o.x && this.i < this.pattern.length) {
      if (/[ \t\r\n\f]/.test(this.pattern[this.i])) this.i++;
      else if (this.pattern[this.i] === '#') { while (this.i < this.pattern.length && this.pattern[this.i] !== '\n') this.i++; }
      else break;
    }
  }
  parseAlternatives(o, conditional = false) {
    const branches = [];
    do {
      const nodes = [];
      while (this.i < this.pattern.length) {
        this.skip(o);
        if (['|', ')'].includes(this.pattern[this.i]) || this.i >= this.pattern.length) break;
        let node = this.atom(o); this.skip(o);
        let min, max;
        const ch = this.pattern[this.i];
        if (ch === '*' || ch === '+' || ch === '?') { this.i++; min = ch === '+' ? 1 : 0; max = ch === '?' ? 1 : Infinity; }
        else if (ch === '{') {
          const m = /^\{(\d+)(?:,(\d*)?)?\}/.exec(this.pattern.slice(this.i));
          if (m) { this.i += m[0].length; min = Number(m[1]); max = m[0].includes(',') ? (m[2] ? Number(m[2]) : Infinity) : min; }
        }
        if (min !== undefined) {
          if (min > max || min > 2147483647 || max > 2147483647 && max !== Infinity) throw new SyntaxError('Invalid regex quantifier');
          const lazy = this.pattern[this.i] === '?'; if (lazy) this.i++;
          node = { type: 'repeat', child: node, min, max, lazy };
          this.skip(o);
          if (/^[*+?]|^\{\d+(?:,\d*)?\}/.test(this.pattern.slice(this.i))) throw new SyntaxError('Nested regex quantifier');
        }
        nodes.push(node);
      }
      branches.push({ type: 'sequence', nodes });
      if (this.pattern[this.i] === '|') this.i++; else break;
    } while (true);
    if (conditional && branches.length > 2) throw new SyntaxError('Too many conditional branches');
    return { type: 'alternatives', branches };
  }
  close() { if (this.pattern[this.i++] !== ')') throw new SyntaxError('Unclosed regex group'); }
  atom(o) {
    const ch = this.pattern[this.i++];
    if (ch === '(') {
      let type = 'capture', name, subtract;
      const inner = { ...o };
      if (this.pattern[this.i] === '?') {
        this.i++;
        const token = this.pattern[this.i++];
        if (token === ':') type = 'group';
        else if (token === '=') type = 'ahead';
        else if (token === '!') type = 'notAhead';
        else if (token === '>') type = 'atomic';
        else if (token === '#') {
          while (this.i < this.pattern.length && this.pattern[this.i] !== ')') this.i++;
          this.close(); return { type: 'empty' };
        } else if (token === '<' && ['=', '!'].includes(this.pattern[this.i])) type = this.pattern[this.i++] === '=' ? 'behind' : 'notBehind';
        else if (token === '<' || token === "'") {
          const end = this.pattern.indexOf(token === '<' ? '>' : "'", this.i);
          if (end < 0) throw new SyntaxError('Invalid capture group');
          [name, subtract] = this.pattern.slice(this.i, end).split('-'); this.i = end + 1;
          if (!name && !subtract) throw new SyntaxError('Empty capture name');
          for (const n of [name, subtract].filter(Boolean)) if (!/^[1-9]\d*$/.test(n) && (U.digit(n[0]) || !n.split('').every(U.word))) throw new SyntaxError('Invalid capture name ' + n);
          if ([name, subtract].some(n => /^\d+$/.test(n || '') && Number(n) > 2147483647)) throw new SyntaxError('Capture number is too large');
        } else if (token === '(') {
          let condition;
          if (this.pattern[this.i] === '?') {
            this.i--; condition = this.atom(inner);
          } else {
            const end = this.pattern.indexOf(')', this.i); if (end < 0) throw new SyntaxError('Invalid conditional');
            const name = this.pattern.slice(this.i, end);
            if (name && name.split('').every(U.word)) { condition = { type: 'hasCapture', name, ignoreCase: inner.i }; this.i = end + 1; }
            else { condition = { type: 'ahead', child: this.parseAlternatives(inner) }; this.close(); }
          }
          const alternatives = this.parseAlternatives(inner, true); this.close();
          return { type: 'conditional', condition, yes: alternatives.branches[0], no: alternatives.branches[1] || { type: 'empty' } };
        } else {
          this.i--;
          const m = /^([imnsx]*)(?:-([imnsx]+))?([:)])/.exec(this.pattern.slice(this.i));
          if (!m || !m[1] && !m[2]) throw new SyntaxError('Unknown regex group');
          this.i += m[0].length;
          const target = m[3] === ')' ? o : inner;
          for (const key of m[1]) target[key] = true;
          for (const key of m[2] || '') target[key] = false;
          if (m[3] === ')') return { type: 'empty' };
          type = 'group';
        }
      }
      if (type === 'capture' && name === undefined && subtract === undefined) {
        if (o.n) type = 'group'; else name = ++this.unnamed;
      }
      if (typeof name === 'string' && name) { this.names.push(name); if (/^\d+$/.test(name)) this.explicitNumbers.add(Number(name)); }
      const child = this.parseAlternatives(inner); this.close();
      const node = { type, child, name, subtract };
      if (type === 'capture' && name !== '') this.groups.push(node);
      return node;
    }
    if (ch === '[') return { type: 'character', predicate: this.characterClass({ ...o }) };
    if (ch === '\\') return this.escape(o, false);
    if (ch === '.') { const singleline = o.s; return { type: 'character', predicate: c => singleline || c !== '\n' }; }
    if (ch === '^' || ch === '$') return { type: 'anchor', kind: ch, multiline: o.m };
    if (ch === '*' || ch === '+' || ch === '?') throw new SyntaxError('Quantifier without target');
    return { type: 'literal', text: ch, ignoreCase: o.i };
  }
  escape(o, inClass) {
    const ch = this.pattern[this.i++];
    if (!ch) throw new SyntaxError('Unterminated escape');
    if (!inClass && ['A', 'z', 'Z', 'G', 'b', 'B'].includes(ch)) return { type: 'anchor', kind: ch };
    const predicates = {
      d: U.digit, w: U.word, s: U.space
    };
    if (predicates[ch.toLowerCase()]) {
      const p = predicates[ch.toLowerCase()]; return { type: 'character', predicate: ch === ch.toLowerCase() ? p : c => !p(c) };
    }
    if (ch === 'p' || ch === 'P') {
      const m = /^\{([^}]+)\}/.exec(this.pattern.slice(this.i)); if (!m) throw new SyntaxError('Invalid Unicode category');
      this.i += m[0].length;
      let p = U.property(m[1]);
      if (o.i && ['Lu', 'Ll', 'Lt'].includes(m[1])) { const tests = ['Lu', 'Ll', 'Lt'].map(U.property); p = c => tests.some(test => test(c)); }
      else if (o.i) { const raw = p; p = c => U.equivalent(c).split('').some(raw); }
      return { type: 'character', predicate: ch === 'p' ? p : c => !p(c) };
    }
    if (!inClass && ch === 'k') {
      const m = /^(?:<([^>]+)>|'([^']+)')/.exec(this.pattern.slice(this.i)); if (!m) throw new SyntaxError('Invalid backreference');
      this.i += m[0].length; return { type: 'backreference', name: m[1] || m[2], ignoreCase: o.i };
    }
    if (!inClass && /[1-9]/.test(ch)) {
      const rest = /^\d*/.exec(this.pattern.slice(this.i))[0]; this.i += rest.length;
      return { type: 'backreference', name: ch + rest, ignoreCase: o.i, numeric: true };
    }
    let text = ({ n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', a: '\x07', e: '\x1b', b: '\b' })[ch];
    if (ch === 'x' || ch === 'u') {
      const count = ch === 'x' ? 2 : 4, hex = this.pattern.slice(this.i, this.i + count);
      if (!new RegExp(`^[a-f0-9]{${count}}$`, 'i').test(hex)) throw new SyntaxError('Invalid hex escape');
      this.i += count; text = String.fromCharCode(parseInt(hex, 16));
    } else if (ch === 'c') {
      const char = this.pattern[this.i++]?.toUpperCase();
      if (!char || char.charCodeAt(0) < 64 || char.charCodeAt(0) > 95) throw new SyntaxError('Invalid control escape');
      text = String.fromCharCode(char.charCodeAt(0) - 64);
    } else if (ch === '0' || inClass && /[1-7]/.test(ch)) {
      const rest = /^[0-7]{0,2}/.exec(this.pattern.slice(this.i))[0]; this.i += rest.length;
      text = String.fromCharCode(parseInt(ch + rest, 8) & 255);
    } else if (text === undefined) {
      if (/\w/.test(ch)) throw new SyntaxError('Unknown escape ' + ch);
      text = ch;
    }
    return { type: 'literal', text, ignoreCase: o.i };
  }
  characterClass(o) {
    const negate = this.pattern[this.i] === '^'; if (negate) this.i++;
    const predicates = []; let first = true, subtract;
    function predicate(node) { return node.predicate || (c => same(c, node.text, node.ignoreCase)); }
    while (this.i < this.pattern.length) {
      if (this.pattern[this.i] === ']' && !first) { this.i++; return c => (negate !== predicates.some(p => p(c))) && (!subtract || !subtract(c)); }
      first = false;
      let node = this.pattern[this.i] === '\\' ? (this.i++, this.escape(o, true)) : { type: 'literal', text: this.pattern[this.i++], ignoreCase: o.i };
      if (this.pattern.startsWith('-[', this.i)) {
        predicates.push(predicate(node)); this.i += 2; subtract = this.characterClass(o);
        if (this.pattern[this.i] !== ']') throw new SyntaxError('Subtraction must be last in a character class');
        continue;
      }
      if (node.type === 'literal' && this.pattern[this.i] === '-' && this.pattern[this.i + 1] !== ']' && this.pattern[this.i + 1] !== '[') {
        this.i++;
        const end = this.pattern[this.i] === '\\' ? (this.i++, this.escape(o, true)) : { text: this.pattern[this.i++] };
        if (end.type && end.type !== 'literal' || node.text.charCodeAt(0) > end.text.charCodeAt(0)) throw new SyntaxError('Invalid character range');
        const a = node.text.charCodeAt(0), b = end.text.charCodeAt(0);
        predicates.push(c => { const v = c.charCodeAt(0); if (v >= a && v <= b) return true; return o.i && U.equivalent(c).split('').some(t => t.charCodeAt(0) >= a && t.charCodeAt(0) <= b); });
      } else predicates.push(predicate(node));
      if (this.pattern.startsWith('-[', this.i)) { this.i += 2; subtract = this.characterClass(o); if (this.pattern[this.i] !== ']') throw new SyntaxError('Subtraction must be last in a character class'); }
    }
    throw new SyntaxError('Unclosed character class');
  }
  match(input) {
    input = String(input);
    const context = { input, operations: 0, deadline: Date.now() + this.timeout, start: 0, engine: this };
    for (let pos = 0; pos <= input.length; pos++) {
      const result = run(this.ast, { pos, captures: new Map() }, context, 1).next();
      if (!result.done) {
        const state = result.value, groups = new Map([['0', input.slice(pos, state.pos)]]);
        const numbers = new Set(this.groups.map(g => g.number));
        const values = new Map();
        for (const n of numbers) { const spans = state.captures.get(n); const span = spans?.at(-1); values.set(n, span ? input.slice(span[0], span[1]) : ''); }
        for (const n of numbers) if (![...this.nameNumbers].some(([name, number]) => number === n && !/^\d+$/.test(name))) groups.set(String(n), values.get(n));
        for (const [name, n] of this.nameNumbers) groups.set(name, values.get(n) ?? '');
        return { success: true, groups, index: pos, length: state.pos - pos };
      }
    }
    return { success: false, groups: new Map() };
  }
}
const same = U.same;
function captureNumber(name, engine) { return /^\d+$/.test(String(name)) ? Number(name) : engine.nameNumbers.get(name); }
function *run(node, state, ctx, direction) {
  if (++ctx.operations > ctx.engine.maxOperations || (ctx.operations % 512 === 0 && Date.now() > ctx.deadline)) throw new RegexTimeout('Regex match timed out');
  const { input } = ctx, p = state.pos;
  switch (node.type) {
    case 'empty': yield state; break;
    case 'literal': {
      const start = direction > 0 ? p : p - node.text.length;
      if (start >= 0 && same(input.slice(start, start + node.text.length), node.text, node.ignoreCase)) yield { ...state, pos: p + direction * node.text.length };
      break;
    }
    case 'character': {
      const at = direction > 0 ? p : p - 1;
      if (at >= 0 && at < input.length && node.predicate(input[at])) yield { ...state, pos: p + direction };
      break;
    }
    case 'anchor': {
      const word = c => U.word(c) || c === '\u200c' || c === '\u200d';
      const condition = { A: p === 0, z: p === input.length, Z: p === input.length || p === input.length - 1 && input[p] === '\n', G: p === ctx.start,
        '^': p === 0 || node.multiline && input[p - 1] === '\n', '$': p === input.length || input[p] === '\n' && (node.multiline || p === input.length - 1),
        b: word(input[p - 1]) !== word(input[p]), B: word(input[p - 1]) === word(input[p]) }[node.kind];
      if (condition) yield state;
      break;
    }
    case 'alternatives': for (const branch of node.branches) yield *run(branch, state, ctx, direction); break;
    case 'sequence': {
      const nodes = direction > 0 ? node.nodes : [...node.nodes].reverse();
      function *next(index, s) {
        if (index === nodes.length) { yield s; return; }
        for (const result of run(nodes[index], s, ctx, direction)) yield *next(index + 1, result);
      }
      yield *next(0, state); break;
    }
    case 'group': yield *run(node.child, state, ctx, direction); break;
    case 'capture': {
      let captures = state.captures, start = p, subtracted;
      if (node.subtract) {
        const n = captureNumber(node.subtract, ctx.engine), list = captures.get(n);
        if (!list?.length) return;
        captures = new Map(captures); captures.set(n, list.slice(0, -1)); subtracted = list.at(-1);
      }
      for (const result of run(node.child, { ...state, captures }, ctx, direction)) {
        if (node.name === '') { yield result; continue; }
        const next = new Map(result.captures); let span = [Math.min(start, result.pos), Math.max(start, result.pos)];
        if (subtracted) {
          const [a, b] = span, [sa, sb] = subtracted;
          span = a >= sb ? [sb, a] : b <= sa ? [b, sa] : [Math.max(a, sa), Math.min(b, sb)];
        }
        next.set(node.number, [...(next.get(node.number) || []), span]); yield { ...result, captures: next };
      }
      break;
    }
    case 'backreference': {
      const n = captureNumber(node.name, ctx.engine), span = state.captures.get(n)?.at(-1);
      if (span) yield *run({ type: 'literal', text: input.slice(span[0], span[1]), ignoreCase: node.ignoreCase }, state, ctx, direction);
      else if (node.numeric && n >= 10 && !ctx.engine.groups.some(g => g.number === n)) {
        const m = /^[0-7]{1,3}/.exec(node.name);
        if (m) yield *run({ type: 'literal', text: String.fromCharCode(parseInt(m[0], 8) & 255) + node.name.slice(m[0].length), ignoreCase: node.ignoreCase }, state, ctx, direction);
      }
      break;
    }
    case 'atomic': { const r = run(node.child, state, ctx, direction).next(); if (!r.done) yield r.value; break; }
    case 'ahead': case 'notAhead': case 'behind': case 'notBehind': {
      const r = run(node.child, state, ctx, node.type.includes('Behind') || node.type === 'behind' ? -1 : 1).next();
      if (node.type.startsWith('not')) { if (r.done) yield state; }
      else if (!r.done) yield { ...r.value, pos: p };
      break;
    }
    case 'conditional': {
      let success;
      if (node.condition.type === 'hasCapture') success = !!state.captures.get(captureNumber(node.condition.name, ctx.engine))?.length;
      else success = !run(node.condition, state, ctx, direction).next().done;
      yield *run(success ? node.yes : node.no, state, ctx, direction); break;
    }
    case 'repeat': {
      // Explicit stack avoids overflowing the JS call stack for long quantifiers.
      const stack = [{ state, count: 0, iterator: null, yielded: false, empty: false }];
      while (stack.length) {
        const top = stack.at(-1);
        if (node.lazy && !top.yielded && top.count >= node.min) { top.yielded = true; yield top.state; }
        if (!top.iterator) top.iterator = top.count < node.max && (!top.empty || top.count < node.min) ? run(node.child, top.state, ctx, direction) : [][Symbol.iterator]();
        const r = top.iterator.next();
        if (!r.done) stack.push({ state: r.value, count: top.count + 1, iterator: null, yielded: false, empty: r.value.pos === top.state.pos });
        else { if (!node.lazy && top.count >= node.min) yield top.state; stack.pop(); }
      }
      break;
    }
    default: throw new Error('Unknown regex node ' + node.type);
  }
}
module.exports = { DotNetRegex, RegexTimeout };
