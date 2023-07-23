function deepFreeze(o) {
  Object.freeze(o);
  if (o === undefined) {
    return o;
  }

  Object.getOwnPropertyNames(o).forEach(function (prop) {
    if (o[prop] !== null
      && (typeof o[prop] === "object" || typeof o[prop] === "function")
      && !Object.isFrozen(o[prop])) {
      deepFreeze(o[prop]);
    }
  });

  return o;
}

function lerp(value1, value2, amount) {
  return value1 + (value2 - value1) * amount
}

function clamp(value, left, right) {
  if (left > right) throw Error("left should less than right");
  if (value < left) {
    return left;
  } else if (value > right) {
    return right;
  } else {
    return value;
  }
}

function adjustValueWithoutOverShooting(current, target, speed) {
  return target < current ? Math.max(target, current - speed) : Math.min(target, current + speed);
}

const FuelRodType = deepFreeze({
  uranium: { type: "uranium", durability: 100, heatPotential: 80 },
  thorium: { type: "thorium", durability: 200, heatPotential: 80 },
  fulgurium: { type: "fulgurium", durability: 150, heatPotential: 150 },
});

class FuelRod {
  typeName;
  durability;

  constructor(typeName) {
    this.typeName = typeName;
    this.durability = FuelRodType[typeName].durability;
  }
}

class Reactor {
  signal = {
    in: {
      fissionRate: 0,
      turbineOutput: 0,
    },
    out: {
      temperature: 0,
      allHeatPotential: 0,
      fuelRodDurabilityRate: 0,
      power: 0,
      load: 0,
    }
  }

  /**
   * 潜艇编辑器中设置的最大功率输出
   */
  baseMaxPowerOutput;
  /**
   * 潜艇编辑器中设置的燃料消耗速率
   */
  baseFuelConsumptionRate;

  constructor(baseMaxPowerOutput, baseFuelConsumptionRate) {
    this.baseMaxPowerOutput = baseMaxPowerOutput;
    this.baseFuelConsumptionRate = baseFuelConsumptionRate;
  }

  /**
   * 燃料栏
   */
  fuelsContainer = [];

  /**
   * 反应堆当前的裂变速率
   */
  fissionRate = 0;

  /**
   * 反应堆当前的涡轮输出
   */
  turbineOutput = 0;

  /**
   * 温度
   *
   * 这里是内部计算使用的温度，UI显示和线控输出温度都是在这个值上乘100
   */
  temperature = 0;

  /**
   * 船上是否有工程师拥有反应堆最大输出增加10%的天赋(buzzing)
   */
  hasTalentEngineerBuzzing = false;

  /**
   * 船上是否有工程师拥有燃料效率提高20%的天赋(cruising)
   */
  hasTalentEngineerCruising = false;

  /**
   * 潜艇的升级选项中的反应堆最大功率等级
   */
  upgradeLevelIncreaseReactorOutput = 0;

  /**
   * 潜艇的升级选项中的反应堆燃料效率等级
   */
  upgradeLevelDecreaseFuelConsumption = 0;

  /**
   * 反应堆要调整到的目标裂变速率
   */
  targetFissionRate = 0;

  /**
   * 反应堆要调整到的目标涡轮输出
   */
  targetTurbineOutput = 0;

  /**
   * 获取实际的反应堆最大输出功率
   */
  getMaxOutput() {
    return this.baseMaxPowerOutput * (1 + 0.03 * this.upgradeLevelIncreaseReactorOutput) * (this.hasTalentEngineerBuzzing ? 1.1 : 1);
  }

  /**
   * 获取实际的燃料消耗速率
   */
  getFuelConsumption() {
    return this.baseFuelConsumptionRate * (1 - 0.02 * this.upgradeLevelDecreaseFuelConsumption) * (this.hasTalentEngineerCruising ? 0.8 : 1)
  }

  /**
   * 获得当前可用燃料的热势和
   */
  getAllHeatPotential() {
    let sum = 0;
    for (const fuelRod of this.fuelsContainer) {
      if (fuelRod && fuelRod.durability > 0) {
        sum += FuelRodType[fuelRod.typeName].heatPotential;
      }
    }
    return sum;
  }

  /**
   * 获取当前生成热量
   */
  getGeneratedHeat() {
    return this.fissionRate * (this.getAllHeatPotential() / 100.0) * 2.0
  }

  optimalFissionRate = [0, 0];
  allowedFissionRate = [0, 0];
  correctTurbineOutput = 0;
  optimalTurbineOutput = [0, 0];
  allowedTurbineOutput = [0, 0];

