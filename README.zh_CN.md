# minecraft-dev-atlas

一个 DeepSeek Harness（DSH）插件：把**运行中的 Minecraft 里到底有什么**导出来——注册表、标签、
配方索引——并且让模型用很省 token 的方式查。

它是两个包分工里的后半截：

```
minecraft-dev-starter   →  怎么把游戏跑起来        （ctx.mcdev 服务）
minecraft-dev-atlas     →  跑起来之后里面有什么    （两个工具 + 一个 Java Agent）
```

starter 不知道这个包存在；卸载它，starter 一切照常。

## 为什么

静态分析回答不了这些问题：`minecraft:stone` 是谁注册的、这个模组加了哪些物品、数据包加载后到底有哪些
配方、某个标签里到底有谁。这些数据**只存在于运行期**。

整份 dump 约 1 MB（约 210k token），比整个上下文窗口还大，所以 dump **永远不进模型**：

- `mc_data_query` 先给摘要（每个注册表一行、按命名空间分组）；
- 钻取有硬上限（默认 50 行、最多 200 行）并带 `nextOffset` 翻页；
- dump 是一个文件，面板与模型共用：人随便翻，模型只拿摘要与命中行。

## 依赖

- DSH，且装了 `minecraft-dev-starter >= 0.3`（本插件 `inject: ['mcdev']`，启动时握手 `capabilities`）；
- 一个带服务端运行目标（`runServer`）的 Gradle Minecraft 模组工程；
- v0.1 只支持 **NeoForge 1.21.x + Mojang 官方名（mojmap）**；没有 adapter 就报 `ATLAS_UNSUPPORTED`，
  不导半份 null；
- Node ≥ 20；只有构建 agent jar 才需要 JDK 21。

## 安装（开发期）

```powershell
node <npm>/@deepseek-ai/dsh/lib/bin.js plugin --profile desktop add link:C:/Projects/minecraft-dev-atlas
```

然后重启 DSH。改代码重启即生效；用 `link:`（不是 `file:`）才是活的。

装之前先构建 agent jar（不进仓库）：

```powershell
npm install --legacy-peer-deps
npm run build
```

## 两个工具 + 一个面板

| 工具 | 做什么 | 代价 |
|---|---|---|
| `mc_data_dump` | 带 `-javaagent` 起 `runServer`，导出注册表/标签/配方，按 sourceHash 缓存 | 一次服务端起停（30–60 秒），之后走缓存 |
| `mc_data_query` | 只读：摘要 / 注册表 / 标签 / 配方查询 | 不起进程，50 行 < 1k token |

面板是右侧栏的「数据」标签（标题栏按钮进入）：只读表格 + 搜索 + 导出 + 翻页，数据走宿主的
`/atlas/api`，与工具共用同一个门面；人和模型看的是同一份文件，但人不受 token 预算限制。

两个工具都按步挂载：工作区里没有 Gradle 工程时它们不进 schema、也不可调用。

## 数据落在哪

```
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/dump.json
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/meta.json
```

沿用 starter 的 state 目录约定，只往下建自己的 `data/` 子目录，**不往用户工程里写任何东西**。
`sourceHash` 由构建文件与 `src/**` 的文件名 + 大小 + mtime 算出；相同就返回缓存（`cached: true`）。

## dump 格式

`schema = 1`，权威定义在 starter 仓库的 `doc/schema/dump-v1.schema.json`。要点：

- 每段独立成功：失败的段落是 `count: 0`、`entries: []`，并且在 `errors[]` 里点名；
- 截断显式：`truncated`、`truncatedSections`，单段上限 `max`；
- 条目按 id 排序、标签按 tag 排序、配方按 id 排序——同一工程两次导出只差 `generatedAt`/`durationMs`；
- 读不到的字段是 `null` 并在 `warnings[]` 里点名，绝不猜。

## 结构

```
src/                    宿主半边（ESM，无构建）
  index.js              inject ['mcdev','tools']、能力握手、注册工具
  tools/                mc_data_dump / mc_data_query + 中文渲染
  lib/                  路径、sourceHash、dump 缓存、导出编排、错误码
engine/                 纯查询引擎（零依赖）：parseDump / indexDump / query / digest
agent/                  Java Agent（Gradle、JDK 21、零运行时依赖）
  src/main/java/dev/mcdev/atlas/            骨架：没有一处游戏类名
  src/main/java/dev/mcdev/atlas/adapters/   NeoForge + mojmap：所有反射都在这里
assets/mcdev-atlas.jar  构建产物（gitignore，进 npm 包）
```

Agent 与 starter 同形：**每一处映射知识都关在 adapter 里**，按 `adapters.properties` 的
`<loader>/<mappings>/<MC 小版本线>` 选；新增一格 = 一个类 + 一行表。

## 命令

```powershell
node --test                     # 引擎 + 工具 + 导出编排
npm run build                   # 构建 agent jar、拷到 assets/、校验 manifest 与版本
node scripts/e2e-export.mjs C:\Projects\Test   # 走宿主路径的真机导出（要 JDK 21 与服务端目标）
```

## 状态

- **M-A1（已完成）**：Agent 骨架、NeoForge/mojmap adapter、`mc_data_dump`、缓存与 schema 校验。
  已在 `C:\Projects\Test`（NeoForge 21.1.266 / MC 1.21.1）上验过：1339 个物品、1060 个方块、
  707 个标签（6891 个成员）、1290 条配方、`errors: []`；缓存命中 12 ms。
- **M-A2（已完成）**：`mc_data_query` + digest + 面板「数据」tab（标题栏按钮 → 右侧栏标签，
  只读表格 / 搜索 / 导出 / 翻页）。缓存命中 12 ms；digest 约 138 token，注册表 50 行约 499 token。
- M-A3（可选）：attach 模式、Fabric/yarn adapter、完整配方 JSON。

## 许可

MIT
