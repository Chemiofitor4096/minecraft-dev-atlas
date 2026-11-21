/**
 * 工程侧的两件小事：这是不是一个 Gradle 工程（按步挂载用）、以及工程指纹（缓存失效用）。
 *
 * 指纹按 **Gradle 根** 计算：多模块工程里改共享模块或根构建脚本，任何模块的缓存都要失效，
 * 否则导出的是旧运行时数据。指纹仍然只看文件名/大小/mtime，不读内容。
 * @module minecraft-dev-atlas/lib/project
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 工程指纹最多吃进多少个文件；超了截断并显式标出来（不静默）。 */
export const SOURCE_HASH_MAX_FILES = 5000

/** Gradle 构建根标记：从模块目录向上找最近的 settings 文件。 */
const GRADLE_SETTINGS = ['settings.gradle', 'settings.gradle.kts']

/** 这些目录不参与指纹：构建输出、运行目录、缓存与工具目录。 */
const EXCLUDED_DIRS = new Set(['build', '.gradle', 'run', 'out', '.git', 'node_modules', '.idea'])

/** 任何层级都要算进来的构建文件。 */
const BUILD_FILE_PATTERN = /(^|\/)(build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts|gradle\.properties|libs\.versions\.toml|gradle-wrapper\.properties)$/

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
 * 一个目录所属的 Gradle 构建根：从它开始向上找最近的 `settings.gradle(.kts)`。
 *
 * 多模块工程的任务必须在聚合根里执行（starter 的 `launch.start` 也是这么判的），
 * 缓存指纹同样要以聚合根为单位：共享模块或根脚本变化时，模块缓存必须失效。
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function findGradleRoot(dir) {
  const start = resolve(dir)
  let current = start
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of GRADLE_SETTINGS) {
      if (await statOrUndefined(join(current, name)) !== undefined) return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return start
}

/**
 * 工程指纹：Gradle 根下所有构建文件与 `src/**` 的文件名/大小/mtime，排序后 sha256。
 *
 * 覆盖整个构建根而不是只覆盖当前模块：多模块工程共享 settings/build 脚本与 common 模块，
 * 只哈希模块自身会让"改了公共代码、缓存还在"这种事发生。
 * @param {string} root
 * @returns {Promise<{ hash: string, files: number, truncated: boolean, gradleRoot: string }>}
 */
export async function sourceFingerprint(root) {
  const absolute = resolve(root)
  const gradleRoot = await findGradleRoot(absolute)
  /** @type {string[]} */
  const entries = []
  let truncated = false

  /**
   * @param {string} current
   * @param {string} prefix
   * @param {number} depth
   */
  const visit = async (current, prefix, depth) => {
    if (entries.length >= SOURCE_HASH_MAX_FILES) {
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
      if (entries.length >= SOURCE_HASH_MAX_FILES) {
        truncated = true
        return
      }
      const relative = prefix === '' ? item.name : `${prefix}/${item.name}`
      if (item.isDirectory()) {
        if (EXCLUDED_DIRS.has(item.name)) continue
        await visit(join(current, item.name), relative, depth + 1)
        continue
      }
      if (!item.isFile() || !fingerprintPath(relative)) continue
      const stat = await statOrUndefined(join(current, item.name))
      if (stat !== undefined) entries.push(`${relative}|${stat.size}|${Math.trunc(stat.mtimeMs)}`)
    }
  }

  await visit(gradleRoot, '', 0)
  entries.sort()
  const payload = `${truncated ? 'truncated\n' : ''}${entries.join('\n')}`
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex')
  return { hash: `sha256:${hash}`, files: entries.length, truncated, gradleRoot }
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
 * 这个相对路径要不要进指纹：构建文件在任何层级都算，源码只在 `src/` 下算。
 * @param {string} relative
 * @returns {boolean}
 */
function fingerprintPath(relative) {
  const normalized = relative.replaceAll('\\', '/')
  if (BUILD_FILE_PATTERN.test(normalized)) return true
  return normalized.startsWith('src/') || normalized.includes('/src/')
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
