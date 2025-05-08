type Range = {
  min: number;
  max: number;
};

function adjustValueWithoutOverShooting(current: number, target: number, speed: number): number {
  return target < current ? Math.max(target, current - speed) : Math.min(target, current + speed);
}

function Lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function Clamp(value: number, left: number, right: number): number {
  if (left > right) throw Error('left should less than right');
  if (value < left) {
    return left;
  } else if (value > right) {
    return right;
  } else {
    return value;
  }
}

function Sign(value: number): number {
  if (value > 0) return 1;
  else if (value < 0) return -1;
  else return 0;
}

const gameTimingStep = 1 / 60;

export type FuelRodType = {
  type: string;
  durability: number;
  heatPotential: number;
};

export const FuelRodTypes = {
  uranium: {type: 'uranium', durability: 100, heatPotential: 80},
  thorium: {type: 'thorium', durability: 200, heatPotential: 80},
  fulgurium: {type: 'fulgurium', durability: 150, heatPotential: 150},
} satisfies Record<string, FuelRodType>;

export class FuelRod {
  public readonly type: FuelRodType;
  public currentDurability: number;

  constructor(type: FuelRodType) {
    this.type = type;
  }
}

export class ReactorSimulator {
  public reactorWrapper: ReactorWrapper = new ReactorWrapper();

  /**
   * 逻辑帧率
   */
  public logicFPS = 60;
  public loadFn: (memory: Record<string, unknown>, deltaTime: number, totalTime: number) => void;
  public controllerFn: (memory: Record<string, unknown>, input: Record<string, string>, output: Record<string, string>, deltaTime: number, totalTime: number) => void;

  private upgradeLevelIncreaseReactorOutput = 0;
  private engineerBuzzingTalentCount = 0;

  public setUpgradeLevelIncreaseReactorOutput(level: number) {
    this.upgradeLevelIncreaseReactorOutput = level;
    this.updateReactorUpgradeFactor();
  }

  public setEngineerBuzzingTalentCount(count: number) {
    this.engineerBuzzingTalentCount = count;
    this.updateReactorUpgradeFactor();
  }

  private updateReactorUpgradeFactor() {
    let factor = 1 + this.upgradeLevelIncreaseReactorOutput * 0.03;
    let counter = this.engineerBuzzingTalentCount;
    while (counter > 0) {
      factor *= 1.1;
      counter--;
    }
    this.reactorWrapper.reactor.maxPowerOutputFactor = factor;
  }

  // 负载生成使用的内存
  public loadMemory: Record<string, unknown> = {};
  // 反应堆控制组件使用的内存
  public controllerMemory: Record<string, unknown> = {};

  private taskId: number;

  public start(speed: number) {
    this.stop(); // 先调用一次停止，避免资源泄露
    const logicFn = () => {
      try {
        this.loadFn(this.loadMemory, gameTimingStep, this.reactorWrapper.totalTime);
        let load = parseInt(String(this.loadMemory.load));
        if (load == Infinity || !(load >= 0)) load = 0;
        this.reactorWrapper.setLoad(load);
      } catch (e) {
        // TODO tip: update load
        this.stop();
        throw e;
      }
      try {
        this.reactorWrapper.update((input, output) => {
          this.controllerFn(this.controllerMemory, input, output, gameTimingStep, this.reactorWrapper.totalTime);
        });
      } catch (e) {
        // TODO tip: update reactor
        this.stop();
        throw e;
      }
    };
    this.taskId = setInterval(() => {
      for (let i = 0; i < speed; i++) {
        logicFn();
        // TODO 每次更新之后提交数据
      }
      // TODO 提交完所有数据后再批量更新图表
    }, 1000 / this.logicFPS);
  }

  public stop() {
    if (this.taskId) {
      clearInterval(this.taskId);
      this.taskId = undefined;
    }
  }
}

export class ReactorWrapper {
  public reactor = new Reactor(this);

  public outputSignal: Record<string, string> = {};

  // 最大耐久
  public maxDurability = 0;
  // 当前耐久
  public currentDurability = 0;
  // 燃料棒列表
  public fuels: FuelRod[] = [];

  // 运行时间
  public totalTime = 0;

  public setLoad(load: number) {
    this.reactor.Load = load;
  }

  public setAvailableFuel(availableFuel: number) {
    this.reactor.AvailableFuel = availableFuel;
  }

  public setAutoTemp(autoTemp: boolean) {
    this.reactor.autoTemp = autoTemp;
  }

