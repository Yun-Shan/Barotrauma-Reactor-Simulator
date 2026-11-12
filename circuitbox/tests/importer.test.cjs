'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { importBlueprint, CircuitSimulator, parseBlueprint, writeBlueprint, boxInputPorts, boxOutputPorts } = require('..');

test('mod import creates fresh items, resolves legacy prefabs and ignores non-editable properties', () => {
  const raw = { components: [{ id: 42, prefab: 'oscillatorcomponent', className: 'OscillatorComponent', properties: { OutputType: 'Sine', Frequency: '13.55', IsActive: 'False' } },
    { id: 6, prefab: 'memorycomponent', className: 'MemoryComponent', properties: { Value: 'abcdef', MaxValueLength: '3', Writeable: 'False', value: 'wrong case' } }], wires: [] };
  const imported = importBlueprint(raw);
  assert.deepEqual(imported.components.map(c => [c.id, c.prefab]), [[0, 'oscillator'], [1, 'memorycomponent']]);
  assert.deepEqual(imported.components[1].properties, { Value: 'abcdef' });
  const sim = new CircuitSimulator(raw, { loadMode: 'blueprints', trace: true }); sim.step();
  assert.equal(sim.world.trace.find(e => e.component === 1).value, 'abcdef');
  assert.equal(raw.components[0].id, 42);
});

test('mod import uses current box connector indices despite old saved panels', () => {
  const text = '<CircuitBox><Component id="0" item="memorycomponent" Class="MemoryComponent" Value="42"/><Wire id="0" prefab="wire"><From target="0" name="signal_out"/><To target="" name="signal_out0"/></Wire></CircuitBox>';
  const imported = importBlueprint(text);
  assert.deepEqual(imported.inputPorts, boxInputPorts); assert.deepEqual(imported.outputPorts, boxOutputPorts);
  assert.equal(new CircuitSimulator(text, { loadMode: 'blueprints' }).step()[0].port, 'signal_out0');
  assert.equal(parseBlueprint(writeBlueprint(imported)).components[0].properties.Value, '42');
});

test('mod import respects five physical wires per connector and virtual I/O fan-out', () => {
  const components = [{ id: 0, prefab: 'memorycomponent' }, ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, prefab: 'notcomponent' }))];
  const wires = components.slice(1).map(c => ({ id: c.id, from: { target: 0, name: 'signal_out' }, to: { target: c.id, name: 'signal_in' } }));
  wires.push({ id: 7, from: { target: 0, name: 'signal_out' }, to: { target: null, name: 'signal_out9' } });
  const imported = importBlueprint({ components, wires });
  assert.equal(imported.wires.length, 6); assert.equal(imported.importDiagnostics.length, 1);
  assert.equal(imported.wires.at(-1).to.name, 'signal_out9');
});

test('mod boolean conversion accepts numeric strings and class mismatches retain prefab defaults', () => {
  const sim = new CircuitSimulator({ components: [{ id: 0, prefab: 'notcomponent', properties: { ContinuousOutput: '1' } },
    { id: 1, prefab: 'memorycomponent', className: 'WrongComponent', properties: { Value: 'ignored' } }], wires: [] }, { loadMode: 'blueprints', trace: true });
  sim.step(); assert.deepEqual(sim.world.trace.map(e => e.value), ['1', '']);
});

test('exporting a mod import updates an older connection panel and retains its unknown settings', () => {
  const text = '<Root><Item identifier="circuitbox"><ConnectionPanel CustomSetting="kept"><input name="signal_in1"/><output name="signal_out1"/></ConnectionPanel><CircuitBox/></Item></Root>';
  const exported = writeBlueprint(importBlueprint(text));
  const reread = parseBlueprint(exported);
  assert.deepEqual(reread.inputPorts, boxInputPorts); assert.deepEqual(reread.outputPorts, boxOutputPorts);
  assert.ok(exported.includes('CustomSetting="kept"'));
});
