import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { dataRoot, dshHome, dumpPath, metaPath, profileName, projectDataDir, projectKey, stateRoot } from '../src/lib/paths.js'

test('profileName：桌面版把 profile 目录放进 argv', () => {
  assert.equal(profileName(['C:\\Users\\h\\.dsh\\profiles\\desktop'], {}), 'desktop')
  assert.equal(profileName(['C:\\x\\profiles\\m0test\\'], {}), 'm0test')
})

test('profileName：CLI 的 --profile / --profile=', () => {
  assert.equal(profileName(['node', 'bin.js', '--profile', 'm10smoke'], {}), 'm10smoke')
  assert.equal(profileName(['node', 'bin.js', '--profile=m10smoke'], {}), 'm10smoke')
})

test('profileName：argv 优先于 DSH_PROFILE', () => {
  assert.equal(profileName(['--profile', 'argv'], { DSH_PROFILE: 'env' }), 'argv')
  assert.equal(profileName([], { DSH_PROFILE: 'env' }), 'env')
  assert.equal(profileName([], {}), undefined)
})

test('DSH_HOME / 状态根目录', () => {
  assert.equal(dshHome({ DSH_HOME: 'D:\\dsh' }), 'D:\\dsh')
  assert.equal(stateRoot({ DSH_HOME: 'D:\\dsh' }), join('D:\\dsh', 'mc-dev-starter'))
})

test('dataRoot：按 profile 分目录，认不出来退回根', () => {
  assert.equal(
    dataRoot({ env: { DSH_HOME: 'D:\\dsh' }, argv: ['--profile', 'desktop'] }),
    join('D:\\dsh', 'mc-dev-starter', 'profiles', 'desktop', 'data'),
  )
  assert.equal(
    dataRoot({ env: { DSH_HOME: 'D:\\dsh' }, argv: [] }),
    join('D:\\dsh', 'mc-dev-starter', 'data'),
  )
})

test('projectKey：可读 + 稳定 + 同目录不同大小写视为同一个', () => {
  const key = projectKey('C:\\Projects\\Test')
  assert.equal(key, projectKey('C:\\Projects\\Test'))
  assert.equal(key, projectKey('c:\\projects\\test'))
  assert.match(key, /^test-[0-9a-f]{8}$/)
  assert.notEqual(key, projectKey('C:\\Projects\\Other'))
})

test('dumpPath / metaPath 落在项目数据目录下', () => {
  const options = { env: { DSH_HOME: 'D:\\dsh' }, argv: ['--profile', 'desktop'] }
  const dir = projectDataDir('C:\\Projects\\Test', options)
  assert.equal(dumpPath('C:\\Projects\\Test', options), join(dir, 'dump.json'))
  assert.equal(metaPath('C:\\Projects\\Test', options), join(dir, 'meta.json'))
})
