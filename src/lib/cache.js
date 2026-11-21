/**
 * dump 的缓存：一个 JSON + 一份 meta。
 *
 * 为什么单独存 meta：判"缓存还算不算数"只需要 sourceHash 与导出时间，
 * 为了这个去解析 1MB 的 dump 太亏（面板轮询会把它变成热路径）。
 * @module minecraft-dev-atlas/lib/cache
 */

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { dumpPath, metaPath } from './paths.js'

/**
 * @typedef {object} DumpMeta
 * @property {1} schema
 * @property {string} pluginVersion
 * @property {string | undefined} jarVersion
 * @property {string} sourceHash
 * @property {string | undefined} taskPath
 * @property {string | undefined} gradleRoot
 * @property {string} exportedAt
 * @property {string} generatedAt
 * @property {Record<string, any>} env
 * @property {{ registries: number, byRegistry: Record<string, number>, tags: number, tagMembers: number, recipes: number }} counts
 * @property {string[]} warnings
 * @property {Array<{ section: string, message: string }>} errors
 * @property {boolean} truncated
 * @property {string[]} truncatedSections
 * @property {string} path
 * @property {number} bytes
 * @property {number} durationMs
 * @property {string | undefined} launchId
 */

/**
 * 读 meta；不存在或坏掉都返回 undefined（缓存是加速器，不是真相来源）。
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 * @returns {Promise<DumpMeta | undefined>}
 */
export async function readMeta(root, options = {}) {
  try {
    const text = await fs.readFile(metaPath(root, options), 'utf8')
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || value.schema !== 1) return undefined
    return /** @type {DumpMeta} */ (value)
  } catch {
    return undefined
  }
}

/**
 * 写 meta：tmp + rename，宿主被强杀时不会留下半个 JSON。
 * @param {string} root
 * @param {DumpMeta} meta
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
export async function writeMeta(root, meta, options = {}) {
  const target = metaPath(root, options)
  const temporary = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temporary, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, target)
}

/**
 * 读 dump 文本；不存在返回 undefined。
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 * @returns {Promise<{ text: string, path: string, bytes: number } | undefined>}
 */
export async function readDumpText(root, options = {}) {
  const path = dumpPath(root, options)
  try {
    const text = await fs.readFile(path, 'utf8')
    return { text, path, bytes: Buffer.byteLength(text, 'utf8') }
  } catch {
    return undefined
  }
}

/**
 * 缓存命中判定：meta 指纹一致、dump 文件在、schema 一致。
 *
 * 注意"文件在"也要查：用户可能手动清了 data 目录，只剩 meta。
 * @param {string} root
 * @param {string} sourceHash
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 * @returns {Promise<DumpMeta | undefined>}
 */
export async function cachedMeta(root, sourceHash, options = {}) {
  const meta = await readMeta(root, options)
  if (meta === undefined || meta.schema !== 1) return undefined
  if (meta.sourceHash !== sourceHash) return undefined
  try {
    const stat = await fs.stat(meta.path === '' ? dumpPath(root, options) : meta.path)
    if (!stat.isFile()) return undefined
  } catch {
    return undefined
  }
  return meta
}

/**
 * 删掉旧 dump 与 meta（`refresh` 前调用；agent 自己会 tmp+rename，这里只是把判据弄干净）。
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
export async function forgetDump(root, options = {}) {
  await Promise.allSettled([
    fs.rm(dumpPath(root, options), { force: true }),
    fs.rm(metaPath(root, options), { force: true }),
  ])
}
