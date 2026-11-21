/**
 * 客户端文本：zh / en 两份扁平字典 + 取词。
 *
 * 语言顺序：宿主 locale 服务 → `navigator.language` → zh。`zh` 是 key 集合的基准，
 * `en` 必须逐键对齐（`test/messages.test.js` 守护）；组件里不写界面字面量。
 * @module minecraft-dev-atlas/client/messages
 */

/** 向宿主 locale 注册时用的命名空间。 */
export const LOCALE_NS = 'minecraft-dev-atlas'

/** 中文词典（key 集合的基准）。 */
export const zh = {
  'tab.data': '数据',
  'button.data': '数据',
  'button.dataTitle': '打开数据面板（注册表、标签、配方）',

  'panel.noData': '该工程尚未导出数据',
  'panel.noDataHint': '选择「导出」启动一次服务端，读取注册表、标签与配方索引；后续查询仅读取该文件。',
  'panel.loadingProjects': '正在识别工作区中的工程…',
  'panel.noProject': '当前工作区未检测到 Minecraft 工程',
  'panel.noProjectHint': '当前目录：{cwd}',
  'panel.project': '工程',
  'panel.registry': '注册表',
  'panel.noServerTarget': '该工程没有服务端运行目标（数据仅可通过 runServer 导出）',
  'panel.rescan': '重新识别',
  'panel.export': '导出',
  'panel.reexport': '重新导出',
  'panel.exporting': '正在导出（启动服务端）',
  'panel.refresh': '刷新',
  'panel.stale': '源文件已变更，当前数据可能已过期',
  'panel.error': '错误：{message}',
  'panel.loading': '正在加载…',
  'panel.empty': '无匹配项',
  'panel.matched': '共 {count} 项',
  'panel.range': '{from}–{to}',
  'panel.prev': '上一页',
  'panel.next': '下一页',
  'panel.back': '返回标签列表',
  'panel.tagHint': '选择标签以查看成员',
  'panel.tagMembers': '{count} 个成员',
  'panel.excerpt': '只读表格。搜索与翻页由宿主处理，不消耗模型 token。',
  'panel.pageSize': '每页',

  'count.registries': '注册表',
  'count.tags': '标签',
  'count.recipes': '配方',
  'count.tagMembers': '（成员 {count}）',

  'kind.registry': '注册表',
  'kind.tag': '标签',
  'kind.recipe': '配方',

  'col.name': '注册名',
  'col.namespace': '命名空间',
  'col.id': 'id',
  'col.owner': '来源',
  'col.props': '属性',
  'col.tag': '标签',
  'col.count': '成员数',
  'col.type': '类型',
  'col.result': '产物',
  'col.ingredients': '材料',

  'props.stack': '堆叠 {n}',
  'props.damage': '耐久 {n}',
  'props.hardness': '硬度 {n}',

  'env.side.server': '服务端',
  'env.side.client': '客户端',
  'env.none': '未导出',
  'loader.unknown': '未识别的 loader',
  'search.placeholder': '搜索 id…',
}

/** 英文词典；键集合必须与 zh 完全一致。 */
export const en = {
  'tab.data': 'Data',
  'button.data': 'Data',
  'button.dataTitle': 'Open the data panel (registries, tags, recipes)',

  'panel.noData': 'No data has been exported for this project',
  'panel.noDataHint': 'Select Export to start a server and capture registries, tags and the recipe index. Subsequent queries read this file only.',
  'panel.loadingProjects': 'Detecting projects in the workspace…',
  'panel.noProject': 'No Minecraft project detected in the current workspace',
  'panel.noProjectHint': 'Current directory: {cwd}',
  'panel.project': 'Project',
  'panel.registry': 'Registry',
  'panel.noServerTarget': 'This project has no server run target; data can only be exported through runServer',
  'panel.rescan': 'Rescan',
  'panel.export': 'Export',
  'panel.reexport': 'Re-export',
  'panel.exporting': 'Exporting (starting the server)',
  'panel.refresh': 'Refresh',
  'panel.stale': 'Source files have changed since this export',
  'panel.error': 'Error: {message}',
  'panel.loading': 'Loading…',
  'panel.empty': 'No matches',
  'panel.matched': '{count} items',
  'panel.range': '{from}–{to}',
  'panel.prev': 'Previous',
  'panel.next': 'Next',
  'panel.back': 'Back to tags',
  'panel.tagHint': 'Select a tag to view its members',
  'panel.tagMembers': '{count} members',
  'panel.excerpt': 'Read-only table. Search and paging are handled by the host and consume no model tokens.',
  'panel.pageSize': 'Per page',

  'count.registries': 'Registries',
  'count.tags': 'Tags',
  'count.recipes': 'Recipes',
  'count.tagMembers': ' ({count} members)',

  'kind.registry': 'Registry',
  'kind.tag': 'Tag',
  'kind.recipe': 'Recipe',

  'col.name': 'Name',
  'col.namespace': 'Namespace',
  'col.id': 'id',
  'col.owner': 'Owner',
  'col.props': 'Props',
  'col.tag': 'Tag',
  'col.count': 'Members',
  'col.type': 'Type',
  'col.result': 'Result',
  'col.ingredients': 'Ingredients',

  'props.stack': 'stack {n}',
  'props.damage': 'durability {n}',
  'props.hardness': 'hardness {n}',

  'env.side.server': 'server',
  'env.side.client': 'client',
  'env.none': 'no data',
  'loader.unknown': 'unknown loader',
  'search.placeholder': 'Search ids…',
}

