'use strict';

// 数字直接按 float 转换；字符串按游戏的 InvariantCulture float.TryParse 转换。
const gameMath = (() => {
  const bits = new DataView(new ArrayBuffer(8));
  const epsilon = Math.fround(0.0001);
  const floatMax = Math.fround(3.4028234663852886e38);
  const pi = Math.fround(Math.PI);
  const piOver2 = Math.fround(Math.PI / 2);
  const radiansPerDegree = Math.PI / 180;
  const degreesPerRadian = 180 / Math.PI;

  function adjacentFloat(value, upward) {
    if (value === Infinity) return upward ? Infinity : floatMax;
    if (value === -Infinity) return upward ? -floatMax : -Infinity;
    if (value === 0) return upward ? 2 ** -149 : -(2 ** -149);
    bits.setFloat32(0, value);
    const encoded = bits.getUint32(0);
    bits.setUint32(0, encoded + ((value > 0) === upward ? 1 : -1));
    return bits.getFloat32(0);
  }

  // 仅在双精度结果恰好落在两个 float 的中点时，才需要比较原始十进制文本。
  function compareDecimalToDouble(text, value) {
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
    const fractional = match[4] === undefined ? (match[3] || '') : match[4];
    const digits = (match[2] || '0') + fractional;
    const exponent = Number(match[5] || 0) - fractional.length;
    let decimalNumerator = BigInt(digits);
    let decimalDenominator = 1n;
    if (exponent >= 0) decimalNumerator *= 10n ** BigInt(exponent);
    else decimalDenominator = 10n ** BigInt(-exponent);
    if (match[1] === '-') decimalNumerator = -decimalNumerator;

    bits.setFloat64(0, value);
    const high = bits.getUint32(0);
    const low = bits.getUint32(4);
    const encodedExponent = (high >>> 20) & 0x7ff;
    let binaryNumerator = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    let binaryExponent = -1074;
    if (encodedExponent !== 0) {
      binaryNumerator |= 1n << 52n;
      binaryExponent = encodedExponent - 1023 - 52;
    }
    let binaryDenominator = 1n;
    if (binaryExponent >= 0) binaryNumerator <<= BigInt(binaryExponent);
    else binaryDenominator <<= BigInt(-binaryExponent);
    if ((high & 0x80000000) !== 0) binaryNumerator = -binaryNumerator;

    const difference = decimalNumerator * binaryDenominator - binaryNumerator * decimalDenominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  function parseFloat32(input) {
    if (typeof input === 'number') return Math.fround(input);
    if (typeof input !== 'string') return undefined;
    const text = input.trim();
    if (/^[+-]?infinity$/i.test(text)) return text[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(text)) return NaN;
    if (!/^[+-]?(?:(?:\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined;

    const number = Number(text);
    const rounded = Math.fround(number);
    if (!Number.isFinite(number) || number === rounded) return rounded;

    const other = adjacentFloat(rounded, number > rounded);
    const midpoint = Number.isFinite(rounded)
      ? (rounded + other) / 2
      : (number < 0 ? -1 : 1) * (2 ** 128 - 2 ** 103);
    if (number !== midpoint) return rounded;
    const comparison = compareDecimalToDouble(text, midpoint);
    return comparison < 0 ? Math.min(rounded, other)
      : comparison > 0 ? Math.max(rounded, other) : rounded;
  }

  function numberOrZero(input) {
    const result = parseFloat32(input);
    return result === undefined ? 0 : result;
  }

  function arithmetic(a, b, operation, min, max) {
    const result = Math.fround(operation(numberOrZero(a), numberOrZero(b)));
    if (!Number.isFinite(result)) return NaN;
    // 与 ArithmeticComponent 相同：先验证计算结果，再应用组件的输出限制。
    const lower = numberOrZero(min);
    const upper = numberOrZero(max);
    return Math.max(lower, Math.min(upper, result));
  }

  function nearlyZero(value) {
    return value === 0 || Math.abs(value) < epsilon;
  }

  function nearlyEqual(a, b) {
    if (a === b) return true;
    const difference = Math.abs(Math.fround(a - b));
    if (a === 0 || b === 0) return difference < epsilon;
    const sum = Math.fround(Math.abs(a) + Math.abs(b));
    if (sum < epsilon) return true;
    return Math.fround(difference / sum) < epsilon;
  }

  // MathHelper 在双精度中乘以转换系数，再转为 float。
  function toRadians(value, useRadians) {
    const angle = numberOrZero(value);
    return useRadians ? angle : Math.fround(angle * radiansPerDegree);
  }

  function fromRadians(angle, useRadians) {
    return useRadians ? angle : Math.fround(angle * degreesPerRadian);
  }

  function unary(input, operation) {
    const value = parseFloat32(input);
    return value === undefined ? NaN : operation(value);
  }

  const helpers = {
    // 四则运算按 float 计算，默认限制在 -999999～999999，可通过 min/max 覆盖。
    add: (a, b, min = -999999, max = 999999) => arithmetic(a, b, (x, y) => x + y, min, max),
    sub: (a, b, min = -999999, max = 999999) => arithmetic(a, b, (x, y) => x - y, min, max),
    mul: (a, b, min = -999999, max = 999999) => arithmetic(a, b, (x, y) => x * y, min, max),
    // 除数绝对值小于 0.0001 时游戏不发送信号，这里返回 NaN。
    div: (a, b, min = -999999, max = 999999) => arithmetic(a, b, (x, y) => nearlyZero(y) ? NaN : x / y, min, max),
    mod: (a, b = 1) => {
      const modulus = numberOrZero(b);
      // 接近零的模数按 1 处理。
      return Math.fround(numberOrZero(a) % (nearlyZero(modulus) ? 1 : modulus));
    },
    pow: (a, b = 1) => {
      const base = numberOrZero(a);
      const exponent = numberOrZero(b);
      // .NET Math.Pow 和 JavaScript Math.pow 在这些特殊值上有不同约定。
      if (base === 1 || (base === -1 && Math.abs(exponent) === Infinity)) return 1;
      // 两者使用双精度计算后再转为 float，不同平台可能有末位差异。
      return Math.fround(Math.pow(base, exponent));
    },
    // 中点取偶数，与 JavaScript Math.round 的中点规则不同。
    round: input => unary(input, value => {
      if (!Number.isFinite(value)) return value;
      const lower = Math.floor(value);
      const fraction = value - lower;
      const result = fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
      return result === 0 ? 0 : result;
    }),
    ceil: input => unary(input, value => {
      const result = Math.ceil(value);
      return result === 0 ? 0 : result;
    }),
    floor: input => unary(input, Math.floor),
    abs: input => unary(input, Math.abs),
    // 负数开方返回 NaN，代表游戏中没有有效信号。
    sqrt: input => unary(input, value => Math.fround(Math.sqrt(value))),
    // 游戏的阶乘组件最多计算到 20。
    factorial: input => unary(input, value => {
      const limit = Math.trunc(Math.min(value, 20));
      let result = 1n;
      for (let i = limit; i > 0; i--) result *= BigInt(i);
      return Math.fround(Number(result));
    }),
    // 三角函数默认使用角度，useRadians 为 true 时使用弧度。
    // 浏览器数学库与游戏的 MathF 可能有末位差异。
    sin: (input, useRadians = false) => Math.fround(Math.sin(toRadians(input, useRadians))),
    cos: (input, useRadians = false) => Math.fround(Math.cos(toRadians(input, useRadians))),
    tan: (input, useRadians = false) => {
      const angle = toRadians(input, useRadians);
      // 余数接近 π/2 时，游戏保留转换后的弧度值。
      return nearlyEqual(Math.fround(angle % pi), piOver2) ? angle : Math.fround(Math.tan(angle));
    },
    // 游戏在反正弦或反余弦的输入超出 [-1, 1] 时直接返回该输入。
    asin: (input, useRadians = false) => {
      const value = numberOrZero(input);
      return value >= -1 && value <= 1 ? fromRadians(Math.fround(Math.asin(value)), useRadians) : value;
    },
    acos: (input, useRadians = false) => {
      const value = numberOrZero(input);
      return value >= -1 && value <= 1 ? fromRadians(Math.fround(Math.acos(value)), useRadians) : value;
    },
    atan: (input, useRadians = false) => fromRadians(Math.fround(Math.atan(numberOrZero(input))), useRadians),
    // 游戏的 x/y 输入使用双精度 Math.Atan2(y, x)，再转换为 float。
    atan2: (y, x, useRadians = false) => fromRadians(Math.fround(Math.atan2(numberOrZero(y), numberOrZero(x))), useRadians),
  };

  return Object.freeze(helpers);
})();

if (typeof module !== 'undefined' && module.exports) module.exports = gameMath;
