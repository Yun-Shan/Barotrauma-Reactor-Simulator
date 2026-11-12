'use strict';

// Numeric conversions at signal boundaries follow .NET 8's invariant culture.
const f = Math.fround;
const bits = new DataView(new ArrayBuffer(8));
const FLOAT_MAX = f(3.4028234663852886e38);
const EPSILON = f(0.0001);
const gameMath = require('../game-math.js');

function adjacent(value, up) {
  if (value === Infinity) return up ? Infinity : FLOAT_MAX;
  if (value === -Infinity) return up ? -FLOAT_MAX : -Infinity;
  if (value === 0) return up ? 2 ** -149 : -(2 ** -149);
  bits.setFloat32(0, value);
  bits.setUint32(0, bits.getUint32(0) + ((value > 0) === up ? 1 : -1));
  return bits.getFloat32(0);
}

function compareDecimal(text, value) {
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  const frac = m[4] === undefined ? (m[3] || '') : m[4];
  const exponent = Number(m[5] || 0) - frac.length;
  let n = BigInt((m[2] || '0') + frac), d = 1n;
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else d = 10n ** BigInt(-exponent);
  if (m[1] === '-') n = -n;
  bits.setFloat64(0, value);
  const hi = bits.getUint32(0), lo = bits.getUint32(4), exp = (hi >>> 20) & 0x7ff;
  let bn = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), bd = 1n;
  let be = -1074;
  if (exp) { bn |= 1n << 52n; be = exp - 1023 - 52; }
  if (be >= 0) bn <<= BigInt(be);
  else bd <<= BigInt(-be);
  if (hi >>> 31) bn = -bn;
  const diff = n * bd - bn * d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

// NumberStyles.Float permits ASCII numeric whitespace, not JS's whole \s class.
function trimNumber(text) { return text.replace(/^[\x09-\x0d ]+|[\x09-\x0d ]+$/g, ''); }
function trimSpecial(text) { return text.replace(/^[\x09-\x0d \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\x09-\x0d \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, ''); }
function parseFloat32(input) {
  if (typeof input === 'number') return f(input);
  if (typeof input !== 'string') return undefined;
  const text = trimNumber(input.replace(/\0+$/, ''));
  const special = trimSpecial(input);
  if (/^[+-]?infinity$/i.test(special)) return special[0] === '-' ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(special)) return NaN;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
  const value = Number(text), rounded = f(value);
  if (!Number.isFinite(value) || value === rounded) return rounded;
  const other = adjacent(rounded, value > rounded);
  const midpoint = Number.isFinite(rounded) ? (rounded + other) / 2 : Math.sign(value) * (2 ** 128 - 2 ** 103);
  if (value !== midpoint) return rounded;
  const cmp = compareDecimal(text, midpoint);
  return cmp < 0 ? Math.min(rounded, other) : cmp > 0 ? Math.max(rounded, other) : rounded;
}
const numberOrZero = value => parseFloat32(value) ?? 0;

function parseAnyFloat(input) {
  if (typeof input !== 'string') return parseFloat32(input);
  const special = trimSpecial(input);
  if (/^[+-]?(?:nan|infinity)$/i.test(special)) return parseFloat32(special);
  const text = input.replace(/\0+$/, '');
  let i = 0, negative = false, sign = false, currency = false, parens = false;
  const whitespace = ch => ch !== undefined && /[\x09-\x0d ]/.test(ch);
  while (i < text.length) {
    const ch = text[i];
    if (whitespace(ch) && (!sign || currency)) i++;
    else if (!sign && (ch === '+' || ch === '-')) { sign = true; negative = ch === '-'; i++; }
    else if (!sign && ch === '(') { sign = true; negative = true; parens = true; i++; }
    else if (!currency && ch === '¤') { currency = true; i++; }
    else break;
  }
  let digits = '', decimal = false, anyDigit = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') { digits += ch; anyDigit = true; i++; }
    else if (ch === '.' && !decimal) { decimal = true; digits += '.'; i++; }
    else if (ch === ',' && anyDigit && !decimal) i++;
    else break;
  }
  if (!anyDigit) return undefined;
  if (text[i] === 'e' || text[i] === 'E') {
    const match = /^[eE][+-]?\d+/.exec(text.slice(i)); if (!match) return undefined;
    digits += match[0]; i += match[0].length;
  }
  while (i < text.length) {
    const ch = text[i];
    if (whitespace(ch)) i++;
    else if (!sign && (ch === '+' || ch === '-')) { sign = true; negative = ch === '-'; i++; }
    else if (parens && ch === ')') { parens = false; i++; }
    else if (!currency && ch === '¤') { currency = true; i++; }
    else return undefined;
  }
  if (parens) return undefined;
  return parseFloat32((negative ? '-' : '') + digits);
}

