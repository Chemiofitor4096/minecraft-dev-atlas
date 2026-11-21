/**
 * 右侧栏「数据」标签：只读表格 + 搜索 + 导出。
 *
 * 数据全部经宿主的 `/atlas/api` 获取（与工具共用同一个 atlas 门面），面板不做第二套查询。
 * 工作区来自会话上下文（title bar 按钮与标签正文都能拿到 sessionId/useSessions）。
 * @module minecraft-dev-atlas/client/DataTab
 */

import { useCallback, useEffect, useState } from 'react'
import { call } from '../lib/api.js'
import { envText, ingredientsText, loaderLabel, pathOf, propsText, resultText, timeText } from '../lib/format.js'
import { h } from '../lib/h.js'
import { IconExport, IconRefresh } from '../lib/icons.js'
import { t } from '../lib/messages.js'
import { useLocale } from '../lib/useLocale.js'
import {
  loadProjects,
  nearbyMcProjects,
  pickProject,
  selectProject,
  serverTargetOf,
  setWorkspace,
} from '../lib/workspace.js'
import { useWorkspace } from '../lib/useWorkspace.js'

/** 可选的每页条数；上限与 `mc_data_query` 的 limit 一致。 */
const PAGE_SIZES = [50, 100, 200]

/** 搜索防抖：输入停止后再查询，避免每次按键都请求宿主。 */
const SEARCH_DEBOUNCE_MS = 250

const KINDS = ['registry', 'tag', 'recipe']

/**
 * 右侧栏标签的 scope 是 session，正文可以直接拿到 `sessionId` / `useSessions`。
 * @param {{ sessionId?: string, useSessions?: any }} [props]
 */
export function DataTab(props) {
  if (props?.useSessions === undefined) return h(DataTabBody, { cwd: undefined })
  return h(SessionDataTab, props)
}

/**
 * @param {{ sessionId?: string, useSessions: any }} props
 */
function SessionDataTab(props) {
  const cwd = props.useSessions((state) => state.byId?.[props.sessionId]?.cwd)
  return h(DataTabBody, { cwd: typeof cwd === 'string' && cwd !== '' ? cwd : undefined })
}

/**
 * @param {{ cwd?: string }} props
 */
