/**
 * 宿主入口：拿到 starter 的 `ctx.mcdev`，注册两个数据工具，并为面板挂 `/atlas/api`。
 *
 * 依赖是单向的：本插件认识 `ctx.mcdev`，starter 不认识本插件；没装 starter 时
 * cordis 会让这个插件停在 pending（`inject` 里写着 `mcdev`），而不是半死不活地加载。
 * @module minecraft-dev-atlas
 */

import { readFileSync } from 'node:fs'
import { createAtlas } from './lib/atlas.js'
import { createPanelApi } from './lib/panelApi.js'
import { dataRoot } from './lib/paths.js'
import { applyTools } from './tools/index.js'

/** Cordis 插件名。 */
export const name = 'mcdev-atlas'

/** 必需服务：`mcdev`（starter ≥ 0.3）、`tools`（注册工具）、`sessions`（面板的默认工作区）。 */
export const inject = ['mcdev', 'tools', 'sessions']

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
 * 面板的默认工作区：最近一个活跃会话的 cwd。
 *
 * 面板不是"某个会话里的东西"，所以拿不到调用方的 cwd；HTTP 路径与 starter 一样退回这里。
 * `ATLAS_WORKSPACE` 是测试/固定工作区的逃生门。
 * @param {any} ctx
 * @returns {string | undefined}
 */
function defaultWorkspace(ctx) {
  const pinned = process.env.ATLAS_WORKSPACE
  if (typeof pinned === 'string' && pinned !== '') return pinned
  try {
    for (const session of ctx.sessions.list().slice().reverse()) {
      const cwd = session?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
  } catch {
    // 没有会话服务时退回进程 cwd
  }
  return process.cwd()
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (raw.trim() === '') return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
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

  const panel = createPanelApi({ atlas, defaultRoot: () => defaultWorkspace(ctx) })

  // webServer 是可选的：纯 CLI / headless profile 里没有它，这时工具照常可用，只是没有面板路由。
  ctx.effect(() => {
    const mount = (scoped) => {
      const webServer = scoped?.webServer
      if (webServer === undefined || typeof webServer.register !== 'function') return undefined
      const dispose = webServer.register({
        kind: 'prefix',
        path: '/atlas/api',
        handler: async (req, res) => {
          const { pathname } = new URL(req.url ?? '/', 'http://dsh.internal')

          if (req.method === 'GET' && pathname === '/atlas/api/ping') {
            writeJson(res, 200, { ok: true, version: VERSION, pid: process.pid })
            return
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { code: 'method', message: 'use POST' } })
            return
          }

          const method = pathname.startsWith('/atlas/api/') ? pathname.slice('/atlas/api/'.length) : ''
          if (method === '' || method.includes('/')) {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown method "${method}"` } })
            return
          }

          // 客户端在 factory 里崩了会报到这个口；没有它就只能看宿主控制台
          if (method === 'client.report') {
            try {
              const payload = await readJsonBody(req)
              console.warn(`[mcdev-atlas] client: ${payload?.event ?? '?'} ${JSON.stringify(payload?.detail ?? {})}`)
            } catch {
              // 报文坏了也不影响面板
            }
            writeJson(res, 200, { ok: true, result: { received: true } })
            return
          }

          const handler = Object.hasOwn(panel, method) ? panel[method] : undefined
          if (typeof handler !== 'function') {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown method "${method}"` } })
            return
          }

          try {
            const payload = await readJsonBody(req)
            const result = await handler(payload)
            writeJson(res, 200, { ok: true, result })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const code = /** @type {any} */ (error)?.code
            console.warn(`[mcdev-atlas] ${method} failed: ${message}`)
            writeJson(res, 500, {
              ok: false,
              error: { code: typeof code === 'string' ? code : 'internal', message },
            })
          }
        },
      })
      console.log('[mcdev-atlas] http routes mounted at /atlas/api')
      return () => {
        try {
          dispose?.()
        } catch {
          // 已经在卸载
        }
      }
    }

    if (typeof ctx.inject === 'function') {
      return ctx.inject(['webServer'], (scoped) => mount(scoped))
    }
    try {
      return mount(ctx)
    } catch {
      return undefined
    }
  }, 'mcdev-atlas: /atlas/api routes')

  console.log(`[mcdev-atlas] host ready (${VERSION}) — mc_data_dump / mc_data_query`)
  console.log(`[mcdev-atlas] data dir: ${dataRoot()}`)
}
