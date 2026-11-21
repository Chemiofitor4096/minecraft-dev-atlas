import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import {
  classVersionsAbove,
  jarPath,
  parseManifest,
  readClassVersions,
  readJarManifest,
  readJarVersion,
  MAX_CLASS_MAJOR,
} from '../src/lib/jar.js'

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

test('jar 已构建时：manifest 满足 Agent 契约，且版本与 package.json 相等', (t) => {
  if (!existsSync(jarPath())) {
    t.skip('assets/mcdev-atlas.jar 还没构建（npm run build）')
    return
  }
  const manifest = readJarManifest()
  assert.equal(manifest['Premain-Class'], 'dev.mcdev.atlas.Premain')
  assert.equal(manifest['Agent-Class'], 'dev.mcdev.atlas.AgentMain')
  assert.equal(manifest['MCDEV-Schema'], '1')
  assert.equal(manifest['Implementation-Version'], PACKAGE_VERSION)
  assert.equal(readJarVersion(), PACKAGE_VERSION)
})

test('jar 里的 class 不高于 Java 17：premain 跑在游戏 JVM（1.20.1 线是 17）', (t) => {
  if (!existsSync(jarPath())) {
    t.skip('assets/mcdev-atlas.jar 还没构建（npm run build）')
    return
  }
  const versions = readClassVersions()
  assert.ok(versions.length > 0, 'jar 里应当有 class')
  const tooNew = classVersionsAbove(versions)
  assert.deepEqual(
    tooNew,
    [],
    `这些 class 高于 major ${MAX_CLASS_MAJOR}，会让 premain 在 Java ${MAX_CLASS_MAJOR - 44} 上 UnsupportedClassVersionError：`
      + tooNew.map((entry) => `${entry.name}(${entry.major})`).join(', '),
  )
})

test('classVersionsAbove：按主版本号筛出超限项', () => {
  const versions = [
    { name: 'a.class', major: 61 },
    { name: 'b.class', major: 65 },
    { name: 'c.class', major: 55 },
  ]
  assert.deepEqual(classVersionsAbove(versions).map((entry) => entry.name), ['b.class'])
  assert.deepEqual(classVersionsAbove(versions, 65), [])
})

test('parseManifest：续行与空行', () => {
  const fields = parseManifest(Buffer.from('Manifest-Version: 1.0\r\nLong: a\r\n b\r\n\r\nX: y\r\n', 'utf8'))
  assert.equal(fields['Manifest-Version'], '1.0')
  assert.equal(fields.Long, 'ab')
  assert.equal(fields.X, 'y')
})
