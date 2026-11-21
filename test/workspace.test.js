import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasMcProject,
  loadProjects,
  selectProject,
  selectedProject,
  serverTargetOf,
  setWorkspace,
  workspaceStore,
} from '../src/client/lib/workspace.js'

/** 每个用例从干净 store 开始。 */
function reset() {
  workspaceStore.set({
    cwd: undefined,
    ready: false,
    loading: false,
    supported: true,
    projects: [],
    selectedRoot: undefined,
    error: undefined,
    scannedAt: 0,
  })
}

/**
 * 替身 fetch：记录请求，按 handler 返回 `{ ok:true, result }`。
 * @param {(url: string, body: any) => any} handler
 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const body = options?.body === undefined ? undefined : JSON.parse(options.body)
    calls.push({ url, body })
    const result = await handler(url, body)
    return { ok: true, json: async () => ({ ok: true, result }) }
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const TEST_PROJECT = {
  root: 'C:/Projects/Test',
  name: 'Test',
  kind: 'mod',
  loader: 'neoforge',
  mcVersion: '1.21.1',
  runTargets: [
    { taskPath: 'runClient', kind: 'client', mode: 'daemon', label: 'Client' },
    { taskPath: 'runServer', kind: 'server', mode: 'daemon', label: 'Server' },
  ],
}

test('setWorkspace：按当前会话 cwd 拉工程并选中它', async (t) => {
  reset()
  const fetchStub = stubFetch(async (_url, body) => ({
    supported: true,
    workspace: body.workspace,
    truncated: false,
    projects: [TEST_PROJECT],
  }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  assert.equal(fetchStub.calls.length, 1)
  assert.equal(fetchStub.calls[0].url, '/atlas/api/data.projects')
  assert.deepEqual(fetchStub.calls[0].body, { workspace: 'C:/Projects/Test', refresh: true })

  const state = workspaceStore.get()
  assert.equal(state.ready, true)
  assert.equal(state.cwd, 'C:/Projects/Test')
  assert.equal(state.selectedRoot, 'C:/Projects/Test')
  assert.equal(hasMcProject(state.projects), true)
  assert.equal(selectedProject().name, 'Test')
})

test('setWorkspace：同一 cwd 重复调用不再扫', async (t) => {
  reset()
  const fetchStub = stubFetch(async (_url, body) => ({ supported: true, workspace: body.workspace, projects: [TEST_PROJECT] }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  await setWorkspace('C:/Projects/Test')
  assert.equal(fetchStub.calls.length, 1)
})

test('切到没有 MC 工程的工作区：工程清空、选中项清空', async (t) => {
  reset()
  let workspace = 'C:/Projects/Test'
  const fetchStub = stubFetch(async () => ({
    supported: true,
    workspace,
    projects: workspace === 'C:/Projects/Test'
      ? [TEST_PROJECT]
      : [{ root: 'C:\\Projects\\minecraft-dev-atlas\\agent', name: 'agent', kind: 'unknown', loader: 'unknown', runTargets: [] }],
  }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  workspace = 'C:/Projects/minecraft-dev-atlas'
  await setWorkspace('C:/Projects/minecraft-dev-atlas')

  const state = workspaceStore.get()
  assert.equal(state.projects.length, 1)
  assert.equal(hasMcProject(state.projects), false)
  assert.equal(state.selectedRoot, undefined)
  assert.equal(selectedProject(), undefined)
})

test('扫描失败：ready=true + error，不把旧工程留在面板上', async (t) => {
  reset()
  const fetchStub = stubFetch(async () => {
    throw new Error('识别失败')
  })
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  const state = workspaceStore.get()
  assert.equal(state.ready, true)
  assert.equal(state.error, '识别失败')
  assert.deepEqual(state.projects, [])
})

test('loadProjects：30 秒内复用，refresh 强制重扫', async (t) => {
  reset()
  const fetchStub = stubFetch(async (_url, body) => ({ supported: true, workspace: body.workspace, projects: [TEST_PROJECT] }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  await loadProjects('C:/Projects/Test')
  assert.equal(fetchStub.calls.length, 1)

  await loadProjects('C:/Projects/Test', { refresh: true })
  assert.equal(fetchStub.calls.length, 2)
})

test('selectProject + selectedProject', async (t) => {
  reset()
  const second = { ...TEST_PROJECT, root: 'C:/Projects/Other', name: 'Other' }
  const fetchStub = stubFetch(async (_url, body) => ({
    supported: true,
    workspace: body.workspace,
    projects: [TEST_PROJECT, second],
  }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  assert.equal(selectedProject().root, 'C:/Projects/Test')
  selectProject('C:/Projects/Other')
  assert.equal(selectedProject().root, 'C:/Projects/Other')
  assert.equal(serverTargetOf(selectedProject()).taskPath, 'runServer')
})

test('老 starter：supported=false 时也保留工作区与空清单', async (t) => {
  reset()
  const fetchStub = stubFetch(async () => ({ supported: false, workspace: 'C:/Projects/Test', projects: [] }))
  t.after(() => fetchStub.restore())

  await setWorkspace('C:/Projects/Test')
  const state = workspaceStore.get()
  assert.equal(state.supported, false)
  assert.equal(state.ready, true)
  assert.deepEqual(state.projects, [])
})