  /**
   * 实际应该调用的更新函数
   * <p>
   * 模拟游戏内实际的计算过程，先计算电网再计算物品。但是信号组件更新顺序暂时无法模拟，所以暂时用反应堆-信号逻辑-反应堆-信号逻辑这样交替更新
   *
   * @param controllerFn 控制函数
   */
  public update(controllerFn: (input: Record<string, string>, output: Record<string, string>) => void) {
    this.totalTime += gameTimingStep;
    this.reactor.GetConnectionPowerOut(this.reactor.MinMaxPowerOut(), this.reactor.Load);
    this.reactor.update(gameTimingStep, this.totalTime);
    const inputSignal = {};
    controllerFn(this.outputSignal, inputSignal);
    for (const key in inputSignal) {
      this.reactor.ReceiveSignal(inputSignal[key], key, this.totalTime);
    }
  }

  public internalSendSignal(signal: string, connection: string) {
    this.outputSignal[signal] = connection;
  }

}


export class Reactor {

  //the rate at which the reactor is being run on (higher rate -> higher temperature)
  public fissionRate: number;
  //how much of the generated steam is used to spin the turbines and generate power
  public turbineOutput: number;
  // Current temperature of the reactor (0% - 100%)
  public temperature: number;

  //is automatic temperature control on
  //(adjusts the fission rate and turbine output automatically to keep the
  //amount of power generated balanced with the load)
  public autoTemp: boolean;

  public maxPowerOutput: number;
  public maxPowerOutputFactor: number = 1;
  public fuelConsumptionRate: number;

  private meltDownTimer: number;
  private meltDownDelay: number;
  private fireTimer: number;
  private fireDelay: number;

  private minUpdatePowerOut: number;
  private maxUpdatePowerOut: number;
  private currPowerConsumption: number;

  // region 这一块主要用于画图和内置自动控制

  public optimalTemperature: Range;
  public allowedTemperature: Range;
  public optimalFissionRate: Range;
  public allowedFissionRate: Range;
  public optimalTurbineOutput: Range;
  public allowedTurbineOutput: Range;

  // endregion

  private signalControlledTargetFissionRate: number | undefined;
  private signalControlledTargetTurbineOutput: number | undefined;
  private lastReceivedFissionRateSignalTime: number;
  private lastReceivedTurbineOutputSignalTime: number;

  private prevAvailableFuel: number;

  /**
   * 每次燃料棒更新的时候从外部设置
   */
  public AvailableFuel: number;
  /**
   * 外部设置负载
   */
  public Load: number;

  public TargetFissionRate: number;
  public TargetTurbineOutput: number;
  private CorrectTurbineOutput: number;


  private readonly wrapper: ReactorWrapper;

  constructor(wrapper: ReactorWrapper) {
    this.wrapper = wrapper;
  }


