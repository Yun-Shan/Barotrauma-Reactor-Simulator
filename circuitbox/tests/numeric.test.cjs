'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { numeric: N, CircuitSimulator } = require('..');
test('invariant parsing handles whitespace, null terminators and decimal midpoints', () => {
  assert.equal(N.parseFloat32('1.000000059604644775390625000001'), 1.0000001192092896);
  assert.equal(N.parseFloat32('1\0 '), undefined); assert.equal(N.parseFloat32('1 \0'), 1);
  assert.equal(N.parseFloat32('\u00a01\u00a0'), undefined); assert.ok(Number.isNaN(N.parseFloat32('\u00a0NaN\u00a0')));
  assert.equal(N.parseAnyFloat('¤- 1,234.5'), -1234.5); assert.equal(N.parseAnyFloat('( 1)'), undefined);
});
test('float G uses shortest even decimal rounding and .NET exponent thresholds', () => {
  for (const [input, text] of [[3934590.25, '3934590.2'], [-484314.625, '-484314.62'], [1e8, '100000000'], [1e9, '1E+09'], [1e-5, '1E-05'], [-0, '-0']]) assert.equal(N.formatFloat(input), text);
});
test('trigonometric components use game-math.js within the DLL radian tolerance', () => {
  for (const [prefab, value, expected, UseRadians] of [
    ['sincomponent','-27.504966735839844','-0.6956808',true], ['sincomponent','1736.7146294564009','0.5531477',true],
    ['asincomponent','0.4237947901710868','0.43763086',true], ['acoscomponent','0.6365397213958204','0.88079304',true],
    ['tancomponent','1396.7247616499662','-3.3906603',true], ['sincomponent','-6.466418790318421e+33','-0.63304836',true],
    ['atancomponent','-2.8053869493305683','-1.2283808',true]
  ]) {
    const sim = new CircuitSimulator({ components: [{ id: 0, prefab, properties: { UseRadians } }], wires: [] }, { trace: true });
    sim.step([{ target: 0, port: 'signal_in', value }]);
    const actual = sim.world.trace[0].value;
    assert.equal(actual, N.formatFloat(N.gameMath[prefab.replace('component', '')](N.parseFloat32(value), true)));
    assert.ok(Math.abs(Number(actual) - Number(expected)) < 1e-6, `${prefab}: ${actual} vs DLL ${expected}`);
  }
});

test('sine oscillator keeps float32 phase and angle but a double sine result', () => {
  const sim = new CircuitSimulator({ components: [{ id: 0, prefab: 'oscillator', properties: { OutputType: 'Sine', Frequency: '13.55' } }], wires: [] }, { trace: true });
  let phase = 0;
  for (let i = 0; i < 3; i++) {
    phase = Math.fround(Math.fround(phase + Math.fround(Math.fround(1 / 60) * Math.fround(13.55))) % 1);
    const angle = Math.fround(phase * Math.fround(Math.PI * 2));
    sim.step();
    assert.equal(sim.getComponent(0).phase, phase);
    const result = Number(sim.world.trace[0].value);
    assert.equal(result, N.gameMath.sinDouble(angle));
    assert.notEqual(result, Math.fround(result));
  }
});
