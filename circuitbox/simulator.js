'use strict';

const { Component } = require('./components.js');
const catalog = require('./catalog.js');
const { f, gameClamp } = require('./numeric.js');
const { parseBlueprint, writeBlueprint } = require('./blueprint.js');
const STEP = 1 / 60;
const addUnique = (array, item) => { if (!array.includes(item)) array.push(item); };

class CircuitWorld {
  constructor(options = {}) {
    this.frame = 0; this.time = options.startTime || 0; this.deltaTime = f(STEP);
    this.simulators = []; this.deferred = []; this.inCoroutinePass = false;
    this.maxSignalsPerFrame = options.maxSignalsPerFrame ?? Infinity; this.operations = 0;
    this.traceEnabled = !!options.trace; this.trace = []; this.outputs = []; this.sources = new Map();
  }
  add(blueprint, options = {}) { return new CircuitSimulator(blueprint, { ...options, world: this }); }
  signal(value, options = {}) {
    if (value !== null && typeof value !== 'string') value = String(value);
    const source = typeof options.source === 'string' || typeof options.source === 'number' ? this.source(options.source) : options.source ?? null;
    return { value, stepsTaken: options.stepsTaken ?? 0, sender: options.sender ?? null, source,
      power: f(options.power ?? 0), strength: f(options.strength ?? 1), creationTime: options.creationTime ?? this.time };
  }
  source(id) {
    for (const sim of this.simulators) {
      if (id === sim.id) return sim.box;
      const component = sim.components.find(c => `${sim.id}/${c.id}` === String(id)); if (component) return component;
    }
    if (!this.sources.has(id)) this.sources.set(id, { sourceId: id, lastRecipients: [] });
    return this.sources.get(id);
  }
  describe(signal) {
    let source = signal.source?.sourceId ?? null;
    if (signal.source?.environment) source = `${signal.source.environment.simulator.id}/${signal.source.id}`;
    return { value: signal.value, stepsTaken: signal.stepsTaken, sender: signal.sender, source,
      power: signal.power, strength: signal.strength, creationTime: signal.creationTime };
  }
  connect(fromSimulator, output, toSimulator, input) {
    if (fromSimulator.world !== this || toSimulator.world !== this) throw new Error('Both boxes must be in this world');
    const a = fromSimulator.port(null, output), b = toSimulator.port(null, input);
    if (a.kind !== 'output' || b.kind !== 'input') throw new Error('External connections require output -> input');
    const wire = { a, b }; a.wires.push(wire); b.wires.push(wire); return wire;
  }
  step(inputs = []) {
    this.frame++; this.time += STEP; this.operations = 0; this.outputs = []; this.trace = [];
    for (const input of inputs) {
      const sim = input.box === undefined ? this.simulators[0] : this.simulators.find(s => s.id === input.box);
      if (!sim) throw new Error('Unknown circuit box ' + input.box);
      if (input.property) { sim.setProperty(input.target, input.property, input.value); continue; }
      if (input.target === undefined || input.target === null) sim.input(input.port || input.name, input.value, input);
      else sim.receive(input.target, input.port || input.name, input.value, input);
    }
    for (const sim of this.simulators) for (const component of sim.updateOrder) component.tick(this.deltaTime);
    // CoroutineManager.Update runs after all items. New iterators yield once on
    // their first visit; only the following visit sends the deferred signal.
    this.inCoroutinePass = true;
    try {
      const pass = [...this.deferred];
      for (const pending of pass) {
        if (!pending.started) { pending.started = true; continue; }
        this.deferred.splice(this.deferred.indexOf(pending), 1);
        this.connectionSend(pending.port, pending.signal);
      }
    } finally { this.inCoroutinePass = false; }
    return this.outputs.slice();
  }
  send(item, port, incoming, sourceFromString = true) {
    if (!port) return;
    if (++this.operations > this.maxSignalsPerFrame) throw new Error(`Signal limit exceeded at frame ${this.frame}; inspect the feedback circuit or increase maxSignalsPerFrame`);
    const signal = typeof incoming === 'string' || incoming === null ? this.signal(incoming) : { ...incoming };
    if (sourceFromString) signal.source ??= item;
    item.lastRecipients.length = 0;
    signal.stepsTaken++;
    if (signal.stepsTaken > 5 && signal.source) {
      if (signal.source.lastRecipients.filter(c => c === port).length > 2) return;
    }
    if (signal.stepsTaken > 10) {
      signal.stepsTaken = 0;
      if (!this.deferred.some(p => p.port === port && p.signal.source === signal.source && p.signal.sender === signal.sender && p.signal.value === signal.value)) this.deferred.push({ port, signal, started: false });
    } else { signal.source ??= item; this.connectionSend(port, signal); }
  }
  connectionSend(port, signal) {
    port.lastSent = { ...signal };
    const sim = port.simulator;
    if (this.traceEnabled) this.trace.push({ frame: this.frame, time: this.time, box: sim.id, component: port.component?.id ?? null, port: port.name, ...this.describe(signal) });
    if (port.kind === 'output') {
      const event = { frame: this.frame, time: this.time, box: sim.id, port: port.name, ...this.describe(signal) };
      sim.lastOutputs[port.name] = signal.value; this.outputs.push(event);
      sim.onOutput?.(event);
    }
    // HashSet<Wire> preserves insertion order while wires remain connected.
    for (const wire of port.wires) {
      const recipient = wire.a === port ? wire.b : wire.a;
      if (recipient.item === port.item || signal.source?.lastRecipients.at(-1) === recipient) continue;
      signal.source?.lastRecipients.push(recipient);
      this.connectionReceive(recipient, signal);
    }
    for (const boundary of port.bridges) this.circuitReceive(boundary, signal);
  }
  connectionReceive(port, signal) {
    port.lastReceived = { ...signal };
    if (port.component) port.component.receive({ ...signal }, port.name);
    else if (port.kind === 'input') this.circuitReceive(port, signal);
  }
  circuitReceive(port, signal) {
    if (port.kind === 'output') this.send(port.item, port, signal, false);
    else if (port.kind === 'input') for (const destination of port.destinations) {
      if (destination.kind === 'output') this.circuitReceive(destination, signal);
      else this.connectionReceive(destination, signal);
    }
  }
  transmit(sender, signal) {
    const p = sender.properties;
    const receivers = this.simulators.flatMap(s => s.components).filter(c => c.kind === 'WifiComponent' && c !== sender);
    for (const receiver of receivers) {
      const r = receiver.properties;
      if (p.Channel !== r.Channel || p.TeamID !== r.TeamID && !r.AllowCrossTeamCommunication || r.JamTimer > 0) continue;
      const out = receiver.environment.simulator.port(receiver.id, 'signal_out');
      if (!r.LinkToChat && out.wires.length === 0 && out.bridges.length === 0) continue;
      const dx = f(sender.position.x - receiver.position.x), dy = f(sender.position.y - receiver.position.y), distanceSquared = f(f(dx * dx) + f(dy * dy));
      if (distanceSquared > f(p.Range * p.Range)) continue;
      const input = receiver.environment.simulator.port(receiver.id, 'signal_in');
      if (signal.source) { if (signal.source.lastRecipients.includes(input)) continue; signal.source.lastRecipients.push(input); }
      const strength = f(signal.strength * gameClamp(f(1 - f(f(Math.sqrt(distanceSquared)) / r.Range)), 0, 1));
      this.send(receiver, out, this.signal(signal.value, { ...signal, stepsTaken: signal.stepsTaken + 1, power: 0, strength, creationTime: this.time }), false);
      if (signal.source) for (const recipient of receiver.lastRecipients) addUnique(signal.source.lastRecipients, recipient);
    }
  }
}