  public update(deltaTime: number, totalTime: number): void {
    //rapidly adjust the reactor in the first few seconds of the round to prevent overvoltages if the load changed between rounds
    //(unless the reactor is being operated by a player)
    if (totalTime < 5) {
      this.UpdateAutoTemp(100.0, gameTimingStep * 10.0);
    }


    const maxPowerOut = this.GetMaxOutput();

    if (this.signalControlledTargetFissionRate !== undefined && this.lastReceivedFissionRateSignalTime > totalTime - 1) {
      this.TargetFissionRate = adjustValueWithoutOverShooting(this.TargetFissionRate, this.signalControlledTargetFissionRate, deltaTime * 5.0);
    } else {
      this.signalControlledTargetFissionRate = undefined;
    }
    if (this.signalControlledTargetTurbineOutput !== undefined && this.lastReceivedTurbineOutputSignalTime > totalTime - 1) {
      this.TargetTurbineOutput = adjustValueWithoutOverShooting(this.TargetTurbineOutput, this.signalControlledTargetTurbineOutput, deltaTime * 5.0);
    } else {
      this.signalControlledTargetTurbineOutput = undefined;
    }


    this.prevAvailableFuel = this.AvailableFuel;

    //use a smoothed "correct output" instead of the actual correct output based on the load
    //so the player doesn't have to keep adjusting the rate impossibly fast when the load fluctuates heavily
    this.CorrectTurbineOutput += Clamp((this.Load / maxPowerOut * 100.0) - this.CorrectTurbineOutput, -20.0, 20.0) * deltaTime;

    //calculate tolerances of the meters based on the skills of the user
    //more skilled characters have larger "sweet spots", making it easier to keep the power output at a suitable level
    let tolerance = 2.5;
    this.optimalTurbineOutput = {min: this.CorrectTurbineOutput - tolerance, max: this.CorrectTurbineOutput + tolerance};
    tolerance = 5.0;
    this.allowedTurbineOutput = {min: this.CorrectTurbineOutput - tolerance, max: this.CorrectTurbineOutput + tolerance};

    this.optimalTemperature = {min: 40.0, max: 60.0};
    this.allowedTemperature = {min: 30.0, max: 70.0};

    this.optimalFissionRate = {min: 30, max: this.AvailableFuel - 20};
    this.optimalFissionRate.min = Math.min(this.optimalFissionRate.min, this.optimalFissionRate.max - 10);
    this.allowedFissionRate = {min: 20, max: this.AvailableFuel};
    this.allowedFissionRate.min = Math.min(this.allowedFissionRate.min, this.allowedFissionRate.max - 10);

    const heatAmount = this.GetGeneratedHeat(this.fissionRate);

    const temperatureDiff = (heatAmount - this.turbineOutput) - this.temperature;
    this.temperature += Clamp(Sign(temperatureDiff) * 10.0 * deltaTime, -Math.abs(temperatureDiff), Math.abs(temperatureDiff));
    this.fissionRate = Lerp(this.fissionRate, Math.min(this.TargetFissionRate, this.AvailableFuel), deltaTime);
    this.turbineOutput = Lerp(this.turbineOutput, this.TargetTurbineOutput, deltaTime);

    if (this.autoTemp) {
      this.UpdateAutoTemp(2.0, deltaTime);
    }


    let fuelLeft = 0.0;
    for (const item of this.wrapper.fuels) {
      if (this.fissionRate > 0.0) {
        item.currentDurability -= this.fissionRate / 100.0 * this.GetFuelConsumption() * deltaTime;
      }
      fuelLeft += (item.currentDurability / item.type.durability);
    }

    this.wrapper.internalSendSignal(String(Math.floor(this.temperature * 100.0)), 'temperature_out');
    this.wrapper.internalSendSignal(String(Math.floor(-this.currPowerConsumption)), 'power_value_out');
    this.wrapper.internalSendSignal(String(Math.floor(this.Load)), 'load_value_out');
    this.wrapper.internalSendSignal(String(Math.floor(this.AvailableFuel)), 'fuel_out');
    this.wrapper.internalSendSignal(String(Math.floor(fuelLeft)), 'fuel_percentage_left');

    this.UpdateFailures(deltaTime);
    this.AvailableFuel = 0.0;
  }


  /**
   * Determine how much power to output based on the load. The load is divided between reactors according to their maximum output in multi-reactor setups.
   **/
  public GetConnectionPowerOut(minMaxPower: Range, load: number) {
    //Load must be calculated at this stage instead of at gridResolved to remove influence of lower priority devices
    const loadLeft = Math.max(load, 0);

    //Delta ratio of Min and Max power output capability of the grid
    let ratio = Math.max((loadLeft - minMaxPower.min) / (minMaxPower.max - minMaxPower.min), 0);
    if (ratio == Infinity || isNaN(ratio)) {
      ratio = 0;
    }

    const output = Clamp(ratio * (this.maxUpdatePowerOut - this.minUpdatePowerOut) + this.minUpdatePowerOut, this.minUpdatePowerOut, this.maxUpdatePowerOut);
    let newLoad = loadLeft;
    if (newLoad < 0) {
      newLoad = 0.0;
    }

    this.Load = newLoad;
    this.currPowerConsumption = -output;
    return output;
  }

  /**
   * Min and Max power output of the reactor based on tolerance
   **/
  public MinMaxPowerOut(): Range {
    let tolerance = 1;

    //If within the optimal output allow for slight output adjustments
    if (this.turbineOutput > this.optimalTurbineOutput.min && this.turbineOutput < this.optimalTurbineOutput.max &&
      this.temperature > this.optimalTemperature.min && this.temperature < this.optimalTemperature.max) {
      tolerance = 3;
    }

    let maxPowerOut = this.GetMaxOutput();

    let temperatureFactor = Math.min(this.temperature / 50.0, 1.0);
    let minOutput = maxPowerOut * Clamp(Math.min((this.turbineOutput - tolerance) / 100.0, temperatureFactor), 0, 1);
    let maxOutput = maxPowerOut * Math.min((this.turbineOutput + tolerance) / 100.0, temperatureFactor);

    this.minUpdatePowerOut = minOutput;
    this.maxUpdatePowerOut = maxOutput;

    return {min: minOutput, max: maxOutput};
  }