/** @type {any} */
let localeService

/** 语言变化的外部 store：`useLocale()` 订阅它。 */
const revisionSource = {
  listeners: new Set(),
  version: 0,
  subscribe(callback) {
    revisionSource.listeners.add(callback)
    try {
      const dispose = localeService?.subscribe?.(() => {
        revisionSource.version += 1
        for (const listener of revisionSource.listeners) listener()
      })
      return () => {
        revisionSource.listeners.delete(callback)
        if (typeof dispose === 'function') dispose()
      }
    } catch {
      return () => revisionSource.listeners.delete(callback)
    }
  },
  /** @returns {string} */
  snapshot() {
    try {
      return String(localeService?.getSnapshot?.().active ?? 'none')
    } catch {
      return 'none'
    }
  },
}

/** 供 `useLocale()` 使用的稳定源。 */
export function localeSource() {
  return revisionSource
}

/** `ctx.locale.bind(NS)` 返回的翻译函数。 */
let translate

/**
 * @param {any} ctx
 * @returns {boolean} 是否拿到了 locale 服务
 */
export function attachLocale(ctx) {
  let service
  try {
    service = ctx?.locale
  } catch {
    service = undefined
  }
  if (service === undefined || service === null) {
    try {
      service = typeof ctx?.get === 'function' ? ctx.get('locale', false) : undefined
    } catch {
      service = undefined
    }
  }
  if (service === undefined || service === null) return false

  localeService = service
  try {
    if (typeof service.register === 'function') service.register(LOCALE_NS, { zh, en })
  } catch {
    // 注册失败不影响加载：t 会用本地词典兜底
  }
  try {
    translate = typeof service.bind === 'function' ? service.bind(LOCALE_NS) : undefined
  } catch {
    translate = undefined
  }
  return true
}

/** @returns {'zh' | 'en'} */
export function activeLanguage() {
  try {
    const active = localeService?.getSnapshot?.().active
    if (typeof active === 'string' && active !== '') return normalizeLanguage(active)
  } catch {
    // 服务异常就继续回退
  }
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    return normalizeLanguage(String(navigator.language ?? ''))
  }
  return 'zh'
}

/**
 * @param {string} language
 * @returns {'zh' | 'en'}
 */
function normalizeLanguage(language) {
  const value = language.toLowerCase()
  if (value.startsWith('zh')) return 'zh'
  if (value.startsWith('en')) return 'en'
  return 'zh'
}

/**
 * @param {string} key
 * @param {Record<string, string | number | undefined | null>} [params]
 * @returns {string}
 */
export function t(key, params) {
  let text
  if (translate !== undefined) {
    try {
      const translated = translate(key, params)
      if (typeof translated === 'string' && translated !== '' && translated !== key) text = translated
    } catch {
      text = undefined
    }
  }
  if (text === undefined) {
    const dict = activeLanguage() === 'en' ? en : zh
    text = dict[key] ?? zh[key] ?? key
  }
  return interpolate(text, params)
}

/**
 * @param {string} text
 * @param {Record<string, string | number | undefined | null>} [params]
 * @returns {string}
 */
export function interpolate(text, params) {
  if (typeof text !== 'string') return ''
  if (params === undefined || params === null) return text
  let out = text
  for (const [name, value] of Object.entries(params)) {
    const replacement = value === undefined || value === null ? '' : String(value)
    out = out.split(`{${name}}`).join(replacement)
  }
  return out
}
