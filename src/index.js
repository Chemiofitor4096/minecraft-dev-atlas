/**
 * 宿主入口：拿到 starter 的 `ctx.mcdev`，注册两个数据工具。
 *
 * 依赖是单向的：本插件认识 `ctx.mcdev`，starter 不认识本插件；没装 starter 时
 * cordis 会让这个插件停在 pending（`inject` 里写着 `mcdev`），而不是半死不活地加载。
 * @module minecraft-dev-atlas
 */

import { readFileSync } from 'node:fs'
import { createAtlas } from './lib/atlas.js'
import { dataRoot } from './lib/paths.js'
import { applyTools } from './tools/index.js'

/** Cordis 插件名。 */
export const name = 'mcdev-atlas'

/** 必需的宿主服务：`mcdev` 来自 minecraft-dev-starter ≥ 0.3，`tools` 用来注册工具。 */
export const inject = ['mcdev', 'tools']

/** 这个插件要用到的能力；缺一个就明确要求升级 starter，而不是"凑合用"。 */
const REQUIRED_CAPABILITIES = ['launch', 'stop', 'list']

/** 版本只有一个来源：package.json（手写常量必然忘记同步）。 */
const VERSION = readPackageVersion()

/** @returns {string} */
function readPackageVersion() {
  try {
    const url = new URL('../package.json', import.meta.url)
    return String(JSON.parse(readFileSync(url, 'utf8')).version)
  } catch {
    return '0.0.0-unknown'
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const mcdev = ctx.mcdev
  const capabilities = Array.isArray(mcdev?.capabilities) ? mcdev.capabilities : []
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability))
  if (missing.length > 0) {
    throw new Error(
      `SERVICE_VERSION_MISMATCH: 需要 minecraft-dev-starter ≥ 0.3（ctx.mcdev.capabilities 里缺 ${missing.join(' / ')}；当前是 ${mcdev?.version ?? '未知版本'}）`,
    )
  }

  const atlas = createAtlas({ mcdev, version: VERSION })
  applyTools(ctx, { atlas })

  console.log(`[mcdev-atlas] host ready (${VERSION}) — mc_data_dump / mc_data_query`)
  console.log(`[mcdev-atlas] data dir: ${dataRoot()}`)
}
