/**
 * 宿主入口的集成测试：假 ctx 里真跑 apply，把 `/atlas/api` 的路由抓出来打一遍。
 *
 * 这里不 mock atlas：`data.query` 真的走引擎、读真文件，验证的是"面板能拿到形状正确的结果"。
 * `data.dump` 不在这里跑（它会起进程，属于真机 E2E）。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'
import { dumpPath } from '../src/lib/paths.js'
import { fakeProject, readFixtureDump, tempDir } from './helpers.js'

/**
 * @param {import('node:test').TestContext} t
 */
async function setup(t) {
  const home = await tempDir(t, 'atlas-host-home-')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const project = await fakeProject(t)

  /** @type {Array<{ entry: any, component: any, settings: any }>} */
  const tools = []
  /** @type {Array<{ kind: string, path: string, handler: Function }>} */
  const routes = []

  const webServer = {
    register(entry) {
      routes.push(entry)
      return () => {}
    },
  }
  const ctx = {
    mcdev: { version: '0.3.0', capabilities: ['launch', 'stop', 'list', 'resolve-java'] },
    tools: {
      register(definition, settings) {
        tools.push({ entry: definition, component: undefined, settings })
      },
    },
    sessions: {
      list: () => [{ header: { cwd: project } }],
    },
    effect(factory) {
      const dispose = factory()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    inject(names, callback) {
      assert.deepEqual([...names], ['webServer'])
      return callback({ webServer })
    },
  }
  return { ctx, tools, routes, project }
}

/** 最小 req：`data` 与 `end` 按 readJsonBody 期望的顺序触发。 */
function fakeRequest({ method = 'POST', url = '/atlas/api/data.state', body } = {}) {
  /** @type {Record<string, Function>} */
  const handlers = {}
  const req = {
    method,
    url,
    setEncoding() {},
    on(event, callback) {
      handlers[event] = callback
      if (event === 'end') {
        queueMicrotask(() => {
          if (body !== undefined && handlers.data !== undefined) handlers.data(body)
          handlers.end?.()
        })
      }
      return req
    },
  }
  return req
}

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(chunk) {
      this.body = String(chunk ?? '')
    },
  }
}

/**
 * @param {Function} handler
 * @param {{ method?: string, url?: string, body?: string }} [options]
 */
async function request(handler, options = {}) {
  const res = fakeResponse()
  await handler(fakeRequest(options), res)
  return { status: res.status, headers: res.headers, json: res.body === '' ? undefined : JSON.parse(res.body) }
}

test('apply 注册两个工具与一条 /atlas/api 路由', async (t) => {
  const { ctx, tools, routes } = await setup(t)
  apply(ctx)
  assert.deepEqual(tools.map((tool) => tool.entry.name), ['mc_data_dump', 'mc_data_query'])
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/atlas/api')
  assert.equal(typeof routes[0].handler, 'function')
})

test('capabilities 不握手就明确报版本不匹配', async (t) => {
  const { ctx } = await setup(t)
  ctx.mcdev = { version: '0.2.2', capabilities: ['launch'] }
  assert.throws(() => apply(ctx), /SERVICE_VERSION_MISMATCH/)
})

test('GET ping', async (t) => {
  const { ctx, routes } = await setup(t)
  apply(ctx)
  const response = await request(routes[0].handler, { method: 'GET', url: '/atlas/api/ping' })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(typeof response.json.version, 'string')
})

test('data.state：没导出时说 hasDump=false', async (t) => {
  const { ctx, routes, project } = await setup(t)
  apply(ctx)
  const response = await request(routes[0].handler, { body: JSON.stringify({ workspace: project }) })
  assert.equal(response.status, 200)
  assert.equal(response.json.result.hasDump, false)
  assert.equal(response.json.result.root, project)
})

test('data.query：有 dump 时返回 digest 形状', async (t) => {
  const { ctx, routes, project } = await setup(t)
  const dump = await readFixtureDump()
  await mkdir(dirname(dumpPath(project)), { recursive: true })
  await writeFile(dumpPath(project), JSON.stringify(dump), 'utf8')
  apply(ctx)

  const state = await request(routes[0].handler, { body: JSON.stringify({ workspace: project }) })
  assert.equal(state.json.result.hasDump, true)
  assert.equal(state.json.result.stale, true) // 没有 meta

  const query = await request(routes[0].handler, {
    url: '/atlas/api/data.query',
    body: JSON.stringify({ workspace: project, kind: 'registry', registry: 'minecraft:item', filter: 'coal' }),
  })
  assert.equal(query.status, 200)
  assert.equal(query.json.result.kind, 'registry')
  assert.equal(query.json.result.matched, 2)
  assert.equal(query.json.result.items.length, 2)
})

test('未知方法 404；GET 非 ping 405', async (t) => {
  const { ctx, routes } = await setup(t)
  apply(ctx)
  const missing = await request(routes[0].handler, { url: '/atlas/api/nope', body: '{}' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.ok, false)

  const wrongMethod = await request(routes[0].handler, { method: 'GET', url: '/atlas/api/data.state' })
  assert.equal(wrongMethod.status, 405)
})

test('client.report 只记日志、照常回 200', async (t) => {
  const { ctx, routes } = await setup(t)
  apply(ctx)
  const response = await request(routes[0].handler, {
    url: '/atlas/api/client.report',
    body: JSON.stringify({ event: 'factory.error', detail: { message: 'boom' } }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
})

test('atlas.dump 失败时把错误码原样交给面板', async (t) => {
  const { ctx, routes, project } = await setup(t)
  apply(ctx)
  // 不是 Gradle 工程：门面在启动前就拒绝，不会真的起进程
  const empty = await tempDir(t, 'atlas-empty-')
  const response = await request(routes[0].handler, {
    url: '/atlas/api/data.dump',
    body: JSON.stringify({ workspace: empty, refresh: true }),
  })
  assert.equal(response.status, 500)
  assert.equal(response.json.error.code, 'NO_RUN_TARGET')
  assert.match(response.json.error.message, /不是 Gradle 工程/)
  assert.equal(typeof project, 'string')
})
