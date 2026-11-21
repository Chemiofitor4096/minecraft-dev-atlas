/**
 * 一次导出的编排：判缓存 → 组 JAVA_TOOL_OPTIONS → 让 starter 起 runServer → 读标记 → 校验 dump → 写 meta。
 *
 * 这里有三个刻意的选择：
 * 1. **不自己 spawn Gradle**：启动、单实例锁、JDK、日志全走 `ctx.mcdev`（本插件不复制 starter）；
 * 2. **以文件为准，不以退出码为准**：dump 在不在、errors[] 有什么，比进程怎么退出更能说明问题；
 * 3. **失败必须可归因**：每个失败码都带 launch 记录与日志尾巴，模型不用再翻一遍日志。
 *
 * @module minecraft-dev-atlas/lib/export
 */

import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { indexDump, javaAgentOption, parseDump, readAllMarkers } from '../../engine/index.js'
import { AtlasError, asAtlasError, fail } from './errors.js'
import { cachedMeta, readDumpText, writeMeta } from './cache.js'
import { jarPath, readJarVersion } from './jar.js'
import { dumpPath } from './paths.js'
import { findGradleRoot, looksLikeGradleProject, sourceFingerprint } from './project.js'

/** 一次导出的总预算：构建 + 启动 + 取数 + 写盘。 */
export const DEFAULT_TIMEOUT_MS = 180_000

/** 给 Agent 的预算：总预算里留 60 秒给 Gradle 构建/下载，避免"宿主先超时杀掉、Agent 还没来得及写"。 */
const AGENT_TIMEOUT_MARGIN_MS = 60_000
const AGENT_TIMEOUT_MIN_MS = 30_000
const AGENT_TIMEOUT_MAX_MS = 600_000

/** 日志尾巴读多少字节：足够带上一段 Gradle 失败与崩溃栈的开头。 */
const LOG_TAIL_BYTES = 16_384

/** 失败信息里带多少行日志。 */
const LOG_TAIL_LINES = 12

/** 只允许结构化任务名，不接受调用方塞命令行。 */
const TASK_PATH_PATTERN = /^:?[A-Za-z0-9_][A-Za-z0-9_.:-]*$/

/**
 * 导出一次。
 *
 * @param {{ mcdev: Record<string, any>, version: string }} deps
 * @param {{ root?: string, workspace?: string, sections?: string[], timeoutMs?: number, refresh?: boolean, taskPath?: string, max?: number, signal?: AbortSignal }} [args]
 * @returns {Promise<Record<string, any>>}
 */
