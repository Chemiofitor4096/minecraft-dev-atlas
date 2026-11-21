import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { applyTools } from '../src/tools/index.js'
import { AtlasError } from '../src/lib/errors.js'
import { describeDump, describeQuery } from '../src/tools/render.js'
import { fakeProject, tempDir } from './helpers.js'

function fakeCtx() {
  /** @type {Array<any>} */
  const registered = []
  /** @type {Map<string, any>} */
  const options = new Map()
  return {
    ctx: {
      tools: {
        register: (definition, settings) => {
          registered.push(definition)
          if (settings !== undefined) options.set(definition.name, settings)
        },
      },
    },
    registered,
    options,
  }
}

function agentAt(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

const DUMP_VALUE = {
  path: 'C:\\data\\dump.json',
  cached: false,
  schema: 1,
  env: { via: 'agent-boot', loader: 'neoforge', loaderVersion: '21.1.266', mcVersion: '1.21.1', mappings: 'mojmap', adapter: 'neoforge/mojmap/1.21@1', side: 'server', java: 21 },
  counts: { registries: 7, byRegistry: { 'minecraft:item': 4 }, tags: 3, tagMembers: 3, recipes: 2 },
  warnings: [],
  errors: [],
  truncated: false,
  truncatedSections: [],
  launch: { id: 'launch-1', status: 'exited', outcome: 'normal', exitCode: 0, timedOut: false },
  durationMs: 12000,
}

function build(atlas) {
  const { ctx, registered, options } = fakeCtx()
  applyTools(ctx, { atlas })
  return { registered, options, byName: Object.fromEntries(registered.map((entry) => [entry.name, entry])) }
}

test('注册两个工具，都带按步挂载的 when', () => {
  const { registered, options } = build({ dump: async () => ({}), query: async () => ({}) })
  assert.deepEqual(registered.map((tool) => tool.name), ['mc_data_dump', 'mc_data_query'])
  for (const settings of options.values()) assert.equal(typeof settings.when, 'function')
})

test('挂载判据：有工程才挂；没有 cwd 时按可见处理', async (t) => {
  const { options } = build({ dump: async () => ({}), query: async () => ({}) })
  const when = options.get('mc_data_dump').when

  const project = await fakeProject(t)
  assert.equal(when(agentAt(project)), true)

  const empty = await tempDir(t)
  assert.equal(when(agentAt(empty)), false)

  assert.equal(when({ agent: { session: { header: {} } } }), true)
  assert.equal(when({}), true)
})

test('mc_data_dump：把 root/workspace 传下去并渲染中文结果', async (t) => {
  const project = await fakeProject(t)
  /** @type {any} */
  let received
  const { byName } = build({
    dump: async (args) => {
      received = args
      return DUMP_VALUE
    },
    query: async () => ({}),
  })
  const value = await byName.mc_data_dump.execute({ refresh: true }, agentAt(project))
  assert.equal(value.path, DUMP_VALUE.path)
  assert.equal(received.refresh, true)
  assert.equal(received.workspace, project)
  assert.equal(received.signal, undefined)

  const rendered = describeDump(value)
  assert.match(rendered, /导出完成/)
  assert.match(rendered, /NeoForge 21\.1\.266/)
  assert.match(rendered, /注册表 7/)
  assert.match(rendered, /launch-1/)
})

test('mc_data_dump：缓存命中时渲染成"没有重起服务端"', () => {
  const rendered = describeDump({ ...DUMP_VALUE, cached: true, launch: { status: 'cached', timedOut: false } })
  assert.match(rendered, /缓存命中/)
  assert.doesNotMatch(rendered, /实例/)
})

test('mc_data_dump：错误带 code 与原因（模型能照着改）', async () => {
  const { byName } = build({
    dump: async () => {
      throw new AtlasError('NO_RUN_TARGET', '这个目录不是 Gradle 工程')
    },
    query: async () => ({}),
  })
  await assert.rejects(
    () => byName.mc_data_dump.execute({}, {}),
    (error) => /NO_RUN_TARGET: 这个目录不是 Gradle 工程/.test(error.message),
  )
})

test('mc_data_dump：失败时的 launch 细节也带上', async () => {
  const { byName } = build({
    dump: async () => {
      throw new AtlasError('LAUNCH_FAILED', '服务端没起来', { launch: { id: 'launch-9', outcome: 'crashed', exitCode: 1 } })
    },
    query: async () => ({}),
  })
  await assert.rejects(
    () => byName.mc_data_dump.execute({}, {}),
    (error) => /LAUNCH_FAILED/.test(error.message) && /launch-9/.test(error.message),
  )
})

test('mc_data_query：透传参数、补齐形状、渲染摘要', async (t) => {
  const project = await fakeProject(t)
  /** @type {any} */
  let received
  const digest = {
    kind: 'digest',
    generatedAt: '2026-11-21T04:00:00.000Z',
    env: { loader: 'neoforge', loaderVersion: '21.1.266', mcVersion: '1.21.1', mappings: 'mojmap', side: 'server', adapter: 'neoforge/mojmap/1.21@1', via: 'agent-boot' },
    counts: { registries: 7, tags: 3, tagMembers: 3, recipes: 2 },
    registries: [{ id: 'minecraft:item', count: 4, owners: [{ owner: 'minecraft', count: 3 }] }],
    recipes: { types: [{ type: 'minecraft:crafting_shaped', count: 1 }] },
    truncated: false,
    truncatedSections: [],
    warnings: 0,
    errors: [],
  }
  const { byName } = build({
    dump: async () => ({}),
    query: async (args) => {
      received = args
      return { ...digest, stale: false, path: 'C:\\data\\dump.json' }
    },
  })
  const value = await byName.mc_data_query.execute({ kind: 'digest', limit: 10, offset: 0 }, agentAt(project))
  assert.equal(received.kind, 'digest')
  assert.equal(received.limit, 10)
  assert.equal(received.workspace, project)
  assert.equal(value.kind, 'digest')
  assert.equal(value.digest.counts.registries, 7)
  assert.equal(value.stale, false)
  assert.equal(value.offset, 0)

  const rendered = describeQuery(value)
  assert.match(rendered, /MC 1\.21\.1/)
  assert.match(rendered, /minecraft:item 4：minecraft 3/)
  assert.match(rendered, /crafting_shaped 1/)
})

test('mc_data_query：列表与分页渲染', () => {
  const rendered = describeQuery({
    kind: 'registry',
    registry: 'minecraft:item',
    matched: 120,
    items: [
      { id: 'minecraft:stone', owner: 'minecraft', props: { maxStackSize: 64, maxDamage: 0, burnTime: null } },
      { id: 'minecraft:diamond_sword', owner: 'minecraft', props: { maxStackSize: 1, maxDamage: 1561, burnTime: null } },
    ],
    truncated: true,
    nextOffset: 50,
    stale: true,
    path: 'x',
    generatedAt: '2026-11-21T04:00:00.000Z',
  })
  assert.match(rendered, /命中 120 · 显示 1–2/)
  assert.match(rendered, /minecraft:stone · minecraft/)
  assert.match(rendered, /耐久1561/)
  assert.doesNotMatch(rendered, /堆叠64/) // 默认值不写，省 token
  assert.match(rendered, /offset=50/)
  assert.match(rendered, /与当前工程不一致/)
})

test('mc_data_query：recipe 与 tag 的渲染', () => {
  const recipe = describeQuery({
    kind: 'recipe',
    matched: 1,
    items: [{
      id: 'minecraft:oak_planks',
      type: 'minecraft:crafting_shaped',
      result: { item: 'minecraft:oak_planks', count: 4 },
      ingredients: [['minecraft:oak_log']],
    }],
    truncated: false,
    stale: false,
    path: 'x',
    generatedAt: '2026-11-21T04:00:00.000Z',
  })
  assert.match(recipe, /4× minecraft:oak_planks/)
  assert.match(recipe, /← minecraft:oak_log/)

  const tag = describeQuery({
    kind: 'tag',
    registry: 'minecraft:item',
    tag: 'minecraft:planks',
    matched: 2,
    items: ['minecraft:oak_planks', 'minecraft:spruce_planks'],
    truncated: false,
    stale: false,
    path: 'x',
    generatedAt: '2026-11-21T04:00:00.000Z',
  })
  assert.match(tag, /minecraft:planks（minecraft:item）/)
  assert.match(tag, /minecraft:oak_planks、minecraft:spruce_planks/)
})
