# 电路盒模拟器

纯 JavaScript 实现，提供 CommonJS 库和命令行入口，无 npm 依赖。支持本机 Barotrauma **1.13.5.0 / Windows x64** 的全部 **35 种**原版 `circuitboxcomponent` 组件，以及 Max112358/Barotrauma-Blueprints 的新旧 `.txt` 格式。

实现与源码调度分析见 [ANALYSIS.md](ANALYSIS.md)。实际对照数量、游戏 DLL SHA-256 和上游提交记录在本地 `verification.json` 中；它记录已执行的检查，不代表穷举了所有电路和字符串。

## 运行

Node.js 20 或更新版本即可运行模拟器。下面的命令从仓库根目录执行：

```powershell
node circuitbox/cli.js run circuitbox/examples/adder.txt --frames 120 --inputs circuitbox/examples/inputs.json
node circuitbox/cli.js inspect your-blueprint.txt
node circuitbox/cli.js run your-blueprint.txt --frames 600 --inputs inputs.json --trace --output result.json --export saved.txt
node circuitbox/cli.js roundtrip your-blueprint.txt --output copied.txt
node circuitbox/cli.js components
```

输入对象表示每帧持续输入，值始终按信号字符串处理：

```json
{"signal_in1":"1500","signal_in2":"80"}
```

输入数组表示指定帧的事件，按数组顺序执行。`target` 省略时输入电路盒；填写组件 ID 时直接注入该组件。组件属性编辑使用 `property`：

```json
[
  {"frame":1,"port":"signal_in1","value":"1500"},
  {"frame":1,"port":"signal_in2","value":"80"},
  {"frame":30,"target":3,"property":"Value","value":"75"},
  {"frame":60,"target":0,"port":"signal_in1","value":"0"}
]
```

结果包含每次输出的帧号、时间、端口、字符串值和信号元数据。`--trace` 另外输出内部组件的每次发送。每帧可以产生多个同端口信号；没有输出、空字符串和字符串 `"0"` 是三种不同情况。

## JavaScript API

```js
const {
  CircuitSimulator, CircuitWorld,
  readBlueprintFile, writeBlueprintFile,
  parseBlueprint, writeBlueprint, importBlueprint, catalog
} = require('./circuitbox');

const blueprint = readBlueprintFile('controller.txt');
const sim = new CircuitSimulator(blueprint, { loadMode: 'blueprints', trace: true });
const events = sim.step({ signal_in1: '1500', signal_in2: '80' });
const history = sim.run(600, { signal_in1: '1500', signal_in2: '80' });

sim.setProperty(3, 'Value', '75');
writeBlueprintFile('edited.txt', sim.toBlueprint());
```

`step()` 固定前进一帧（1/60 秒），返回本帧盒子输出；`run()` 返回所有输出事件。`world.trace` 只保留最近一帧；`lastOutputs` 保存每个端口最后一次输出。空闲帧不会清空最后值。`input()` 和 `receive()` 可在两次更新之间同步注入信号；若要保存这些即时输出，直接读取 `world.outputs` 或设置 `onOutput(event)`。

模拟 Blueprints 模组写入时使用 `loadMode: 'blueprints'`，命令行 `run` 已默认使用此模式。它按文件顺序创建新组件、应用旧 prefab 别名、只写入模组允许编辑的属性，并按当前盒子的连接器编号连线；旧文件里保存的 8 个端口会映射到当前原版的 `0..9` 共 10 个端口。也可先调用 `importBlueprint(blueprint)` 查看实际导入图及 `importDiagnostics`。省略此选项会直接运行传入的图和属性，便于构造测试电路或自定义端口。

`new CircuitSimulator(blueprint, { updateOrder: [组件ID...], startTime: 0, position: {x:0,y:0} })` 可指定物品更新顺序、世界时钟起点及电路盒世界位置。组件定义中的 `worldPosition` 可覆盖世界位置；蓝图中的 `position` 仅为编辑器布局。

多个盒子可通过同一个 `CircuitWorld` 通信，WiFi 也在该世界中共享接收者。调用 `world.step()` 统一推进，避免分别调用各盒子的 `step()` 导致重复计时：

