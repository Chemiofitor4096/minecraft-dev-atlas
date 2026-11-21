# AGENTS.md

给在这个仓库里干活的 agent（和以后的自己）看的。用户向说明在 [README](./README.zh_CN.md)；
上游设计与契约在 starter 仓库：`doc/策划-atlas插件.md`、`doc/拓展-MC数据导出.md`、
`doc/schema/dump-v1.schema.json`。

## 这是什么

DSH 插件：带 Java Agent 起一次 headless 服务端，把注册表 / 标签 / 配方索引导出成一份
`schema=1` 的 dump，然后让模型用摘要 + 分页查询（`mc_data_dump` / `mc_data_query`）。

- 宿主侧：ESM、无 TypeScript、JSDoc；Node ≥ 20；
- 查询引擎：纯函数、零依赖（`engine/`）；
- Agent：Java 21、Gradle、零第三方运行时依赖；**骨架里没有一处游戏类名**，映射只存在 adapter 里。

## 目录

```
src/index.js            宿主入口：inject ['mcdev','tools','sessions']、能力握手、注册工具、挂 /atlas/api
src/tools/              mc_data_dump / mc_data_query + 中文渲染（render.js）+ 挂载判定（shared.js）
src/lib/
  atlas.js              门面：dump / query / state；索引按 mtime+size 缓存
  export.js             一次导出的编排（缓存 → JAVA_TOOL_OPTIONS → ctx.mcdev.launch → 读标记 → 校验 → meta）
  panelApi.js           面板的窄方法表：data.state / data.query / data.dump / ping
  paths.js              状态目录（复用 starter 约定）、projectKey
  project.js            Gradle 工程探针 + sourceHash（文件名/大小/mtime，不读内容）
  cache.js              dump 与 meta 的读写、缓存命中判定
  jar.js                zip/manifest 读取（零依赖，prepack 与测试共用）
  errors.js             错误码表（中文含义与工具错误文本）
src/client/             客户端半边（React + h()，esbuild 打成懒 CJS）
  index.js              标题栏「数据」按钮、右侧栏标签类型 / 正文 / 标题 chip
  views/DataTab.js      只读表格 + 搜索 + 导出 + 翻页
  views/DataButton.js   标题栏入口
  lib/                  api（相对路径 fetch）/ messages（zh+en）/ styles（--dsw-* 令牌）/ format / icons / runtime
engine/
  dump.js               parseDump / validateDump（手写 schema=1 校验）
  index.js              indexDump / digest / query（纯函数）
  contract.js           javaAgentOption / readLogMarkers / 能力清单
agent/
  build.gradle.kts      jar 名固定 mcdev-atlas.jar，版本读 ../package.json
  src/main/java/dev/mcdev/atlas/            骨架：premain/agentmain/参数/日志/JSON/反射/写盘
  src/main/java/dev/mcdev/atlas/adapters/   NeoForgeMojmap1210：唯一放类名/方法名的地方
  src/main/resources/adapters.properties    <loader>/<mappings>/<MC 线> → adapter 类
assets/mcdev-atlas.jar  构建产物（gitignore；prepack 现构建）
lib/client.js           客户端构建产物（gitignore；prepack 现构建）
scripts/                build-agent.mjs / build-client.mjs / e2e-export.mjs
test/                   node --test；fixtures/dump-small.json 是引擎夹具
```

## 命令

```powershell
node --test                                   # 全部测试（Node 20 不认 glob，别写 test/*.test.js）
npm run build                                 # agent jar + 客户端（要 JDK 21）
npm run build:client                          # 只构建客户端（改 src/client 后至少跑这个）
node scripts/build-agent.mjs --skip-build     # 只拷贝 + 校验（CI 已构建过时）
node scripts/e2e-export.mjs C:\Projects\Test  # 走宿主路径的真机导出
```

## 硬坑（都踩过）

