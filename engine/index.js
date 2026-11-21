/**
 * 查询引擎：纯函数、零依赖、不碰进程。
 *
 * 为什么要有这一层：一份 dump 在 1MB 量级（约 210k token），永远不许整份进上下文。
 * 所以先 `digest` 给摘要，再按 `kind` 钻取，且每次都有硬上限与 `nextOffset`。
 *
 * @module minecraft-dev-atlas/engine
 */

import { ATLAS_SCHEMA, ATLAS_SECTIONS } from './dump.js'

export { ATLAS_SCHEMA, ATLAS_SECTIONS } from './dump.js'
export { parseDump, validateDump, AtlasSchemaError } from './dump.js'
export { ATLAS_CAPABILITIES, javaAgentOption, readAllMarkers, readLogMarkers } from './contract.js'

/** 一次查询的默认条数与硬上限。 */
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/** digest 里每个注册表最多列几个 owner，以及总共列几种配方类型。 */
const DIGEST_OWNERS = 8
const DIGEST_RECIPE_TYPES = 12

/**
 * 把 dump 建成内存索引：`Map<id, entry>` / `Map<tag, Set>` / `Map<result, recipes[]>`。
 *
 * 1MB 的 JSON 解析大约 30–50ms，索引常驻几 MB；查询是 O(1)–O(n) 过滤。
 * 不用数据库的理由见拓展文档 §5.1。
 * @param {Record<string, any>} dump 已通过 schema 校验的 dump
 */
export function indexDump(dump) {
  /** @type {Map<string, { id: string, count: number, byId: Map<string, any>, owners: Map<string, number> }>} */
  const registries = new Map()
  for (const [registryId, section] of Object.entries(dump.registries ?? {})) {
    const byId = new Map()
    const owners = new Map()
    const entries = Array.isArray(section?.entries) ? section.entries : []
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
      const owner = typeof entry.owner === 'string' ? entry.owner : namespaceOf(entry.id)
      byId.set(entry.id, { id: entry.id, owner, class: entry.class ?? null, props: entry.props ?? null })
      owners.set(owner, (owners.get(owner) ?? 0) + 1)
    }
    registries.set(registryId, { id: registryId, count: byId.size, byId, owners })
  }

  /** @type {Map<string, Map<string, string[]>>} */
  const tags = new Map()
  /** @type {Map<string, Map<string, string[]>>} */
  const tagsByMember = new Map()
  let tagCount = 0
  let tagMembers = 0
  for (const [registryId, byTag] of Object.entries(dump.tags ?? {})) {
    const map = new Map()
    const membership = new Map()
    for (const [tagId, members] of Object.entries(byTag ?? {})) {
      if (!Array.isArray(members)) continue
      const clean = members.filter((member) => typeof member === 'string')
      map.set(tagId, clean)
      tagCount += 1
      tagMembers += clean.length
      for (const member of clean) {
        const list = membership.get(member) ?? []
        list.push(tagId)
        membership.set(member, list)
      }
    }
    tags.set(registryId, map)
    tagsByMember.set(registryId, membership)
  }

  const recipes = []
  for (const entry of dump.recipes?.entries ?? []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
    recipes.push({
      id: entry.id,
      type: typeof entry.type === 'string' ? entry.type : 'unknown:unknown',
      result: entry.result ?? null,
      ingredients: Array.isArray(entry.ingredients) ? entry.ingredients : null,
    })
  }
  const recipesByResult = new Map()
  const recipeTypes = new Map()
  for (const recipe of recipes) {
    recipeTypes.set(recipe.type, (recipeTypes.get(recipe.type) ?? 0) + 1)
    const item = recipe.result?.item
    if (typeof item === 'string' && item !== '') {
      const list = recipesByResult.get(item) ?? []
      list.push(recipe)
      recipesByResult.set(item, list)
    }
  }

  return {
    schema: dump.schema,
    generatedAt: dump.generatedAt,
    env: dump.env,
    provenance: dump.provenance,
    truncated: dump.truncated === true,
    truncatedSections: Array.isArray(dump.truncatedSections) ? dump.truncatedSections : [],
    warnings: Array.isArray(dump.warnings) ? dump.warnings : [],
    errors: Array.isArray(dump.errors) ? dump.errors : [],
    registries,
    tags,
    tagsByMember,
    recipes,
    recipesByResult,
    recipeTypes,
    counts: {
      registries: sumCounts(registries),
      tags: tagCount,
      tagMembers,
      recipes: recipes.length,
    },
  }
}

/** @param {Map<string, { count: number }>} registries */
function sumCounts(registries) {
  let total = 0
  for (const registry of registries.values()) total += registry.count
  return total
}

/**
 * 摘要优先：模型先看这一屏，再决定钻哪一段。
 * @param {ReturnType<typeof indexDump>} index
 */
export function digest(index) {
  const registries = []
  for (const registry of index.registries.values()) {
    const owners = [...registry.owners.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, DIGEST_OWNERS)
      .map(([owner, count]) => ({ owner, count }))
    registries.push({ id: registry.id, count: registry.count, owners })
  }
  const types = [...index.recipeTypes.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, DIGEST_RECIPE_TYPES)
    .map(([type, count]) => ({ type, count }))

  return {
    kind: 'digest',
    generatedAt: index.generatedAt,
    env: pickEnv(index.env),
    counts: index.counts,
    registries,
    recipes: { types },
    truncated: index.truncated,
    truncatedSections: index.truncatedSections,
    warnings: index.warnings.length,
    errors: index.errors,
  }
}

