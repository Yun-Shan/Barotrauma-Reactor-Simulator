'use strict';

const catalog = require('./catalog.js');
const N = require('./numeric.js');
const { DotNetRegex, RegexTimeout } = require('./regex.js');
const { f, numberOrZero: number, parseFloat32, parseAnyFloat, parseInt32, int32, gameClamp, nearlyEqual, formatFloat: fmt, formatDouble, gameMath } = N;
const arithmetic = { AdderComponent: 'add', SubtractComponent: 'sub', MultiplyComponent: 'mul', DivideComponent: 'div' };
const booleans = new Set(['AndComponent', 'OrComponent', 'XorComponent']);
const selectors = new Set(['MultiplexerComponent', 'DemultiplexerComponent']);
const waves = ['Pulse', 'Sawtooth', 'Sine', 'Square', 'Triangle'];
const functions = ['Round', 'Ceil', 'Floor', 'Factorial', 'AbsoluteValue', 'SquareRoot'];
const trigFunctions = ['Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan'];
const common = { TimeFrame: 0, ClampMin: -999999, ClampMax: 999999, MaxOutputLength: 200, Output: '1', FalseOutput: '0' };
const defaults = {
  MemoryComponent: { MaxValueLength: 200, Value: '', Writeable: true },
  NotComponent: { ContinuousOutput: false },
  DelayComponent: { Delay: 1, ResetWhenSignalReceived: false, ResetWhenDifferentSignalReceived: false },
  ConcatComponent: { TimeFrame: 0, MaxOutputLength: 256, Separator: '' },
  SignalCheckComponent: { MaxOutputLength: 200, Output: '1', FalseOutput: '0', TargetSignal: '' },
  RegExFindComponent: { MaxOutputLength: 200, Output: '1', FalseOutput: '0', UseCaptureGroup: false, OutputEmptyCaptureGroup: false, ContinuousOutput: true, Expression: '' },
  ColorComponent: { UseHSV: false },
  ExponentiationComponent: { Exponent: 1 }, ModuloComponent: { Modulus: 1 },
  FunctionComponent: { Function: 'Round' }, TrigonometricFunctionComponent: { Function: 'Sin', UseRadians: false },
  OscillatorComponent: { OutputType: 'Pulse', Frequency: 1 },
  RelayComponent: { IsOn: true, MaxPower: 1000, CanBeOverloaded: false, VulnerableToEMP: false },
  WifiComponent: { Channel: 0, Range: 20000, TeamID: 'None', AllowCrossTeamCommunication: false, LinkToChat: false, MinChatMessageInterval: 1, DiscardDuplicateChatMessages: true, JamTimer: 0 },
  MultiplexerComponent: { SelectedConnection: 0, WrapAround: true, SkipEmptyConnections: true },
  DemultiplexerComponent: { SelectedConnection: 0, WrapAround: true, SkipEmptyConnections: true }
};
const integers = new Set(['MaxOutputLength', 'MaxValueLength', 'SelectedConnection', 'Channel']);
function parseEnum(value, names, ignoreCase = false) {
  const text = String(value).trim(), index = parseInt32(text);
  if (index !== undefined) return names[index] ?? index;
  return names.find(name => ignoreCase ? name.toLowerCase() === text.toLowerCase() : name === text);
}

