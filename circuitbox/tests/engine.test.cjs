'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CircuitSimulator, CircuitWorld, catalog } = require('..');
const component = (prefab, properties = {}) => new CircuitSimulator({ components: [{ id: 0, prefab, properties }], wires: [] }, { trace: true });
const values = sim => sim.world.trace.filter(e => e.component === 0).map(e => e.value);

test('catalog contains every vanilla circuitboxcomponent prefab', () => {
  assert.equal(Object.keys(catalog).length, 35);
  for (const prefab of Object.keys(catalog)) assert.doesNotThrow(() => component(prefab).step());
});
test('arithmetic waits for both inputs; comparisons retain the other input', () => {
  const add = component('addercomponent');
  add.step([{ target: 0, port: 'signal_in1', value: '3' }]); assert.deepEqual(values(add), []);
  add.step([{ target: 0, port: 'signal_in2', value: '2' }]); assert.deepEqual(values(add), []);
  add.step([{ target: 0, port: 'signal_in1', value: '3' }, { target: 0, port: 'signal_in2', value: '2' }]); assert.deepEqual(values(add), ['5']);
  const equals = component('equalscomponent');
  equals.step([{ target: 0, port: 'signal_in1', value: 'a' }]); assert.deepEqual(values(equals), ['0']);
  equals.step([{ target: 0, port: 'signal_in2', value: 'a' }]); assert.deepEqual(values(equals), ['1']);
});
test('logic gates count empty strings and ignore only literal zero', () => {
  const sim = component('orcomponent');
  sim.step([{ target: 0, port: 'signal_in1', value: '' }]); assert.deepEqual(values(sim), ['1']);
  sim.step([{ target: 0, port: 'signal_in1', value: '0' }]); assert.deepEqual(values(sim), ['0']);
  sim.step([{ target: 0, port: 'signal_in1', value: '0.0' }]); assert.deepEqual(values(sim), ['1']);
});
test('division drops near-zero divisors, while modulo and power emit special values', () => {
  const div = component('dividecomponent');
  div.step([{ target: 0, port: 'signal_in1', value: '1' }, { target: 0, port: 'signal_in2', value: '0.00001' }]); assert.deepEqual(values(div), []);
  const pow = component('powcomponent', { Exponent: '0.5' });
  pow.step([{ target: 0, port: 'signal_in', value: '-1' }]); assert.deepEqual(values(pow), ['NaN']);
  const add = component('addercomponent', { ClampMin: 'Infinity' });
  add.step([{ target: 0, port: 'signal_in1', value: '1' }, { target: 0, port: 'signal_in2', value: '1' }]); assert.deepEqual(values(add), ['Infinity']);
});
test('memory lock requires literal 1 and truncates in UTF-16 code units', () => {
  const sim = component('memorycomponent', { Value: 'old', MaxValueLength: 3 });
  sim.step([{ target: 0, port: 'lock_state', value: '0' }, { target: 0, port: 'signal_in', value: 'new' }]); assert.deepEqual(values(sim), ['old']);
  sim.step([{ target: 0, port: 'lock_state', value: '1' }, { target: 0, port: 'signal_in', value: 'abcdef' }]); assert.deepEqual(values(sim), ['abc']);
});
test('a delay of 0.1 seconds sends on the sixth update and resets on changed input', () => {
  const sim = component('delaycomponent', { Delay: '0.1', ResetWhenDifferentSignalReceived: true });
  sim.step([{ target: 0, port: 'signal_in', value: 'A', strength: 0.8 }]);
  for (let i = 0; i < 3; i++) sim.step();
  sim.step([{ target: 0, port: 'signal_in', value: 'B', strength: 0.8 }]);
  for (let i = 0; i < 4; i++) { sim.step(); assert.deepEqual(values(sim), []); }
  sim.step(); assert.deepEqual(values(sim), ['B']); assert.equal(sim.world.trace[0].strength, Math.fround(0.8));
});
test('long immediate chains yield through the actual two coroutine visits', () => {
  const components = Array.from({ length: 24 }, (_, id) => ({ id, prefab: 'notcomponent' }));
  const wires = components.slice(1).map((_, i) => ({ id: i, from: { target: i, name: 'signal_out' }, to: { target: i + 1, name: 'signal_in' } }));
  wires.push({ id: 99, from: { target: 23, name: 'signal_out' }, to: { target: null, name: 'signal_out1' } });
  const sim = new CircuitSimulator({ components, wires });
  assert.deepEqual(sim.step([{ target: 0, port: 'signal_in', value: '0' }]), []);
  assert.deepEqual(sim.step(), []);
  assert.deepEqual(sim.step(), []);
  assert.equal(sim.step()[0].value, '0');
});
test('updateOrder preserves order-sensitive memory feedback', () => {
  const blueprint = { components: [{ id: 0, prefab: 'memorycomponent', properties: { Value: 'A' } }, { id: 1, prefab: 'memorycomponent', properties: { Value: 'B' } }], wires: [
    { id: 0, from: { target: 0, name: 'signal_out' }, to: { target: 1, name: 'signal_in' } },
    { id: 1, from: { target: 1, name: 'signal_out' }, to: { target: 0, name: 'signal_in' } }] };
  const first = new CircuitSimulator(blueprint), reversed = new CircuitSimulator(blueprint, { updateOrder: [1, 0] });
  first.step(); reversed.step(); assert.equal(first.getComponent(1).properties.Value, 'A'); assert.equal(reversed.getComponent(0).properties.Value, 'B');
});
test('wireless components pass signals to connected receivers on the same channel', () => {
  const sim = new CircuitSimulator({ components: [{ id: 0, prefab: 'wificomponent' }, { id: 1, prefab: 'wificomponent' }], wires: [
    { id: 0, from: { target: 1, name: 'signal_out' }, to: { target: null, name: 'signal_out1' } }] });
  assert.equal(sim.step([{ target: 0, port: 'signal_in', value: 'hello' }])[0].value, 'hello');
  sim.setProperty(1, 'Channel', 2); assert.deepEqual(sim.step([{ target: 0, port: 'signal_in', value: 'hello' }]), []);
});
test('multiple boxes share one ordered world update', () => {
  const world = new CircuitWorld();
  const a = world.add({ components: [{ id: 0, prefab: 'memorycomponent', properties: { Value: '9' } }], wires: [{ id: 0, from: { target: 0, name: 'signal_out' }, to: { target: null, name: 'signal_out1' } }] });
  const b = world.add({ components: [{ id: 0, prefab: 'notcomponent' }], wires: [{ id: 0, from: { target: null, name: 'signal_in1' }, to: { target: 0, name: 'signal_in' } }, { id: 1, from: { target: 0, name: 'signal_out' }, to: { target: null, name: 'signal_out1' } }] });
  world.connect(a, 'signal_out1', b, 'signal_in1');
  assert.deepEqual(world.step().map(e => [e.box, e.value]), [['box0', '9'], ['box1', '0']]);
});
