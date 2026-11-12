(function (root) {
  'use strict';

  const reactorTypes = typeof module !== 'undefined' && module.exports
    ? require('./reactor.js')
    : { Reactor, FuelRod, FuelRodType };
  const { Reactor: ReactorModel, FuelRod: FuelRodModel, FuelRodType: fuelRodTypes } = reactorTypes;
  const math = typeof module !== 'undefined' && module.exports
    ? require('./game-math.js')
    : gameMath;

  // 游戏时间每帧固定推进 1/60 秒；帧率和倍速只改变现实时间中的执行频率。
  const LOGIC_STEP = 1 / 60;
  const HISTORY_LENGTH = 60 * 20;

  function compileUserCode(context, code) {
    context.console = console;
    // gameMath 和页面上的普通全局变量一样可以被用户代码中的局部声明遮蔽。
    const create = new Function('gameMath',
      `return function (${Object.keys(context).join(',')}) { 'use strict';\n${code}\n}`);
    return create(math).bind(context);
  }

  function createHistory() {
    const names = [
      'power', 'load', 'fissionSignal', 'fissionTarget', 'fissionActual',
      'turbineSignal', 'turbineTarget', 'turbineActual', 'temperature',
    ];
    return Object.fromEntries(names.map(name => [name,
      Array.from({ length: HISTORY_LENGTH }, (_, i) => [(i - HISTORY_LENGTH + 1) * LOGIC_STEP, 0]),
    ]));
  }

  /**
   * 管理反应堆和模拟周期，不依赖 DOM。
   * onUpdate 接收历史数据及裂变、涡轮仪表状态；onError 处理运行时错误。
   */
  class SimulationController {
    constructor({ onUpdate = () => {}, onError = error => { throw error; },
      now = () => performance.now(), schedule = (fn, delay) => setTimeout(fn, delay),
      cancel = id => clearTimeout(id) } = {}) {
      this.onUpdate = onUpdate;
      this.onError = onError;
      this.now = now;
      this.schedule = schedule;
      this.cancel = cancel;
      this.running = false;
      this.generation = 0;
      this.timeoutId = undefined;
      this.reactor = undefined;
    }

    /**
     * 创建反应堆并立即执行首轮模拟；已运行时返回 false。
     * tps 是每现实秒的目标周期数，speed 是每周期的逻辑帧数，signalDelay 以逻辑帧计。
     * 负载生成和信号处理代码各有独立的 memory；编译错误直接抛出。
     * 运行时错误交给 onError，之后需 reset 才能重新启动。
     */
    start(options) {
      if (this.running) return false;

      const loadContext = { memory: {}, deltaTime: 0, output: { load: 0 } };
      const actionContext = { memory: {}, signal: {} };
      let loadEval;
      let actionEval;
      try {
        loadEval = compileUserCode(loadContext, options.loadFormula);
      } catch (error) {
        throw new Error(`编译负载生成代码时发生异常：${String(error)}`);
      }
      try {
        actionEval = compileUserCode(actionContext, options.actionCode);
      } catch (error) {
        throw new Error(`编译信号处理代码时发生异常：${String(error)}`);
      }

      this.loadFn = deltaTime => {
        loadContext.deltaTime = deltaTime;
        loadEval(...Object.values(loadContext));
        return loadContext.output.load;
      };
      this.actionFn = signal => {
        actionContext.signal = signal;
        actionEval(...Object.values(actionContext));
      };

      const reactor = new ReactorModel(options.baseMaxPowerOutput, 0.2);
      reactor.hasTalentEngineerBuzzing = options.hasTalentEngineerBuzzing;
      reactor.upgradeLevelIncreaseReactorOutput = options.upgradeLevelIncreaseReactorOutput;
      reactor.fissionRate = reactor.targetFissionRate = reactor.signal.in.fissionRate = options.initFissionRate;
      reactor.turbineOutput = reactor.targetTurbineOutput = reactor.signal.in.turbineOutput = options.initTurbineOutput;
      this.reactor = reactor;
      this.setFuelRods(options.fuelTypeNames);

      this.elapsed = 0;
      this.history = createHistory();
      this.signalBuffer = [];
      this.signalDelay = options.signalDelay;
      this.speed = options.speed;
      this.intervalTime = 1000 / options.tps;
      this.nextCycleTime = this.now();
      this.running = true;
      const generation = ++this.generation;
      this.runCycle(generation);
      return true;
    }

    /** 更新四个燃料槽；相同类型保留原有耐久，清空后再放入才能更换同类燃料棒。 */
    setFuelRods(typeNames) {
      if (!this.reactor) return;
      for (let i = 0; i < 4; i++) {
        const type = typeNames[i];
        const current = this.reactor.fuelsContainer[i];
        if (type && fuelRodTypes[type]) {
          if (!current || current.typeName !== type) this.reactor.fuelsContainer[i] = new FuelRodModel(type);
        } else if (current) {
          this.reactor.fuelsContainer[i] = undefined;
        }
      }
    }

    reset() {
      this.running = false;
      this.generation++;
      if (this.timeoutId !== undefined) this.cancel(this.timeoutId);
      this.timeoutId = undefined;
      this.reactor = undefined;
      this.history = undefined;
      this.signalBuffer = undefined;
      this.loadFn = undefined;
      this.actionFn = undefined;
    }

    updateFrame() {
      this.elapsed += LOGIC_STEP;
      let load;
      try {
        load = this.loadFn(LOGIC_STEP);
      } catch (error) {
        throw new Error(`执行负载生成代码时发生异常：${String(error)}`);
      }

      const reactor = this.reactor;
      reactor.update(LOGIC_STEP, load);
      const values = {
        power: reactor.signal.out.power,
        load,
        fissionSignal: reactor.signal.in.fissionRate,
        fissionTarget: reactor.targetFissionRate,
        fissionActual: reactor.fissionRate,
        turbineSignal: reactor.signal.in.turbineOutput,
        turbineTarget: reactor.targetTurbineOutput,
        turbineActual: reactor.turbineOutput,
        temperature: reactor.temperature * 100,
      };
      for (const [name, value] of Object.entries(values)) {
        this.history[name].shift();
        this.history[name].push([this.elapsed, value]);
      }

      this.signalBuffer.push(JSON.parse(JSON.stringify(reactor.signal)));
      if (this.signalBuffer.length > this.signalDelay) {
        const signal = this.signalBuffer.shift();
        try {
          this.actionFn(signal);
        } catch (error) {
          throw new Error(`执行信号处理代码时发生异常：${String(error)}`);
        }
        const { fissionRate, turbineOutput } = signal.in;
        if (typeof fissionRate !== 'number') throw new Error('裂变速率输入必须为数字');
        if (typeof turbineOutput !== 'number') throw new Error('涡轮输出输入必须为数字');
        // NaN 表示没有有效信号；其他数字由反应堆在下一帧限幅。
        if (!Number.isNaN(fissionRate)) reactor.signal.in.fissionRate = fissionRate;
        if (!Number.isNaN(turbineOutput)) reactor.signal.in.turbineOutput = turbineOutput;
      }
    }

    runCycle(generation) {
      if (!this.running || this.generation !== generation) return;
      try {
        for (let i = 0; i < this.speed; i++) this.updateFrame();
        const reactor = this.reactor;
        this.onUpdate({
          history: this.history,
          fission: { allowed: reactor.allowedFissionRate, optimal: reactor.optimalFissionRate, target: reactor.targetFissionRate },
          turbine: { allowed: reactor.allowedTurbineOutput, optimal: reactor.optimalTurbineOutput, target: reactor.targetTurbineOutput },
        });
        if (!this.running || this.generation !== generation) return;
        // 计入计算和界面更新耗时，避免每轮额外等待完整的帧间隔。
        const currentTime = this.now();
        this.nextCycleTime = Math.max(this.nextCycleTime + this.intervalTime, currentTime);
        this.timeoutId = this.schedule(() => {
          if (this.generation !== generation) return;
          this.timeoutId = undefined;
          this.runCycle(generation);
        }, this.nextCycleTime - currentTime);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { SimulationController };
  else root.SimulationController = SimulationController;
})(globalThis);
