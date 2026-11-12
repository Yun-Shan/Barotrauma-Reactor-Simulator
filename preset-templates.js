// 预设名称和内容统一在此维护，页面会按数组顺序生成菜单。
// code 是模板字符串，反斜杠、反引号和 ${...} 需按 JavaScript 字符串规则转义。
const presetTemplates = {
  load: [
    {
      name: "0~3000kw，0.06Hz正弦",
      code: `let maxPower = 5000;
let halfMaxPower = maxPower / 2;
let frequency = 0.06;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = Math.sin(memory.phase * Math.PI * 2) * halfMaxPower + halfMaxPower;`,
    },
    {
      name: "0~3000kw，0.1Hz正弦",
      code: `let maxPower = 5000;
let halfMaxPower = maxPower / 2;
let frequency = 0.1;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = Math.sin(memory.phase * Math.PI * 2) * halfMaxPower + halfMaxPower;`,
    },
    {
      name: "1000/3000kw，0.1Hz方波",
      code: `let frequency = 0.1;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = Math.sin(memory.phase * Math.PI * 2) > 0 ? 3000 : 1000;`,
    },
    {
      name: "1000~5000kw，0.15Hz正弦",
      code: `let maxPower = 5000;
let halfMaxPower = maxPower / 2;
let frequency = 0.15;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = Math.sin(memory.phase * Math.PI * 2) * 2000 + 3000;`,
    },
    {
      name: "1000~5000kw，0.15Hz三角",
      code: `let maxPower = 5000;
let halfMaxPower = maxPower / 2;
let frequency = 0.15;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = (Math.asin(Math.sin(memory.phase * Math.PI * 2)) / Math.PI * 2) * 2000 + 3000;`,
    },
    {
      name: "1000~5000kw，0.1Hz正锯齿",
      code: `let maxPower = 5000;
let frequency = 0.1;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = memory.phase % (1 / frequency) * (maxPower - 1000) + 1000;`,
    },
    {
      name: "1000~5000kw，0.1Hz反锯齿",
      code: `let maxPower = 5000;
let frequency = 0.1;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
output.load = maxPower - memory.phase % (1 / frequency) * (maxPower - 1000);`,
    },
    {
      name: "1000~5000kw，平缓+剧烈混合波动",
      code: `let maxPower = 5000;
let halfMaxPower = maxPower / 2;
let frequency = 0.02;
if (!memory.phase) memory.phase = 0;
memory.phase = (memory.phase + deltaTime * frequency) % 1;
// DeepSeek生成的复杂波形
function complexWave(x) {
    if (x < 0.25) {
        // 平缓上升至y=1（0 ≤ x < 0.25）
        return -128 * Math.pow(x, 3) + 48 * Math.pow(x, 2);
    } else if (x < 0.75) {
        // 剧烈波动区域（0.25 ≤ x < 0.75）
        const t = (x - 0.25) / 0.5; // 归一化为0-1
        const main = -2 * t + 1;     // 主波形线性下降
        const amp = 0.3 * (1 - Math.abs(main)); // 动态振幅控制
        const highFreq = amp * Math.sin(20 * Math.PI * t); // 高频波动
        return main + highFreq;
    } else {
        // 平缓下降至y=0（0.75 ≤ x ≤ 1）
        const t = (x - 0.75) / 0.25;
        return -2 * Math.pow(t, 3) + 3 * Math.pow(t, 2) - 1;
    }
}
output.load = complexWave(memory.phase) * halfMaxPower + halfMaxPower;`,
    },
  ],
  action: [
    {
      name: "标准省油公式(最大功率5000kw)",
      code: `let maxPower = 5000;
signal.in.turbineOutput = 100 * Math.min(signal.out.load / maxPower, 1);
signal.in.fissionRate = (75 * signal.in.turbineOutput) / signal.out.allHeatPotential;`,
    },
    {
      name: "标准温控公式(最大功率5000kw)",
      code: `let maxPower = 5000;
signal.in.turbineOutput = 100;
let needTemperature = Math.min((signal.out.load / maxPower) * 50, 50);
signal.in.fissionRate = (50 * needTemperature + 5000) / signal.out.allHeatPotential;`,
    },
    {
      name: "云闪优化温控公式-旧(最大功率5000kw)",
      code: `let maxPower = 5000;
signal.in.turbineOutput = 100;
if (!memory.lastTemperature) memory.lastTemperature = 0;
let temperatureDiff = Math.abs(memory.lastTemperature - signal.out.temperature);
let currentTemperature = signal.out.temperature / 100;
let needTemperature = Math.min((signal.out.load / maxPower) * 50, 50);
let needFissionRate = (50 * needTemperature + 5000) / signal.out.allHeatPotential;
if (currentTemperature >= 50 || temperatureDiff * 0.07 > Math.abs(needTemperature - currentTemperature)) {
  signal.in.fissionRate = needFissionRate;
} else {
  const c = needTemperature > currentTemperature ? 5500 : 4500;
  signal.in.fissionRate = (50 * currentTemperature + c) / signal.out.allHeatPotential;
}
memory.lastTemperature = signal.out.temperature;
`,
    },
    {
      name: "露卡优化温控公式(最大功率5000kw)",
      code: `// 思路地址：https://tieba.baidu.com/p/8663839130
let baseMaxPower = 5000;
signal.in.turbineOutput = signal.out.allHeatPotential == 80 ? 85 : 99.1;
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
// 将这个数称之为最大功率因数，用于自适应反应堆功率升级，4170 * 1.09 * 1.1 = 4999.83 ≈ 5000，由于游戏内信号延迟，这个数字会有短时间的微小波动，但没什么影响
if (!memory.maxPowerFactor) memory.maxPowerFactor = 1;
if (signal.out.power > 0) memory.maxPowerFactor = clamp(signal.out.temperature / signal.out.power, 4170 / baseMaxPower, 5000 / baseMaxPower);
let targetTemperature = memory.maxPowerFactor * signal.out.load;
let temperatureDiff = clamp(targetTemperature - signal.out.temperature, -999, 999);
if (/^\\-?(?:\\d\\d?|1[0,1]\\d)(\\..+)?$/.test(temperatureDiff.toString())) {
  // 上面的正则等同于Math.abs(temperatureDiff) < 120
  // do nothing (游戏内直连下一个逻辑的组件)
} else if (/^\\-?(?:1[2-9].|[2-9]..)(\\..+)?$/.test(temperatureDiff.toString())) {
  // 上面的正则等同于Math.abs(temperatureDiff) >= 120
  // 下面的正则单纯判断正负
  targetTemperature = signal.out.temperature + (/^\\-.+/.test(temperatureDiff.toString()) ? -1150 : 1150);
} else {
  throw new Error('上面两个正则互为补集，不应当执行到这里');
}
let turbineConsumeHeat = signal.out.allHeatPotential == 80 ? 8500 : 9909;
let spawnHeat = targetTemperature + turbineConsumeHeat;
// 正则等同于signal.out.temperature < 5200, 10000是个魔法值，目的是尽可能压低裂变防止过热
let heatPotentialFactor = signal.out.allHeatPotential * (/^(?:[1-4]?.{1,3}|5[0,1]..)$/.test(signal.out.temperature.toString()) ? 2 : 10000);
signal.in.fissionRate = spawnHeat / heatPotentialFactor;
`,
    },
    {
      name: "KB优化温控(自适应功率)",
      code: `// 思路地址：https://www.bilibili.com/video/BV14sLoz4ET3/
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
// 转移函数
const transfer = (der, temp) => {
  if (!memory.transferS) memory.transferS = 0;
  const ds = der * (temp - memory.transferS);
  memory.transferS = ds + memory.transferS;
  return ds * 60 + memory.transferS;
};
// 获取目标温度(限制目标温度变化范围正负16.7)
const getTargetTemp = () => {
  if (!memory.powerFactor) memory.powerFactor = 1;
  // 温度或功率信号为0时无法估算功率因数，保留上次有效值。
  if (signal.out.temperature > 0 && signal.out.power > 0) {
    memory.powerFactor = signal.out.power / signal.out.temperature;
  }
  let targetTemperature = clamp(signal.out.load / memory.powerFactor, 0, 5000);
  targetTemperature = 2 * targetTemperature - signal.out.temperature;
  if (!memory.fixTemp) memory.fixTemp = 0;
  targetTemperature = memory.fixTemp + clamp(targetTemperature - memory.fixTemp, -16.7, 16.7);
  memory.fixTemp = targetTemperature;
  return targetTemperature;
};
// 微分
const derivativeJudgment = () => {
  const heatFactor = signal.out.allHeatPotential / 4500;
  let useTrueOutput = false;
  if (memory.derTimer >= 0.04) {
      useTrueOutput = true;
  } else {
      if (memory.derCheck == signal.out.load) {
        memory.derTimer++;
      } else {
        memory.derCheck = signal.out.load;
        memory.derTimer = 0;
      }
  }
  return useTrueOutput ? heatFactor : 0.6;
};
const targetTemperature = transfer(derivativeJudgment(), getTargetTemp());

let turbineConsumeHeat = signal.out.allHeatPotential == 80 ? 8600 : 9904;
let spawnHeat = targetTemperature + turbineConsumeHeat;
// 正则等同于signal.out.temperature < 5050，目的是过热时尽可能压低裂变防止过热
let heatPotentialFactor = signal.out.allHeatPotential * (/^(0|[1-9]\\d{0,2}|[1-4]\\d{3}|50[0-4]\\d)$/.test(signal.out.temperature.toString()) ? 2 : 999999);
signal.in.fissionRate = spawnHeat / heatPotentialFactor;
signal.in.turbineOutput = signal.out.allHeatPotential === 80 ? 86 : 99.04;
`,
    },
    {
      name: "云闪优化温控公式-新(自适应功率)",
      code: `const deltaTime = 1 / 60;
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

// 将这个数称之为最大功率因数，用于自适应反应堆功率升级，由于游戏内信号取整，这个数字会有微小波动，虽然会有影响但是没办法
if (!memory.maxPowerFactor) memory.maxPowerFactor = 1;
if (signal.out.power > 0) memory.maxPowerFactor = signal.out.temperature / signal.out.power;

if (!memory.lastTargetTemperature) memory.lastTargetTemperature = 0; // 注意 因为时序问题，必须先放这个内存组件再执行LoadNeedTemperature的计算
const LoadNeedTemperature = clamp(memory.maxPowerFactor * signal.out.load, 0, 5000);

// 根据预测趋势修正温控限制
//const maxTemperatureFrameDiff = 1000 * deltaTime; // 16.66666666 => 16.7
let temperatureDiff = 16.66667 * clamp((LoadNeedTemperature - signal.out.temperature) / 50, -1, 1);
const forecastFactor = 6000 / signal.out.allHeatPotential;
let forecastTemperatureDiff = forecastFactor * Math.round(LoadNeedTemperature - memory.lastTargetTemperature);
const forecastTemperature = LoadNeedTemperature + forecastTemperatureDiff;
memory.lastTargetTemperature = LoadNeedTemperature;
const targetTemperature = signal.out.temperature + temperatureDiff;
let outputTemperature = (signal.out.temperature * (deltaTime - 1) + targetTemperature) / deltaTime;
if (forecastTemperatureDiff * temperatureDiff < 0) {
  // 这个不需要在游戏中实现，因为游戏中使用异或组件实现min和max，如果其中一个为0就会造成提早return的效果，写在代码里是为了验证即使提早返回也不影响控制功能
  if (outputTemperature == 0 || forecastTemperature == 0) {
    signal.in.turbineOutput = signal.out.allHeatPotential === 80 ? 85 : 99.1;
    return;
  }
  outputTemperature = forecastTemperatureDiff < 0 ? Math.min(outputTemperature, forecastTemperature) : Math.max(outputTemperature, forecastTemperature);
}
let turbineConsumeHeat = signal.out.allHeatPotential === 80 ? 8500 : 9910;
let spawnHeat = outputTemperature + turbineConsumeHeat;
// 正则等同于signal.out.temperature < 5200, 10000是个魔法值，目的是压低裂变防止过热
let heatPotentialFactor = signal.out.allHeatPotential * (/^(?:[1-4]?.{1,3}|5[0,1]..)$/.test(signal.out.temperature.toString()) ? 2 : 10000);
signal.in.fissionRate = spawnHeat / heatPotentialFactor;
signal.in.turbineOutput = signal.out.allHeatPotential === 80 ? 85 : 99.1;
`,
    },
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = presetTemplates;
