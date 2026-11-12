#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { CircuitSimulator, readBlueprintFile, writeBlueprint, catalog } = require('./index.js');
function main(args) {
  const [command, filename, ...flags] = args;
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    console.log('Usage:\n  node circuitbox/cli.js inspect blueprint.txt\n  node circuitbox/cli.js run blueprint.txt --frames 600 [--inputs inputs.json] [--trace] [--output result.json] [--export saved.txt]\n  node circuitbox/cli.js roundtrip blueprint.txt --output saved.txt\n  node circuitbox/cli.js components');
    return;
  }
  if (command === 'components') { console.log(JSON.stringify(catalog, null, 2)); return; }
  if (!['inspect', 'run', 'roundtrip'].includes(command) || !filename) throw new Error('Unknown command or missing blueprint filename; use --help');
  const options = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--trace') options.trace = true;
    else if (['--frames', '--inputs', '--output', '--export'].includes(flag)) {
      const value = flags[++i]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
      options[flag.slice(2)] = value;
    } else throw new Error('Unknown option ' + flag);
  }
  const blueprint = readBlueprintFile(filename);
  if (command === 'roundtrip') {
    if (!options.output) throw new Error('roundtrip requires --output');
    fs.writeFileSync(options.output, writeBlueprint(blueprint), 'utf8'); return;
  }
  let result;
  if (command === 'inspect') result = blueprint;
  else {
    const frames = Number(options.frames ?? 1);
    if (!Number.isSafeInteger(frames) || frames < 0) throw new Error('--frames must be a nonnegative integer');
    const inputs = options.inputs ? JSON.parse(fs.readFileSync(options.inputs, 'utf8').replace(/^\uFEFF/, '')) : {};
    if (typeof inputs !== 'object' || inputs === null) throw new Error('inputs.json must contain an object or an array');
    const timeline = new Map();
    if (Array.isArray(inputs)) for (const event of inputs) {
      if (!Number.isInteger(event.frame) || event.frame < 1) throw new Error('Input events require frame >= 1');
      if (!timeline.has(event.frame)) timeline.set(event.frame, []); timeline.get(event.frame).push(event);
    }
    const sim = new CircuitSimulator(blueprint, { trace: options.trace, loadMode: 'blueprints' });
    const outputs = [], trace = [];
    for (let i = 1; i <= frames; i++) {
      outputs.push(...sim.step(Array.isArray(inputs) ? timeline.get(i) || [] : inputs));
      if (options.trace) trace.push(...sim.world.trace);
    }
    result = { frames: sim.frame, time: sim.time, lastOutputs: sim.lastOutputs, outputs, ...(options.trace ? { trace } : {}) };
    if (options.export) fs.writeFileSync(options.export, writeBlueprint(sim.toBlueprint()), 'utf8');
  }
  const text = JSON.stringify(result, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2) + '\n';
  if (options.output) fs.writeFileSync(options.output, text, 'utf8'); else process.stdout.write(text);
}
if (require.main === module) try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
module.exports = { main };
