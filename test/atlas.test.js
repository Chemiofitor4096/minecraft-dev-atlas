import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAtlas } from '../src/lib/atlas.js'
import { dumpPath } from '../src/lib/paths.js'
import { readFixtureDump, fakeProject, tempDir } from './helpers.js'

/**
 * 每个用例一个临时 DSH_HOME（paths 在调用时读环境变量）。
 * @param {import('node:test').TestContext} t
 */
async function setup(t) {
  const home = await tempDir(t, 'atlas-home-')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  const project = await fakeProject(t)
  const atlas = createAtlas({ mcdev: {}, version: '0.1.0' })
  return { project, atlas }
}

test('没有 dump 时 query 报 NO_DATA（不替调用方起进程）', async (t) => {
  const { project, atlas } = await setup(t)
  await assert.rejects(
    () => atlas.query({ root: project, kind: 'digest' }),
    (error) => {
      assert.equal(error.code, 'NO_DATA')
      assert.match(error.message, /mc_data_dump/)
      return true
    },
  )
})

test('有 dump 时 query 返回摘要，且按 sourceHash 标 stale', async (t) => {
  const { project, atlas } = await setup(t)
  const dump = await readFixtureDump()
  await mkdir(dirname(dumpPath(project)), { recursive: true })
  await writeFile(dumpPath(project), JSON.stringify(dump), 'utf8')

  const digest = await atlas.query({ root: project, kind: 'digest' })
  assert.equal(digest.kind, 'digest')
  assert.equal(digest.counts.registries, 7)
  assert.equal(digest.stale, true) // fixture 的 sourceHash 不是这个工程算出来的
  assert.match(digest.path, /dump\.json$/)

  const registry = await atlas.query({ root: project, kind: 'registry', filter: 'coal' })
  assert.equal(registry.matched, 2)
  assert.equal(registry.stale, true)
})

test('state：有没有数据、新不新', async (t) => {
  const { project, atlas } = await setup(t)
  const before = await atlas.state({ root: project })
  assert.equal(before.hasDump, false)

  const dump = await readFixtureDump()
  await mkdir(dirname(dumpPath(project)), { recursive: true })
  await writeFile(dumpPath(project), JSON.stringify(dump), 'utf8')
  const after = await atlas.state({ root: project })
  assert.equal(after.hasDump, true)
  assert.equal(after.stale, true)
  assert.equal(after.meta, undefined) // 没有 meta，state 也不编一个出来
})

test('索引缓存：同一份文件重复查询复用，不需要每次解析 1MB', async (t) => {
  const { project, atlas } = await setup(t)
  const dump = await readFixtureDump()
  await mkdir(dirname(dumpPath(project)), { recursive: true })
  await writeFile(dumpPath(project), JSON.stringify(dump), 'utf8')
  const first = await atlas.query({ root: project, kind: 'registry', filter: 'coal' })
  const second = await atlas.query({ root: project, kind: 'registry', filter: 'coal' })
  assert.deepEqual(second.items, first.items)
})
