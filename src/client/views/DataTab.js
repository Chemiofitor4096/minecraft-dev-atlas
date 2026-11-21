/**
 * 右侧栏「数据」标签：只读表格 + 搜索 + 导出。
 *
 * 数据全部走宿主的 `/atlas/api`（与工具同一个 atlas 门面），面板不做第二套查询：
 * 搜索、翻页都在宿主侧完成，花的是本地 IO，不是模型 token。
 * @module minecraft-dev-atlas/client/DataTab
 */

import { useCallback, useEffect, useState } from 'react'
import { call } from '../lib/api.js'
import { countsText, envText, ingredientsText, propsText, resultText, shortId, timeText } from '../lib/format.js'
import { h } from '../lib/h.js'
import { IconExport, IconRefresh } from '../lib/icons.js'
import { t } from '../lib/messages.js'
import { useLocale } from '../lib/useLocale.js'

/** 一页 50 条：和工具的默认 limit 对齐，翻页手感也够用。 */
const PAGE_SIZE = 50

/** 搜索防抖：输入停下来再查，别每敲一个字打一次宿主。 */
const SEARCH_DEBOUNCE_MS = 250

const KINDS = ['registry', 'tag', 'recipe']

export function DataTab() {
  useLocale()
  const [status, setStatus] = useState(/** @type {Record<string, any>} */ ({ loading: true }))
  const [digest, setDigest] = useState(/** @type {Record<string, any> | undefined} */ (undefined))
  const [kind, setKind] = useState('registry')
  const [registry, setRegistry] = useState('minecraft:item')
  const [tag, setTag] = useState('')
  const [filter, setFilter] = useState('')
  const [debounced, setDebounced] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState(/** @type {Record<string, any>} */ ({ loading: false }))
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(/** @type {string | undefined} */ (undefined))
  const [revision, setRevision] = useState(0)

  /** 读工程状态；有数据就顺手拉一份摘要。 */
  const loadStatus = useCallback(async () => {
    const next = await call('data.state', {})
    setStatus({ loading: false, ...next })
    if (next.hasDump === true) {
      setDigest(await call('data.query', { kind: 'digest' }))
    } else {
      setDigest(undefined)
    }
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    loadStatus().catch((failure) => {
      if (!cancelled) setStatus({ loading: false, hasDump: false, error: messageOf(failure) })
    })
    return () => {
      cancelled = true
    }
  }, [loadStatus])

  // 摘要里没有当前注册表（换工程 / 换 MC 版本）时，落到第一张
  useEffect(() => {
    if (digest === undefined) return
    const ids = (digest.registries ?? []).map((entry) => entry.id)
    if (ids.length > 0 && !ids.includes(registry)) setRegistry(ids[0])
  }, [digest, registry])

  // 搜索防抖：输入停下来 250ms 再查，顺便回到第一页
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
    let cancelled = false
    setPage({ loading: true })
    /** @type {Record<string, any>} */
    const payload = { kind, limit: PAGE_SIZE, offset }
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
  }, [status.hasDump, kind, registry, tag, debounced, offset, revision])

  // 导出计时：服务端起停要几十秒，按钮上得让人看见还在动
  useEffect(() => {
    if (!busy) return undefined
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])

  /** 导出一次（面板上只有这个动作会起进程）。 */
  const runExport = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await call('data.dump', { refresh: true })
      await loadStatus()
      setOffset(0)
      setRevision((value) => value + 1)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  /** 只重读缓存与摘要，不起进程。 */
  const refresh = async () => {
    setError(undefined)
    try {
      await loadStatus()
      setRevision((value) => value + 1)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  if (status.loading === true) {
    return h('div', { className: 'atlas-panel' }, h('div', { className: 'atlas-loading' }, t('panel.loading')))
  }

  if (status.hasDump !== true) {
    return h(
      'div',
      { className: 'atlas-panel' },
      h('div', { className: 'atlas-head' }, h('div', { className: 'atlas-title' }, t('tab.data'))),
      h(
        'div',
        { className: 'atlas-empty' },
        h('div', undefined, t('panel.noData')),
        h('div', { className: 'atlas-hint' }, t('panel.noDataHint')),
        exportButton(busy, runExport, t('panel.export')),
      ),
      busy ? h('div', { className: 'atlas-hint' }, `${seconds}s`) : undefined,
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

  return h(
    'div',
    { className: 'atlas-panel' },
    h(
      'div',
      { className: 'atlas-head' },
      h('div', { className: 'atlas-title' }, t('tab.data')),
      h('div', { className: 'atlas-chips' }, envText(digest?.env)),
      h('div', { className: 'atlas-chips' }, countsText(digest?.counts)),
    ),
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
              onChange: (event) => {
                setRegistry(event.target.value)
                setOffset(0)
              },
            },
            registries.map((entry) => h('option', { key: entry.id, value: entry.id }, `${shortId(entry.id)} (${entry.count})`)),
          ),
      tag === ''
        ? undefined
        : h(
            'button',
            { type: 'button', className: 'atlas-back', onClick: () => { setTag(''); setOffset(0) } },
            t('panel.back'),
          ),
      kind === 'tag' && tag !== ''
        ? undefined
        : h('input', {
            className: 'atlas-input',
            value: filter,
            placeholder: t('search.placeholder'),
            onChange: (event) => setFilter(event.target.value),
          }),
      h(
        'button',
        { type: 'button', className: 'atlas-mini', title: t('panel.refresh'), onClick: () => void refresh() },
        h('span', { className: 'atlas-icon' }, h(IconRefresh, { size: 12 })),
      ),
      exportButton(busy, runExport, t('panel.reexport')),
    ),
    busy ? h('div', { className: 'atlas-hint' }, `${t('panel.exporting')} ${seconds}s`) : undefined,
    digest?.stale === true ? h('div', { className: 'atlas-stale' }, t('panel.stale')) : undefined,
    page.error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: page.error })),
    error === undefined ? undefined : h('div', { className: 'atlas-error' }, t('panel.error', { message: error })),
    h(
      'div',
      { className: 'atlas-rows' },
      page.loading === true
        ? h('div', { className: 'atlas-loading' }, t('panel.loading'))
        : items.length === 0
          ? h('div', { className: 'atlas-loading' }, kind === 'tag' && tag === '' ? t('panel.tagHint') : t('panel.empty'))
          : rowsOf(kind, tag, items, (picked) => {
            setTag(picked)
            setOffset(0)
          }),
    ),
    h(
      'div',
      { className: 'atlas-pager' },
      h('span', undefined, `${t('panel.matched', { count: matched })} · ${from}–${to}`),
      h(
        'button',
        {
          type: 'button',
          className: 'atlas-mini',
          disabled: offset === 0 || page.loading === true,
          onClick: () => setOffset(Math.max(0, offset - PAGE_SIZE)),
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
    h('div', { className: 'atlas-foot' }, `${String(digest?.path ?? status.path ?? '')} · ${timeText(digest?.generatedAt)}`),
    h('div', { className: 'atlas-hint' }, t('panel.excerpt')),
  )
}

/**
 * @param {boolean} busy
 * @param {() => Promise<void>} runExport
 * @param {string} label
 */
function exportButton(busy, runExport, label) {
  return h(
    'button',
    { type: 'button', className: 'atlas-export', disabled: busy, onClick: () => void runExport() },
    h('span', { className: 'atlas-icon' }, h(IconExport, { size: 12 })),
    busy ? t('panel.exporting') : label,
  )
}

/**
 * 三种表格行。
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
        h('span', { className: 'atlas-id', title: item.id }, shortId(item.id)),
        h('span', { className: 'atlas-owner', title: item.owner }, item.owner),
        h('span', { className: 'atlas-props', title: item.class ?? '' }, textOf([propsText(item.props), shortClass(item.class)])),
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
        h('span', { className: 'atlas-id' }, shortId(item.tag)),
        h('span', { className: 'atlas-owner' }, String(item.count)),
      ),
    )
  }
  if (kind === 'tag') {
    return h(
      'div',
      { className: 'atlas-members' },
      items.map((member) => h('span', { key: String(member), className: 'atlas-member' }, shortId(member))),
    )
  }
  return items.map((item) =>
    h(
      'div',
      { key: item.id, className: 'atlas-row atlas-row-recipe' },
      h('span', { className: 'atlas-id', title: item.id }, shortId(item.id)),
      h('span', { className: 'atlas-owner' }, String(item.type ?? '').replace(/^minecraft:/, '')),
      h('span', { className: 'atlas-props' }, resultText(item.result)),
      h('span', { className: 'atlas-props', title: (item.ingredients ?? []).flat().join(' ') }, ingredientsText(item.ingredients)),
    ),
  )
}

/**
 * 类名只留简单名：表格里 `Item` / `SwordItem` 比全限定名好读。
 * @param {unknown} name
 * @returns {string}
 */
function shortClass(name) {
  if (typeof name !== 'string' || name === '') return ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? name : name.slice(dot + 1)
}

/**
 * @param {Array<string>} parts
 * @returns {string}
 */
function textOf(parts) {
  return parts.filter((part) => part !== '').join(' · ')
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function messageOf(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}