function DataTabBody({ cwd }) {
  useLocale()
  const workspace = useWorkspace()
  const project = findProject(workspace)
  const projectRoot = project?.root
  const workspaceCwd = workspace.cwd
  const serverTarget = serverTargetOf(project)
  // 老 starter 没有 projects 能力（或识别失败）时退回宿主默认工作区，只是没有工程选择。
  const legacy = workspace.supported === false || workspace.error !== undefined

  useEffect(() => {
    void setWorkspace(cwd)
  }, [cwd])

  const [status, setStatus] = useState(/** @type {Record<string, any>} */ ({ loading: true }))
  const [digest, setDigest] = useState(/** @type {Record<string, any> | undefined} */ (undefined))
  const [kind, setKind] = useState('registry')
  const [registry, setRegistry] = useState('minecraft:item')
  const [tag, setTag] = useState('')
  const [filter, setFilter] = useState('')
  const [debounced, setDebounced] = useState('')
  const [pageSize, setPageSize] = useState(100)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState(/** @type {Record<string, any>} */ ({ loading: false }))
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(/** @type {string | undefined} */ (undefined))
  const [revision, setRevision] = useState(0)

  /** 读取工程状态；有数据时同时获取摘要。 */
  const loadStatus = useCallback(async () => {
    if (legacy !== true && typeof projectRoot !== 'string') return
    const target = {
      ...(typeof projectRoot === 'string' ? { root: projectRoot } : {}),
      ...(typeof workspaceCwd === 'string' ? { workspace: workspaceCwd } : {}),
    }
    const next = await call('data.state', target)
    setStatus({ loading: false, ...next })
    setDigest(next.hasDump === true ? await call('data.query', { ...target, kind: 'digest' }) : undefined)
  }, [legacy, projectRoot, workspaceCwd])

  useEffect(() => {
    let cancelled = false
    loadStatus().catch((failure) => {
      if (!cancelled) setStatus({ loading: false, hasDump: false, error: messageOf(failure) })
    })
    return () => {
      cancelled = true
    }
  }, [loadStatus])

  // 切换工程等于换一份数据：回到第一页并清空旧摘要
  useEffect(() => {
    setOffset(0)
    setStatus({ loading: true })
    setDigest(undefined)
  }, [projectRoot, workspaceCwd])

  // 摘要中不存在当前注册表时，落到第一张
  useEffect(() => {
    if (digest === undefined) return
    const ids = (digest.registries ?? []).map((entry) => entry.id)
    if (ids.length > 0 && !ids.includes(registry)) setRegistry(ids[0])
  }, [digest, registry])

  // 搜索防抖：输入停止后查询，并回到第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(filter.trim().toLowerCase())
      setOffset(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filter])

  // 当前页
  useEffect(() => {
    if (status.hasDump !== true) return undefined
    if (legacy !== true && typeof projectRoot !== 'string') return undefined
    let cancelled = false
    setPage({ loading: true })
    /** @type {Record<string, any>} */
    const payload = {
      kind,
      limit: pageSize,
      offset,
      ...(typeof projectRoot === 'string' ? { root: projectRoot } : {}),
      ...(typeof workspaceCwd === 'string' ? { workspace: workspaceCwd } : {}),
    }
    if (kind === 'registry') payload.registry = registry
    if (kind === 'tag' && tag !== '') payload.tag = tag
    if (debounced !== '') payload.filter = debounced
    call('data.query', payload)
      .then((result) => {
        if (!cancelled) setPage({ loading: false, result })
      })
      .catch((failure) => {
        if (!cancelled) setPage({ loading: false, error: messageOf(failure) })
      })
    return () => {
      cancelled = true
    }
  }, [status.hasDump, kind, registry, tag, debounced, offset, pageSize, revision, legacy, projectRoot, workspaceCwd])

  // 导出计时
  useEffect(() => {
    if (!busy) return undefined
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])

  /** 导出一次；面板上只有这个动作会启动进程。 */
  const runExport = async () => {
    if (legacy !== true && (typeof projectRoot !== 'string' || serverTarget === undefined)) return
    setBusy(true)
    setError(undefined)
    try {
      await call('data.dump', {
        ...(typeof projectRoot === 'string' ? { root: projectRoot } : {}),
        ...(typeof workspaceCwd === 'string' ? { workspace: workspaceCwd } : {}),
        ...(serverTarget === undefined ? {} : { taskPath: serverTarget.taskPath }),
        refresh: true,
      })
      await loadStatus()
      setOffset(0)
      setRevision((value) => value + 1)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  /** 重新识别工程并重读缓存，不启动进程。 */
  const refresh = async () => {
    setError(undefined)
    try {
      await loadProjects(workspaceCwd, { refresh: true })
      await loadStatus()
      setRevision((value) => value + 1)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  if (workspace.ready !== true) {
    return h('div', { className: 'atlas-panel' }, h('div', { className: 'atlas-loading' }, t('panel.loadingProjects')))
  }

  if (legacy !== true && workspace.error === undefined && nearbyMcProjects(workspace.projects, workspaceCwd).length === 0) {
    return h(
      'div',
      { className: 'atlas-panel' },
      h(
        'div',
        { className: 'atlas-empty' },
        h('div', { className: 'atlas-empty-title' }, t('panel.noProject')),
        h('div', { className: 'atlas-hint' }, t('panel.noProjectHint', { cwd: workspaceCwd ?? '—' })),
        h(
          'button',
          { type: 'button', className: 'atlas-mini', onClick: () => void refresh() },
          h('span', { className: 'atlas-icon' }, h(IconRefresh, { size: 12 })),
          t('panel.rescan'),
        ),
      ),
    )
  }

  if (status.loading === true) {
    return h('div', { className: 'atlas-panel' }, h('div', { className: 'atlas-loading' }, t('panel.loading')))
  }

  const serverMissing = legacy !== true && serverTarget === undefined
  const exportDisabled = busy || serverMissing

  if (status.hasDump !== true) {
    return h(
      'div',
      { className: 'atlas-panel' },
      contextHeader(project, digest, workspaceCwd),
      projectSelector(workspace, project),
      h(
        'div',
        { className: 'atlas-empty' },
        h('div', { className: 'atlas-empty-title' }, t('panel.noData')),
        h('div', { className: 'atlas-hint' }, t('panel.noDataHint')),
        exportButton(busy, exportDisabled, serverMissing ? t('panel.noServerTarget') : undefined, t('panel.export'), runExport),
      ),
      busy ? h('div', { className: 'atlas-hint' }, `${t('panel.exporting')} ${seconds}s`) : undefined,
      serverMissing ? h('div', { className: 'atlas-hint' }, t('panel.noServerTarget')) : undefined,
      status.error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: status.error })),
      error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: error })),
    )
  }

  const result = page.result ?? {}
  const items = Array.isArray(result.items) ? result.items : []
  const matched = Number.isInteger(result.matched) ? result.matched : 0
  const nextOffset = Number.isInteger(result.nextOffset) ? result.nextOffset : undefined
  const from = items.length === 0 ? 0 : offset + 1
  const to = offset + items.length
  const registries = Array.isArray(digest?.registries) ? digest.registries : []
  const memberView = kind === 'tag' && tag !== ''

  return h(
    'div',
    { className: 'atlas-panel' },
    contextHeader(project, digest, workspaceCwd),
    projectSelector(workspace, project),
    h(
      'div',
      { className: 'atlas-toolbar' },
      h(
        'div',
        { className: 'atlas-seg', role: 'group' },
        KINDS.map((value) =>
          h(
            'button',
            {
              key: value,
              type: 'button',
              className: 'atlas-seg-item',
              'data-active': kind === value ? 'true' : 'false',
              onClick: () => {
                setKind(value)
                setTag('')
                setOffset(0)
              },
            },
            t(`kind.${value}`),
          ),
        ),
      ),
      kind !== 'registry'
        ? undefined
        : h(
            'select',
            {
              className: 'atlas-select',
              value: registry,
              title: t('panel.registry'),
              onChange: (event) => {
                setRegistry(event.target.value)
                setOffset(0)
              },
            },
            registries.map((entry) => h('option', { key: entry.id, value: entry.id }, `${pathOf(entry.id)} (${entry.count})`)),
          ),
      tag === ''
        ? undefined
        : h(
            'button',
            { type: 'button', className: 'atlas-back', onClick: () => { setTag(''); setOffset(0) } },
            t('panel.back'),
          ),
      memberView
        ? undefined
        : h('input', {
            className: 'atlas-input',
            value: filter,
            placeholder: t('search.placeholder'),
            onChange: (event) => setFilter(event.target.value),
          }),
      h(
        'button',
        { type: 'button', className: 'atlas-mini atlas-icon-button', title: t('panel.refresh'), onClick: () => void refresh() },
        h('span', { className: 'atlas-icon' }, h(IconRefresh, { size: 12 })),
      ),
      exportButton(busy, exportDisabled, serverMissing ? t('panel.noServerTarget') : undefined, t('panel.reexport'), runExport),
    ),
    busy ? h('div', { className: 'atlas-hint' }, `${t('panel.exporting')} ${seconds}s`) : undefined,
    digest?.stale === true ? h('div', { className: 'atlas-stale' }, t('panel.stale')) : undefined,
    serverMissing ? h('div', { className: 'atlas-hint' }, t('panel.noServerTarget')) : undefined,
    page.error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: page.error })),
    error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: error })),
    h(
      'div',
      { className: 'atlas-table' },
      tableHead(kind, tag, matched),
      h(
        'div',
        { className: 'atlas-tbody' },
        page.loading === true
          ? h('div', { className: 'atlas-loading' }, t('panel.loading'))
          : items.length === 0
            ? h('div', { className: 'atlas-loading' }, kind === 'tag' && tag === '' ? t('panel.tagHint') : t('panel.empty'))
            : rowsOf(kind, tag, items, (picked) => {
              setTag(picked)
              setOffset(0)
            }),
      ),
    ),
    h(
      'div',
      { className: 'atlas-pager' },
      h('span', { className: 'atlas-range' }, `${t('panel.matched', { count: matched })} · ${from}–${to}`),
      h(
        'label',
        { className: 'atlas-page-size' },
        t('panel.pageSize'),
        h(
          'select',
          {
            className: 'atlas-select atlas-select-sm',
            value: String(pageSize),
            onChange: (event) => {
              setPageSize(Number(event.target.value))
              setOffset(0)
            },
          },
          PAGE_SIZES.map((size) => h('option', { key: size, value: String(size) }, String(size))),
        ),
      ),
      h(
        'span',
        { className: 'atlas-pager-btns' },
        h(
          'button',
          {
            type: 'button',
            className: 'atlas-mini',
            disabled: offset === 0 || page.loading === true,
            onClick: () => setOffset(Math.max(0, offset - pageSize)),
          },
          t('panel.prev'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'atlas-mini',
            disabled: nextOffset === undefined || page.loading === true,
            onClick: () => {
              if (nextOffset !== undefined) setOffset(nextOffset)
            },
          },
          t('panel.next'),
        ),
      ),
    ),
    h(
      'div',
      { className: 'atlas-foot', title: `${envText(digest?.env)}\n${t('panel.excerpt')}` },
      h('span', { className: 'atlas-path', title: String(digest?.path ?? status.path ?? '') }, String(digest?.path ?? status.path ?? '')),
      h('span', { className: 'atlas-dot' }, '·'),
      h('span', { className: 'atlas-time' }, timeText(digest?.generatedAt)),
    ),
  )
}

