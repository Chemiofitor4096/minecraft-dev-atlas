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
import { looksLikeGradleProject, sourceFingerprint } from './project.js'

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
  const root = resolveProject(args)
  const sections = normalizeSections(args.sections)
  const taskPath = normalizeTaskPath(args.taskPath)

  if (!looksLikeGradleProject(root)) {
    fail('NO_RUN_TARGET', `${root} 不是 Gradle 工程（没有 build.gradle / settings.gradle / gradlew）：数据只能从运行中的服务端导出`)
  }

  const fingerprint = await sourceFingerprint(root)

  if (args.refresh !== true) {
    const cached = await cachedMeta(root, fingerprint.hash)
    if (cached !== undefined) {
      /** @type {Record<string, any>} */
      const value = {
        path: cached.path,
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
        value.note = '工程文件超过指纹上限，缓存可能漏掉新改动（用 refresh 重导）'
      }
      return value
    }
  }

  const agentJar = deps.jarPath ?? jarPath()
  if (!existsSync(agentJar)) {
    fail('AGENT_BUILD_MISSING', `找不到 agent jar：${agentJar}（本地开发先跑 npm run build）`)
  }
  const jarVersion = deps.jarVersion ?? readJarVersion(agentJar)
  if (typeof jarVersion === 'string' && jarVersion !== deps.version) {
    fail('AGENT_BUILD_MISSING', `agent jar 是 ${jarVersion}，插件包是 ${deps.version}：先重新构建（npm run build），否则会出现"包升了、jar 还是旧的"`)
  }

  const out = dumpPath(root)
  await fs.mkdir(dirname(out), { recursive: true })

  // 正在跑就不导：一个工程只允许一个实例，第二条 runServer 会被 starter 直接拒掉
  const instances = await safeList(mcdev, { root, workspace: args.workspace })
  const running = instances.find((entry) => entry?.status === 'starting' || entry?.status === 'running')
  if (running !== undefined) {
    fail('ALREADY_RUNNING', `这个工程已经有实例 ${running.id}（${running.taskPath}）在跑；先停止再导出`, {
      launch: { id: running.id, status: running.status, taskPath: running.taskPath },
    })
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
      `${schemaError.message}\n问题：${problems.join('；') || '（无更多细节）'}\ndump: ${dumpFile.path}\n${tail(logText)}`,
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
      ? { note: '导出不完整：看 errors[] 里失败的段落，日志尾巴能定位到具体原因' }
      : {}),
    ...(fingerprint.truncated
      ? { fingerprintTruncated: true, note: '工程文件超过指纹上限，下次可能误判缓存（用 refresh 强制重导）' }
      : {}),
  }
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
      fail('BAD_REQUEST', `未知段落 ${JSON.stringify(entry)}（可用：registries / tags / recipes）`)
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
    fail('BAD_REQUEST', `taskPath 只能是 Gradle 任务路径（例如 runServer 或 :fabric:runServer），收到 ${JSON.stringify(value)}`)
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
      `${context.root} 没有 ${context.taskPath} 这个目标（NeoForge 工程的 runs 块里要有 server；多模块工程用 taskPath 指到具体模块）`,
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
  const detail = `\nlaunch: ${JSON.stringify(launch)}\n日志尾巴：\n${tail(logText)}`

  const taskMissing = /Task ['"][^'"]+' not found|Cannot locate tasks that match/i.test(logText)
  if (taskMissing) {
    return new AtlasError('NO_RUN_TARGET', `${root} 没有 ${taskPath} 这个目标（Gradle 报 Task not found）${detail}`, { launch })
  }

  const unsupported = markers.find((marker) => marker.kind === 'unsupported')
  if (unsupported !== undefined) {
    return new AtlasError(
      'ATLAS_UNSUPPORTED',
      `这个运行时没有可用的 adapter：loader=${unsupported.loader} mappings=${unsupported.mappings} mc=${unsupported.mc}（${unsupported.reason}）${detail}`,
      { env: { loader: unsupported.loader, mappings: unsupported.mappings, mcVersion: unsupported.mc }, launch },
    )
  }

  const ready = markers.find((marker) => marker.kind === 'ready')
  const inert = markers.find((marker) => marker.kind === 'inert')
  if (ready === undefined) {
    const reason = inert === undefined ? '日志里根本没有 [mcdev-atlas] 标记' : `Agent 在这个进程里 inert（${inert.reason}）`
    return new AtlasError(
      'ATLAS_NOT_LOADED',
      `服务端起来了，但 Agent 没生效：${reason}。常见原因：starter 没把 JAVA_TOOL_OPTIONS 传进游戏 JVM。${detail}`,
      { launch, markers },
    )
  }

  if (record?.timedOut === true) {
    return new AtlasError('ATLAS_TIMEOUT', `等导出超时，且没有拿到 dump（Agent 已经 ready，可能卡在取数或写盘）${detail}`, { launch })
  }
  if (record?.outcome !== undefined && record.outcome !== null && record.outcome !== 'normal') {
    return new AtlasError(
      'LAUNCH_FAILED',
      `服务端以 ${record.outcome}（退出码 ${record.exitCode ?? '未知'}）结束，没有产出 dump${detail}`,
      { launch },
    )
  }
  const failed = markers.filter((marker) => marker.kind === 'failed')
  const failureText = failed.length > 0
    ? `Agent 的失败行：${failed.map((marker) => `${marker.stage ?? '?'}=${marker.error ?? '?'}`).join('；')}`
    : 'Agent 打了 ready 但没有写出 dump'
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
