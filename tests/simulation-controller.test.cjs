const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { SimulationController } = require('../simulation-controller.js');

const step = 1 / 60;
const defaults = {
  baseMaxPowerOutput: 3000,
  hasTalentEngineerBuzzing: false,
  upgradeLevelIncreaseReactorOutput: 0,
  fuelTypeNames: ['uranium'],
  initFissionRate: 0,
  initTurbineOutput: 100,
  tps: 60,
  speed: 1,
  signalDelay: 0,
  loadFormula: 'output.load = 3000;',
  actionCode: 'signal.in.fissionRate = 0; signal.in.turbineOutput = 100;',
};

function createRun(options = {}, renderCost = 0) {
  const clock = { now: 0 };
  const scheduled = [];
  const updates = [];
  const errors = [];
  const controller = new SimulationController({
    now: () => clock.now,
    schedule: (fn, delay) => {
      const task = { fn, delay, cancelled: false, used: false };
      scheduled.push(task);
      return task;
    },
    cancel: task => { task.cancelled = true; },
    onUpdate: state => { updates.push(state); clock.now += renderCost; },
    onError: error => { errors.push(error); },
  });
  const run = {
    controller, clock, scheduled, updates, errors,
    start: overrides => controller.start({ ...defaults, ...options, ...overrides }),
    tick: () => {
      const task = scheduled.find(item => !item.used && !item.cancelled);
      assert.ok(task, 'expected a scheduled cycle');
      task.used = true;
      clock.now += task.delay;
      task.fn();
    },
  };
  run.start();
  return run;
}

