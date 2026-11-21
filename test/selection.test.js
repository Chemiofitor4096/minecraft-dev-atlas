import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasMcProject,
  hasNearbyMcProject,
  isMcProject,
  mcProjects,
  nearbyMcProjects,
  pickProject,
  projectDepth,
  serverTargetOf,
} from '../src/client/lib/selection.js'

const ITEM = {
  root: 'C:\\Projects\\Test',
  name: 'Test',
  kind: 'mod',
  loader: 'neoforge',
  runTargets: [
    { taskPath: 'runClient', kind: 'client', mode: 'daemon' },
    { taskPath: 'runServer', kind: 'server', mode: 'daemon' },
  ],
}

const LIBRARY = {
  root: 'C:\\Projects\\AnnoCore\\anno-core',
  name: 'anno-core',
  kind: 'mod',
  loader: 'fabric',
  runTargets: [],
}

const UNKNOWN = {
  root: 'C:\\Projects\\minecraft-dev-atlas\\agent',
  name: 'agent',
  kind: 'unknown',
  loader: 'unknown',
  runTargets: [],
}

test('isMcProject：kind=unknown 不算 MC 工程', () => {
  assert.equal(isMcProject(ITEM), true)
  assert.equal(isMcProject(UNKNOWN), false)
  assert.equal(isMcProject(undefined), false)
})

test('mcProjects / hasMcProject', () => {
  assert.deepEqual(mcProjects([ITEM, UNKNOWN, LIBRARY]).map((project) => project.name), ['Test', 'anno-core'])
  assert.equal(hasMcProject([UNKNOWN]), false)
  assert.equal(hasMcProject([UNKNOWN, ITEM]), true)
  assert.equal(hasMcProject(undefined), false)
})

test('serverTargetOf：优先 kind=server，其次 runServer 结尾', () => {
  assert.equal(serverTargetOf(ITEM).taskPath, 'runServer')
  const moduleProject = {
    runTargets: [
      { taskPath: ':anno-mod-neoforge:runClient', kind: 'client' },
      { taskPath: ':anno-mod-neoforge:runServer' },
    ],
  }
  assert.equal(serverTargetOf(moduleProject).taskPath, ':anno-mod-neoforge:runServer')
  assert.equal(serverTargetOf(LIBRARY), undefined)
  assert.equal(serverTargetOf(undefined), undefined)
})

test('pickProject：cwd 本身优先，其次能跑服务端的，最后第一个', () => {
  assert.equal(pickProject([LIBRARY, ITEM], 'C:\\Projects\\Test').name, 'Test')
  assert.equal(pickProject([LIBRARY, ITEM], 'c:\\projects\\test').name, 'Test')
  // cwd 正好是库工程：就显示这个库工程（不能跑不代表不是用户当前的项目）
  assert.equal(pickProject([LIBRARY, ITEM], 'C:\\Projects\\AnnoCore\\anno-core').name, 'anno-core')
  // cwd 是父目录：在同工作区的子工程里挑能跑服务端的那个
  const runnable = { ...ITEM, root: 'C:\\Projects\\AnnoCore\\anno-mod-neoforge', name: 'anno-mod-neoforge' }
  assert.equal(pickProject([LIBRARY, runnable], 'C:\\Projects\\AnnoCore').name, 'anno-mod-neoforge')
  // 没有能跑的，就第一个 MC 工程
  assert.equal(pickProject([LIBRARY], 'C:\\Projects\\AnnoCore').name, 'anno-core')
  // 只有 unknown 时没有可选工程
  assert.equal(pickProject([UNKNOWN], 'C:\\Projects'), undefined)
  assert.equal(pickProject(undefined, undefined), undefined)
})