/**
 * 标题区：工程名 + loader/MC 版本片，下面一行是数据量。
 * 完整环境放在悬停提示里，避免与 Mod Dev 面板重复。
 * @param {Record<string, any> | undefined} project
 * @param {Record<string, any> | undefined} digest
 * @param {string | undefined} workspaceCwd
 */
function contextHeader(project, digest, workspaceCwd) {
  // 优先模组名（与 Mod Dev 面板一致），没有元数据时退回工程目录名
  const name = project?.modName ?? project?.name ?? project?.root ?? workspaceCwd ?? t('tab.data')
  const title = [project?.name, project?.root].filter((value) => typeof value === 'string' && value !== '').join('\n')
  const chip = projectChip(project, digest)
  return h(
    'div',
    { className: 'atlas-context', title: title === '' ? String(workspaceCwd ?? '') : title },
    h(
      'div',
      { className: 'atlas-context-main' },
      h('span', { className: 'atlas-project-name' }, String(name)),
      chip === '' ? undefined : h('span', { className: 'atlas-chip', title: envText(digest?.env) }, chip),
    ),
    countsLine(digest?.counts),
  )
}

/**
 * @param {Record<string, any> | undefined} project
 * @param {Record<string, any> | undefined} digest
 * @returns {string}
 */
function projectChip(project, digest) {
  const loader = project?.loader ?? digest?.env?.loader
  const mcVersion = project?.mcVersion ?? digest?.env?.mcVersion
  if (typeof loader !== 'string' || loader === '' || loader === 'unknown') return ''
  return `${loaderLabel(loader)}${typeof mcVersion === 'string' && mcVersion !== '' ? ` ${mcVersion}` : ''}`
}