/** @param {Record<string, any>} env */
function pickEnv(env) {
  return {
    loader: env?.loader ?? 'unknown',
    loaderVersion: env?.loaderVersion ?? null,
    mcVersion: env?.mcVersion ?? 'unknown',
    mappings: env?.mappings ?? 'unknown',
    adapter: env?.adapter ?? 'unknown',
    side: env?.side ?? 'unknown',
    via: env?.via ?? 'unknown',
  }
}

/**
 * 查询入口。
 *
 * @param {ReturnType<typeof indexDump>} index
 * @param {{ kind?: 'digest'|'registry'|'tag'|'recipe', registry?: string, tag?: string, filter?: string, limit?: number, offset?: number }} [options]
 * @returns {Record<string, any>}
 */
export function query(index, options = {}) {
  const kind = options.kind ?? 'digest'
  const limit = clampLimit(options.limit)
  const offset = Math.max(0, Number.isInteger(options.offset) ? options.offset : 0)
  const filter = typeof options.filter === 'string' ? options.filter.trim().toLowerCase() : ''

  if (kind === 'digest') return digest(index)
  if (kind === 'registry') return queryRegistry(index, options, filter, limit, offset)
  if (kind === 'tag') return queryTag(index, options, filter, limit, offset)
  if (kind === 'recipe') return queryRecipe(index, options, filter, limit, offset)
  throw new Error(`未知的查询类型 ${JSON.stringify(kind)}（可用：digest / registry / tag / recipe）`)
}

/**
 * @param {ReturnType<typeof indexDump>} index
 * @param {any} options
 * @param {string} filter
 * @param {number} limit
 * @param {number} offset
 */
function queryRegistry(index, options, filter, limit, offset) {
  const registryId = typeof options.registry === 'string' && options.registry !== '' ? options.registry : 'minecraft:item'
  const registry = index.registries.get(registryId)
  if (registry === undefined) {
    return {
      kind: 'registry',
      registry: registryId,
      matched: 0,
      items: [],
      truncated: false,
      nextOffset: null,
      available: [...index.registries.keys()],
    }
  }
  const all = [...registry.byId.values()]
  const matchedEntries = filter === '' ? all : all.filter((entry) => entry.id.includes(filter))
  const page = matchedEntries.slice(offset, offset + limit)
  const exact = filter !== '' && matchedEntries.length === 1 && matchedEntries[0].id === filter
  return {
    kind: 'registry',
    registry: registryId,
    matched: matchedEntries.length,
    items: page.map((entry) => compactEntry(entry, exact)),
    truncated: matchedEntries.length > offset + page.length,
    nextOffset: matchedEntries.length > offset + page.length ? offset + page.length : null,
  }
}

/**
 * 单条详情（精确 id 命中）带上 class；列表页不带，省上下文。
 * @param {{ id: string, owner: string, class: string | null, props: Record<string, any> | null }} entry
 * @param {boolean} detail
 */
function compactEntry(entry, detail) {
  /** @type {Record<string, any>} */
  const value = { id: entry.id, owner: entry.owner }
  if (detail && entry.class !== null) value.class = entry.class
  if (entry.props !== null && Object.keys(entry.props).length > 0) value.props = entry.props
  return value
}

/**
 * @param {ReturnType<typeof indexDump>} index
 * @param {any} options
 * @param {string} filter
 * @param {number} limit
 * @param {number} offset
 */
function queryTag(index, options, filter, limit, offset) {
  const registryFilter = typeof options.registry === 'string' && options.registry !== '' ? options.registry : undefined
  const tagId = typeof options.tag === 'string' && options.tag !== '' ? options.tag : undefined

  if (tagId === undefined) {
    // 没指定 tag：把 filter 当标签 id 子串，列标签与成员数
    const found = []
    for (const [registryId, byTag] of index.tags) {
      if (registryFilter !== undefined && registryId !== registryFilter) continue
      for (const [id, members] of byTag) {
        if (filter === '' || id.includes(filter)) found.push({ registry: registryId, tag: id, count: members.length })
      }
    }
    found.sort((left, right) => left.tag.localeCompare(right.tag))
    const page = found.slice(offset, offset + limit)
    return {
      kind: 'tag',
      matched: found.length,
      items: page,
      truncated: found.length > offset + page.length,
      nextOffset: found.length > offset + page.length ? offset + page.length : null,
    }
  }

  const candidates = registryFilter === undefined ? [...index.tags.keys()] : [registryFilter]
  for (const registryId of candidates) {
    const members = index.tags.get(registryId)?.get(tagId)
    if (members === undefined) continue
    const page = members.slice(offset, offset + limit)
    return {
      kind: 'tag',
      registry: registryId,
      tag: tagId,
      matched: members.length,
      items: page,
      truncated: members.length > offset + page.length,
      nextOffset: members.length > offset + page.length ? offset + page.length : null,
    }
  }
  return {
    kind: 'tag',
    tag: tagId,
    matched: 0,
    items: [],
    truncated: false,
    nextOffset: null,
  }
}

/**
 * @param {ReturnType<typeof indexDump>} index
 * @param {any} options
 * @param {string} filter
 * @param {number} limit
 * @param {number} offset
 */
function queryRecipe(index, options, filter, limit, offset) {
  const matched = filter === ''
    ? index.recipes
    : index.recipes.filter((recipe) =>
      recipe.id.toLowerCase().includes(filter) || (recipe.result?.item ?? '').toLowerCase().includes(filter))
  const page = matched.slice(offset, offset + limit)
  return {
    kind: 'recipe',
    matched: matched.length,
    items: page,
    truncated: matched.length > offset + page.length,
    nextOffset: matched.length > offset + page.length ? offset + page.length : null,
  }
}

/** @param {unknown} value */
function clampLimit(value) {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(value))))
}

/** @param {string} id */
function namespaceOf(id) {
  const colon = id.indexOf(':')
  return colon <= 0 ? id : id.slice(0, colon)
}