class Component {
  constructor(definition, environment) {
    const prefab = definition.prefab || definition.item;
    this.definition = catalog[prefab];
    if (!this.definition) throw new Error('Unsupported circuit box prefab: ' + prefab);
    if (definition.className && definition.className !== this.definition.className) throw new Error(`Class ${definition.className} does not match ${prefab}`);
    this.id = definition.id; this.prefab = prefab; this.kind = this.definition.className; this.environment = environment;
    this.properties = { ...(arithmetic[this.kind] || booleans.has(this.kind) || ['EqualsComponent', 'GreaterComponent'].includes(this.kind) ? common : defaults[this.kind]) };
    this.active = !(arithmetic[this.kind] || this.kind === 'ConcatComponent' || this.kind === 'NotComponent' || selectors.has(this.kind));
    this.condition = f(definition.condition ?? 100);
    const position = definition.worldPosition || environment.position || { x: 0, y: 0 };
    this.position = { x: f(position.x), y: f(position.y) };
    this.times = [f(0.1), f(0.1)]; this.values = [0, 0]; this.senders = [null, null];
    if (this.kind === 'EqualsComponent' || this.kind === 'ConcatComponent') this.values = [null, null];
    if (this.kind === 'TrigonometricFunctionComponent') this.times = [0, 0];
    this.queue = []; this.previousQueued = null; this.delayTicks = 60; this.queueSize = 120;
    this.phase = 0; this.signalReceived = false; this.color = [0, 0, 0, 0]; this.colorOutput = '0,0,0,0';
    this.received = null; this.previousReceived = ''; this.previousResult = false; this.previousGroups = null;
    this.nonContinuousSent = true; this.timedOut = false; this.timeoutsInARow = 0;
    this.regex = this.kind === 'RegExFindComponent' ? new DotNetRegex('', environment.regexOptions) : null;
    this.sender = null; this.chatCooldown = 0; this.lastRecipients = [];
    this.connectionCount = selectors.has(this.kind) ? 10 : 0;
    for (const [key, value] of Object.entries(this.definition.prefabProperties)) this.setProperty(key, value);
    for (const [key, value] of Object.entries(definition.properties || {})) this.setProperty(key, value);
    if (selectors.has(this.kind)) this.active = true;
  }
  setProperty(inputKey, value) {
    const p = this.properties;
    const key = Object.keys(p).find(k => k.toLowerCase() === inputKey.toLowerCase());
    // Blueprint files can carry inherited editing/UI properties without affecting signals.
    if (!key) return false;
    if (typeof p[key] === 'boolean') value = typeof value === 'boolean' ? value : String(value).trim().toLowerCase() === 'true';
    else if (typeof p[key] === 'number') {
      const parsed = integers.has(key) ? parseInt32(value) : parseFloat32(value);
      if (parsed === undefined) throw new TypeError(`Invalid ${this.prefab}.${key}: ${value}`);
      value = parsed;
    } else if (value != null) value = String(value);
    else return true;
    switch (key) {
      case 'MaxOutputLength': case 'MaxValueLength': value = Math.max(value, 0); break;
      case 'TimeFrame':
        if (value > p.TimeFrame) this.times.fill(Math.max(f(value * 2), f(0.1)));
        value = Math.max(0, value); break;
      case 'Output': case 'FalseOutput':
        if (key === 'Output' || this.kind !== 'RegExFindComponent') value = value.slice(0, p.MaxOutputLength);
        if (booleans.has(this.kind)) this.active = true;
        break;
      case 'Value': value = value.slice(0, p.MaxValueLength); break;
      case 'Modulus': if (nearlyEqual(value, 0)) value = 1; break;
      case 'Delay':
        if (value !== p.Delay) { this.delayTicks = int32(value / (1 / 60)); this.queueSize = Math.imul(Math.max(this.delayTicks, 1), 2); this.queue.length = 0; }
        break;
      case 'ContinuousOutput': if (this.kind === 'NotComponent') this.active = value; break;
      case 'Expression':
        if (value !== p.Expression || !this.regex) {
          this.previousReceived = '';
          try { this.regex = new DotNetRegex(value, this.environment.regexOptions); this.timedOut = false; } catch { /* .NET retains the previous compiled expression on invalid edits. */ }
        }
        break;
      case 'Frequency': value = gameClamp(value, 0, 240); break;
      case 'Range': case 'MaxPower': value = Math.max(value, 0); break;
      case 'Channel': value = gameClamp(value, 0, 10000); break;
      case 'TeamID': value = String(parseEnum(value, ['None', 'Team1', 'Team2', 'FriendlyNPC'], true) ?? value); break;
      case 'JamTimer': value = Math.max(value, 0); if (value > 0) this.active = true; break;
      case 'SelectedConnection': value = Math.min(Math.max(value, 0), this.connectionCount - 1); break;
      case 'Function': value = parseEnum(value, this.kind === 'FunctionComponent' ? functions : trigFunctions, true) ?? value; break;
      case 'OutputType': value = parseEnum(value, waves, true) ?? value; break;
    }
    p[key] = value; return true;
  }
  send(pin, signal) { this.environment.send(this, pin, signal); }
  fresh(value, options = {}) { return this.environment.newSignal(value, options); }
  tick(delta) {
    const p = this.properties, kind = this.kind;
    if (!this.active || this.condition <= 0) return;
    if (arithmetic[kind] || kind === 'ConcatComponent') {
      const expired = this.times.map(t => t > p.TimeFrame);
      this.times = this.times.map(t => f(t + delta)); this.active = !expired.every(Boolean);
      if (expired.some(Boolean)) return;
      if (kind === 'ConcatComponent') this.send('signal_out', ((this.values[0] ?? '') + p.Separator + (this.values[1] ?? '')).slice(0, p.MaxOutputLength));
      else {
        const [a, b] = this.values;
        const output = kind === 'AdderComponent' ? f(a + b) : kind === 'SubtractComponent' ? f(a - b)
          : kind === 'MultiplyComponent' ? f(a * b) : nearlyEqual(b, 0) ? NaN : f(a / b);
        if (Number.isFinite(output)) this.send('signal_out', this.fresh(fmt(gameClamp(output, p.ClampMin, p.ClampMax)), { sender: this.senders[0] ?? this.senders[1] }));
      }
    } else if (booleans.has(kind)) {
      const count = this.times.filter(t => t <= p.TimeFrame).length;
      this.times = this.times.map(t => f(t + delta));
      const state = kind === 'AndComponent' ? count >= 2 : kind === 'OrComponent' ? count > 0 : count === 1;
      const output = state ? p.Output : p.FalseOutput;
      if (output === '') { if (!state && count === 0) this.active = false; return; }
      this.send('signal_out', this.fresh(output, { sender: this.senders[0] ?? this.senders[1] }));
    } else if (kind === 'EqualsComponent' || kind === 'GreaterComponent') {
      const outputNow = this.times.some(t => t <= p.TimeFrame);
      this.times = this.times.map(t => f(t + delta));
      const state = kind === 'EqualsComponent' ? this.values[0] === this.values[1] : this.values[0] > this.values[1];
      const output = state ? p.Output : p.FalseOutput;
      if (outputNow && output !== '') this.send('signal_out', this.fresh(output, { sender: kind === 'EqualsComponent' ? this.senders[0] ?? this.senders[1] : null }));
    } else if (kind === 'MemoryComponent') this.send('signal_out', p.Value);
    else if (kind === 'NotComponent') { if (!this.signalReceived) this.send('signal_out', '1'); this.signalReceived = false; }
    else if (kind === 'ColorComponent') this.send('signal_out', this.colorOutput);
    else if (kind === 'RelayComponent') {
      this.send('state_out', p.IsOn ? '1' : '0');
      this.send('power_value_out', '0'); this.send('load_value_out', '0'); // Power pins cannot be wired inside a circuit box.
    } else if (kind === 'DelayComponent') {
      if (!this.queue.length) { this.active = false; return; }
      for (const signal of this.queue) signal.timer = (signal.timer - 1) | 0;
      while (this.queue.length && this.queue[0].timer <= 0) {
        const signal = this.queue[0]; signal.duration--;
        this.send('signal_out', this.fresh(signal.signal.value, { sender: signal.signal.sender, strength: signal.signal.strength }));
        if (signal.duration <= 0) this.queue.shift(); else break;
      }
    } else if (kind === 'RegExFindComponent') this.tickRegex();
    else if (kind === 'OscillatorComponent') this.tickOscillator(delta);
    else if (kind === 'TrigonometricFunctionComponent' && p.Function === 'Atan') {
      for (let i = 0; i < 2; i++) { this.times[i] = f(this.times[i] + delta); if (this.times[i] > f(0.1)) this.values[i] = NaN; }
      if (!this.values.some(Number.isNaN)) this.send('signal_out', this.fresh(fmt(gameMath.atan2(this.values[1], this.values[0], p.UseRadians)), { sender: this.sender }));
    } else if (selectors.has(kind)) this.send(kind === 'MultiplexerComponent' ? 'selected_input_out' : 'selected_output_out', String(p.SelectedConnection));
    else if (kind === 'WifiComponent') {
      this.chatCooldown = f(this.chatCooldown - delta); this.setProperty('JamTimer', f(p.JamTimer - delta));
      if (this.chatCooldown <= 0 && p.JamTimer <= 0) this.active = false;
    }
  }
  receive(signal, pin) {
    const p = this.properties, kind = this.kind;
    const index = pin === 'signal_in1' ? 0 : pin === 'signal_in2' ? 1 : -1;
    if (arithmetic[kind] || kind === 'ConcatComponent' || booleans.has(kind) || kind === 'EqualsComponent' || kind === 'GreaterComponent') {
      if (index >= 0) {
        if (booleans.has(kind) && signal.value === '0') return;
        this.times[index] = 0; this.senders[index] = signal.sender;
        this.values[index] = arithmetic[kind] || kind === 'GreaterComponent' ? number(signal.value) : signal.value;
        if (arithmetic[kind] || booleans.has(kind) || kind === 'ConcatComponent') this.active = true;
      } else if (pin === 'set_output' && p.Output !== undefined) p.Output = signal.value;
    } else if (kind === 'MemoryComponent') {
      if (pin === 'signal_in' && p.Writeable) this.setProperty('Value', signal.value);
      else if (pin === 'lock_state' || pin === 'signal_store') p.Writeable = signal.value === '1';
    } else if (kind === 'NotComponent' && pin === 'signal_in') {
      this.send('signal_out', { ...signal, value: signal.value === '0' || !signal.value ? '1' : '0', power: 0 }); this.signalReceived = true;
    } else if (kind === 'SignalCheckComponent') {
      if (pin === 'set_output') this.setProperty('Output', signal.value);
      else if (pin === 'set_targetsignal') this.setProperty('TargetSignal', signal.value);
      else if (pin === 'signal_in') { const value = signal.value === p.TargetSignal ? p.Output : p.FalseOutput; if (value !== '') this.send('signal_out', { ...signal, value }); }
    } else if (kind === 'RegExFindComponent') {
      if (pin === 'signal_in') { this.received = signal.value; this.nonContinuousSent = false; }
      else if (pin === 'set_output') this.setProperty('Output', signal.value);
    } else if (kind === 'ExponentiationComponent' || kind === 'ModuloComponent') {
      const property = kind === 'ModuloComponent' ? 'Modulus' : 'Exponent', input = property.toLowerCase();
      if (pin === 'set_' + input || pin === input) this.setProperty(property, number(signal.value));
      else if (pin === 'signal_in') this.send('signal_out', { ...signal, value: fmt(kind === 'ModuloComponent' ? f(number(signal.value) % p.Modulus) : gameMath.pow(signal.value, p.Exponent)) });
    } else if (kind === 'FunctionComponent' && pin === 'signal_in') {
      const value = parseFloat32(signal.value); if (value === undefined || p.Function === 'SquareRoot' && value < 0) return;
      const fn = { Round: 'round', Ceil: 'ceil', Floor: 'floor', Factorial: 'factorial', AbsoluteValue: 'abs', SquareRoot: 'sqrt' }[p.Function];
      if (!fn) throw new Error('Unknown Function ' + p.Function);
      this.send('signal_out', { ...signal, value: fmt(gameMath[fn](value)) });
    } else if (kind === 'TrigonometricFunctionComponent') {
      this.sender = signal.sender;
      if (p.Function === 'Atan' && (pin === 'signal_in_x' || pin === 'signal_in_y')) {
        const index = pin === 'signal_in_x' ? 0 : 1; this.values[index] = number(signal.value); this.times[index] = 0;
      } else {
        const result = gameMath[p.Function.toLowerCase()](number(signal.value), p.UseRadians);
        this.send('signal_out', { ...signal, value: fmt(result) });
      }
    } else if (kind === 'ColorComponent') {
      const index = ['signal_r', 'signal_g', 'signal_b', 'signal_a'].indexOf(pin);
      if (index >= 0) {
        this.color[index] = number(signal.value);
        const color = p.UseHSV ? [...hsv(...this.color), this.color[3]] : this.color;
        this.colorOutput = color.map(fmt).join(',');
      }
    } else if (kind === 'DelayComponent') this.receiveDelay(signal, pin);
    else if (kind === 'RelayComponent') {
      if (this.condition <= 0 || pin.startsWith('power_')) return;
      if (/^signal_in[1-5]?$/.test(pin)) { if (p.IsOn) this.send(pin.replace('in', 'out'), signal); }
      else if (pin === 'set_state') p.IsOn = signal.value !== '0';
      else if (pin === 'toggle' && signal.value !== '0') p.IsOn = !p.IsOn;
    } else if (kind === 'OscillatorComponent') {
      if (pin === 'set_frequency' || pin === 'frequency_in') { const value = parseFloat32(signal.value); if (value !== undefined) this.setProperty('Frequency', value); this.active = true; }
      else if (pin === 'set_outputtype' || pin === 'set_wavetype') { const value = parseEnum(signal.value, waves); if (value !== undefined) p.OutputType = value; }
    } else if (selectors.has(kind)) this.receiveSelector(signal, pin);
    else if (kind === 'WifiComponent') {
      if (pin === 'signal_in') this.environment.transmit(this, signal);
      else if (pin === 'set_channel') { const value = parseInt32(signal.value); if (value !== undefined) this.setProperty('Channel', value); }
      else if (pin === 'set_range') { const value = parseFloat32(signal.value); if (value !== undefined) this.setProperty('Range', value); }
    }
  }
  receiveDelay(signal, pin) {
    const p = this.properties;
    if (pin === 'set_delay') {
      const value = parseAnyFloat(signal.value);
      if (value !== undefined) {
        const delay = gameClamp(value, 0, 60);
        if (this.queue.length && delay !== p.Delay) { this.previousQueued = null; this.queue.length = 0; }
        this.setProperty('Delay', delay);
      }
    } else if (pin === 'signal_in') {
      if (this.queue.length >= this.queueSize) return;
      if (p.ResetWhenSignalReceived || p.ResetWhenDifferentSignalReceived && this.queue.length && this.queue[0].signal.value !== signal.value) { this.previousQueued = null; this.queue.length = 0; }
      const prev = this.previousQueued;
      if (prev && prev.signal.value === signal.value && nearlyEqual(prev.signal.strength, signal.strength) && (prev.timer + prev.duration === this.delayTicks || prev.timer <= 0 && prev.duration > 0)) { prev.duration++; return; }
      this.previousQueued = { signal: { ...signal }, timer: this.delayTicks, duration: 1 };
      this.queue.push(this.previousQueued); this.active = true;
    }
  }
  receiveSelector(signal, pin) {
    const p = this.properties, mux = this.kind === 'MultiplexerComponent';
    if (mux && pin.startsWith('signal_in')) { if (pin === 'signal_in' + p.SelectedConnection) this.send('signal_out', signal); }
    else if (!mux && pin === 'signal_in') this.send('signal_out' + p.SelectedConnection, signal);
    else if (pin === (mux ? 'set_input' : 'set_output')) { const value = parseInt32(signal.value); if (value !== undefined) this.setProperty('SelectedConnection', value); }
    else if (pin === (mux ? 'move_input' : 'move_output')) {
      const value = parseInt32(signal.value); if (value === undefined) return;
      for (let i = 0; i < (p.SkipEmptyConnections ? this.connectionCount : 1); i++) {
        const sum = (p.SelectedConnection + value) | 0;
        this.setProperty('SelectedConnection', p.WrapAround ? ((sum % this.connectionCount) + this.connectionCount) % this.connectionCount : sum);
        if (this.environment.connected(this, (mux ? 'signal_in' : 'signal_out') + p.SelectedConnection)) break;
      }
    }
  }
  tickRegex() {
    const p = this.properties;
    if (this.timedOut) { this.send('signal_out', 'TIMEOUT'); return; }
    if (!p.Expression.trim() || !this.regex || !p.ContinuousOutput && this.nonContinuousSent) return;
    if (this.received !== this.previousReceived && this.received !== null) {
      try {
        const start = performance.now(), result = this.regex.match(this.received);
        this.timeoutsInARow = performance.now() - start > 1 ? this.timeoutsInARow + 1 : 0;
        if (this.timeoutsInARow >= 3) throw new RegexTimeout('Three consecutive slow matches');
        this.previousResult = result.success;
        this.previousGroups = p.UseCaptureGroup && result.success ? result.groups : null; this.previousReceived = this.received;
      } catch (error) {
        if (error instanceof RegexTimeout) this.timedOut = true; else this.send('signal_out', 'ERROR');
        this.previousResult = false; return;
      }
    }
    let value = p.FalseOutput, allowEmpty = false;
    if (this.previousResult) {
      if (!p.UseCaptureGroup) value = p.Output;
      else if (this.previousGroups?.has(p.Output)) { value = this.previousGroups.get(p.Output); allowEmpty = p.OutputEmptyCaptureGroup; }
    }
    if (value !== '' || allowEmpty) this.send('signal_out', value);
    if (!p.ContinuousOutput) this.nonContinuousSent = true;
  }
  tickOscillator(delta) {
    const p = this.properties;
    if (p.OutputType === 'Pulse') {
      if (p.Frequency <= 0) return;
      this.phase = f(this.phase + delta); const interval = f(1 / p.Frequency);
      while (this.phase >= interval) { this.send('signal_out', '1'); this.phase = f(this.phase - interval); }
      return;
    }
    if (!waves.includes(p.OutputType)) return;
    this.phase = f(f(this.phase + f(delta * p.Frequency)) % 1);
    const positivePhase = f(f(f(f(this.phase - f(0.25)) % 1) + 1) % 1);
    const triangle = f(f(4 * Math.abs(f(positivePhase - f(0.5)))) - 1);
    const value = p.OutputType === 'Sawtooth' ? fmt(this.phase) : p.OutputType === 'Square' ? this.phase < 0.5 ? '0' : '1'
      : p.OutputType === 'Sine' ? formatDouble(gameMath.sinDouble(f(this.phase * f(Math.PI * 2)))) : fmt(triangle);
    this.send('signal_out', value);
  }
}
function hsv(hue, saturation, value) {
  const c = f(value * saturation), h = f(gameClamp(hue, 0, 360) / 60), x = f(c * f(1 - Math.abs(f(f(h % 2) - 1))));
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h <= 1) { r = c; g = x; }
  else if (h <= 2 && h > 1) { r = x; g = c; }
  else if (h <= 3 && h > 2) { g = c; b = x; }
  else if (h <= 4 && h > 3) { g = x; b = c; }
  else if (h <= 5 && h > 4) { r = x; b = c; }
  else if (h <= 6 && h > 5) { r = c; b = x; }
  const m = f(value - c);
  return [r, g, b].map(v => gameClamp(int32(f(f(v + m) * 255)), 0, 255));
}
module.exports = { Component, defaults, hsv };
