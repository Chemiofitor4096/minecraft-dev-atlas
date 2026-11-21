/**
 * 落盘位置：复用 starter 的 state 目录约定，但只往下建自己的 `data/` 子目录。
 *
 * - 根：`$DSH_HOME/mc-dev-starter`（没有 DSH_HOME 就是 `~/.dsh/mc-dev-starter`）
 * - 按 profile 分：`profiles/<name>/data/<projectKey>/dump.json`
 * - 认不出 profile 时退回根下的 `data/`（宁可共用，也不要把已有数据弄丢）
 *
 * 这样面板与模型看到的永远是同一份文件，而用户的工程目录里一个字节都不多。
 * @module minecraft-dev-atlas/lib/paths
 */

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** profile 目录在启动参数里的位置（桌面版把 profile 目录整个传给 host.js）。 */
const PROFILE_PATTERN = /[\\/]profiles[\\/]([^\\/]+)[\\/]?$/i

/**
 * 当前宿主跑在哪个 profile 上：argv 优先，其次 `DSH_PROFILE`。
 * 逻辑与 starter 的 state.js 对齐——两边必须算出同一个目录。
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function profileName(argv = process.argv, env = process.env) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (typeof arg !== 'string' || arg === '') continue
    const match = PROFILE_PATTERN.exec(arg)
    if (match !== null) return match[1]
    if (arg === '--profile') {
      const next = argv[index + 1]
      if (typeof next === 'string' && next !== '' && !next.startsWith('-')) return next
    }
    const inline = /^--profile=(.+)$/.exec(arg)
    if (inline !== null) return inline[1]
  }
  if (typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '') return env.DSH_PROFILE
  return undefined
}

/**
 * `~/.dsh`（或 DSH_HOME）。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function dshHome(env = process.env) {
  return env.DSH_HOME ?? join(env.USERPROFILE ?? homedir(), '.dsh')
}

/** starter 的状态根目录。 */
export function stateRoot(env = process.env) {
  return join(dshHome(env), 'mc-dev-starter')
}

/**
 * 本插件的数据根：`<stateRoot>/profiles/<profile>/data`。
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 * @returns {string}
 */
export function dataRoot(options = {}) {
  const env = options.env ?? process.env
  const profile = profileName(options.argv ?? process.argv, env)
  const root = stateRoot(env)
  return profile === undefined ? join(root, 'data') : join(root, 'profiles', profile, 'data')
}

/**
 * 工程在数据目录里的名字：可读的目录名 + 路径哈希，避免同名工程互踩。
 * @param {string} root 工程绝对路径
 * @returns {string}
 */
export function projectKey(root) {
  const absolute = resolve(root)
  // 工程名按小写归一：Windows 路径不区分大小写，同一个工程不能因为盘符/目录大小写不同落两份数据
  const slug = basename(absolute).toLowerCase().replaceAll(/[^a-z0-9_.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'project'
  const hash = createHash('sha256').update(absolute.toLowerCase()).digest('hex').slice(0, 8)
  return `${slug}-${hash}`
}

/**
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
export function projectDataDir(root, options = {}) {
  return join(dataRoot(options), projectKey(root))
}

/**
 * dump 的落点。
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
export function dumpPath(root, options = {}) {
  return join(projectDataDir(root, options), 'dump.json')
}

/**
 * 缓存元数据的落点（sourceHash / env / counts，避免每次为判缓存而解析 1MB）。
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
export function metaPath(root, options = {}) {
  return join(projectDataDir(root, options), 'meta.json')
}