| 现象 | 原因 | 做法 |
|---|---|---|
| 游戏 JVM 里 Agent 完全不生效 | `JAVA_TOOL_OPTIONS` 没传到 JavaExec 子进程 | 宿主把它放在 `ctx.mcdev.launch({ env })` 里；starter 合并到 spawn 环境。daemon 会转发 client 的环境变量，实测 9.2.1 成立 |
| `Class.forName("net.minecraft...")` 在 Agent 里失败 | 游戏类在 ModLauncher 的转换加载器里，不在系统加载器 | `Reflect.awaitGameLoader` 用 `Instrumentation.getAllLoadedClasses()` 找到加载了 `SharedConstants` 的那个 ClassLoader，之后所有查找都走它 |
| 停服把进程挂死 60 秒，watchdog 崩服 | `MinecraftServer#stopServer()` 内部 `waitUntilNextTick()`；从 tick 任务里调会把自己等死，从外部线程调会和主线程抢保存 | 用 `/stop` 命令同一条路：`halt(false)`（只置 running=false），保存交给服务端主线程 |
| `env.side` 导成 client | 开发环境 classpath 上客户端类也存在，`Minecraft` 类在不在不是判据 | 以实例为准：`MinecraftServer#isDedicatedServer()` / `DedicatedServer` 类名 |
| `generatedAt` 解析失败 | `Instant.toString()` 带纳秒（`.449571200Z`），不是所有解析器都吃 | `Instant.now().truncatedTo(ChronoUnit.MILLIS)` |
| 日志标记解析不出来 | 值里有空格，或把位置词写成了 key=value | 值一律 `AgentLog.value()` 折空白；位置词用 `eventNamed`（`section registries count=…`） |
| "包升级了、jar 还是旧的" | `assets/*.jar` 是构建产物 | `build-agent.mjs` 比对 manifest 的 `Implementation-Version` 与 `package.json.version`，不等直接失败 |
| 导出后读到了上一次的 dump | 失败时旧 dump 还在 | `generatedAt` 必须晚于本次启动（5 秒容差）；不满足按"没写出"归因 |
| `npm install` 被 peer 挡住 | `peerDependencies` 里有未发布的 `minecraft-dev-starter` | 开发期 `npm install --legacy-peer-deps`；`@deepseek-ai/*` 的 peer 已显式列进 devDependencies |
| npm 在 PowerShell 里不能执行 | 执行策略禁用了 `npm.ps1` | 用 `npm.cmd`；`npm test` 的 pretest 会先构建客户端 |
| 客户端整包不加载 | 没有 `__ModuleLoader__.load` 包装 / factory 里用了 ESM | esbuild 打 CJS，banner/footer 在 `scripts/build-client.mjs`；`test/bundle.test.js` 在 VM 里真跑一遍 |
| 面板拿不到数据 | 面板没有"当前会话"，宿主按最近一个会话 cwd 解析 | 会话作用域的 slot（标题栏 utilities、右侧栏 tab 正文）都能拿到 `sessionId` + `useSessions`（slots 的 session 标准包）；把它们喂进 workspace store，不要用宿主默认 |
| 面板/入口停在上一个会话的工程 | 用"宿主最近一个会话"当默认工作区 | 同上：`setWorkspace(session cwd)`；切会话时先清空再识别 |
| 入口在非 MC 工作区常驻 | 只判"有没有 MC 工程"会把 `templates/`、`test/` 夹具算进来 | 判据是"近处"工程：cwd 本身或直接子目录（`projectDepth <= 1`）；`kind=unknown` 不算 |
| `ctx.mcdev.projects({ workspace })` 扫的是宿主默认目录 | starter 的 `resolveRoot` 是 `requested ?? resolveRoot()`，`workspace` 只解析**相对 root** | 调用时把绝对的 `root` 一起传下去（`{ root: workspace, workspace }`） |
| 面板导出打到工作区根而不是工程 | 只传 workspace 时 atlas 把 workspace 当 root | 面板传 `root` + `taskPath`（`kind=server`）；工具在"工作区根不是工程"时用 projects 回退到唯一候选 |
| 客户端 fetch 被 CORS 拒 | 用了绝对 origin | 桌面外壳页面是 `dsh-app://app/`，必须 `/atlas/api/...` 相对路径 |

其他约定：

- **文案语体**：README、面板文案与面向用户的错误消息统一使用书面语。避免“点一下 / 取出来 / 跑起来 /
  没有了”这类口语表达，也不对读者使用第二人称说教；技术名词保持原样（dump、schema、token、loader）。
  工具描述仍是英文契约，工具执行结果（render）仍是中文。
- **工具描述英文、render 中文**；描述一到两句（是什么 + 最容易踩的约束），参数与返回交给 schema。
- **两个工具都按步挂载**：工作区（或直接子目录）里有 `build.gradle* / settings.gradle* / gradlew*` 才挂；
  判不出来按可见处理。判定按 cwd 缓存 60 秒，导出成功后清缓存。
- **返回值必须是无损 JSON**：不放 `undefined`，可缺的字段就不放（不要用 null 占位）。
- **错误必须能指导下一步**：每个失败码带 launch 记录与日志尾巴（`export.js` 的 `tail()`）。
- **一个工程只允许一个实例**：导出前先 `mcdev.list`，有 running 就报 `ALREADY_RUNNING`，不排队。
- **dump 永远不进上下文**：查询默认 50 条、上限 200，摘要先给 `digest`。
- **不 import starter 的文件**：两包独立发版，唯一通道是 `ctx.mcdev` 的四个方法。

## 验证记录

### M-A1（2026-11-21，通过）

- `C:\Projects\Test`（NeoForge 21.1.266 / MC 1.21.1 / mojmap）真机导出：
  1339 物品、1060 方块、130 实体类型、5 流体、39 状态效果、42 附魔；
  707 个标签 / 6891 个成员；1290 条配方；`errors: []`；dump 约 993 KB；取数写盘 < 1 s。
- 服务端从 premain 到写盘到 `halt(false)` 干净退出（Gradle 退出码 0，`BUILD SUCCESSFUL in 14s`）。
- 两条真机路径都跑过：`gradlew.bat runServer` 手动注入 `JAVA_TOOL_OPTIONS`（验 Agent），以及
  `node scripts/e2e-export.mjs C:\Projects\Test`（验宿主编排：sourceHash → launch → 标记 → schema → meta）。
