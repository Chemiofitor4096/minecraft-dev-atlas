# CHANGELOG

## 0.1.0 — 2026-11-21 · M-A1 + M-A2

首版：把运行中的 Minecraft 数据导出来，人能翻、模型能查。

### Agent（`assets/mcdev-atlas.jar`，Java 21，零第三方依赖）

- 骨架：`premain` / `agentmain`、参数解析（`out/sections/stop/timeout/max/loader/mappings/root/sourcehash`）、
  超时、tmp + rename 写盘、`[mcdev-atlas]` 单行事件日志；骨架里没有一处游戏类名。
- adapter 表：`adapters.properties` 按 `<loader>/<mappings>/<MC 小版本线>` 选类，没有表就报
  `unsupported`，不导半份 null。
- `NeoForgeMojmap1210`（NeoForge 1.21.x / mojmap）：物品、方块、实体类型、流体、状态效果、附魔
  （动态注册表走 `registryAccess()`）；item/block/fluid 标签；配方索引（id / type / result /
  ingredients，`json: null`）。
- 进程判定：Gradle daemon 里打一行 `inert` 就退出；等就绪最多 `timeout`；超时也写出已完成的部分。
- 停服走 `/stop` 同一条路（`halt(false)`），保存交给服务端主线程，Gradle 干净退出（退出码 0）。
- 缺字段进 `warnings[]`（例如 1.21.1 读不到 `item.burnTime`），单段失败进 `errors[]` 且该段
  `count: 0`。

### 宿主（DSH bundle）

- `inject: ['mcdev','tools','sessions']`；启动握手 `ctx.mcdev.capabilities`（缺 `launch` 就抛
  `SERVICE_VERSION_MISMATCH`，要求 starter ≥ 0.3）。
- `mc_data_dump`：sourceHash 缓存（命中 ~12 ms）、`ALREADY_RUNNING` 前置检查、`JAVA_TOOL_OPTIONS`
  注入、失败归因（`NO_RUN_TARGET` / `LAUNCH_FAILED` / `ATLAS_NOT_LOADED` / `ATLAS_UNSUPPORTED` /
  `ATLAS_TIMEOUT` / `ATLAS_NO_DUMP` / `ATLAS_SCHEMA_MISMATCH`）、中文渲染。
- `mc_data_query`：只读，摘要优先，默认 50 条 / 上限 200，`nextOffset` 翻页，`stale` 标记。
- 两个工具都按步挂载（工作区或直接子目录里有 Gradle 工程才挂），挂载后约 516 token。
- 数据落 `$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/`，不往用户工程写文件。

### 引擎（零依赖）

- `parseDump` / `validateDump`（手写 schema=1 校验，错误点名到字段）。
- `indexDump` / `digest` / `query`：`Map<id, entry>` / `Map<tag, members>` / `Map<result, recipes>`
  内存索引；摘要按命名空间分组；精确命中才带 `class`，列表页不带（省上下文）。
- `javaAgentOption` / `readLogMarkers` / `readAllMarkers`：jar 契约的纯函数形态。

### 面板（M-A2）

- 标题栏「数据」按钮（`conversation.session.header.utilities`，order 16）→ 右侧栏 `atlas.data`
  标签，带图标标题 chip；`ctx.sidebarRight.openTab` 打开即展开。
- 只读表格三种视图：注册表（id / 来源 / 属性）、标签（列表 + 成员，点标签钻进去）、
  配方（id / 类型 / 产物 / 材料）；搜索 250ms 防抖、50 条一页、上一页 / 下一页。
- 「导出 / 重新导出」按钮显示计时（服务端起停 30–60 秒）；「刷新」只重读缓存不起进程。
- 文案 zh/en 两套词典跟随宿主 locale；样式一次性注入，只用 `--dsw-*` 令牌。
- 宿主 `/atlas/api`：`data.state` / `data.query` / `data.dump` / `ping` / `client.report`；
  默认 workspace 取最近一个活跃会话的 cwd（`ATLAS_WORKSPACE` 可固定），客户端只用相对路径。
- 客户端用 esbuild 打成懒 CJS（32.2 KiB），`prepack` 与 `pretest` 都会现构建。

### 测试

- `node --test`：98 个测试，覆盖引擎、契约、路径、工程指纹、工具与挂载、导出编排（缓存/失败/
  并发拦截/旧 dump）、atlas 门面、jar manifest、客户端产物协议、样式护栏、双语词典、
  面板方法表与 `/atlas/api` 路由（假 req/res 真打）。
- 真机 `C:\Projects\Test`（NeoForge 21.1.266 / MC 1.21.1）：1339 物品、1060 方块、130 实体类型、
  5 流体、39 状态效果、42 附魔；707 标签 / 6891 成员；1290 配方；`errors: []`；dump 约 993 KB。