  /**
   * 模拟游戏中的逻辑刻更新，通过指定deltaTime可模拟不同帧率的反应堆变化情况
   *
   * @param deltaTime 距离上一次更新经过的时间(单位：秒)
   * @param load 当前负载
   */
  update(deltaTime, load) {
    if (deltaTime <= 0) throw Error("经过的时间必须大于0")
    // 限制线控速率
    this.targetFissionRate = adjustValueWithoutOverShooting(this.targetFissionRate, this.signal.in.fissionRate, deltaTime * 5.0);
    this.targetTurbineOutput = adjustValueWithoutOverShooting(this.targetTurbineOutput, this.signal.in.turbineOutput, deltaTime * 5.0);

    // 计算仪表盘绿色区域
    const maxPowerOut = this.getMaxOutput();
    if (maxPowerOut > 0.1) {
      this.correctTurbineOutput += clamp((load / this.getMaxOutput() * 100) - this.correctTurbineOutput, -20, 20) * deltaTime;
    }
    let tolerance = 2.5;
    this.optimalTurbineOutput = [this.correctTurbineOutput - tolerance, this.correctTurbineOutput + tolerance];
    tolerance = 5;
    this.allowedTurbineOutput = [this.correctTurbineOutput - tolerance, this.correctTurbineOutput + tolerance];
    const allHeatPotential = this.getAllHeatPotential();
    this.optimalFissionRate = [Math.min(30, allHeatPotential - 30), allHeatPotential - 20];
    this.allowedFissionRate = [Math.min(20, allHeatPotential - 10), allHeatPotential];

    // region 核心逻辑

    // 生成的热量
    const heatAmount = this.getGeneratedHeat();
    // 温度变化量
    const temperatureDiff = (heatAmount - this.turbineOutput) - this.temperature;
    // 温度随时间变化 这里是化简后的公式
    // 原公式 (sign(temperatureDiff) * 10.0 * deltaTime).coerceIn(-abs(temperatureDiff), abs(temperatureDiff))

    this.temperature = clamp(
      this.temperature + clamp(Math.sign(temperatureDiff) * 10.0 * deltaTime, -Math.abs(temperatureDiff), Math.abs(temperatureDiff)),
      0, 100
    );
    // 实际裂变速率是通过lerp函数过渡的
    this.fissionRate = clamp(
      lerp(this.fissionRate, Math.min(this.targetFissionRate, this.getAllHeatPotential()), deltaTime),
      0, 100
    );
    // 实际涡轮输出是通过lerp函数过渡的
    this.turbineOutput = clamp(
      lerp(this.turbineOutput, this.targetTurbineOutput, deltaTime),
      0, 100
    );

    // endregion 核心逻辑

    // 计算剩余燃料百分比
    let fuelLeft = 0.0
    for (const fuelRod of this.fuelsContainer) {
      if (!fuelRod) continue;
      if (this.fissionRate > 0) {
        fuelRod.durability -= this.fissionRate / 100 * this.getFuelConsumption() * deltaTime;
      }
      fuelLeft += fuelRod.durability / FuelRodType[fuelRod.typeName].durability;
    }

    this.signal.out.temperature = this.temperature * 100;
    this.signal.out.allHeatPotential = this.getAllHeatPotential();
    this.signal.out.fuelRodDurabilityRate = fuelLeft;
    this.signal.out.load = load;
    this.signal.out.power = this.getPowerOutByLoad(load);
  }

  getPowerOutByLoad(load) {
    const powerOut = this.getMinMaxPowerOut();
    return clamp(load, powerOut[0], powerOut[1]);
  }

  getMinMaxPowerOut() {
    // 容差为1，即涡轮输出不在绿色范围内或温度不在4000~6000范围内
    let tolerance = 1;

    // 容差为3，即涡轮输出在绿色范围内且温度在4000~6000范围内
    if (
      this.turbineOutput > this.optimalTurbineOutput[0] && this.turbineOutput < this.optimalTurbineOutput[1]
      && this.temperature > 40 && this.temperature < 60
    ) {
      tolerance = 3;
    }

    const maxPowerOut = this.getMaxOutput();

    const temperatureFactor = Math.min(this.temperature / 50, 1);

    // 根据容差计算输出功率
    const minOutput = maxPowerOut * clamp(Math.min((this.turbineOutput - tolerance) / 100.0, temperatureFactor), 0, 1);
    const maxOutput = maxPowerOut * Math.min((this.turbineOutput + tolerance) / 100.0, temperatureFactor);

    return [minOutput, maxOutput];
  }
}
