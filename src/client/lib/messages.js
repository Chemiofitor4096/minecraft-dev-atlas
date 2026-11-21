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
  'button.dataTitle': '打开数据面板（注册表 / 标签 / 配方）',

  'panel.noData': '这个工程还没有导出过数据',
  'panel.noDataHint': '点「导出」起一次服务端，把注册表、标签、配方索引取出来；之后查询都只读这份文件。',
  'panel.loadingProjects': '正在识别工作区里的工程…',
  'panel.noProject': '这个工作区里没有识别到 MC 工程',
  'panel.noProjectHint': '当前目录：{cwd}',
  'panel.project': '工程',
  'panel.noServerTarget': '这个工程没有服务端运行目标（数据只能从 runServer 导出）',
  'panel.rescan': '重新识别',
  'panel.export': '导出',
  'panel.reexport': '重新导出',
  'panel.exporting': '导出中…（起服务端，约 30–60 秒）',
  'panel.refresh': '刷新',
  'panel.stale': '源文件改过，这份数据可能过期',
  'panel.error': '出错了：{message}',
  'panel.loading': '加载中…',
  'panel.empty': '没有命中',
  'panel.matched': '命中 {count}',
  'panel.range': '{from}–{to}',
  'panel.prev': '上一页',
  'panel.next': '下一页',
  'panel.back': '返回标签列表',
  'panel.tagHint': '选一个标签看成员',
  'panel.tagMembers': '{count} 个成员',
  'panel.excerpt': '只读表格；搜索与翻页都走宿主，不花模型 token。',
  'panel.counts': '注册表 {registries} · 标签 {tags}（成员 {members}）· 配方 {recipes}',

  'kind.registry': '注册表',
  'kind.tag': '标签',
  'kind.recipe': '配方',

  'col.id': 'id',
  'col.owner': '来源',
  'col.props': '属性',
  'col.tag': '标签',
  'col.count': '成员',
  'col.type': '类型',
  'col.result': '产物',
  'col.ingredients': '材料',

  'props.stack': '堆叠 {n}',
  'props.damage': '耐久 {n}',
  'props.hardness': '硬度 {n}',

  'env.side.server': '服务端',
  'env.side.client': '客户端',
  'env.none': '未导出',
  'loader.unknown': '未知 loader',
  'search.placeholder': '搜索 id…',
}

/** 英文词典；键集合必须与 zh 完全一致。 */
export const en = {
  'tab.data': 'Data',
  'button.data': 'Data',
  'button.dataTitle': 'Open the data panel (registries / tags / recipes)',

  'panel.noData': 'No exported data for this project yet',
  'panel.noDataHint': 'Press Export to boot a server once and snapshot registries, tags and the recipe index; every query after that only reads the file.',
  'panel.loadingProjects': 'Detecting projects in this workspace…',
  'panel.noProject': 'No Minecraft project found in this workspace',
  'panel.noProjectHint': 'Current directory: {cwd}',
  'panel.project': 'Project',
  'panel.noServerTarget': 'This project has no server run target (data can only come from runServer)',
  'panel.rescan': 'Rescan',
  'panel.export': 'Export',
  'panel.reexport': 'Re-export',
  'panel.exporting': 'Exporting… (booting the server, 30–60 s)',
  'panel.refresh': 'Refresh',
  'panel.stale': 'Sources changed since this export',
  'panel.error': 'Failed: {message}',
  'panel.loading': 'Loading…',
  'panel.empty': 'No matches',
  'panel.matched': '{count} matched',
  'panel.range': '{from}–{to}',
  'panel.prev': 'Previous',
  'panel.next': 'Next',
  'panel.back': 'Back to tags',
  'panel.tagHint': 'Pick a tag to see its members',
  'panel.tagMembers': '{count} members',
  'panel.excerpt': 'Read-only table; search and paging go through the host and cost no model tokens.',
  'panel.counts': 'Registries {registries} · Tags {tags} ({members} members) · Recipes {recipes}',

  'kind.registry': 'Registry',
  'kind.tag': 'Tag',
  'kind.recipe': 'Recipe',

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
