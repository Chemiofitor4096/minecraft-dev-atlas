/**
 * 宿主侧的门面：工具与（将来的）面板都只认这几个方法。
 *
 * 和 starter 的 api.js 一样，这里只做"解析 → 调领域 → 拼返回"，策略在 export / engine 里。
 * @module minecraft-dev-atlas/lib/atlas
 */

import { promises as fs } from 'node:fs'
import { dumpPath } from './paths.js'
import { indexDump, parseDump, query as engineQuery } from '../../engine/index.js'
import { AtlasError, fail } from './errors.js'
import { readDumpText, readMeta } from './cache.js'
import { exportDump, resolveProject } from './export.js'
import { sourceFingerprint } from './project.js'

/**
 * @param {{ mcdev: Record<string, any>, version: string, jarPath?: string, jarVersion?: string, maxIndexCache?: number }} deps
 */
export function createAtlas(deps) {
  /** @type {Map<string, { mtimeMs: number, size: number, index: ReturnType<typeof indexDump> }>} */
  const indexCache = new Map()
  const maxCache = Number.isFinite(deps.maxIndexCache) ? Number(deps.maxIndexCache) : 4

  /**
   * 拿索引：同一份文件按 mtime/size 复用，改过就重建。
   * @param {string} root
   */
  async function loadIndex(root) {
    const file = await readDumpText(root)
    if (file === undefined) {
      fail('NO_DATA', `${root} 还没有导出过数据（先调用 mc_data_dump）`, { path: dumpPath(root) })
    }
    const stat = await fs.stat(file.path)
    const cached = indexCache.get(file.path)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { index: cached.index, path: file.path }
    }
    let dump
    try {
      dump = parseDump(file.text)
    } catch (error) {
      const atlasError = /** @type {AtlasError} */ (error)
      fail(atlasError.code ?? 'ATLAS_SCHEMA_MISMATCH', `缓存里的 dump 读不了：${atlasError.message}`, { path: file.path })
    }
    const index = indexDump(dump)
    indexCache.set(file.path, { mtimeMs: stat.mtimeMs, size: stat.size, index })
    while (indexCache.size > maxCache) {
      const oldest = indexCache.keys().next().value
      if (oldest === undefined) break
      indexCache.delete(oldest)
    }
    return { index, path: file.path }
  }

  return {
    version: deps.version,

    /**
     * @param {Record<string, any>} args
     */
    async dump(args = {}) {
      return await exportDump(deps, args)
    },

    /**
     * 只读查询：永远不起进程。
     * @param {{ root?: string, workspace?: string, kind?: string, registry?: string, tag?: string, filter?: string, limit?: number, offset?: number }} args
     */
    async query(args = {}) {
      const root = resolveProject(args)
      const { index, path } = await loadIndex(root)
      const meta = await readMeta(root)
      let stale = true
      try {
        const fingerprint = await sourceFingerprint(root)
        const recorded = meta?.sourceHash ?? index.provenance?.sourceHash ?? ''
        stale = recorded !== fingerprint.hash
      } catch {
        // 算不出指纹（工程被删了）就当作 stale，但仍然返回旧数据
        stale = true
      }
      const result = engineQuery(index, {
        kind: args.kind,
        registry: args.registry,
        tag: args.tag,
        filter: args.filter,
        limit: args.limit,
        offset: args.offset,
      })
      return { ...result, stale, path, generatedAt: index.generatedAt }
    },

    /**
     * 面板用：这个工程现在有没有数据、新不新。
     * @param {{ root?: string, workspace?: string }} args
     */
    async state(args = {}) {
      const root = resolveProject(args)
      const file = await readDumpText(root)
      if (file === undefined) {
        return { root, hasDump: false }
      }
      const meta = await readMeta(root)
      let stale = true
      try {
        const fingerprint = await sourceFingerprint(root)
        stale = meta === undefined || meta.sourceHash !== fingerprint.hash
      } catch {
        stale = true
      }
      /** @type {Record<string, any>} */
      const value = { root, hasDump: true, stale, path: file.path }
      if (meta !== undefined) value.meta = meta
      return value
    },
  }
}
