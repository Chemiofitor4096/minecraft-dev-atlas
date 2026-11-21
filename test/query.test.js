import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LIMIT, digest, indexDump, MAX_LIMIT, query } from '../engine/index.js'
import { readFixtureDump } from './helpers.js'

/** @returns {Promise<ReturnType<typeof indexDump>>} */
async function fixtureIndex() {
  return indexDump(await readFixtureDump())
}

test('索引统计数量：注册表 / 标签 / 成员 / 配方', async () => {
  const index = await fixtureIndex()
  assert.equal(index.counts.registries, 7)
  assert.equal(index.counts.tags, 3)
  assert.equal(index.counts.tagMembers, 3)
  assert.equal(index.counts.recipes, 2)
  assert.equal(index.registries.get('minecraft:item').count, 4)
})

test('digest 按 owner 分组并降序', async () => {
  const index = await fixtureIndex()
  const value = digest(index)
  assert.equal(value.kind, 'digest')
  const item = value.registries.find((registry) => registry.id === 'minecraft:item')
  assert.equal(item.count, 4)
  assert.deepEqual(item.owners[0], { owner: 'minecraft', count: 3 })
  assert.deepEqual(item.owners[1], { owner: 'coalcraft', count: 1 })
  assert.equal(value.recipes.types[0].type, 'minecraft:crafting_shaped')
  assert.equal(value.counts.tagMembers, 3)
})

test('未指定 kind 时默认 digest', async () => {
  const index = await fixtureIndex()
  assert.equal(query(index).kind, 'digest')
})

test('registry：按 id 子串过滤、分页、截断标记', async () => {
  const index = await fixtureIndex()
  const first = query(index, { kind: 'registry', filter: 'coal', limit: 1 })
  assert.equal(first.matched, 2)
  assert.equal(first.items.length, 1)
  assert.equal(first.truncated, true)
  assert.equal(first.nextOffset, 1)

  const second = query(index, { kind: 'registry', filter: 'coal', limit: 1, offset: first.nextOffset })
  assert.equal(second.items.length, 1)
  assert.equal(second.truncated, false)
  assert.equal(second.nextOffset, null)
})

test('registry：精确命中时带 class（详情），列表页不带', async () => {
  const index = await fixtureIndex()
  const detail = query(index, { kind: 'registry', filter: 'minecraft:diamond_sword' })
  assert.equal(detail.items.length, 1)
  assert.equal(detail.items[0].class, 'net.minecraft.world.item.SwordItem')
  assert.equal(detail.items[0].props.maxDamage, 1561)

  const list = query(index, { kind: 'registry', filter: '' })
  assert.equal(list.matched, 4)
  assert.equal(list.items[0].class, undefined)
})

test('registry：未知注册表给出已有清单', async () => {
  const index = await fixtureIndex()
  const value = query(index, { kind: 'registry', registry: 'minecraft:painting' })
  assert.equal(value.matched, 0)
  assert.deepEqual(value.available.sort(), ['minecraft:block', 'minecraft:enchantment', 'minecraft:item'])
})

test('tag：给 tag 时返回成员，并排序', async () => {
  const index = await fixtureIndex()
  const value = query(index, { kind: 'tag', tag: 'minecraft:planks' })
  assert.equal(value.registry, 'minecraft:item')
  assert.equal(value.matched, 1)
  assert.deepEqual(value.items, ['minecraft:oak_planks'])
})

test('tag：不给 tag 时列标签（可按 registry 收窄）', async () => {
  const index = await fixtureIndex()
  const all = query(index, { kind: 'tag' })
  assert.equal(all.matched, 3)
  const items = query(index, { kind: 'tag', registry: 'minecraft:block' })
  assert.equal(items.matched, 1)
  assert.equal(items.items[0].tag, 'minecraft:mineable/axe')
  assert.equal(items.items[0].count, 1)
})

test('tag：不存在的 tag 是 0 命中，不是抛错', async () => {
  const index = await fixtureIndex()
  const value = query(index, { kind: 'tag', tag: 'minecraft:nope' })
  assert.equal(value.matched, 0)
  assert.deepEqual(value.items, [])
})

test('recipe：按 id 与产物过滤', async () => {
  const index = await fixtureIndex()
  const byId = query(index, { kind: 'recipe', filter: 'coal_block' })
  assert.equal(byId.matched, 1)
  assert.equal(byId.items[0].result.item, 'minecraft:coal_block')

  const byResult = query(index, { kind: 'recipe', filter: 'minecraft:oak_planks' })
  assert.equal(byResult.matched, 1)
  assert.deepEqual(byResult.items[0].ingredients, [['minecraft:oak_log']])
})

test('limit 被夹在 1..200', async () => {
  const index = await fixtureIndex()
  assert.equal(DEFAULT_LIMIT, 50)
  assert.equal(MAX_LIMIT, 200)
  assert.equal(query(index, { kind: 'registry', limit: 9999 }).items.length, 4)
  assert.equal(query(index, { kind: 'registry', limit: 0 }).items.length, 1)
})
