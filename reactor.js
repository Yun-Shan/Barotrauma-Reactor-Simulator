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

// C# float 的每次算术运算都会舍入为单精度；状态仍使用 JavaScript 数字存储。
const f32 = Math.fround;

function lerp(value1, value2, amount) {
  return f32(value1 + f32(f32(value2 - value1) * amount));
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
  return target < current ? Math.max(target, f32(current - speed)) : Math.min(target, f32(current + speed));
}

const FuelRodType = deepFreeze({
  uranium: { type: "uranium", durability: 100, heatPotential: 80 },
  thorium: { type: "thorium", durability: 200, heatPotential: 100 },
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
    this.baseMaxPowerOutput = f32(baseMaxPowerOutput);
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
    // 游戏先按升级等级调整基础值，再乘天赋加成。
    const upgradeFactor = f32(1 + f32(f32(3 / 100) * this.upgradeLevelIncreaseReactorOutput));
    const upgradedOutput = f32(this.baseMaxPowerOutput * upgradeFactor);
    return this.hasTalentEngineerBuzzing ? f32(upgradedOutput * f32(1.1)) : upgradedOutput;
  }

  /**
   * 获取实际的燃料消耗速率
   */
  getFuelConsumption() {
    return this.baseFuelConsumptionRate * (1 - 0.2 * this.upgradeLevelDecreaseFuelConsumption) * (this.hasTalentEngineerCruising ? 0.8 : 1)
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
  getGeneratedHeat(allHeatPotential = this.getAllHeatPotential()) {
    return f32(f32(f32(this.fissionRate) * f32(f32(allHeatPotential) / 100)) * 2);
  }

  optimalFissionRate = [0, 0];
  allowedFissionRate = [0, 0];
  correctTurbineOutput = 0;
  optimalTurbineOutput = [0, 0];
  allowedTurbineOutput = [0, 0];

  /**
   * 模拟游戏中的逻辑刻更新。游戏的每个逻辑帧使用固定的 1/60 秒步长。
   * 本帧功率按更新前的状态结算，温度信号使用更新后的温度；燃料耐久消耗采用近似计算。
   *
   * @param deltaTime 本逻辑帧推进的游戏时间（单位：秒）
   * @param load 当前负载
   */
  update(deltaTime, load) {
    if (deltaTime <= 0) throw Error("经过的时间必须大于0")

    // 游戏传入 Reactor.Update 的 1/60 秒为 float；图表和负载代码仍使用原始时间步长。
    const floatStep = f32(deltaTime);
    this.temperature = f32(this.temperature);
    this.fissionRate = f32(this.fissionRate);
    this.turbineOutput = f32(this.turbineOutput);
    this.targetFissionRate = f32(this.targetFissionRate);
    this.targetTurbineOutput = f32(this.targetTurbineOutput);
    this.correctTurbineOutput = f32(this.correctTurbineOutput);

    // 电网在反应堆更新前结算，因此功率使用上一帧的温度、涡轮和仪表区域。
    const reactorLoad = Math.max(f32(load), 0);
    const powerOut = this.getPowerOutByLoad(reactorLoad);

    // 限制线控速率
    this.signal.in.fissionRate = clamp(f32(this.signal.in.fissionRate), 0, 100);
    this.targetFissionRate = adjustValueWithoutOverShooting(this.targetFissionRate, this.signal.in.fissionRate, f32(floatStep * 5));
    this.signal.in.turbineOutput = clamp(f32(this.signal.in.turbineOutput), 0, 100);
    this.targetTurbineOutput = adjustValueWithoutOverShooting(this.targetTurbineOutput, this.signal.in.turbineOutput, f32(floatStep * 5));

    // 计算仪表盘绿色区域
    const maxPowerOut = this.getMaxOutput();
    if (maxPowerOut > 0.1) {
      const desiredOutput = f32(f32(reactorLoad / maxPowerOut) * 100);
      const correction = clamp(f32(desiredOutput - this.correctTurbineOutput), -20, 20);
      this.correctTurbineOutput = f32(this.correctTurbineOutput + f32(correction * floatStep));
    }
    let tolerance = 2.5;
    this.optimalTurbineOutput = [f32(this.correctTurbineOutput - tolerance), f32(this.correctTurbineOutput + tolerance)];
    tolerance = 5;
    this.allowedTurbineOutput = [f32(this.correctTurbineOutput - tolerance), f32(this.correctTurbineOutput + tolerance)];
    const allHeatPotential = f32(this.getAllHeatPotential());
    const optimalFissionMax = f32(allHeatPotential - 20);
    this.optimalFissionRate = [Math.min(30, f32(optimalFissionMax - 10)), optimalFissionMax];
    this.allowedFissionRate = [Math.min(20, f32(allHeatPotential - 10)), allHeatPotential];

    // region 核心逻辑

    // 生成的热量
    const heatAmount = this.getGeneratedHeat(allHeatPotential);
    // 温度变化量
    const temperatureDiff = f32(f32(heatAmount - this.turbineOutput) - this.temperature);
    // 温度随时间变化 这里是化简后的公式
    // 原公式 (sign(temperatureDiff) * 10.0 * deltaTime).coerceIn(-abs(temperatureDiff), abs(temperatureDiff))

    this.temperature = clamp(
      f32(this.temperature + clamp(f32(Math.sign(temperatureDiff) * 10 * floatStep), -Math.abs(temperatureDiff), Math.abs(temperatureDiff))),
      0, 100
    );
    // 实际裂变速率是通过lerp函数过渡的
    this.fissionRate = clamp(
      lerp(this.fissionRate, Math.min(this.targetFissionRate, allHeatPotential), floatStep),
      0, 100
    );
    // 实际涡轮输出是通过lerp函数过渡的
    this.turbineOutput = clamp(
      lerp(this.turbineOutput, this.targetTurbineOutput, floatStep),
      0, 100
    );

    // endregion 核心逻辑

    // 燃料耐久按裂变速率、消耗速率和 deltaTime 近似递减；百分比和累计值按游戏的 float 运算。
    let fuelLeft = 0.0
    for (const fuelRod of this.fuelsContainer) {
      if (!fuelRod) continue;
      if (this.fissionRate > 0) {
        fuelRod.durability = Math.max(0, fuelRod.durability - this.fissionRate / 100 * this.getFuelConsumption() * deltaTime);
      }
      const condition = f32(fuelRod.durability);
      const maxCondition = f32(FuelRodType[fuelRod.typeName].durability);
      const conditionPercentage = f32(f32(condition / maxCondition) * 100);
      fuelLeft = f32(fuelLeft + conditionPercentage);
    }

    // 游戏将输出信号向零截断为整数；燃料剩余量先求各棒百分比之和再截断。
    this.signal.out.temperature = Math.trunc(f32(this.temperature * 100));
    // 燃料信号使用本帧消耗前的热值，耗尽的燃料棒从下一帧开始不再提供热值。
    this.signal.out.allHeatPotential = Math.trunc(allHeatPotential);
    this.signal.out.fuelRodDurabilityRate = Math.trunc(fuelLeft);
    this.signal.out.load = Math.trunc(reactorLoad);
    this.signal.out.power = Math.trunc(powerOut);
  }

  getPowerOutByLoad(load) {
    const [minOutput, maxOutput] = this.getMinMaxPowerOut();
    const loadLeft = Math.max(f32(load), 0);
    const outputRange = f32(maxOutput - minOutput);
    const rawRatio = f32(f32(loadLeft - minOutput) / outputRange);
    // MathHelper.Max(NaN, 0) 返回 0；正无穷也在游戏中被重置为 0。
    let ratio = rawRatio > 0 ? rawRatio : 0;
    if (!Number.isFinite(ratio)) ratio = 0;
    return clamp(f32(f32(ratio * outputRange) + minOutput), minOutput, maxOutput);
  }

  getMinMaxPowerOut() {
    // 容差为1，即涡轮输出不在绿色范围内或温度不在4000~6000范围内
    let tolerance = 1;

    // 容差为3，即涡轮输出在绿色范围内且温度在4000~6000范围内
    const turbineOutput = f32(this.turbineOutput);
    const temperature = f32(this.temperature);
    if (
      turbineOutput > f32(this.optimalTurbineOutput[0]) && turbineOutput < f32(this.optimalTurbineOutput[1])
      && temperature > 40 && temperature < 60
    ) {
      tolerance = 3;
    }

    const maxPowerOut = this.getMaxOutput();

    const temperatureFactor = Math.min(f32(temperature / 50), 1);

    // 根据容差计算输出功率
    const minOutput = f32(maxPowerOut * clamp(Math.min(f32(f32(turbineOutput - tolerance) / 100), temperatureFactor), 0, 1));
    const maxOutput = f32(maxPowerOut * Math.min(f32(f32(turbineOutput + tolerance) / 100), temperatureFactor));

    return [minOutput, maxOutput];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Reactor, FuelRod, FuelRodType };
}
