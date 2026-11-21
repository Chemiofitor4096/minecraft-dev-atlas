# minecraft-dev-atlas

一个 DeepSeek Harness（DSH）插件：导出运行中 Minecraft 实例的注册表、标签与配方索引，
并以可控的 token 开销供模型查询。

它承担两个包分工中的后半部分：

```
minecraft-dev-starter   →  启动游戏                （ctx.mcdev 服务）
minecraft-dev-atlas     →  读取运行期的数据内容    （两个工具与一个 Java Agent）
```

starter 不依赖本插件；卸载本插件后，starter 的功能不受影响。

## 背景

静态分析无法回答以下问题：`minecraft:stone` 由哪个模组注册、某个模组新增了哪些物品、
数据包加载后存在哪些配方、某个标签包含哪些成员。这些数据仅存在于运行期。

完整的 dump 约为 1 MB（约 210k token），超过上下文窗口的容量，因此 dump 不会进入模型上下文：

- `mc_data_query` 首先返回摘要（每个注册表一行，按命名空间分组）；
- 钻取具有硬性上限（默认 50 行，最多 200 行），并通过 `nextOffset` 分页；
- dump 保存在文件中，面板与模型读取同一份文件：用户可自由浏览，模型只获得摘要与匹配行。

## 依赖

- DSH，且已安装 `minecraft-dev-starter >= 0.3`（本插件 `inject: ['mcdev']`，启动时校验 `capabilities`）；
- 一个具有服务端运行目标（`runServer`）的 Gradle Minecraft 模组工程；
- v0.1 仅支持 **NeoForge 1.21.x + Mojang 官方映射（mojmap）**；缺少对应 adapter 时返回
  `ATLAS_UNSUPPORTED`，不会导出内容不完整的数据；
- Node ≥ 20；仅在构建 agent jar 时需要 JDK 21。

## 安装（开发期）

```powershell
node <npm>/@deepseek-ai/dsh/lib/bin.js plugin --profile desktop add link:C:/Projects/minecraft-dev-atlas
```

随后重启 DSH。以 `link:` 方式安装时，仓库内的修改在重启后生效；`file:` 方式会复制一份副本，
修改仓库不会影响已安装的副本。

安装前需先构建 agent jar（该产物不纳入版本控制）：

```powershell
npm install --legacy-peer-deps
npm run build
```

## 工具与面板

| 工具 | 用途 | 开销 |
|---|---|---|
| `mc_data_dump` | 通过 `-javaagent` 启动 `runServer`，导出注册表、标签与配方，并按 sourceHash 缓存 | 启动并停止一次服务端（30–60 秒）；此后命中缓存 |
| `mc_data_query` | 只读查询：摘要、注册表、标签、配方 | 不启动进程；50 行结果低于 1k token |

面板位于右侧栏的「数据」标签页，由标题栏按钮打开，提供只读表格、搜索、导出与翻页。
数据经宿主的 `/atlas/api` 获取，与工具共用同一套接口；人与模型读取同一份文件，
但面板不受 token 预算限制。面板跟随当前会话的工作区，存在多个工程时提供选择器；
工作区内没有邻近的 Minecraft 工程时，标题栏入口不显示。

两个工具均按步挂载：工作区中不存在 Gradle 工程时，它们不进入 schema，也无法调用。

## 数据存放位置

```
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/dump.json
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/meta.json
```

沿用 starter 的状态目录约定，仅创建本插件自己的 `data/` 子目录，不向用户工程写入任何文件。
`sourceHash` 由构建文件与 `src/**` 的文件名、大小和修改时间计算；哈希相同时直接返回缓存
（`cached: true`）。

## dump 格式

`schema = 1`，权威定义见 starter 仓库的 `doc/schema/dump-v1.schema.json`。要点如下：

- 各段独立处理：失败段落的 `count` 为 0、`entries` 为空数组，并在 `errors[]` 中注明；
- 截断显式标记：`truncated`、`truncatedSections`，以及单段上限 `max`；
- 条目按 id 排序，标签按 tag id 排序，配方按 id 排序；同一工程的两次导出仅
  `generatedAt` 与 `durationMs` 不同；
- 无法读取的字段记为 `null`，并在 `warnings[]` 中注明，不做推测。

## 结构

```
src/                    宿主侧（ESM，无需构建）
  index.js              inject ['mcdev','tools']、能力校验、工具注册
  tools/                mc_data_dump / mc_data_query 与中文渲染
  lib/                  路径、sourceHash、dump 缓存、导出编排、错误码
engine/                 查询引擎（纯函数，零依赖）：parseDump / indexDump / query / digest
agent/                  Java Agent（Gradle、JDK 21、零运行时依赖）
  src/main/java/dev/mcdev/atlas/            骨架：不包含任何游戏类名
  src/main/java/dev/mcdev/atlas/adapters/   适配器（NeoForge + mojmap）：所有反射调用集中于此
assets/mcdev-atlas.jar  构建产物（已忽略，包含在 npm 包中）
```

Agent 的组织方式与 starter 一致：所有映射知识都封装在 adapter 中，按 `adapters.properties` 的
`<loader>/<mappings>/<MC 小版本线>` 选择；新增一格支持即新增一个类与一行表项。

## 命令

```powershell
node --test                     # 引擎、工具与导出编排
npm run build                   # 构建 agent jar、复制到 assets/，并校验 manifest 与版本
node scripts/e2e-export.mjs C:\Projects\Test   # 经宿主路径执行真实导出（需要 JDK 21 与服务端目标）
```

## 状态

- **M-A1（已完成）**：Agent 骨架、NeoForge/mojmap adapter、`mc_data_dump`、缓存与 schema 校验。
  已在 `C:\Projects\Test`（NeoForge 21.1.266 / MC 1.21.1）验证：1339 个物品、1060 个方块、
  707 个标签（6891 个成员）、1290 条配方、`errors: []`；缓存命中 12 ms。
- **M-A2（已完成）**：`mc_data_query` 与 digest，以及面板「数据」标签页（标题栏按钮 → 右侧栏标签页，
  只读表格、搜索、导出、翻页）。缓存命中 12 ms；digest 约 138 token，注册表 50 行约 499 token。
- M-A3（可选）：attach 模式、Fabric/yarn adapter、完整配方 JSON。

## 许可

MIT
