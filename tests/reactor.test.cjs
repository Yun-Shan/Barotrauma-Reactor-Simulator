const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const reactorSource = fs.readFileSync(path.join(root, 'reactor.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const step = 1 / 60;

function createContext(globals = {}) {
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(`${reactorSource}\nglobalThis.ReactorForTest = Reactor; globalThis.FuelRodForTest = FuelRod;`, context);
  return context;
}

function approximately(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be close to ${expected}`);
}

function setRates(reactor, fission, turbine) {
  reactor.fissionRate = reactor.targetFissionRate = reactor.signal.in.fissionRate = fission;
  reactor.turbineOutput = reactor.targetTurbineOutput = reactor.signal.in.turbineOutput = turbine;
}

test('power is settled before the current frame changes temperature', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  reactor.fuelsContainer = [new FuelRod('uranium')];
  reactor.temperature = 10;
  setRates(reactor, 50, 20);

  reactor.update(step, 3000);

  approximately(reactor.signal.out.power, 600);
  assert.equal(reactor.temperature, 10.166666984558105);
  approximately(reactor.getPowerOutByLoad(3000), 610);
});

test('power uses the previous frame’s turbine tolerance when load changes', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  reactor.fuelsContainer = [new FuelRod('uranium'), new FuelRod('uranium')];
  reactor.temperature = 50;
  setRates(reactor, 32, 52.4);
  reactor.correctTurbineOutput = 50;
  reactor.optimalTurbineOutput = [47.5, 52.5];

  reactor.update(step, 0);

  approximately(reactor.signal.out.power, 1482);
  approximately(reactor.getPowerOutByLoad(0), 1542);
});

test('an exhausted rod contributes heat and fuel signal for its last frame only', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  const exhaustedRod = new FuelRod('uranium');
  exhaustedRod.durability = 0.0001;
  reactor.fuelsContainer = [exhaustedRod, new FuelRod('uranium')];
  reactor.temperature = 60;
  setRates(reactor, 50, 100);

  reactor.update(step, 3000);
  assert.equal(exhaustedRod.durability, 0);
  assert.equal(reactor.signal.out.allHeatPotential, 160);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 99);
  approximately(reactor.temperature, 60);

  reactor.update(step, 3000);
  assert.equal(exhaustedRod.durability, 0);
  assert.equal(reactor.signal.out.allHeatPotential, 80);
  assert.equal(reactor.temperature, 59.83333206176758);

  for (let i = 2; i < 6001; i++) reactor.update(step, 3000);
  assert.equal(exhaustedRod.durability, 0);
  approximately(reactor.fuelsContainer[1].durability, 90 - 1 / 600, 1e-8);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 89);
});

test('output signals truncate fractional values without changing internal load', () => {
  const { ReactorForTest: Reactor } = createContext();
  const reactor = new Reactor(5000, 0.2);
  reactor.temperature = 40;
  reactor.correctTurbineOutput = 50;
  reactor.getAllHeatPotential = () => 160.9;
  setRates(reactor, 0, 50);

  reactor.update(step, 2500.9);

  assert.equal(reactor.signal.out.power, 2500);
  assert.equal(reactor.signal.out.load, 2500);
  assert.equal(reactor.signal.out.allHeatPotential, 160);
  assert.equal(reactor.signal.out.temperature, 3983);
  assert.equal(reactor.correctTurbineOutput, 50.000301361083984);
  assert.ok(Object.values(reactor.signal.out).every(Number.isInteger));
});

test('fuel percentage sums all rods before truncation', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  const uranium = new FuelRod('uranium');
  const thorium = new FuelRod('thorium');
  uranium.durability = 33.8;
  thorium.durability = 133.6;
  reactor.fuelsContainer = [uranium, thorium];

  reactor.update(step, 0);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 100);

  uranium.durability = 100;
  thorium.durability = 200;
  reactor.update(step, 0);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 200);
});

test('a rod condition percentage is calculated in float32 before truncation', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  const uranium = new FuelRod('uranium');
  uranium.durability = 0.9999999403953552;
  reactor.fuelsContainer = [uranium];
  setRates(reactor, 0, 0);

  reactor.update(step, 0);
  assert.equal(uranium.durability, 0.9999999403953552);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 1);
  assert.equal(reactor.signal.out.allHeatPotential, 80);
});

test('fuel percentages are accumulated in float32 in slot order', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(3000, 0.2);
  const first = new FuelRod('uranium');
  const second = new FuelRod('uranium');
  first.durability = 33.79999923706055;
  second.durability = 66.19999694824219;
  reactor.fuelsContainer = [first, second];
  setRates(reactor, 0, 0);

  reactor.update(step, 0);
  assert.equal(reactor.signal.out.fuelRodDurabilityRate, 100);
});

test('negative generated load produces the same zero load signal as a single reactor', () => {
  const { ReactorForTest: Reactor } = createContext();
  const reactor = new Reactor(3000, 0.2);
  reactor.update(step, -100.9);
  assert.equal(reactor.signal.out.load, 0);
  assert.equal(reactor.correctTurbineOutput, 0);
});

test('float32 temperature crosses the power tolerance boundary on the same frame as the game', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(5000, 0.2);
  reactor.fuelsContainer = [new FuelRod('uranium')];
  setRates(reactor, 51, 40);

  for (let frame = 1; frame <= 240; frame++) reactor.update(step, 2000);
  assert.equal(reactor.temperature, 40.0000114440918);
  assert.equal(reactor.signal.out.temperature, 4000);
  assert.equal(reactor.signal.out.power, 2000);

  reactor.update(step, 1000);
  assert.equal(reactor.signal.out.temperature, 4016);
  assert.equal(reactor.signal.out.power, 1850);
});

test('steady minimum output is truncated after float32 power calculation', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(5000, 0.2);
  reactor.fuelsContainer = [new FuelRod('uranium')];
  setRates(reactor, 50, 40);

  for (let frame = 1; frame <= 245; frame++) reactor.update(step, 1000);
  assert.equal(reactor.temperature, 40);
  assert.equal(reactor.signal.out.temperature, 4000);
  assert.equal(reactor.signal.out.power, 1949);
});

test('power output retains the game ratio calculation and its float32 rounding', () => {
  const { ReactorForTest: Reactor } = createContext();
  const reactor = new Reactor(5000, 0.2);
  reactor.temperature = 34.17148;
  reactor.turbineOutput = 0.22962628;
  reactor.optimalTurbineOutput = [17.5, 22.5];

  const power = reactor.getPowerOutByLoad(1);
  assert.equal(power, 0.9999999403953552);
  assert.equal(Math.trunc(power), 0);
});

test('a collapsed output range stays finite at zero and positive power', () => {
  const { ReactorForTest: Reactor } = createContext();
  const reactor = new Reactor(5000, 0.2);

  assert.equal(reactor.getPowerOutByLoad(0), 0);
  assert.equal(reactor.getPowerOutByLoad(1000), 0);
  reactor.update(step, 0);
  assert.equal(reactor.signal.out.power, 0);
  reactor.update(step, 1000);
  assert.equal(reactor.signal.out.power, 0);

  reactor.temperature = 10;
  reactor.turbineOutput = 40;
  assert.equal(reactor.getPowerOutByLoad(0), 1000);
  assert.equal(reactor.getPowerOutByLoad(1000), 1000);
  assert.equal(reactor.getPowerOutByLoad(5000), 1000);
});

test('reactor inputs and load are converted to float32 before calculation', () => {
  const { ReactorForTest: Reactor, FuelRodForTest: FuelRod } = createContext();
  const reactor = new Reactor(5000, 0.2);
  reactor.fuelsContainer = [new FuelRod('uranium')];

  for (let frame = 1; frame <= 2; frame++) {
    reactor.signal.in.fissionRate = 0.1;
    reactor.signal.in.turbineOutput = 25.1;
    reactor.update(step, 999.99999);
  }

  assert.equal(reactor.targetFissionRate, 0.10000000149011612);
  assert.equal(reactor.targetTurbineOutput, 0.1666666716337204);
  assert.equal(reactor.signal.out.load, 1000);
});

test('out-of-range inputs, including infinities and float32 overflow, are clamped', () => {
  const { ReactorForTest: Reactor } = createContext();
  for (const [high, low] of [[150, -10], [Infinity, -Infinity], [1e39, -1e39]]) {
    const reactor = new Reactor(5000, 0.2);
    setRates(reactor, 50, 50);
    reactor.signal.in.fissionRate = high;
    reactor.signal.in.turbineOutput = low;

    reactor.update(step, 0);

    assert.equal(reactor.signal.in.fissionRate, 100);
    assert.equal(reactor.signal.in.turbineOutput, 0);
    assert.ok(reactor.targetFissionRate > 50);
    assert.ok(reactor.targetTurbineOutput < 50);
  }
});

test('power upgrade and engineer talent use the game float32 calculation order', () => {
  const { ReactorForTest: Reactor } = createContext();
  const reactor = new Reactor(3000, 0.2);
  reactor.upgradeLevelIncreaseReactorOutput = 2;
  reactor.hasTalentEngineerBuzzing = true;

  assert.equal(reactor.getMaxOutput(), 3497.999755859375);
});

test('changing one fuel slot does not refill the other rods', () => {
  const document = { formFuelRods: {
    fuelRod1: { value: '1' }, fuelRod2: { value: '2' },
    fuelRod3: { value: '3' }, fuelRod4: { value: '0' },
  } };
  const context = createContext({ document });
  const start = pageSource.indexOf('  function getFuelRodTypeList()');
  const end = pageSource.indexOf('  function handleBtnStart()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`let currentReactor;\n${pageSource.slice(start, end)}\nglobalThis.setReactor = value => currentReactor = value; globalThis.updateFuelRodsForTest = updateFuelRods;`, context);

  const reactor = new context.ReactorForTest(3000, 0.2);
  reactor.fuelsContainer = [new context.FuelRodForTest('uranium'), new context.FuelRodForTest('thorium'), new context.FuelRodForTest('fulgurium')];
  reactor.fuelsContainer[0].durability = 0;
  reactor.fuelsContainer[1].durability = 60;
  reactor.fuelsContainer[2].durability = 70;
  context.setReactor(reactor);

  document.formFuelRods.fuelRod2.value = '1';
  context.updateFuelRodsForTest();
  assert.equal(reactor.fuelsContainer[0].durability, 0);
  assert.equal(reactor.fuelsContainer[1].durability, 100);
  assert.equal(reactor.fuelsContainer[2].durability, 70);

  document.formFuelRods.fuelRod1.value = '0';
  context.updateFuelRodsForTest();
  document.formFuelRods.fuelRod1.value = '1';
  context.updateFuelRodsForTest();
  assert.equal(reactor.fuelsContainer[0].durability, 100);
  assert.equal(reactor.fuelsContainer[2].durability, 70);
});

function createPageCycle(tps, speed, renderCost = 0, control = signal => {
  signal.in.fissionRate = 0;
  signal.in.turbineOutput = 100;
}, signalDelay = 0) {
  const delays = [];
  const steps = [];
  const signals = [];
  const clock = { now: 0 };
  let powerData;
  const chart = { setOption() {} };
  const context = createContext({
    console: { log() {} },
    setTimeout: (_callback, delay) => { delays.push(delay); },
    performance: { now: () => clock.now },
    alert: message => { throw new Error(message); },
    powerLoadChart: { setOption: option => { powerData = option.series[0].data; } },
    fissionRateChart: chart, fissionRateGaugeChart: chart,
    turbineOutputChart: chart, turbineOutputGaugeChart: chart,
    temperatureChart: { setOption: () => { clock.now += renderCost; } },
  });
  const start = pageSource.indexOf('  function genRunCycleFn(');
  const end = pageSource.indexOf('\n  resetChartData();', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`let currentReactor; let currentCycleFn; let runFlag = true;\n${pageSource.slice(start, end)}\nglobalThis.createCycle = genRunCycleFn; globalThis.getReactor = () => currentReactor; globalThis.setActiveCycle = value => currentCycleFn = value;`, context);
  const cycle = context.createCycle(3000, false, 0, ['uranium'], 0, 100, tps, speed, signalDelay,
    signal => { control(signal); signals.push(signal); },
    deltaTime => { steps.push(deltaTime); return 3000; });
  context.setActiveCycle(cycle);
  return { cycle, delays, steps, signals, clock, getPowerData: () => powerData, getReactor: context.getReactor, retire: () => context.setActiveCycle(undefined) };
}

test('controller outputs must have number type, including for both inputs', () => {
  for (const field of ['fissionRate', 'turbineOutput']) {
    for (const value of ['50', null, undefined, true, {}, 1n]) {
      const run = createPageCycle(60, 1, 0, signal => {
        signal.in.fissionRate = 50;
        signal.in.turbineOutput = 50;
        signal.in[field] = value;
      });
      const message = field === 'fissionRate' ? /裂变速率输入必须为数字/ : /涡轮输出输入必须为数字/;
      assert.throws(() => run.cycle(), message);
    }
  }

});

test('NaN inputs are independently ignored while the other input keeps updating', () => {
  const commands = [[25, 40], [NaN, 70], [35, NaN], [NaN, NaN], [45, 55]];
  const expected = [[25, 40], [25, 70], [35, 70], [35, 70], [45, 55]];
  for (const signalDelay of [0, 2]) {
    let commandIndex = 0;
    const run = createPageCycle(60, 1, 0, signal => {
      [signal.in.fissionRate, signal.in.turbineOutput] = commands[commandIndex++];
    }, signalDelay);
    for (let i = 0; i < signalDelay; i++) run.cycle();

    for (const pair of expected) {
      run.cycle();
      const reactor = run.getReactor();
      assert.deepEqual([reactor.signal.in.fissionRate, reactor.signal.in.turbineOutput], pair);
      assert.ok(Number.isFinite(reactor.targetFissionRate));
      assert.ok(Number.isFinite(reactor.targetTurbineOutput));
    }
  }
});

test('controller accepts infinity and the reactor clamps it to the corresponding limit', () => {
  for (const [fission, turbine] of [[Infinity, -Infinity], [-Infinity, Infinity], [1e39, -1e39]]) {
    const run = createPageCycle(60, 1, 0, signal => {
      signal.in.fissionRate = fission;
      signal.in.turbineOutput = turbine;
    });
    const reactor = run.getReactor();
    setRates(reactor, 50, 50);

    run.cycle();
    assert.equal(reactor.signal.in.fissionRate, fission);
    assert.equal(reactor.signal.in.turbineOutput, turbine);
    run.cycle();
    assert.equal(reactor.targetFissionRate > 50, fission > 0);
    assert.equal(reactor.targetTurbineOutput > 50, turbine > 0);
  }
});

test('the controller receives settled power and updated temperature together', () => {
  const run = createPageCycle(60, 1);
  const reactor = run.getReactor();
  reactor.temperature = 10;
  setRates(reactor, 50, 20);
  run.cycle();
  approximately(run.signals[0].out.power, 600);
  assert.equal(run.signals[0].out.temperature, 1016);
});

test('lag changes the execution interval while every simulated frame remains 1/60 second', () => {
  const slow = createPageCycle(30, 1);
  const normal = createPageCycle(60, 1);
  for (let i = 0; i < 30; i++) {
    slow.cycle();
    normal.cycle();
    slow.clock.now += slow.delays.at(-1);
    normal.clock.now += normal.delays.at(-1);
  }

  assert.equal(slow.steps.length, 30);
  assert.ok(slow.steps.every(deltaTime => deltaTime === step));
  assert.ok(normal.steps.every(deltaTime => deltaTime === step));
  approximately(slow.delays[0], 1000 / 30);
  approximately(normal.delays[0], 1000 / 60);
  assert.equal(slow.getPowerData().length, 1200);
  approximately(slow.getPowerData().at(-1)[0], 0.5);
  approximately(slow.getReactor().temperature, normal.getReactor().temperature);
  approximately(slow.getReactor().signal.out.power, normal.getReactor().signal.out.power);
});

test('scheduled interval accounts for time spent updating charts', () => {
  const run = createPageCycle(30, 1, 8);
  run.cycle();
  approximately(run.delays[0], 1000 / 30 - 8);
  run.clock.now += run.delays[0];
  run.cycle();
  approximately(run.delays[1], 1000 / 30 - 8);
});

test('speed executes multiple fixed-length frames per scheduled cycle', () => {
  const run = createPageCycle(30, 3);
  run.cycle();
  assert.equal(run.steps.length, 3);
  assert.ok(run.steps.every(deltaTime => deltaTime === step));
  approximately(run.getPowerData().at(-1)[0], 3 / 60);
  approximately(run.delays[0], 1000 / 30);
});

test('a previous cycle cannot continue after reset and restart', () => {
  const run = createPageCycle(30, 1);
  run.cycle();
  run.retire();
  run.cycle();
  assert.equal(run.steps.length, 1);
  assert.equal(run.delays.length, 1);
});
