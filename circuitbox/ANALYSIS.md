# 执行逻辑与移植依据

分析基准固定为 FakeFishGames/Barotrauma 提交 `5332d91fe05e051db61360136b317389b5f5e3f3`，并使用本机 `DedicatedServer.dll` 1.13.5.0 直接执行对照。Blueprints 基准提交为 `f2b209eaa7787e750b0bcd7af8ef29f7447c5b47`。实际 DLL 哈希保存在 `verification.json`。

## 调度与连线

电路盒不统一计算一个组合逻辑图。盒内组件仍是普通 `ItemComponent`，游戏按 `Item.ItemList` 的顺序逐个调用物品更新，再按物品组件顺序调用活跃组件。因此，前面更新的组件可以在本帧唤醒后面的组件；反向依赖通常要等到下一帧。重排为拓扑序、先统一读取输入再统一计算，都会改变反馈电路和延迟。[MapEntity.UpdateAll](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Map/MapEntity.cs#L638)、[Item.Update](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Item.cs#L2418)。

内部组件之间的线缆有实际 Wire；与盒子输入/输出连接的线缆是虚拟桥接。输入桥直接调用接收组件，输出桥通过盒子物品再发送一次信号，因此还会增加 `stepsTaken`。虚拟桥接按目标去重，普通线缆则沿连接的 HashSet 插入顺序传播。[CircuitBoxWire.EnsureWireConnected](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/CircuitBox/CircuitBoxWire.cs)、[CircuitBoxConnection](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/CircuitBox/CircuitBoxConnection.cs)。

普通信号传播是同步、深度优先的。每次 `Item.SendSignal` 清空该物品最近接收者列表并增加步数；超过 5 步检查重复接收者，超过 10 步进入延迟集合。延迟按“连接、来源、值、发送者”去重。协程首次访问只 yield，第二次访问才真正发送；协程在该轮所有物品之后执行，新协程不加入当前遍历快照。不能把它简单替换成每条线一帧或无条件“下一帧开头发送”。[Item.SendSignal / DelaySignal](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Item.cs#L3059)、[Connection.SendSignal](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Signal/Connection.cs#L343)、[CoroutineManager](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/CoroutineManager.cs)。

## 组件时序

| 组件族 | 收到信号时 | Update 时 |
| --- | --- | --- |
| 四则、Concat | 保存输入、清零对应计时器、唤醒 | 两路均未过期才输出；两路均过期才停用 |
| AND / OR / XOR | 仅字面值 `"0"` 被忽略；空字符串也算真 | 统计有效输入，根据 Output / FalseOutput 输出 |
| Equals / Greater | 保存输入；另一输入一直保留 | 任一路未过期就比较；Equals 为字符串相等，Greater 解析 float |
| NOT | 立即发送反值，清零 power，标记本帧收过信号 | 仅 ContinuousOutput 启用时更新；未收到信号则发 `"1"` |
| Memory | 可写时修改 Value；锁定输入仅 `"1"` 允许写入 | 每帧发送当前 Value，包括空字符串 |
| SignalCheck、幂、模、单输入数学函数、三角函数 | 立即运算并发送 | 单输入运算不依赖 Update |
| Atan 的 x/y 输入 | 缓存 x/y 并更新计时器 | 先加 deltaTime，超 0.1 秒置 NaN；两路非 NaN 则算 atan2 |
| Regex | 保存输入或改 Output | 缓存前次匹配；处理连续/脉冲、分组与超时 |
| Color | 收到任一颜色输入后重算输出缓存 | 每帧发送缓存；仅修改 UseHSV 不立即重算 |
| Relay | 开启时同步转发对应信号；toggle / set_state 改状态 | 输出状态及隔离电路环境中的零负载、零功率 |
| Mux / Demux | 选择端口、移动选择或立即转发 | 每帧输出当前所选索引 |
| WiFi | 同步向符合频道、距离、队伍、干扰条件的接收者转发 | 更新干扰和聊天冷却计时 |

计时窗口是在比较后加上 float deltaTime；Atan 则先增加计时再比较。对于 TimeFrame=0，输入必须落在该组件两次 Update 之间，不一定是调用方眼中的同一“帧开始”。源代码：[Signal 组件目录](https://github.com/FakeFishGames/Barotrauma/tree/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Signal)。

Delay 把 float Delay 除以 double `Timing.Step` 后转为 int 帧数，队列容量为 `max(delayTicks,1)*2`。每次更新先将所有计时器减一，再发送队首到期信号。相同值及近似相同强度的连续信号会合并为持续帧数；重置、队列满、重新设置延迟、同步反馈会影响结果。[DelayComponent](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Signal/DelayComponent.cs)。

振荡器保留 float 相位。Pulse 一帧可以发送多次；其他波形先累加相位再输出。Sine 的角度先以 float 相乘，却调用 double `Math.Sin`，随后按 double 输出字符串；不能把它当作普通 MathF 正弦组件。[OscillatorComponent](https://github.com/FakeFishGames/Barotrauma/blob/5332d91fe05e051db61360136b317389b5f5e3f3/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Signal/OscillatorComponent.cs)。

## 数值与字符串

信号值始终是字符串。非法数字在多数数学输入处按 TryParse 的 out 参数变为 0，但 FunctionComponent 在解析失败时不发送。四则先验证结果，再 clamp；开方仅在值小于零时不发送。幂、模、三角函数可以发送 `NaN` / `Infinity` 文本。

`numeric.js` 实现直接十进制转 float、NumberStyles.Float / Any、int32、负零及 .NET `G` 最短往返格式。float 的中点十进制输出采用取偶数，指数阈值也与 JavaScript 不同。三角函数与其他可复用运算统一调用 `game-math.js`，保留其转换系数及中间 float32 舍入；三角差距按弧度模式的 `< 1e-6` 容差验收。正弦振荡器通过共享模块的 `sinDouble` 保留 double 结果，未额外舍入成 float32。

字符串长度按 UTF-16 代码单元处理。组件的属性 setter 与 ReceiveSignal 中直接写字段不同：例如布尔/比较组件的 `set_output` 不经过 Output 长度限制或激活逻辑。Regex 的 GroupCollection.TryGetValue 仅接受规范分组名称；命名组的数字编号不一定是其可查询的字符串键。

正则以 .NET 8 的 Unicode 分类、区段与 invariant 大小写表为基准，解释执行分组和回溯；没有把 .NET 表达式直接交给 JS RegExp。表来源：[RegexCharClass](https://github.com/dotnet/runtime/blob/v8.0.23/src/libraries/System.Text.RegularExpressions/src/System/Text/RegularExpressions/RegexCharClass.cs)、[RegexCaseEquivalences](https://github.com/dotnet/runtime/blob/v8.0.23/src/libraries/System.Text.RegularExpressions/src/System/Text/RegularExpressions/RegexCaseEquivalences.cs)。耗时保护取决于运行机器，相关边界见 README。

## Blueprints 文件

新格式在 Component 的属性中使用未加引号的 `<<<STRINGSTART>>>...<<<STRINGEND>>>`；旧格式使用普通 XML 属性和 HTML 实体。标签和端口名称覆盖也可能包裹分隔符。必须先识别属性值边界，再解析 XML 结构，不能先用 `<...>` 正则切标签。

解析后保留文档、资源引用、组件 ID、连线、I/O 节点、标签和未知节点。未修改时直接返回原文；修改后重建对应节点。组件的 Class、prefab、属性恢复规则及文件输出通过原版 Lua `blue_prints.parseXML` 做读回对照。[save_blueprint.lua](https://github.com/Max112358/Barotrauma-Blueprints/blob/f2b209eaa7787e750b0bcd7af8ef29f7447c5b47/Blueprints/Lua/save_blueprint.lua)、[load_blueprint.lua](https://github.com/Max112358/Barotrauma-Blueprints/blob/f2b209eaa7787e750b0bcd7af8ef29f7447c5b47/Blueprints/Lua/load_blueprint.lua)。

## DLL 对照方式

`tools/GameOracle.cs` 只加载本地程序集。它创建最小物品/连接环境，调用游戏组件构造器、ReceiveSignal、Update、真实 Item.SendSignal / Connection.SendSignal 及协程；Harmony 只记录发送事件，不替换游戏计算和信号路由。`ModImport.cs` 使用游戏自带 MoonSharp 执行原始模组的 `parseXML`、`add_all_components_to_circuitbox`、`add_wires_to_circuitbox_recursive` 和 `update_values_in_components`，直接写入真实 DLL 组件，连线校验调用真实 `CircuitBox.VerifyConnection`，然后运行写入后的同一批实例。GUI、库存及 Timer 使用适配器，导入期间暂停组件更新。没有调用游戏或服务器的入口方法，也没有启动游戏进程。

`tools/verify.cjs` 比较每个场景的完整发送序列，并覆盖随机 float 位模式、数学函数、延迟及反馈、全部波形、WiFi 距离/队伍/干扰、正则语法与 Unicode。`tools/mod-validation.cjs` 独立验证全部上游示例和本地保存目录的蓝图：原文件与重新导出版本分别经过原始 Lua 写入 DLL 电路，再与 JS 的 `loadMode: 'blueprints'` 比较。两边不共享导入后的图，避免用游戏侧结果反向构造 JS 测试对象。验证结果及逐文件校验值记录于 `verification.json`。

`tools/trace-comparison.cjs` 实现用户指定的严格绝对容差 `< 1e-6`，仅对有限数值信号放宽比较；文本、事件次序和时序元数据仍精确匹配。验收容差不参与组件运算或条件判断，避免把细小数值误差导致的分支变化掩盖成相同执行结果。

`tools/trig-validation.cjs` 将三角函数差距与角度转换分别验证。前者仅使用 `UseRadians=true`，比较原始 `game-math.js` 与真实 DLL 组件，按 `< 1e-6` 验收。后者将同一 float32 弧度值注入 JS 的原始反三角函数转换路径，并直接调用游戏 `MathHelper.ToDegrees`，要求转换结果精确相同；因此不会把弧度计算误差乘以角度系数后再次计为三角内核误差。原有蓝图整体运行对照继续保留其实际配置。