/**
 * @param {Record<string, any> | undefined} counts
 */
function countsLine(counts) {
  if (counts === undefined || counts === null) return undefined
  const parts = [
    { key: 'registries', label: t('count.registries'), value: counts.registries },
    { key: 'tags', label: t('count.tags'), value: counts.tags, note: t('count.tagMembers', { count: counts.tagMembers ?? 0 }) },
    { key: 'recipes', label: t('count.recipes'), value: counts.recipes },
  ]
  /** @type {Array<any>} */
  const children = []
  for (const [index, part] of parts.entries()) {
    if (index > 0) children.push(h('span', { key: `${part.key}-sep`, className: 'atlas-count-sep' }, '·'))
    children.push(
      h(
        'span',
        { key: part.key, className: 'atlas-count' },
        h('span', { className: 'atlas-count-label' }, part.label),
        h('span', { className: 'atlas-count-value' }, String(part.value ?? 0)),
        part.note === undefined ? undefined : h('span', { className: 'atlas-count-note' }, part.note),
      ),
    )
  }
  return h('div', { className: 'atlas-counts' }, children)
}

/**
 * 表头：没有表头时字段含义不明确，尤其是注册名与命名空间分列之后。
 * @param {string} kind
 * @param {string} tag
 * @param {number} matched
 */
function tableHead(kind, tag, matched) {
  if (kind === 'registry') {
    return h(
      'div',
      { className: 'atlas-thead atlas-row' },
      h('span', undefined, t('col.name')),
      h('span', undefined, t('col.namespace')),
      h('span', undefined, t('col.props')),
    )
  }
  if (kind === 'tag' && tag === '') {
    return h(
      'div',
      { className: 'atlas-thead atlas-row atlas-row-tag' },
      h('span', undefined, t('col.tag')),
      h('span', { className: 'atlas-num' }, t('col.count')),
    )
  }
  if (kind === 'tag') {
    return h(
      'div',
      { className: 'atlas-thead' },
      h('span', { className: 'atlas-thead-title', title: tag }, tag),
      h('span', { className: 'atlas-count-note' }, t('panel.tagMembers', { count: matched })),
    )
  }
  return h(
    'div',
    { className: 'atlas-thead atlas-row atlas-row-recipe' },
    h('span', undefined, t('col.recipe')),
    h('span', undefined, t('col.type')),
    h('span', undefined, t('col.result')),
    h('span', undefined, t('col.ingredients')),
  )
}

