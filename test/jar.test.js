import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { jarPath, parseManifest, readJarManifest, readJarVersion } from '../src/lib/jar.js'

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

test('parseManifest：续行与空行', () => {
  const fields = parseManifest(Buffer.from('Manifest-Version: 1.0\r\nLong: a\r\n b\r\n\r\nX: y\r\n', 'utf8'))
  assert.equal(fields['Manifest-Version'], '1.0')
  assert.equal(fields.Long, 'ab')
  assert.equal(fields.X, 'y')
})
