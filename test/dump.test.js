import assert from 'node:assert/strict'
import test from 'node:test'
import { ATLAS_SCHEMA, AtlasSchemaError, parseDump, validateDump } from '../engine/dump.js'
import { readFixtureDump } from './helpers.js'

test('schema 版本号就是 1', () => {
  assert.equal(ATLAS_SCHEMA, 1)
})

test('fixture 能通过校验并解析', async () => {
  const dump = await readFixtureDump()
  assert.deepEqual(validateDump(dump), [])
  const parsed = parseDump(JSON.stringify(dump))
  assert.equal(parsed.schema, 1)
  assert.equal(parsed.registries['minecraft:item'].count, 4)
  assert.equal(parsed.errors.length, 0)
})

test('schema 不匹配会点名到具体字段', async () => {
  const dump = await readFixtureDump()
  dump.env.loader = 'quilt'
  const problems = validateDump(dump)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /env\.loader/)
})

test('缺必需段落会被拒', async () => {
  const dump = await readFixtureDump()
  delete dump.recipes
  const problems = validateDump(dump)
  assert.ok(problems.some((problem) => problem.includes('recipes')))
})

test('truncatedSections 只认三段', async () => {
  const dump = await readFixtureDump()
  dump.truncated = true
  dump.truncatedSections = ['registries', 'loot_tables']
  const problems = validateDump(dump)
  assert.ok(problems.some((problem) => problem.includes('loot_tables')))
})

test('不是 JSON 时抛 ATLAS_SCHEMA_MISMATCH', () => {
  assert.throws(
    () => parseDump('{ not json'),
    (error) => error instanceof AtlasSchemaError && error.code === 'ATLAS_SCHEMA_MISMATCH',
  )
})

test('schema 版本不对时抛 ATLAS_SCHEMA_MISMATCH 并带问题清单', async () => {
  const dump = await readFixtureDump()
  dump.schema = 2
  assert.throws(
    () => parseDump(JSON.stringify(dump)),
    (error) => error instanceof AtlasSchemaError
      && error.code === 'ATLAS_SCHEMA_MISMATCH'
      && error.problems.some((problem) => problem.includes('schema')),
  )
})

test('entries 里缺 id 会被点名', async () => {
  const dump = await readFixtureDump()
  delete dump.registries['minecraft:item'].entries[0].id
  const problems = validateDump(dump)
  assert.ok(problems.some((problem) => problem.includes('缺 id')), problems.join('\n'))
})

test('配方的 result.count 必须是正整数', async () => {
  const dump = await readFixtureDump()
  dump.recipes.entries[0].result.count = 0
  const problems = validateDump(dump)
  assert.ok(problems.some((problem) => problem.includes('result.count')))
})

test('errors 的 section 只认已知五类', async () => {
  const dump = await readFixtureDump()
  dump.errors = [{ section: 'loot', message: 'x' }]
  const problems = validateDump(dump)
  assert.ok(problems.some((problem) => problem.includes('loot')))
})
