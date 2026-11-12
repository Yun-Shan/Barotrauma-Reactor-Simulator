const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const reactorSource = fs.readFileSync(path.join(root, 'reactor.js'), 'utf8');
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
