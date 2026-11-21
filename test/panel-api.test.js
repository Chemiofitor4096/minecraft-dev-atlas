import assert from 'node:assert/strict'
import test from 'node:test'
import { createPanelApi } from '../src/lib/panelApi.js'

/**
 * 假 atlas：把收到的参数原样返回，断言"路由层有没有改坏调用"。
 * @param {{ defaultRoot?: () => string | undefined }} [options]
 */
function panelWith(options = {}) {
  const calls = []
  const atlas = {
    version: '0.1.0',
    async state(args) {
      calls.push(['state', args])
      return { hasDump: true, ...args }
    },
    async query(args) {
      calls.push(['query', args])
      return { kind: args.kind, ...args }
    },
    async dump(args) {
      calls.push(['dump', args])
      return { cached: false, ...args }
    },
  }
  return { panel: createPanelApi({ atlas, defaultRoot: options.defaultRoot ?? (() => 'C:\\ws') }), calls }
}

test('state：没给 workspace 时用宿主默认', async () => {
  const { panel, calls } = panelWith()
  await panel['data.state']({})
  assert.deepEqual(calls[0], ['state', { workspace: 'C:\\ws' }])
})

test('state：给了 root/workspace 就原样透传', async () => {
  const { panel, calls } = panelWith()
  await panel['data.state']({ root: 'C:\\p', workspace: 'C:\\w' })
  assert.deepEqual(calls[0], ['state', { root: 'C:\\p', workspace: 'C:\\w' }])
})

test('默认工作区拿不到时就不传 workspace（让门面报 NO_DATA 之外的真错误）', async () => {
  const { panel, calls } = panelWith({ defaultRoot: () => undefined })
  await panel['data.state']({})
  assert.deepEqual(calls[0], ['state', {}])
})

test('query：kind 默认 digest，空串参数不传', async () => {
  const { panel, calls } = panelWith()
  await panel['data.query']({ registry: '', tag: '', filter: 'coal', limit: 20, offset: 40 })
  assert.deepEqual(calls[0], [
    'query',
    { workspace: 'C:\\ws', kind: 'digest', filter: 'coal', limit: 20, offset: 40 },
  ])
})

test('query：kind/registry/tag 都按字符串透传', async () => {
  const { panel, calls } = panelWith()
  await panel['data.query']({ kind: 'tag', tag: 'minecraft:planks', limit: 50 })
  assert.equal(calls[0][1].kind, 'tag')
  assert.equal(calls[0][1].tag, 'minecraft:planks')
  assert.equal(calls[0][1].limit, 50)
})

test('dump：只有 refresh === true 才算强制重导', async () => {
  const { panel, calls } = panelWith()
  await panel['data.dump']({ refresh: 'yes' })
  assert.equal(calls[0][1].refresh, false)
  await panel['data.dump']({ refresh: true, timeoutMs: 120000 })
  assert.equal(calls[1][1].refresh, true)
  assert.equal(calls[1][1].timeoutMs, 120000)
})

test('ping 带版本', async () => {
  const { panel } = panelWith()
  assert.deepEqual(await panel.ping(), { ok: true, version: '0.1.0' })
})