```js
const world = new CircuitWorld();
const a = world.add(readBlueprintFile('a.txt'), { id: 'a', loadMode: 'blueprints' });
const b = world.add(readBlueprintFile('b.txt'), { id: 'b', loadMode: 'blueprints' });
world.connect(a, 'signal_out1', b, 'signal_in1');
world.step([{ box: 'a', port: 'signal_in1', value: '42' }]);
```

也可直接构造蓝图对象，结构参见 `parseBlueprint()` 的返回值及测试。组件须提供 `id`、`prefab`、可选 `properties`；线缆须提供 `from`、`to`，端点为 `{target: 组件ID或null, name: 端口名}`。`inputPorts` / `outputPorts` 支持保存文件中自定义的盒子端口。

## 支持的组件

| 类别 | prefab 标识符 |
| --- | --- |
| 逻辑与比较 | `andcomponent`, `orcomponent`, `xorcomponent`, `notcomponent`, `equalscomponent`, `greatercomponent`, `signalcheckcomponent` |
| 四则、幂、取模 | `addercomponent`, `subtractcomponent`, `multiplycomponent`, `dividecomponent`, `powcomponent`, `modulocomponent` |
| 数学函数 | `roundcomponent`, `ceilcomponent`, `floorcomponent`, `factorialcomponent`, `abscomponent`, `squarerootcomponent` |
| 三角函数 | `sincomponent`, `coscomponent`, `tancomponent`, `asincomponent`, `acoscomponent`, `atancomponent`（含双输入 atan2） |
| 字符串与颜色 | `concatcomponent`, `regexcomponent`, `colorcomponent`（RGB / HSV） |
| 状态与路由 | `memorycomponent`, `delaycomponent`, `relaycomponent`, `oscillator`, `wificomponent`, `multiplexercomponent`, `demultiplexercomponent` |

完整端口、别名和 prefab 默认配置在 [catalog.js](catalog.js)。未知 prefab 会明确报错。组件自身支持的其他端口名，可通过相应原版别名映射；模拟器不加载第三方 mod 组件代码。

## 对照条件

“与游戏相同”需要相同的版本、初始状态、物品更新顺序和外部输入。默认按蓝图组件顺序从刚创建的状态运行。DLL 对照采用空新盒、材料充足、导入期间暂停更新、写入后以 60 Hz 运行的条件。Blueprints 文件没有保存游戏时钟、延迟队列、振荡器相位、完整世界物品顺序等信息，因此导出的是组件配置和电路布局，不能作为任意运行帧的检查点。若游戏在模组的 `Timer.Wait` 导入间隔内持续更新，完成时可能已经积累相位或反馈状态；这种运行状态不能仅从 `.txt` 推断。

三角函数和普通计算复用仓库的 `game-math.js`，由 JavaScript 原生数学函数计算，保留原有转换常量和 float32 舍入顺序。正弦振荡器使用共享模块的 `sinDouble`，保留游戏的 float32 相位和角度、double 正弦结果。其他运行时、操作系统或游戏版本应重新运行 DLL 对照。WiFi 的频道、距离、队伍和干扰状态影响电路信号；游戏聊天窗口和电力网络属于外部环境。电路盒不允许连接电力端子，继电器的负载/功率输出在这种环境中为零。

数值验收使用绝对容差：有限数值信号的绝对误差 `< 1e-6` 即通过，等于 `1e-6` 不通过。比较直接使用十进制信号文本，避免浮点相减把边界误判为容差内，或丢失大整数的差异。空字符串、普通文本、复合字符串及 NaN/Infinity 要求原样相同；事件数量、顺序、帧号、端口和元数据要求精确一致。容差仅用于对照验收，电路内的 Equals、SignalCheck、正则匹配等仍按游戏自己的规则执行。报告同时记录按容差接受的事件数及最大误差。

正则使用 .NET 风格的 UTF-16 匹配，包括 Unicode 分类与区段、命名/编号/重复捕获、平衡组、条件、原子组和后顾。50ms 超时及连续三次超过 1ms 的保护与游戏采用相同策略；这些基于实际耗时的结果会受运行时和机器速度影响，不能保证 `TIMEOUT` 在两个运行时中同时发生。可通过 `regexOptions` 设置测试用超时或操作数上限。