  private GetGeneratedHeat(fissionRate: number): number {
    return fissionRate * (this.prevAvailableFuel / 100.0) * 2.0;
  }

  private UpdateFailures(deltaTime: number): void {
    if (this.temperature > this.allowedTemperature.max) {
      this.wrapper.internalSendSignal('1', 'meltdown_warning');
      //faster meltdown if the item is in a bad condition
      this.meltDownTimer += Lerp(deltaTime * 2.0, deltaTime, this.wrapper.currentDurability / this.wrapper.maxDurability);
      if (this.meltDownTimer > this.meltDownDelay) {
        this.MeltDown();
        return;
      }
    } else {
      this.wrapper.internalSendSignal('0', 'meltdown_warning');
      this.meltDownTimer = Math.max(0.0, this.meltDownTimer - deltaTime);
    }

    if (this.temperature > this.optimalTemperature.max) {
      this.fireTimer += Lerp(deltaTime * 2.0, deltaTime, this.wrapper.currentDurability / this.wrapper.maxDurability);
      if (this.fireTimer >= this.fireDelay) {
        // new FireSource(item.WorldPosition);
        // TODO 着火事件
        this.fireTimer = 0.0;
      }
    } else {
      this.fireTimer = Math.max(0.0, this.fireTimer - deltaTime);
    }
  }

  public UpdateAutoTemp(speed: number, deltaTime: number): void {
    const desiredTurbineOutput = (this.optimalTurbineOutput.min + this.optimalTurbineOutput.max) / 2.0;
    this.TargetTurbineOutput += Clamp(desiredTurbineOutput - this.TargetTurbineOutput, -speed, speed) * deltaTime;
    this.TargetTurbineOutput = Clamp(this.TargetTurbineOutput, 0.0, 100.0);

    const desiredFissionRate = (this.optimalFissionRate.min + this.optimalFissionRate.max) / 2.0;
    this.TargetFissionRate += Clamp(desiredFissionRate - this.TargetFissionRate, -speed, speed) * deltaTime;

    if (this.temperature > (this.optimalTemperature.min + this.optimalTemperature.max) / 2.0) {
      this.TargetFissionRate = Math.min(this.TargetFissionRate - speed * 2 * deltaTime, this.allowedFissionRate.max);
    } else if (-this.currPowerConsumption < this.Load) {
      this.TargetFissionRate = Math.min(this.TargetFissionRate + speed * 2 * deltaTime, 100.0);
    }
    this.TargetFissionRate = Clamp(this.TargetFissionRate, 0.0, 100.0);

    //don't push the target too far from the current fission rate
    //otherwise we may "overshoot", cranking the target fission rate all the way up because it takes a while
    //for the actual fission rate and temperature to follow
    this.TargetFissionRate = Clamp(this.TargetFissionRate, this.fissionRate - 5, this.fissionRate + 5);
  }

  private MeltDown(): void {
    // TODO 熔毁事件
    this.fireTimer = 0.0;
    this.meltDownTimer = 0.0;
  }

  public ReceiveSignal(signal: string, connection: string, totalTime: number): void {
    switch (connection) {
      case 'set_fissionrate':
        let newFissionRate = parseFloat(signal);
        if (newFissionRate != Infinity && !isNaN(newFissionRate)) {
          this.signalControlledTargetFissionRate = Clamp(newFissionRate, 0.0, 100.0);
          this.lastReceivedFissionRateSignalTime = totalTime;
        }
        break;
      case 'set_turbineoutput':
        let newTurbineOutput = parseFloat(signal);
        if (newTurbineOutput != Infinity && !isNaN(newTurbineOutput)) {
          this.signalControlledTargetTurbineOutput = Clamp(newTurbineOutput, 0.0, 100.0);
          this.lastReceivedTurbineOutputSignalTime = totalTime;
        }
        break;
    }
  }

  private GetMaxOutput(): number {
    return this.maxPowerOutput * this.maxPowerOutputFactor;
  }

  private GetFuelConsumption(): number {
    // 暂时不使用燃料消耗升级，因为没有意义，控制组件的燃料消耗对比只需要固定的消耗值就能对比，升级多少都没区别
    return this.fuelConsumptionRate;
  }
}