class CircuitSimulator {
  constructor(blueprint, options = {}) {
    this.blueprint = typeof blueprint === 'string' ? parseBlueprint(blueprint, options) : blueprint;
    if (options.loadMode === 'blueprints') this.blueprint = require('./importer.js').importBlueprint(this.blueprint);
    if (!this.blueprint?.components || !this.blueprint?.wires) throw new TypeError('Expected a circuit blueprint');
    this.world = options.world || new CircuitWorld(options); this.id = options.id ?? `box${this.world.simulators.length}`;
    if (this.world.simulators.some(s => s.id === this.id)) throw new Error('Duplicate circuit box ID ' + this.id);
    this.box = { sourceId: this.id, lastRecipients: [] }; this.ports = new Map(); this.lastOutputs = Object.create(null); this.onOutput = options.onOutput;
    const env = { simulator: this, position: options.position, regexOptions: options.regexOptions,
      newSignal: (value, opts) => this.world.signal(value, opts), send: (c, pin, signal) => this.world.send(c, this.port(c.id, pin), signal),
      connected: (c, pin) => { const port = this.port(c.id, pin); return port.wires.length > 0 || port.bridges.length > 0; },
      transmit: (c, signal) => this.world.transmit(c, signal) };
    this.components = this.blueprint.components.map(def => new Component(def, env));
    this.byId = new Map();
    for (const component of this.components) {
      if (!Number.isInteger(component.id) || component.id < 0 || component.id >= 65535 || this.byId.has(component.id)) throw new Error('Invalid or duplicate component ID ' + component.id);
      this.byId.set(component.id, component);
      for (const name of [...component.definition.inputs, ...component.definition.outputs]) this.makePort(component, name, 'component');
    }
    for (const name of this.blueprint.inputPorts || Array.from({ length: 10 }, (_, i) => 'signal_in' + i)) this.makePort(null, name, 'input');
    for (const name of this.blueprint.outputPorts || Array.from({ length: 10 }, (_, i) => 'signal_out' + i)) this.makePort(null, name, 'output');
    for (const wire of this.blueprint.wires) {
      const a = this.port(wire.from.target, wire.from.name), b = this.port(wire.to.target, wire.to.name);
      const isOutput = p => p.kind === 'input' || p.component?.definition.outputs.includes(p.name);
      if (isOutput(a) === isOutput(b)) throw new Error('Wire must connect an output to an input: ' + wire.id);
      if (a.name.startsWith('power_') || b.name.startsWith('power_')) throw new Error('Circuit boxes do not support power wires');
      const actual = { a, b, id: wire.id };
      // Boundary wires are virtual. An internal wire must have a backing item.
      if (a.component && b.component && wire.backingItemId !== '') { a.wires.push(actual); b.wires.push(actual); }
      for (const [one, two] of [[a, b], [b, a]]) {
        if (one.kind === 'input') addUnique(one.destinations, two);
        if (one.component && two.kind !== 'component') addUnique(one.bridges, two);
      }
    }
    this.updateOrder = options.updateOrder ? options.updateOrder.map(id => this.getComponent(id)) : [...this.components];
    if (this.updateOrder.length !== this.components.length || new Set(this.updateOrder).size !== this.components.length) throw new Error('updateOrder must list every component once');
    this.world.simulators.push(this);
  }
  makePort(component, name, kind) {
    const port = { name, component, simulator: this, kind, item: component || this.box, wires: [], bridges: [], destinations: [], lastSent: null, lastReceived: null };
    this.ports.set(`${component?.id ?? ''}:${name}`, port); return port;
  }
  getComponent(id) { const c = this.byId.get(Number(id)); if (!c) throw new Error('Unknown component ' + id); return c; }
  port(target, name) {
    const c = target === null || target === undefined || target === '' ? null : this.getComponent(target);
    name = c?.definition.aliases[name] || name;
    const port = this.ports.get(`${c?.id ?? ''}:${name}`); if (!port) throw new Error(`Unknown connection ${target ?? 'box'}.${name}`);
    return port;
  }
  input(port, value, options = {}) {
    const connection = this.port(null, port); if (connection.kind !== 'input') throw new Error('Expected circuit box input');
    this.world.connectionReceive(connection, this.world.signal(value, options));
  }
  receive(componentId, port, value, options = {}) { this.world.connectionReceive(this.port(componentId, port), this.world.signal(value, options)); }
  setProperty(componentId, name, value) {
    const component = this.getComponent(componentId);
    if (!component.setProperty(name, value)) throw new Error('Unknown property ' + name + ' on ' + component.prefab);
  }
  step(inputs = []) {
    if (!Array.isArray(inputs)) inputs = Object.entries(inputs).map(([port, value]) => ({ port, value }));
    return this.world.step(inputs.map(event => ({ ...event, box: event.box ?? this.id }))).filter(e => e.box === this.id);
  }
  run(frames, inputs = []) {
    if (!Number.isInteger(frames) || frames < 0) throw new TypeError('frames must be a nonnegative integer');
    const outputs = [];
    for (let i = 0; i < frames; i++) outputs.push(...this.step(typeof inputs === 'function' ? inputs(this.world.frame + 1, this) : inputs));
    return outputs;
  }
  toBlueprint() {
    const blueprint = parseBlueprint(writeBlueprint(this.blueprint));
    for (const def of blueprint.components) {
      const component = this.getComponent(def.id);
      for (const [key, value] of Object.entries(component.properties)) def.properties[key] = typeof value === 'boolean' ? value ? 'True' : 'False' : String(value);
    }
    return blueprint;
  }
  get frame() { return this.world.frame; }
  get time() { return this.world.time; }
}
module.exports = { CircuitSimulator, CircuitWorld, STEP, catalog };
