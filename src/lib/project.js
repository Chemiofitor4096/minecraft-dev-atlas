/**
 * 工程侧的两件小事：这是不是一个 Gradle 工程（按步挂载用）、以及工程指纹（缓存失效用）。
 *
 * 刻意不复制 starter 的识别引擎：这里不需要知道 loader 是谁，只需要"能不能起 runServer"。
 * @module minecraft-dev-atlas/lib/project
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

/** 工程指纹最多吃进多少个文件；超了截断并显式标出来（不静默）。 */
export const SOURCE_HASH_MAX_FILES = 5000

/** 算进指纹的构建文件（与拓展文档 §5 一致：文件名 + 大小 + mtime，不读内容）。 */
const BUILD_FILES = [
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
  'gradle/libs.versions.toml',
]

const PROJECT_MARKERS = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat']

/**
 * 目录本身是不是一个 Gradle 工程（只看标记文件，不做识别）。
 * @param {string} dir
 * @returns {boolean}
 */
export function looksLikeGradleProject(dir) {
  if (typeof dir !== 'string' || dir === '') return false
  return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)))
}

/**
 * 会话工作区里"一眼能看到的"工程根：先看自己，再看直接子目录。
 *
 * 只是按步挂载的判据，不是工程识别：判不出来就按"可见"处理（多花几百 token，
 * 也不让模型在真需要时手里没工具）。
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function nearProject(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  if (looksLikeGradleProject(cwd)) return resolve(cwd)
  let children
  try {
    children = readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return undefined
  }
  for (const child of children) {
    const dir = join(cwd, child)
    if (looksLikeGradleProject(dir)) return resolve(dir)
  }
  return undefined
}

/**
 * 工程指纹：构建文件 + `src/**` 的文件名/大小/mtime，排序后 sha256。
 *
 * 比内容哈希便宜得多（不动文件内容），而"改代码 → 重导"这件事已经够用；
 * 不够用的那天再加一个内容哈希开关（拓展文档 §5 留了这个口子）。
 * @param {string} root
 * @returns {Promise<{ hash: string, files: number, truncated: boolean }>}
 */
export async function sourceFingerprint(root) {
  const absolute = resolve(root)
  /** @type {string[]} */
  const entries = []
  let truncated = false

  for (const relative of BUILD_FILES) {
    const stat = await statOrUndefined(join(absolute, relative))
    if (stat !== undefined) entries.push(`${relative}|${stat.size}|${Math.trunc(stat.mtimeMs)}`)
  }

  const walked = await walkSource(join(absolute, 'src'), 'src', SOURCE_HASH_MAX_FILES)
  entries.push(...walked.entries)
  truncated = walked.truncated

  entries.sort()
  const payload = `${truncated ? 'truncated\n' : ''}${entries.join('\n')}`
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex')
  return { hash: `sha256:${hash}`, files: entries.length, truncated }
}

/**
 * @param {string} root
 * @returns {Promise<string>}
 */
export async function sourceHash(root) {
  const fingerprint = await sourceFingerprint(root)
  return fingerprint.hash
}

/**
 * @param {string} dir
 * @param {string} prefix
 * @param {number} maxFiles
 * @returns {Promise<{ entries: string[], truncated: boolean }>}
 */
async function walkSource(dir, prefix, maxFiles) {
  /** @type {string[]} */
  const entries = []
  let truncated = false

  /** @param {string} current @param {string} currentPrefix @param {number} depth */
  const visit = async (current, currentPrefix, depth) => {
    if (entries.length >= maxFiles) {
      truncated = true
      return
    }
    if (depth > 16) {
      truncated = true
      return
    }
    let items
    try {
      items = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    items.sort((left, right) => left.name.localeCompare(right.name))
    for (const item of items) {
      if (entries.length >= maxFiles) {
        truncated = true
        return
      }
      const relative = `${currentPrefix}/${item.name}`
      if (item.isDirectory()) {
        await visit(join(current, item.name), relative, depth + 1)
      } else if (item.isFile()) {
        const stat = await statOrUndefined(join(current, item.name))
        if (stat !== undefined) entries.push(`${relative}|${stat.size}|${Math.trunc(stat.mtimeMs)}`)
      }
    }
  }

  await visit(dir, prefix, 0)
  return { entries, truncated }
}

/**
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | undefined>}
 */
async function statOrUndefined(path) {
  try {
    const stat = await fs.stat(path)
    return stat.isFile() ? stat : undefined
  } catch {
    return undefined
  }
}