test('projectDepth：自己 / 直接子目录 / 深层 / 不在里面', () => {
  assert.equal(projectDepth('C:\\Projects\\Test', 'C:\\Projects\\Test'), 0)
  assert.equal(projectDepth('C:/Projects/Test', 'c:\\projects\\test\\'), 0)
  assert.equal(projectDepth('C:\\Projects', 'C:\\Projects\\Test'), 1)
  assert.equal(projectDepth('C:\\Projects\\minecraft-dev-starter', 'C:\\Projects\\minecraft-dev-starter\\templates\\fabric'), 2)
  assert.equal(projectDepth('C:\\Projects\\Test', 'C:\\Projects\\Other'), Number.POSITIVE_INFINITY)
  assert.equal(projectDepth(undefined, 'C:\\Projects\\Test'), Number.POSITIVE_INFINITY)
})

test('hasNearbyMcProject：模板/夹具不算"这个工作区的工程"', () => {
  const templates = [
    { root: 'C:\\Projects\\minecraft-dev-starter\\templates\\fabric', kind: 'mod' },
    { root: 'C:\\Projects\\minecraft-dev-starter\\templates\\neoforge', kind: 'mod' },
  ]
  assert.equal(hasNearbyMcProject(templates, 'C:\\Projects\\minecraft-dev-starter'), false)
  assert.equal(hasNearbyMcProject([ITEM], 'C:\\Projects\\Test'), true)
  assert.equal(hasNearbyMcProject([{ ...ITEM, root: 'C:\\Projects\\Test\\mod' }], 'C:\\Projects\\Test'), true)
  assert.equal(hasNearbyMcProject([ITEM], 'C:\\Projects'), true)
  assert.equal(hasNearbyMcProject([UNKNOWN], 'C:\\Projects\\minecraft-dev-atlas'), false)
  // 没有 cwd 时退回"只要扫描到 MC 工程就算"
  assert.equal(hasNearbyMcProject([ITEM], undefined), true)
})

test('nearbyMcProjects：只留 cwd 本身与直接子目录', () => {
  const deep = { root: 'C:\\Projects\\minecraft-dev-starter\\templates\\fabric', kind: 'mod' }
  assert.deepEqual(nearbyMcProjects([deep], 'C:\\Projects\\minecraft-dev-starter'), [])
  assert.deepEqual(nearbyMcProjects([ITEM, deep], 'C:\\Projects\\Test'), [ITEM])
  assert.deepEqual(nearbyMcProjects([ITEM], undefined), [ITEM])
})

test('pickProject：近处工程优先于扫描深度里的模板/夹具', () => {
  const deep = {
    root: 'C:\\Projects\\Test\\fixtures\\demo',
    name: 'fixture',
    kind: 'mod',
    runTargets: [{ taskPath: 'runServer', kind: 'server' }],
  }
  assert.equal(pickProject([deep, ITEM], 'C:\\Projects\\Test').name, 'Test')
  // 只有深层工程时仍返回它（面板会按"没有近处工程"隐藏入口）
  assert.equal(pickProject([deep], 'C:\\Projects\\Test').name, 'fixture')
})

test('nearbyMcProjects：同一 Gradle 构建的嵌套模块算当前工作区', () => {
  const cwd = 'C:\\Projects\\Multi'
  const nested = {
    root: 'C:\\Projects\\Multi\\modules\\core',
    name: 'core',
    kind: 'mod',
    gradleRoot: 'C:\\Projects\\Multi',
    runTargets: [{ taskPath: ':modules:core:runServer', kind: 'server' }],
  }
  const template = {
    root: 'C:\\Projects\\Multi\\templates\\fabric',
    name: 'template',
    kind: 'mod',
    gradleRoot: 'C:\\Projects\\Multi\\templates\\fabric',
  }
  assert.deepEqual(nearbyMcProjects([nested], cwd), [nested])
  assert.deepEqual(nearbyMcProjects([template], cwd), [])
  assert.equal(hasNearbyMcProject([nested], cwd), true)
  assert.equal(hasNearbyMcProject([template], cwd), false)
  assert.equal(pickProject([nested], cwd).name, 'core')
})
