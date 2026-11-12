'use strict';

const catalog = require('./catalog.js');
const { parseBlueprint } = require('./blueprint.js');
const prefabAliases = Object.freeze({ oscillatorcomponent: 'oscillator', concatenationcomponent: 'concatcomponent', exponentiationcomponent: 'powcomponent', regexfind: 'regexcomponent', signalcheck: 'signalcheckcomponent', squareroot: 'squarerootcomponent' });
const editable = {
  ArithmeticComponent: ['ClampMin','ClampMax','TimeFrame'],
  AndComponent: ['TimeFrame','Output','FalseOutput'], OrComponent: ['TimeFrame','Output','FalseOutput'], XorComponent: ['TimeFrame','Output','FalseOutput'],
  EqualsComponent: ['TimeFrame','Output','FalseOutput'], GreaterComponent: ['TimeFrame','Output','FalseOutput'],
  NotComponent: ['ContinuousOutput'], MemoryComponent: ['Value'], ColorComponent: ['UseHSV'],
  ConcatComponent: ['TimeFrame','Separator'], ExponentiationComponent: ['Exponent'], ModuloComponent: ['Modulus'],
  FunctionComponent: [], TrigonometricFunctionComponent: ['UseRadians'], RelayComponent: ['IsOn'],
  DelayComponent: ['Delay','ResetWhenSignalReceived','ResetWhenDifferentSignalReceived'],
  SignalCheckComponent: ['Output','FalseOutput','TargetSignal'],
  RegExFindComponent: ['Output','FalseOutput','UseCaptureGroup','OutputEmptyCaptureGroup','ContinuousOutput','Expression'],
  OscillatorComponent: ['OutputType','Frequency'], WifiComponent: ['Channel'],
  MultiplexerComponent: ['SelectedConnection','WrapAround','SkipEmptyConnections'], DemultiplexerComponent: ['SelectedConnection','WrapAround','SkipEmptyConnections']
};
const boxInputPorts = Object.freeze(Array.from({ length: 10 }, (_, i) => 'signal_in' + i));
const boxOutputPorts = Object.freeze(Array.from({ length: 10 }, (_, i) => 'signal_out' + i));
const booleanProperties = new Set(['ContinuousOutput','UseHSV','UseRadians','IsOn','ResetWhenSignalReceived','ResetWhenDifferentSignalReceived','UseCaptureGroup','OutputEmptyCaptureGroup','WrapAround','SkipEmptyConnections']);

// Blueprints constructs NEW items in file order, resolves I/O by sorted connector
// index and only writes InGameEditable properties. This differs from loading the
// serialized XML directly, especially for older prefabs and non-editable fields.
function importBlueprint(input) {
  const blueprint = typeof input === 'string' ? parseBlueprint(input) : input;
  const diagnostics = [], components = blueprint.components.map((component, id) => {
    const prefab = prefabAliases[component.prefab] || component.prefab, definition = catalog[prefab];
    if (!definition) throw new Error('Unsupported circuit box prefab: ' + prefab);
    const kind = definition.className;
    const keys = /^(Adder|Subtract|Multiply|Divide)Component$/.test(kind) ? editable.ArithmeticComponent : editable[kind];
    const properties = {};
    if (!component.className || component.className === kind) for (const [key, value] of Object.entries(component.properties || {})) {
      if (!keys.includes(key)) continue;
      if (booleanProperties.has(key)) {
        const text = String(value).toLowerCase();
        if (!['true','false','1','0'].includes(text)) { diagnostics.push(`Component ${id}.${key}: boolean conversion failed in the mod`); continue; }
        properties[key] = text === 'true' || text === '1';
      } else properties[key] = value;
    }
    return { ...component, id, prefab, className: kind, properties };
  });
  const counts = new Map(), wires = [];
  function endpoint(value, ports) {
    if (value.target === null || value.target === undefined || value.target === '') {
      const index = /\d+/.exec(value.name); if (!index) return null;
      const name = ports[Number(index[0])];
      return name ? { target: null, name } : null;
    }
    const component = components[Number(value.target)];
    if (!component || value.name.startsWith('power_') || ![...catalog[component.prefab].inputs, ...catalog[component.prefab].outputs].includes(value.name)) return null;
    return { target: component.id, name: value.name };
  }
  const isOutput = ep => ep.target === null ? ep.name.startsWith('signal_in') : catalog[components[ep.target].prefab].outputs.includes(ep.name);
  for (const wire of blueprint.wires) {
    let from = endpoint(wire.from, boxInputPorts), to = endpoint(wire.to, boxOutputPorts);
    if (!from || !to) { diagnostics.push(`Wire ${wire.id}: endpoint not found by the mod`); continue; }
    const key = ep => `${ep.target}:${ep.name}`;
    const internal = from.target !== null && to.target !== null;
    if (isOutput(from) === isOutput(to) || internal && (from.target === to.target || (counts.get(key(from)) || 0) >= 5 || (counts.get(key(to)) || 0) >= 5)) {
      diagnostics.push(`Wire ${wire.id}: rejected by CircuitBox.VerifyConnection`); continue;
    }
    if (!isOutput(from)) [from, to] = [to, from];
    const id = wires.length;
    wires.push({ id, prefab: wire.prefab || 'redwire', backingItemId: internal ? `${id},0` : '', from, to });
    if (internal) for (const ep of [from, to]) counts.set(key(ep), (counts.get(key(ep)) || 0) + 1);
  }
  const result = { ...blueprint, components, wires, inputPorts: [...boxInputPorts], outputPorts: [...boxOutputPorts], importDiagnostics: diagnostics };
  for (const symbol of Object.getOwnPropertySymbols(blueprint)) Object.defineProperty(result, symbol, Object.getOwnPropertyDescriptor(blueprint, symbol));
  return result;
}

module.exports = { importBlueprint, prefabAliases, boxInputPorts, boxOutputPorts, editable };