export async function exportDump(deps, args = {}) {
  const startedAt = Date.now()
  const mcdev = deps.mcdev
  const timeoutMs = Number.isFinite(args.timeoutMs) ? Number(args.timeoutMs) : DEFAULT_TIMEOUT_MS
  let root = resolveProject(args)
  const sections = normalizeSections(args.sections)
  let taskPath = normalizeTaskPath(args.taskPath)

  // 多模块：聚合根本身不是可启动的工程，任务在子模块里。先让 starter 的工程视图决定
  // "哪个模块、哪个服务端任务"——不猜：多个模块都有 runServer 时报出来，让调用方指明。
  const target = await resolveExportTarget(mcdev, {
    root,
    workspace: args.workspace,
    taskPath: args.taskPath,
  })
  let gradleRoot = target?.gradleRoot
  if (target !== undefined) {
    root = target.root
    taskPath = target.taskPath
  }

  if (!looksLikeGradleProject(root)) {
    fail('NO_RUN_TARGET', `${root} 不是 Gradle 工程（缺少 build.gradle、settings.gradle 或 gradlew）；数据需从运行中的服务端导出。`)
  }

  const fingerprint = await sourceFingerprint(root)
  gradleRoot = gradleRoot ?? fingerprint.gradleRoot

  if (args.refresh !== true) {
    const cached = await cachedMeta(root, fingerprint.hash)
    if (cached !== undefined) {
      /** @type {Record<string, any>} */
      const value = {
        path: cached.path,
        root,
        taskPath,
        cached: true,
        schema: cached.schema,
        env: cached.env,
        counts: cached.counts,
        warnings: cached.warnings,
        errors: cached.errors,
        truncated: cached.truncated,
        truncatedSections: cached.truncatedSections,
        launch: { status: 'cached', timedOut: false },
        durationMs: Date.now() - startedAt,
      }
      if (fingerprint.truncated) {
        value.note = '工程文件超过指纹上限，缓存可能遗漏新增改动（使用 refresh 重新导出）'
      }
      return value
    }
  }

  const agentJar = deps.jarPath ?? jarPath()
  if (!existsSync(agentJar)) {
    fail('AGENT_BUILD_MISSING', `未找到 agent jar：${agentJar}（本地开发请先执行 npm run build）。`)
  }
  const jarVersion = deps.jarVersion ?? readJarVersion(agentJar)
  if (typeof jarVersion === 'string' && jarVersion !== deps.version) {
    fail('AGENT_BUILD_MISSING', `agent jar 版本为 ${jarVersion}，插件包版本为 ${deps.version}；请重新构建（npm run build），避免插件包与 jar 版本不一致。`)
  }

  const out = dumpPath(root)
  await fs.mkdir(dirname(out), { recursive: true })

  // 多模块的模块共享 Gradle 根下的 run/ 与端口：starter 的单实例锁按 root 记，
  // 两个模块会各跑一个服务端。这里按 Gradle 根再拦一层，只有同构建的实例才算冲突。
  const instances = await safeList(mcdev, {})
  const running = instances.find((entry) => entry?.status === 'starting' || entry?.status === 'running')
  if (running !== undefined) {
    const runningRoot = typeof running.root === 'string' && running.root !== '' ? running.root : root
    const runningGradleRoot = await findGradleRoot(runningRoot)
    if (samePath(runningRoot, root) || samePath(runningGradleRoot, gradleRoot)) {
      fail(
        'ALREADY_RUNNING',
        samePath(runningRoot, root)
          ? `该工程已有运行中的实例 ${running.id}（${running.taskPath}）；请先停止该实例，再执行导出。`
          : `同一 Gradle 工程已有实例 ${running.id}（模块 ${runningRoot}，${running.taskPath}）在运行；模块共享运行目录与端口，请先停止该实例。`,
        {
          launch: { id: running.id, status: running.status, taskPath: running.taskPath, root: runningRoot },
          gradleRoot,
        },
      )
    }
  }

  const agentTimeoutMs = clamp(timeoutMs - AGENT_TIMEOUT_MARGIN_MS, AGENT_TIMEOUT_MIN_MS, AGENT_TIMEOUT_MAX_MS)
  const option = javaAgentOption({
    jar: agentJar,
    out,
    sections,
    timeoutMs: agentTimeoutMs,
    stop: true,
    max: Number.isFinite(args.max) ? Number(args.max) : undefined,
    root,
    sourceHash: fingerprint.hash,
  })

  // JAVA_TOOL_OPTIONS 是唯一"不改用户 build.gradle 也能给游戏 JVM 加参数"的位置。
  // 宿主自己的 JAVA_TOOL_OPTIONS（比如代理）要保留，追加而不是覆盖。
  const inherited = typeof process.env.JAVA_TOOL_OPTIONS === 'string' ? process.env.JAVA_TOOL_OPTIONS.trim() : ''
  const javaToolOptions = inherited === '' ? option : `${inherited} ${option}`

  const launchStartedAt = Date.now()
  /** @type {Record<string, any>} */
  let record
  try {
    record = await mcdev.launch({
      root,
      ...(typeof args.workspace === 'string' && args.workspace !== '' ? { workspace: args.workspace } : {}),
      taskPath,
      env: { JAVA_TOOL_OPTIONS: javaToolOptions },
      wait: 'exit',
      timeoutMs,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  } catch (error) {
    throw translateLaunchError(error, { root, taskPath })
  }

  if (record?.timedOut === true || args.signal?.aborted === true) {
    await safeStop(mcdev, record?.id)
  }

  const logText = await readLogTail(record?.logPath)
  const markers = readAllMarkers(logText)
  const dumpFile = await readDumpText(root)

  const fresh = dumpFile !== undefined && isFresh(dumpFile.text, launchStartedAt)
  if (!fresh) {
    throw classifyMissingDump({ record, markers, logText, root, taskPath, dumpFile })
  }

  let dump
  try {
    dump = parseDump(dumpFile.text)
  } catch (error) {
    const schemaError = asAtlasError(error, 'ATLAS_SCHEMA_MISMATCH')
    const problems = Array.isArray(/** @type {any} */ (schemaError).problems)
      ? /** @type {any} */ (schemaError).problems.slice(0, 5)
      : []
    throw new AtlasError(
      'ATLAS_SCHEMA_MISMATCH',
      `${schemaError.message}\n问题列表：${problems.join('；') || '（无更多细节）'}\ndump: ${dumpFile.path}\n${tail(logText)}`,
      { path: dumpFile.path, problems },
    )
  }

  const index = indexDump(dump)
  const counts = {
    registries: index.counts.registries,
    byRegistry: Object.fromEntries([...index.registries].map(([id, registry]) => [id, registry.count])),
    tags: index.counts.tags,
    tagMembers: index.counts.tagMembers,
    recipes: index.counts.recipes,
  }

  /** @type {import('./cache.js').DumpMeta} */
  const meta = {
    schema: 1,
    pluginVersion: deps.version,
    jarVersion,
    sourceHash: fingerprint.hash,
    taskPath,
    gradleRoot,
    exportedAt: new Date().toISOString(),
    generatedAt: dump.generatedAt,
    env: dump.env,
    counts,
    warnings: dump.warnings,
    errors: dump.errors,
    truncated: dump.truncated,
    truncatedSections: dump.truncatedSections,
    path: dumpFile.path,
    bytes: dumpFile.bytes,
    durationMs: Date.now() - startedAt,
    launchId: record?.id,
  }
  await writeMeta(root, meta)

  const launch = launchValue(record, { timedOut: record?.timedOut === true })
  const partial = record?.timedOut === true || dump.errors.length > 0
  return {
    path: dumpFile.path,
    root,
    taskPath,
    cached: false,
    schema: dump.schema,
    env: dump.env,
    counts,
    warnings: dump.warnings,
    errors: dump.errors,
    truncated: dump.truncated,
    truncatedSections: dump.truncatedSections,
    launch,
    durationMs: Date.now() - startedAt,
    ...(partial
      ? { note: '导出不完整：请查看 errors[] 中失败的段落，日志末尾可定位具体原因' }
      : {}),
    ...(fingerprint.truncated
      ? { fingerprintTruncated: true, note: '工程文件超过指纹上限，下次可能误判缓存（使用 refresh 强制重新导出）' }
      : {}),
  }
}

/**
 * 用 starter 的 `ctx.mcdev.projects()`（可选能力）把"工作区根"落到唯一的可导出工程上。
 *
 * 没有这个能力（starter 太老）或者找不到/找到多个时返回 undefined 或直接报错——
 * 绝不替调用方在多个工程里挑一个。
 * @param {Record<string, any>} mcdev
 * @param {string | undefined} workspace
 * @returns {Promise<{ root: string, taskPath: string } | undefined>}
 */
/**
 * 用 starter 的工程视图解析"从哪个模块、跑哪个服务端任务"。
 *
 * - 简单工程：命中 root，任务就是它的服务端目标；
 * - 多模块聚合根：root 本身没有可启动任务，落到唯一的服务端模块；
 * - 多个模块都有 runServer：不猜，列出候选，让调用方用 root 或 taskPath 指定。
 * @param {Record<string, any>} mcdev
 * @param {{ root: string, workspace?: string, taskPath?: string }} input
 * @returns {Promise<{ root: string, taskPath: string, gradleRoot?: string } | undefined>}
 */
async function resolveExportTarget(mcdev, input) {
  if (typeof mcdev?.projects !== 'function') return undefined
  let scanned
  try {
    // starter 的 projects() 只用 workspace 解析相对 root，不会拿它当扫描根：
    // 这里把绝对 root 一起传下去。
    scanned = await mcdev.projects({
      root: input.root,
      ...(typeof input.workspace === 'string' && input.workspace !== '' ? { workspace: input.workspace } : {}),
    })
  } catch {
    return undefined
  }
  const candidates = (Array.isArray(scanned?.projects) ? scanned.projects : [])
    .map((project) => ({ project, target: serverTargetOf(project) }))
    .filter((entry) => entry.target !== undefined && typeof entry.project?.root === 'string')
  if (candidates.length === 0) return undefined

  if (typeof input.taskPath === 'string' && input.taskPath !== '') {
    const byTask = candidates.find((entry) => entry.target.taskPath === input.taskPath)
    if (byTask !== undefined) return targetOf(byTask)
    fail('NO_RUN_TARGET', `没有找到服务端任务 ${input.taskPath}；可用的服务端任务：${formatCandidates(candidates)}。`)
  }

  const exact = candidates.find((entry) => samePath(entry.project.root, input.root))
  if (exact !== undefined) return targetOf(exact)
  if (candidates.length === 1) return targetOf(candidates[0])
  fail(
    'NO_RUN_TARGET',
    `${input.root} 下存在多个可导出的服务端模块（${candidates.length} 个）：${formatCandidates(candidates)}。请用 root 指定其中一个模块，或用 taskPath 指定服务端任务。`,
  )
}

/**
 * @param {{ project: Record<string, any>, target: { taskPath: string } }} entry
 * @returns {{ root: string, taskPath: string, gradleRoot?: string }}
 */
function targetOf(entry) {
  /** @type {{ root: string, taskPath: string, gradleRoot?: string }} */
  const target = { root: entry.project.root, taskPath: entry.target.taskPath }
  if (typeof entry.project.gradleRoot === 'string' && entry.project.gradleRoot !== '') {
    target.gradleRoot = entry.project.gradleRoot
  }
  return target
}

/**
 * @param {Array<{ project: Record<string, any>, target: { taskPath: string } }>} candidates
 * @returns {string}
 */
function formatCandidates(candidates) {
  const shown = candidates
    .slice(0, 8)
    .map((entry) => `${entry.project.root}（${entry.target.taskPath}）`)
    .join('、')
  return `${shown}${candidates.length > 8 ? '…' : ''}`
}

/**
 * 路径比较：Windows 大小写不敏感，统一 resolve 后按小写比。
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left === '' || right === '') return false
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

/**
 * 工程的服务端运行目标：优先 kind=server，其次以 runServer 结尾的任务名。
 * @param {Record<string, any>} project
 * @returns {{ taskPath: string } | undefined}
 */
function serverTargetOf(project) {
  const targets = Array.isArray(project?.runTargets) ? project.runTargets : []
  const target = targets.find((entry) => entry.kind === 'server')
    ?? targets.find((entry) => typeof entry.taskPath === 'string' && /(^|:)runServer$/.test(entry.taskPath))
  return target === undefined ? undefined : { taskPath: target.taskPath }
}

/**
 * 解析调用方给的工程目录：相对路径按调用方会话 cwd 解析，没给就用工作区。
 * @param {{ root?: string, workspace?: string }} args
 * @returns {string}
 */
export function resolveProject(args) {
  if (typeof args.root === 'string' && args.root !== '') {
    return resolve(typeof args.workspace === 'string' && args.workspace !== '' ? args.workspace : process.cwd(), args.root)
  }
  if (typeof args.workspace === 'string' && args.workspace !== '') return resolve(args.workspace)
  return resolve(process.cwd())
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeSections(value) {
  if (!Array.isArray(value) || value.length === 0) return ['registries', 'tags', 'recipes']
  /** @type {string[]} */
  const sections = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const section = entry.trim()
    if (!['registries', 'tags', 'recipes'].includes(section)) {
      fail('BAD_REQUEST', `未知段落 ${JSON.stringify(entry)}（可用值：registries、tags、recipes）。`)
    }
    if (!sections.includes(section)) sections.push(section)
  }
  return sections.length > 0 ? sections : ['registries', 'tags', 'recipes']
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTaskPath(value) {
  if (value === undefined || value === null || value === '') return 'runServer'
  if (typeof value !== 'string' || !TASK_PATH_PATTERN.test(value)) {
    fail('BAD_REQUEST', `taskPath 必须是 Gradle 任务路径（例如 runServer 或 :fabric:runServer），收到 ${JSON.stringify(value)}。`)
  }
  return value
}

/**
 * 把 starter 的错误码翻成我们的失败码：BAD_TASK 就是"没有 runServer"。
 * @param {unknown} error
 * @param {{ root: string, taskPath: string }} context
 */
function translateLaunchError(error, context) {
  const atlas = asAtlasError(error, 'LAUNCH_FAILED')
  const code = atlas.code
  if (code === 'BAD_TASK') {
    return new AtlasError(
      'NO_RUN_TARGET',
      `${context.root} 缺少 ${context.taskPath} 目标（NeoForge 工程的 runs 块中需包含 server；多模块工程请用 taskPath 指向具体模块）。`,
      { cause: atlas.message },
    )
  }
  if (code === 'ALREADY_RUNNING') {
    return new AtlasError('ALREADY_RUNNING', atlas.message)
  }
  return new AtlasError('LAUNCH_FAILED', atlas.message)
}

/**
 * 没有 dump 时按日志/标记归因——这一步给出的是"下一步该查什么"，不是"失败了"。
 * @param {{ record?: Record<string, any>, markers: Array<Record<string, string>>, logText: string, root: string, taskPath: string, dumpFile?: unknown }} input
 * @returns {AtlasError}
 */
function classifyMissingDump(input) {
  const { record, markers, logText, taskPath, root } = input
  const launch = launchValue(record, { timedOut: record?.timedOut === true })
  const detail = `\nlaunch: ${JSON.stringify(launch)}\n日志末尾：\n${tail(logText)}`

  const taskMissing = /Task ['"][^'"]+' not found|Cannot locate tasks that match/i.test(logText)
  if (taskMissing) {
    return new AtlasError('NO_RUN_TARGET', `${root} 缺少 ${taskPath} 目标（Gradle 报 Task not found）。${detail}`, { launch })
  }

  const unsupported = markers.find((marker) => marker.kind === 'unsupported')
  if (unsupported !== undefined) {
    return new AtlasError(
      'ATLAS_UNSUPPORTED',
      `当前运行时没有可用的 adapter：loader=${unsupported.loader} mappings=${unsupported.mappings} mc=${unsupported.mc}（${unsupported.reason}）。${detail}`,
      { env: { loader: unsupported.loader, mappings: unsupported.mappings, mcVersion: unsupported.mc }, launch },
    )
  }

  const ready = markers.find((marker) => marker.kind === 'ready')
  const inert = markers.find((marker) => marker.kind === 'inert')
  if (ready === undefined) {
    const reason = inert === undefined ? '日志中没有 [mcdev-atlas] 标记' : `Agent 在该进程中处于 inert 状态（${inert.reason}）`
    return new AtlasError(
      'ATLAS_NOT_LOADED',
      `服务端已启动，但 Agent 未生效：${reason}。常见原因：starter 未将 JAVA_TOOL_OPTIONS 传入游戏 JVM。${detail}`,
      { launch, markers },
    )
  }

  if (record?.timedOut === true) {
    return new AtlasError('ATLAS_TIMEOUT', `等待导出超时，且未生成 dump（Agent 已就绪，可能阻塞在取数或写盘阶段）。${detail}`, { launch })
  }
  if (record?.outcome !== undefined && record.outcome !== null && record.outcome !== 'normal') {
    return new AtlasError(
      'LAUNCH_FAILED',
      `服务端以 ${record.outcome}（退出码 ${record.exitCode ?? '未知'}）结束，未生成 dump。${detail}`,
      { launch },
    )
  }
  const failed = markers.filter((marker) => marker.kind === 'failed')
  const failureText = failed.length > 0
    ? `Agent 的失败记录：${failed.map((marker) => `${marker.stage ?? '?'}=${marker.error ?? '?'}`).join('；')}`
    : 'Agent 记录了 ready，但未写出 dump'
  return new AtlasError('ATLAS_NO_DUMP', `${failureText}${detail}`, { launch, markers })
}

/**
 * dump 是不是这次导出的：generatedAt 必须晚于启动时间（留 5 秒容差）。
 * @param {string} text
 * @param {number} launchStartedAt
 */
function isFresh(text, launchStartedAt) {
  try {
    const value = JSON.parse(text)
    const generatedAt = Date.parse(value?.generatedAt)
    if (Number.isNaN(generatedAt)) return false
    return generatedAt >= launchStartedAt - 5_000
  } catch {
    return false
  }
}

/**
 * 读日志尾部；文件不存在就是空串。
 * @param {unknown} path
 * @returns {Promise<string>}
 */
async function readLogTail(path) {
  if (typeof path !== 'string' || path === '') return ''
  try {
    const buffer = await fs.readFile(path)
    const tailBuffer = buffer.length > LOG_TAIL_BYTES ? buffer.subarray(buffer.length - LOG_TAIL_BYTES) : buffer
    return tailBuffer.toString('utf8')
  } catch {
    return ''
  }
}

/**
 * 把日志尾巴压成几行有用的：错误特征行优先，其次最后几行。
 * @param {string} text
 * @returns {string}
 */
function tail(text) {
  if (typeof text !== 'string' || text.trim() === '') return '（日志为空）'
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const interesting = lines.filter((line) =>
    /BUILD FAILED|FAILURE:|Caused by:|Exception|Error:|error:|Task .* not found|\[mcdev-atlas\]/i.test(line))
  const picked = [...new Set([...interesting.slice(-LOG_TAIL_LINES), ...lines.slice(-6)])]
  return picked.slice(-LOG_TAIL_LINES).map((line) => (line.length > 300 ? `${line.slice(0, 300)}…` : line)).join('\n')
}

/**
 * @param {Record<string, any>} mcdev
 * @param {{ root?: string, workspace?: string }} input
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function safeList(mcdev, input) {
  try {
    const list = await mcdev.list(input)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * 停止失败不改写原始结论：导出的错误信息已经够查了。
 * @param {Record<string, any>} mcdev
 * @param {unknown} id
 */
async function safeStop(mcdev, id) {
  if (typeof id !== 'string' || id === '') return
  try {
    await mcdev.stop({ id })
  } catch {
    // 实例可能已经退出
  }
}

/**
 * 输出值的 launch 部分：只放存在的字段（无损 JSON，不放 undefined，也不堆 null）。
 * @param {Record<string, any> | undefined} record
 * @param {{ timedOut: boolean }} extra
 */
function launchValue(record, extra) {
  /** @type {Record<string, any>} */
  const value = { timedOut: extra.timedOut }
  if (record === undefined || record === null) return value
  if (typeof record.id === 'string') value.id = record.id
  if (typeof record.status === 'string') value.status = record.status
  if (typeof record.outcome === 'string') value.outcome = record.outcome
  if (typeof record.exitCode === 'number') value.exitCode = record.exitCode
  if (typeof record.verdict === 'string') value.verdict = record.verdict
  if (typeof record.logPath === 'string') value.logPath = record.logPath
  if (typeof record.taskPath === 'string') value.taskPath = record.taskPath
  return value
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