- 缓存：第二次导出 `cached: true`，**12 ms**（判据 < 100 ms）。
- 上下文成本（按 4 字符/token）：两个工具挂载后 **516 token**；digest **138 token**；
  注册表 50 行 **499 token**；配方 50 行 **394 token**（判据 < 1k）。
- 独立 profile 加载：`atlas-smoke`（`@deepseek-ai/dsh-base` + starter + atlas）启动日志同时出现
  `[mcdev] host ready (0.3.0)` 与 `[mcdev-atlas] host ready (0.1.0)`，说明 `inject: ['mcdev','tools']`
  与能力握手在真 cordis 下成立。
- `npm pack --dry-run`：143 KB 解包，带 `assets/mcdev-atlas.jar`、`engine/`、`src/`，
  不带 `test/`、`scripts/`。
- Node 侧 72 个测试：引擎校验/查询/摘要、工具与挂载、导出编排（缓存命中、失败归因、ALREADY_RUNNING、
  schema mismatch、旧 dump）、atlas 门面、jar manifest。
- 已知不足：`item.burnTime` 在 1.21.1 没有跨 loader 的读取入口，固定 null + 一条 warning；
  配方 `ingredients` 里空槽位是 `[]`（shaped 配方如此，shapeless 目前也可能出现空层）。

### M-A2（2026-11-21，通过）

- `mc_data_query` + digest 已实现并量过（见 M-A1 的 token 数字）。
- 面板「数据」tab：标题栏按钮（`conversation.session.header.utilities`，order 16）→ 右侧栏
  `atlas.data` 标签；只读表格（注册表 / 标签 + 成员 / 配方三种视图）+ 搜索（250ms 防抖）+
  「导出 / 重新导出」+ 翻页；文案 zh/en 两套词典；样式只用 `--dsw-*` 令牌。
- 宿主 `/atlas/api`：`data.state` / `data.query` / `data.dump` / `ping` / `client.report`；
  默认 workspace 取最近一个活跃会话 cwd（`ATLAS_WORKSPACE` 可固定）。
- 客户端产物 32.2 KiB；`test/bundle.test.js` 在 VM 里按 `__ModuleLoader__` 协议真跑：
  外壳 id、cordis 形状、按钮 / 标签类型 / 正文 / 标题 chip 四处注册、样式只注入一次。
- `test/host.test.js` 用假 req/res 真打路由：ping、data.state、data.query（读真 dump）、
  未知方法 404、GET 非 ping 405、client.report、data.dump 的失败码透传。
- 真 web 运行时（临时 profile `atlas-web-smoke` = base + web-app + starter + atlas）：
  启动日志出现 `[mcdev] http routes mounted at /mcdev/api` 与 `[mcdev-atlas] http routes mounted at /atlas/api`，
  `GET /atlas/api/ping` 200；页面 preload 列表包含 `minecraft-dev-atlas/client.js`，
  合并后的 client bundle 里能找到 `id: 'minecraft-dev-atlas'`、`.atlas-panel`、`minecraft-dev-atlas:data-button`。
- 合计 98 个测试全绿。
- 尚未做：真机面板的视觉冒烟（需要装在 desktop / mc-dev-starter profile 并重启 DSH 后用眼睛看）。

### 跟随会话与入口判据（2026-11-21 修订，通过）

- **面板跟当前会话**：`DataButton` 与 `DataTab` 都从 session 标准 props 取 cwd（`sessionId` +
  `useSessions`），喂 `workspaceStore`；切会话先清空再识别。位置：`src/client/lib/workspace.js`
  （无 React，可在 Node 里测） + `useWorkspace.js`。
- **入口判据**：`hasNearbyMcProject(projects, cwd)`（cwd 或直接子目录内、`kind != unknown`）才显示
  「数据」按钮；`C:\Projects\minecraft-dev-starter` 的 `templates/*` 与 `test/*` 夹具不再让入口常驻。
  老 starter（没有 `ctx.mcdev.projects()`）或识别异常时退回"总是显示"。
- **工程选择**：`/atlas/api/data.projects` 走 `ctx.mcdev.projects()`；面板按 cwd → 附近能跑服务端的
  → 第一个的顺序默认；多工程给选择器；导出传 `root` + `taskPath`。
- **starter 语义坑**：`projects.scan` 的 `workspace` 只解析相对 root；服务调用必须传绝对 `root`，
  否则扫的是宿主默认会话（真机复现：面板在 Test 会话里却扫到 `minecraft-dev-atlas`）。
- **工作区根回退**：`export.js` 在工作区根不是工程且没显式给 root 时，用 `mcdev.projects` 落到
  唯一可导出工程；多个 → `NO_RUN_TARGET` 列出候选（最多 8 个）。
- 真 web 运行时（临时 profile）验证：`data.projects` 对 4 个工作区返回正确工程；面板 API 触发导出
  14 秒完成、`exitCode 0`、计数与真机一致；服务端 client bundle 里包含 `data.projects`、
  `panel.noProject`、`hasNearbyMcProject`。
- 合计 120 个测试全绿。