/**
 * 多工程时提供选择器。
 * @param {Record<string, any>} workspace
 * @param {Record<string, any> | undefined} project
 */
function projectSelector(workspace, project) {
  const candidates = nearbyMcProjects(workspace.projects, workspace.cwd)
  if (candidates.length <= 1) return undefined
  return h(
    'div',
    { className: 'atlas-project-bar' },
    h('span', { className: 'atlas-hint' }, t('panel.project')),
    h(
      'select',
      {
        className: 'atlas-select',
        value: project?.root ?? '',
        onChange: (event) => selectProject(event.target.value),
      },
      candidates.map((entry) =>
        h(
          'option',
          { key: entry.root, value: entry.root },
          `${entry.name ?? entry.root}${entry.loader === undefined ? '' : ` · ${loaderLabel(entry.loader)}`}${entry.mcVersion === undefined ? '' : ` ${entry.mcVersion}`}`,
        ),
      ),
    ),
  )
}

/**
 * @param {boolean} busy
 * @param {boolean} disabled
 * @param {string | undefined} hint
 * @param {string} label
 * @param {() => Promise<void>} runExport
 */
function exportButton(busy, disabled, hint, label, runExport) {
  return h(
    'button',
    {
      type: 'button',
      className: 'atlas-export',
      disabled,
      ...(hint === undefined ? {} : { title: hint }),
      onClick: () => void runExport(),
    },
    h('span', { className: 'atlas-icon' }, h(IconExport, { size: 12 })),
    busy ? t('panel.exporting') : label,
  )
}

/**
 * 三种表格行。注册表把 id 拆成"资源路径 + 命名空间"两列，与表头一致。
 * @param {string} kind
 * @param {string} tag
 * @param {Array<any>} items
 * @param {(tag: string) => void} onPickTag
 * @returns {any}
 */
function rowsOf(kind, tag, items, onPickTag) {
  if (kind === 'registry') {
    return items.map((item) =>
      h(
        'div',
        { key: item.id, className: 'atlas-row' },
        h('span', { className: 'atlas-id', title: item.id }, pathOf(item.id)),
        h('span', { className: 'atlas-owner', title: item.owner }, item.owner),
        h(
          'span',
          { className: 'atlas-props', title: item.class ?? '' },
          propsText(item.props) === '' ? '—' : propsText(item.props),
        ),
      ),
    )
  }
  if (kind === 'tag' && tag === '') {
    return items.map((item) =>
      h(
        'div',
        {
          key: `${item.registry}/${item.tag}`,
          className: 'atlas-row atlas-row-tag',
          role: 'button',
          tabIndex: 0,
          title: item.tag,
          onClick: () => onPickTag(item.tag),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onPickTag(item.tag)
            }
          },
        },
        h('span', { className: 'atlas-id' }, item.tag),
        h('span', { className: 'atlas-num' }, String(item.count)),
      ),
    )
  }
  if (kind === 'tag') {
    return h(
      'div',
      { className: 'atlas-members' },
      items.map((member) => h('span', { key: String(member), className: 'atlas-member' }, String(member))),
    )
  }
  return items.map((item) =>
    h(
      'div',
      { key: item.id, className: 'atlas-row atlas-row-recipe' },
      h('span', { className: 'atlas-id', title: item.id }, item.id),
      h('span', { className: 'atlas-owner', title: item.type ?? '' }, String(item.type ?? '').replace(/^minecraft:/, '')),
      h('span', { className: 'atlas-props' }, resultText(item.result)),
      h(
        'span',
        { className: 'atlas-props', title: (item.ingredients ?? []).flat().join(' ') },
        ingredientsText(item.ingredients),
      ),
    ),
  )
}

/**
 * @param {Record<string, any>} workspace
 */
function findProject(workspace) {
  const found = (workspace.projects ?? []).find((entry) => entry.root === workspace.selectedRoot)
  return found ?? pickProject(workspace.projects, workspace.cwd)
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function messageOf(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}
