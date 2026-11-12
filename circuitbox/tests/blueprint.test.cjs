'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseBlueprint, writeBlueprint, readBlueprintFile, CircuitSimulator } = require('..');
const example = path.join(__dirname, '../examples/adder.txt');
test('unchanged blueprints round-trip byte for byte', () => {
  const text = '\uFEFF' + fs.readFileSync(example, 'utf8').replace(/\n/g, '\r\n');
  assert.equal(writeBlueprint(parseBlueprint(text)), text);
});
test('edited files preserve the graph, labels, unknown XML and delimiter strings', () => {
  const b = readBlueprintFile(example);
  b.components[0].prefab = 'concatcomponent'; b.components[0].className = 'ConcatComponent';
  b.components[0].properties = { TimeFrame: '0', Separator: '" < > & /> \n \\ <<<STRINGSTART>>> <<<STRINGEND>>>' };
  b.labels.push({ id: '0', header: '中文 & <tag>', body: 'a\nb', color: '#00FFFF', position: '0,0', size: '256,256' });
  const reread = parseBlueprint(writeBlueprint(b));
  assert.deepEqual(reread.components, b.components); assert.deepEqual(reread.wires, b.wires); assert.deepEqual(reread.labels, b.labels);
});
test('new graphs use a format loadable by Blueprints, with custom I/O pins', () => {
  const b = { components: [{ id: 7, prefab: 'memorycomponent', properties: { Value: '2' }, position: { x: 10, y: 20 } }], wires: [
    { id: 4, from: { target: 7, name: 'signal_out' }, to: { target: null, name: 'signal_out0' } }], inputPorts: ['signal_in0'], outputPorts: ['signal_out0'] };
  const reread = parseBlueprint(writeBlueprint(b));
  assert.deepEqual(reread.inputPorts, b.inputPorts); assert.equal(new CircuitSimulator(reread).step()[0].value, '2');
});
test('legacy XML attribute entities and malformed input are handled explicitly', () => {
  const text = '<CircuitBox><Component id="0" item="memorycomponent" Class="MemoryComponent" Value="&lt;&amp;&quot;&pound;&#xA;" /></CircuitBox>';
  assert.equal(parseBlueprint(text).components[0].properties.Value, '<&"£\n');
  for (const value of ['<CircuitBox>', '<Root><CircuitBox></Root>', '<!DOCTYPE x><CircuitBox/>', '<CircuitBox><Component id="0" Value=<<<STRINGSTART>>>x/></CircuitBox>']) assert.throws(() => parseBlueprint(value), SyntaxError);
});
test('export retains current settings without pretending to serialize pending signals', () => {
  const sim = new CircuitSimulator(readBlueprintFile(example)); sim.setProperty(0, 'ClampMax', '10');
  assert.equal(parseBlueprint(writeBlueprint(sim.toBlueprint())).components[0].properties.ClampMax, '10');
});
