const assert = require('node:assert/strict');
const test = require('node:test');
const gameMath = require('../game-math.js');

test('rounding first converts to float and rounds ties to even', () => {
  for (const [input, expected] of [[0.5, 0], [1.5, 2], [2.5, 2], [-0.5, 0], [-1.5, -2], [-2.5, -2], [0.49999999, 0]]) {
    assert.equal(gameMath.round(input), expected);
  }
  assert.ok(Object.is(gameMath.round(-0.1), 0));
  assert.ok(Object.is(gameMath.ceil(-0.1), 0));
  assert.ok(Object.is(gameMath.floor(-0), -0));
  assert.equal(gameMath.floor(-1.1), -2);
});

test('arithmetic follows float operations and component output limits', () => {
  assert.equal(gameMath.add(262144, 0.02), 262144.03125);
  assert.equal(gameMath.sub('0.3', '0.1'), 0.20000001788139343);
  assert.equal(gameMath.mul('0.1', 3), 0.30000001192092896);
  assert.equal(gameMath.div(7, 3), 2.3333332538604736);
  assert.equal(gameMath.mul(1000000, 2), 999999);
  assert.equal(gameMath.add(-100, 10, -20, 30), -20);
  assert.equal(gameMath.add(60, 10, -20, 30), 30);
  assert.equal(gameMath.add('not a number', '2'), 2);
  assert.equal(gameMath.add('0x10', 1), 1);
  assert.ok(Number.isNaN(gameMath.mul(3e38, 3)));
});

test('division and modulo use the game near-zero threshold', () => {
  assert.ok(Number.isNaN(gameMath.div(1, 0)));
  assert.ok(Number.isNaN(gameMath.div(1, 0.0000999)));
  assert.ok(Number.isNaN(gameMath.div(1, -0.0000999)));
  assert.equal(gameMath.div(1, 0.0001), 10000);
  assert.equal(gameMath.mod(5.3, 2), 1.3000001907348633);
  assert.equal(gameMath.mod(5.3, 0), 0.3000001907348633);
  assert.equal(gameMath.mod(-5.3, 2), -1.3000001907348633);
});

test('decimal text is parsed directly to float even beside a rounding midpoint', () => {
  assert.equal(gameMath.add('1.0000000596046447753906250000000001', 0), 1.0000001192092896);
  assert.equal(gameMath.add('1.000000059604644775390625', 0), 1);
  assert.equal(gameMath.add('1.0000000596046447753906249999999999', 0), 1);
  assert.equal(gameMath.add('-1.0000000596046447753906250000000001', 0), -1.0000001192092896);
  assert.equal(gameMath.add('1.0000000596046448', 0), 1.0000001192092896);
  assert.equal(gameMath.add(1.0000000596046448, 0), 1);
  assert.equal(gameMath.add(' 1.25e2 ', '2.5'), 127.5);
  assert.ok(Number.isNaN(gameMath.round('invalid')));
});

test('power, square root and factorial follow component input and result rules', () => {
  assert.equal(gameMath.pow('2.5', '2'), 6.25);
  assert.equal(gameMath.pow(3), 3);
  assert.equal(gameMath.pow(1, NaN), 1);
  assert.equal(gameMath.pow(1, Infinity), 1);
  assert.equal(gameMath.pow(-1, -Infinity), 1);
  assert.equal(gameMath.sqrt(2), 1.4142135381698608);
  assert.ok(Number.isNaN(gameMath.sqrt(-1)));
  assert.equal(gameMath.factorial(-3), 1);
  assert.equal(gameMath.factorial(5.9), 120);
  // C# ulong -> float for 20!; values above 20 use the same cap.
  assert.equal(gameMath.factorial(20), 2432902023163674600);
  assert.equal(gameMath.factorial(100), 2432902023163674600);
});

test('sine and cosine use degrees by default and support radians', () => {
  assert.equal(gameMath.sin(90), 1);
  assert.equal(gameMath.sin('90'), 1);
  assert.equal(gameMath.sin(Math.PI / 2, true), 1);
  assert.equal(gameMath.sin('invalid'), 0);
  assert.ok(Math.abs(gameMath.sin(180) - (-8.742277657347586e-8)) < 1e-12);
  assert.ok(Math.abs(gameMath.cos(90) - (-4.371138828673793e-8)) < 1e-12);
  assert.equal(gameMath.cos(0, true), 1);
});

test('tangent keeps the converted angle when the game considers it near a pole', () => {
  assert.equal(gameMath.tan(45), 1);
  assert.equal(gameMath.tan(90), 1.5707963705062866);
  assert.equal(gameMath.tan(Math.PI / 2, true), 1.5707963705062866);
  assert.equal(gameMath.tan(90.01), 1.570970892906189);
  assert.equal(gameMath.tan(270), 4.71238899230957);
  assert.ok(gameMath.tan(90.02) < -2800);
  // C# floating-point remainder is negative for a negative angle.
  assert.ok(gameMath.tan(-90) > 1_000_000);
});

test('inverse trigonometry follows the game domain and output units', () => {
  assert.equal(gameMath.asin(0.5), 30);
  assert.equal(gameMath.acos(0.5), 60);
  assert.equal(gameMath.atan(1), 45);
  assert.ok(Math.abs(gameMath.asin(-1, true) - (-1.5707963705062866)) < 1e-7);
  // The component checks the input after float conversion and leaves out-of-domain values unchanged.
  assert.equal(gameMath.asin(1 + 2 ** -25), 90);
  assert.equal(gameMath.asin(2), 2);
  assert.equal(gameMath.acos(-2, true), -2);
  assert.equal(gameMath.acos('invalid'), 90);
  assert.ok(Number.isNaN(gameMath.asin(NaN)));
});

test('atan2 uses the component y/x input order and output units', () => {
  assert.equal(gameMath.atan2(1, -1), 135);
  assert.ok(Math.abs(gameMath.atan2(1, -1, true) - 2.356194496154785) < 1e-7);
  assert.equal(gameMath.atan2(0, -1), 180);
  assert.equal(gameMath.atan2(-0, -1), -180);
  assert.ok(Number.isNaN(gameMath.atan2(NaN, 1)));
});