function parseInt32(input) {
  const text = trimNumber(String(input ?? '').replace(/\0+$/, ''));
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 ? n : undefined;
}
function int32(value) { return !Number.isFinite(value) || value < -2147483648 || value >= 2147483648 ? -2147483648 : Math.trunc(value); }
function clamp(value, min, max) { return value < min ? min : (value > max ? max : value); }
// XNA MathHelper.Clamp applies max before min, including reversed limits.
function gameClamp(value, min, max) { if (value > max) value = max; if (value < min) value = min; return value; }
function nearlyEqual(a, b) {
  if (a === b) return true;
  const diff = Math.abs(f(a - b));
  if (a === 0 || b === 0) return diff < EPSILON;
  const sum = f(Math.abs(a) + Math.abs(b));
  return sum < EPSILON || f(diff / sum) < EPSILON;
}

function general(text, exponentLimit) {
  // First obtain significant digits independently of JS's fixed/exponential thresholds.
  let [mantissa, exponent] = Number(text).toExponential().split('e');
  const exp = Number(exponent), negative = mantissa[0] === '-';
  if (negative) mantissa = mantissa.slice(1);
  const digits = mantissa.replace('.', '');
  let result;
  if (exp < -4 || exp >= exponentLimit) {
    result = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'E' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  } else if (exp < 0) result = '0.' + '0'.repeat(-exp - 1) + digits;
  else if (exp + 1 >= digits.length) result = digits + '0'.repeat(exp + 1 - digits.length);
  else result = digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  return (negative ? '-' : '') + result;
}
function formatFloat(value) {
  value = f(value);
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  // Round the exact binary rational to decimal, with ties to even. JS's
  // toPrecision rounds decimal ties away from zero (e.g. 3934590.25).
  bits.setFloat32(0, Math.abs(value));
  const encoded = bits.getUint32(0), exponent = (encoded >>> 23) & 255;
  let coefficient = BigInt((encoded & 0x7fffff) | (exponent ? 0x800000 : 0));
  const binaryExponent = exponent ? exponent - 150 : -149;
  let scale = 0;
  if (binaryExponent >= 0) coefficient <<= BigInt(binaryExponent);
  else { coefficient *= 5n ** BigInt(-binaryExponent); scale = binaryExponent; }
  const length = coefficient.toString().length;
  let shortest;
  for (let precision = 1; precision <= 9; precision++) {
    const cut = Math.max(length - precision, 0), divisor = 10n ** BigInt(cut);
    let rounded = coefficient / divisor;
    const remainder = coefficient % divisor;
    if (remainder * 2n > divisor || remainder * 2n === divisor && rounded % 2n !== 0n) rounded++;
    const candidate = (value < 0 ? '-' : '') + rounded + 'e' + (scale + cut);
    if (Object.is(parseFloat32(candidate), value)) { shortest = candidate; break; }
  }
  return general(shortest, 9);
}
function formatDouble(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) return '-0';
  return general(String(value), 17);
}

module.exports = { f, gameMath, EPSILON, FLOAT_MAX, parseFloat32, numberOrZero, parseAnyFloat, parseInt32, int32, clamp, gameClamp, nearlyEqual, formatFloat, formatDouble };
