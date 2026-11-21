/**
 * 工具之间的共享件：工作区身份、按步挂载判定、参数整形。
 *
 * 与 starter 的 tools/shared.js 同一套口径：工具只交 `{ root, workspace }`，
 * 相对路径由上层解析（工具里不拼路径），挂载判定按 cwd 缓存 60 秒。
 * @module minecraft-dev-atlas/tools/shared
 */

import { nearProject } from '../lib/project.js'

/**
 * 调用方会话的工作区（它的 cwd）。这是"模型正在哪个文件夹里干活"的唯一可信来源。
 * @param {{ agent?: any } | undefined} exec
 * @returns {string | undefined}
 */
export function agentWorkspace(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * @param {{ root?: string }} args
 * @param {{ agent?: any } | undefined} exec
 * @returns {{ root?: string, workspace?: string }}
 */
export function rootArgs(args, exec) {
  const workspace = agentWorkspace(exec)
  /** @type {{ root?: string, workspace?: string }} */
  const payload = {}
  if (typeof args?.root === 'string' && args.root !== '') payload.root = args.root
  if (workspace !== undefined) payload.workspace = workspace
  return payload
}

/** 挂载判定缓存：每步都要问一次，别每步都读盘。 */
const GATE_TTL_MS = 60_000

/** @type {Map<string, { at: number, visible: boolean }>} */
const gateCache = new Map()

/** 导出成功后清一次：下一步 query 应当立即可用。 */
export function clearGateCache() {
  gateCache.clear()
}

/**
 * 这个工具这一步该不该挂上：工作区里（或直接子目录里）有 Gradle 工程才挂。
 *
 * 判不出来时按可见处理：宁可多花几百 token，也不让模型在真需要时手里没工具。
 * @param {{ session?: { header?: { cwd?: string } } } | undefined} agent
 * @returns {boolean}
 */
export function projectToolVisible(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return true
  const cached = gateCache.get(cwd)
  if (cached !== undefined && Date.now() - cached.at < GATE_TTL_MS) return cached.visible
  let visible = true
  try {
    visible = nearProject(cwd) !== undefined
  } catch {
    visible = true
  }
  gateCache.set(cwd, { at: Date.now(), visible })
  return visible
}

/**
 * 工具的失败出口：把 AtlasError 的 code 与细节压成一句话。
 *
 * 错误文本是模型看到的东西，所以必须能直接指导下一步（看日志尾巴 / 先 dump / 改 taskPath），
 * 而不是只报一个码。
 * @param {unknown} error
 * @returns {never}
 */
export function rethrowToolError(error) {
  const value = /** @type {{ code?: string, message?: string, details?: Record<string, any> } | undefined} */ (error)
  if (value !== undefined && typeof value.code === 'string') {
    const details = value.details ?? {}
    const suffix = details.launch === undefined ? '' : `\nlaunch: ${JSON.stringify(details.launch)}`
    throw new Error(`${value.code}: ${value.message ?? ''}${suffix}`)
  }
  throw error
}
