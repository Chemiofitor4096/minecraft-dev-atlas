/**
 * 客户端产物守卫：`lib/client.js` 不进仓库，只有发布时通过 files 进包。
 * 忘了构建的错，本地全绿也发现不了——所以这里按宿主的加载协议在 VM 里真跑一遍。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const BUNDLE = new URL('../lib/client.js', import.meta.url)

function reactStub() {
  const createElement = (type, props, ...children) => ({ type, props, children })
  return {
    createElement,
    Fragment: Symbol.for('react.fragment'),
    memo: (component) => component,
    forwardRef: (component) => component,
    createContext: (value) => ({ Provider: () => null, Consumer: () => null, value }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useContext: () => ({}),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

const MODULES = {
  react: reactStub(),
  'react-dom': { createPortal: () => null, render: () => {}, unmountComponentAtNode: () => {} },
  'react-dom/client': { createRoot: () => ({ render() {}, unmount() {} }) },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol.for('react.fragment') },
}

function createSandbox() {
  const loads = []
  const style = { id: '', textContent: '', setAttribute() {}, appendChild() {} }
  const created = []
  const document = {
    getElementById: () => null,
    createElement: () => {
      const element = { ...style }
      created.push(element)
      return element
    },
    head: { appendChild() {} },
    body: { appendChild() {} },
  }
  const window = { __ModuleLoader__: { load: (definition) => loads.push(definition) } }
  window.document = document
  const sandbox = {
    window,
    document,
    fetch: () => Promise.resolve({ ok: true }),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    URL,
    navigator: { language: 'zh-CN' },
  }
  return { sandbox, loads, created }
}

/** 一个够用的 cordis ctx。 */
function createCtx() {
  const slots = []
  const tabTypes = []
  const opened = []
  const injected = []
  const ctx = {
    slots: {
      inject(name, callback) {
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(entry, slotComponent) {
        slots.push({ entry, component: slotComponent })
        return () => {}
      },
    },
    effect(factory) {
      const dispose = factory()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    sidebarRightTabs: {
      register(definition) {
        tabTypes.push(definition)
        return () => {}
      },
    },
    sidebarRight: {
      openTab(kind) {
        opened.push(kind)
      },
    },
    inject(names, callback) {
      injected.push(names)
      callback({})
      return () => {}
    },
    get() {
      return undefined
    },
  }
  return { ctx, slots, tabTypes, opened, injected }
}

async function loadBundle() {
  const source = await readFile(BUNDLE, 'utf8')
  const { sandbox, loads, created } = createSandbox()
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.equal(loads.length, 1, 'lib/client.js 应当只调用一次 __ModuleLoader__.load')
  return { definition: loads[0], created }
}

test('产物外壳符合宿主加载协议', async () => {
  const { definition } = await loadBundle()
  assert.equal(definition.id, 'minecraft-dev-atlas')
  assert.equal(typeof definition.factory, 'function')
})

test('factory 导出 cordis 插件形状', async () => {
  const { definition } = await loadBundle()
  const plugin = definition.factory((id) => {
    const mod = MODULES[id]
    assert.ok(mod !== undefined, `未知的外部模块: ${id}`)
    return mod
  })
  assert.equal(plugin.name, 'atlas-client')
  assert.deepEqual([...plugin.inject], ['slots', 'sidebarRight', 'sidebarRightTabs'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 注册标题栏按钮、标签类型、正文与标题 chip', async () => {
  const { definition, created } = await loadBundle()
  const plugin = definition.factory((id) => MODULES[id])
  const { ctx, slots, tabTypes } = createCtx()
  plugin.apply(ctx)

  const button = slots.find((slot) => slot.entry.name === 'conversation.session.header.utilities')
  assert.ok(button !== undefined, '没有注册标题栏按钮')
  assert.equal(button.entry.id, 'minecraft-dev-atlas:data-button')
  assert.equal(button.entry.order, 16)
  assert.equal(typeof button.component, 'function')

  assert.deepEqual(
    tabTypes.map((tab) => ({ id: tab.id, kind: tab.kind })),
    [{ id: 'minecraft-dev-atlas/data', kind: 'atlas.data' }],
  )
  assert.equal(typeof tabTypes[0].title, 'function')
  assert.equal(tabTypes[0].title(), '数据')

  const bodies = slots.filter((slot) => slot.entry.name === 'sidebar.right.pane.tab')
  assert.deepEqual(bodies.map((slot) => slot.entry.key), ['minecraft-dev-atlas/data'])
  assert.equal(typeof bodies[0].component, 'function')

  const titles = slots.filter((slot) => slot.entry.name === 'sidebar.right.pane.tab.title')
  assert.deepEqual(titles.map((slot) => slot.entry.key), ['minecraft-dev-atlas/data'])
  assert.equal(typeof titles[0].component, 'function')

  // 样式只注入一次
  assert.equal(created.length, 1)
  assert.match(created[0].textContent, /\.atlas-panel/)
})