文件原样导出保持原始文本；修改后会保留布局、标签及未知 XML 节点，并重写组件与线缆。模组自己的 Lua 解析器对某些包含 `/>` 或嵌套字符串分隔符的属性有格式限制；JavaScript 读写器可以无损保存这些文本，但无法修正模组本身的解析行为。

## 验证

普通单元测试仅依赖仓库内文件和 Node.js。`tools/`、测试缓存及 JSON 报告属于本地开发辅助文件，已被 Git 忽略；下面的完整 DLL 验证和性能测量命令需要工作目录中保留这些本地工具。

```powershell
node --test tests/*.test.cjs circuitbox/tests/*.test.cjs
node circuitbox/tools/verify.cjs
```

完整验证需要本机 .NET 8 运行时/SDK及游戏安装；只编译测试工具，引用游戏 DLL，不编译或启动游戏。第一次会下载固定提交的 10 个上游蓝图和原始 Lua 文件，并校验 Git blob SHA。使用环境代理的 Node.js 24+ 可执行 `node --use-env-proxy circuitbox/tools/verify.cjs`。更改游戏路径可设置 `BAROTRAUMA_DIR`；本地蓝图默认递归读取游戏目录的 `LocalMods/Blueprints_saved_blueprints`，可用 `BAROTRAUMA_BLUEPRINTS_DIR` 覆盖。目录缺失或没有蓝图会使验证失败。

模组流程对照会执行原始 Lua 的解析、添加组件、连线和属性写入函数，属性直接写入真实 DLL 组件，再运行同一批实例。GUI、库存供应及导入计时器使用无界面适配器。每个上游示例、本地保存文件及本项目示例都验证原文件和重新导出的文件，并分别运行 600 帧连续变化输入、1200 帧脉冲与空闲输入。报告逐文件记录绝对路径、SHA-256、组件数、实际连线、属性写入及信号事件数。

验证比较组件和边界输出的完整顺序、帧号、值、步数、来源、强度、功率、创建时间；另外比较随机浮点、正则匹配及原版 Lua 解析器的读回结果。失败时返回非零状态并保存诊断；全部通过才更新 `verification.json`。DLL、编译产物及下载的第三方源码均留在忽略目录中。

三角函数专项验证分开记录：`game-math.js` 的 `sin/cos/tan/asin/acos/atan/atan2` 差距仅在弧度模式比较，接受绝对误差 `< 1e-6`。角度转换只验证条件“双方弧度 float32 完全相同”：给实际 JS 反三角函数路径和游戏 DLL 的 `MathHelper.ToDegrees` 注入相同的 float32 弧度值，精确比较转换后的 float32 及输出文本，不应用数值容差。JS 测试仅替换反三角计算内核，以排除弧度误差，转换代码直接执行原始 `game-math.js`。该检查包括正负零、普通弧度值、浮点边界、溢出及非有限值；NaN 比较文本，不比较载荷位。蓝图整体验证继续按文件配置执行，专项结果与整体电路结果分别记录在报告中。

## 性能测量

```powershell
node circuitbox/tools/benchmark.cjs
```

默认读取本地保存蓝图，每个蓝图分别测量无外部输入和持续输入，再测量全部蓝图共享同一世界的情况。持续输入使用功能验证的 600 帧循环信号，仅发送到已连接的输入端口。每次使用新模拟实例，先预热至少 200ms、1200 帧，再测量至少 1 秒，重复 3 次并取帧率中位数。使用公开 `step` API，关闭 trace，计入输入、组件、连线及输出事件生成；帧结果随即丢弃，文件读写、导入、渲染和 JSON 导出在计时区间之外。

结果写入本地 `benchmark.json`，包含硬件、运行时、源码与蓝图校验值、完整输入周期、各次结果及区间。每个模拟帧固定为 1/60 秒；合并场景每帧同时推进全部盒子。可用 `--duration-ms`、`--repeats`、`--warmup-ms`、`--blueprints-dir` 和 `--output` 调整测试。