function approximately(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be close to ${expected}`);
}

function setRates(reactor, fission, turbine) {
  reactor.fissionRate = reactor.targetFissionRate = reactor.signal.in.fissionRate = fission;
  reactor.turbineOutput = reactor.targetTurbineOutput = reactor.signal.in.turbineOutput = turbine;
}

test('classic browser scripts load in order and user code can access gameMath', () => {
  const context = vm.createContext({ console, performance: { now: () => 0 }, setTimeout: () => 1 });
  for (const file of ['game-math.js', 'reactor.js', 'simulation-controller.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  context.options = {
    ...defaults,
    loadFormula: 'output.load = gameMath.add(10, 0.1);',
    actionCode: 'signal.in.fissionRate = gameMath.round(2.5); signal.in.turbineOutput = 100;',
  };
  vm.runInContext('globalThis.testController = new SimulationController(); testController.start(options);', context);
  assert.equal(context.testController.reactor.signal.out.load, 10);
  assert.equal(context.testController.reactor.signal.in.fissionRate, 2);
});

test('changing one fuel slot does not refill the other rods', () => {
  const run = createRun({ fuelTypeNames: ['uranium', 'thorium', 'fulgurium'] });
  const reactor = run.controller.reactor;
  reactor.fuelsContainer[0].durability = 0;
  reactor.fuelsContainer[1].durability = 60;
  reactor.fuelsContainer[2].durability = 70;

  run.controller.setFuelRods(['uranium', 'uranium', 'fulgurium']);
  assert.equal(reactor.fuelsContainer[0].durability, 0);
  assert.equal(reactor.fuelsContainer[1].durability, 100);
  assert.equal(reactor.fuelsContainer[2].durability, 70);

  run.controller.setFuelRods([undefined, 'uranium', 'fulgurium']);
  run.controller.setFuelRods(['uranium', 'uranium', 'fulgurium']);
  assert.equal(reactor.fuelsContainer[0].durability, 100);
  assert.equal(reactor.fuelsContainer[2].durability, 70);
});

test('controller outputs must have number type, including for both inputs', () => {
  for (const field of ['fissionRate', 'turbineOutput']) {
    for (const expression of ["'50'", 'null', 'undefined', 'true', '({})', '1n']) {
      const run = createRun({ actionCode: `
        signal.in.fissionRate = 50;
        signal.in.turbineOutput = 50;
        signal.in.${field} = ${expression};
      ` });
      const message = field === 'fissionRate' ? /裂变速率输入必须为数字/ : /涡轮输出输入必须为数字/;
      assert.equal(run.errors.length, 1);
      assert.match(run.errors[0].message, message);
      assert.equal(run.scheduled.length, 0);
    }
  }
});

test('NaN inputs are independently ignored while the other input keeps updating', () => {
  const actionCode = `
    const commands = [[25, 40], [NaN, 70], [35, NaN], [NaN, NaN], [45, 55]];
    [signal.in.fissionRate, signal.in.turbineOutput] = commands[memory.index || 0];
    memory.index = (memory.index || 0) + 1;
  `;
  const expected = [[25, 40], [25, 70], [35, 70], [35, 70], [45, 55]];
  for (const signalDelay of [0, 2]) {
    const run = createRun({ actionCode, signalDelay });
    for (let i = 0; i < signalDelay; i++) run.tick();
    for (let i = 0; i < expected.length; i++) {
      const reactor = run.controller.reactor;
      assert.deepEqual([reactor.signal.in.fissionRate, reactor.signal.in.turbineOutput], expected[i]);
      assert.ok(Number.isFinite(reactor.targetFissionRate));
      assert.ok(Number.isFinite(reactor.targetTurbineOutput));
      if (i < expected.length - 1) run.tick();
    }
    assert.equal(run.errors.length, 0);
  }
});

test('controller accepts infinity and the reactor clamps it to the corresponding limit', () => {
  for (const [fission, turbine] of [[Infinity, -Infinity], [-Infinity, Infinity], [1e39, -1e39]]) {
    const run = createRun({
      initFissionRate: 50, initTurbineOutput: 50,
      actionCode: `signal.in.fissionRate = ${fission}; signal.in.turbineOutput = ${turbine};`,
    });
    const reactor = run.controller.reactor;
    assert.equal(reactor.signal.in.fissionRate, fission);
    assert.equal(reactor.signal.in.turbineOutput, turbine);
    run.tick();
    assert.equal(reactor.targetFissionRate > 50, fission > 0);
    assert.equal(reactor.targetTurbineOutput > 50, turbine > 0);
  }
});

test('the controller passes settled power and updated temperature together to user code', () => {
  const run = createRun({ actionCode: 'signal.in.fissionRate = signal.out.power; signal.in.turbineOutput = signal.out.temperature;' });
  const reactor = run.controller.reactor;
  reactor.temperature = 10;
  setRates(reactor, 50, 20);
  run.tick();
  assert.equal(reactor.signal.in.fissionRate, 600);
  assert.equal(reactor.signal.in.turbineOutput, 1016);
});

test('lag changes the execution interval while every simulated frame remains 1/60 second', () => {
  const slow = createRun({ tps: 30 });
  const normal = createRun({ tps: 60 });
  for (let i = 1; i < 30; i++) {
    slow.tick();
    normal.tick();
  }
  approximately(slow.scheduled[0].delay, 1000 / 30);
  approximately(normal.scheduled[0].delay, 1000 / 60);
  assert.equal(slow.updates.at(-1).history.power.length, 1200);
  approximately(slow.updates.at(-1).history.power.at(-1)[0], 0.5);
  approximately(slow.controller.reactor.temperature, normal.controller.reactor.temperature);
  approximately(slow.controller.reactor.signal.out.power, normal.controller.reactor.signal.out.power);
});

test('scheduled interval accounts for time spent updating charts', () => {
  const run = createRun({ tps: 30 }, 8);
  approximately(run.scheduled[0].delay, 1000 / 30 - 8);
  run.tick();
  approximately(run.scheduled[1].delay, 1000 / 30 - 8);
});

test('speed executes multiple fixed-length frames per scheduled cycle', () => {
  const run = createRun({ tps: 30, speed: 3, loadFormula: 'memory.time = (memory.time || 0) + deltaTime; output.load = memory.time;' });
  approximately(run.updates[0].history.load.at(-1)[1], 3 * step);
  approximately(run.updates[0].history.power.at(-1)[0], 3 * step);
  approximately(run.scheduled[0].delay, 1000 / 30);
});

test('a previous cycle cannot continue after reset and restart', () => {
  const run = createRun({ tps: 30 });
  const previous = run.scheduled[0];
  run.controller.reset();
  assert.equal(previous.cancelled, true);
  run.start();
  const reactor = run.controller.reactor;
  const elapsed = run.controller.elapsed;
  const count = run.scheduled.length;
  previous.fn();
  assert.equal(run.controller.reactor, reactor);
  assert.equal(run.controller.elapsed, elapsed);
  assert.equal(run.scheduled.length, count);
});

test('user scripts have separate memory, gameMath access, and fresh memory after reset', () => {
  const run = createRun({
    loadFormula: 'memory.n = (memory.n || 0) + 1; output.load = gameMath.add(memory.n, 0.1);',
    actionCode: 'memory.n = (memory.n || 0) + 1; signal.in.fissionRate = gameMath.round(memory.n + 1.5); signal.in.turbineOutput = gameMath.sin(90) * 100;',
  });
  assert.equal(run.controller.reactor.signal.out.load, 1);
  assert.equal(run.controller.reactor.signal.in.fissionRate, 2);
  assert.equal(run.controller.reactor.signal.in.turbineOutput, 100);
  run.tick();
  assert.equal(run.controller.reactor.signal.out.load, 2);
  assert.equal(run.controller.reactor.signal.in.fissionRate, 4);
  run.controller.reset();
  run.start();
  assert.equal(run.controller.reactor.signal.out.load, 1);
  assert.equal(run.controller.reactor.signal.in.fissionRate, 2);
});

test('script compilation failures leave the controller ready for another start', () => {
  const run = createRun();
  run.controller.reset();
  assert.throws(() => run.start({ loadFormula: 'not valid ! code' }), /编译负载生成代码时发生异常/);
  assert.equal(run.controller.running, false);
  assert.throws(() => run.start({ actionCode: 'not valid ! code' }), /编译信号处理代码时发生异常/);
  assert.equal(run.controller.running, false);
  assert.equal(run.start(), true);
  assert.equal(run.errors.length, 0);
});

test('runtime errors identify which user script failed and do not schedule more work', () => {
  for (const [options, message] of [
    [{ loadFormula: "throw new Error('load');" }, /执行负载生成代码时发生异常.*load/],
    [{ actionCode: "throw new Error('action');" }, /执行信号处理代码时发生异常.*action/],
  ]) {
    const run = createRun(options);
    assert.equal(run.errors.length, 1);
    assert.match(run.errors[0].message, message);
    assert.equal(run.scheduled.length, 0);
    run.controller.reset();
    assert.equal(run.controller.running, false);
  }
});
