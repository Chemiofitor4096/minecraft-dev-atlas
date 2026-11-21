/**
 * dump 的校验与解析（schema=1，权威定义是 starter 仓库的
 * `doc/schema/dump-v1.schema.json`）。
 *
 * 为什么不直接跑 JSON Schema：插件是零依赖的，而这份结构小到可以手写；
 * 手写的另一个好处是错误信息能直接用中文说"哪一段、哪一条、缺什么"。
 *
 * @module minecraft-dev-atlas/engine/dump
 */

/** 线上格式版本；不兼容改动 +1。 */
export const ATLAS_SCHEMA = 1

/** 三类段落。 */
export const ATLAS_SECTIONS = ['registries', 'tags', 'recipes']

const VIA = new Set(['agent-boot', 'agent-attach'])
const LOADERS = new Set(['neoforge', 'fabric', 'forge'])
const MAPPINGS = new Set(['mojmap', 'yarn'])
const SIDES = new Set(['server', 'client'])
const ERROR_SECTIONS = new Set(['registries', 'tags', 'recipes', 'env', 'write'])

/**
 * 解析失败：`code` 给工具层映射错误码，`problems` 给人看。
 */
export class AtlasSchemaError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [problems]
   */
  constructor(message, problems = []) {
    super(message)
    this.name = 'AtlasSchemaError'
    this.code = 'ATLAS_SCHEMA_MISMATCH'
    this.problems = problems
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * 校验一份 dump；返回问题清单（空数组表示通过）。
 * 只校验"读的人会因此读错"的东西：必需字段、枚举、数组/对象形状；不校验 id 正则的边界情况。
 * @param {unknown} dump
 * @returns {string[]}
 */
export function validateDump(dump) {
  /** @type {string[]} */
  const problems = []
  /** @param {boolean} condition @param {string} message */
  const check = (condition, message) => {
    if (!condition) problems.push(message)
  }

  if (dump === null || typeof dump !== 'object' || Array.isArray(dump)) {
    return [`dump 不是对象（实际是 ${typeOf(dump)}）`]
  }
  const value = /** @type {Record<string, any>} */ (dump)

  check(value.schema === ATLAS_SCHEMA, `schema 应为 ${ATLAS_SCHEMA}，实际是 ${JSON.stringify(value.schema)}`)
  check(typeof value.generatedAt === 'string', 'generatedAt 应为 ISO 时间字符串')
  check(typeof value.truncated === 'boolean', 'truncated 应为布尔值')
  check(Array.isArray(value.truncatedSections), 'truncatedSections 应为数组')
  if (Array.isArray(value.truncatedSections)) {
    for (const section of value.truncatedSections) {
      check(ATLAS_SECTIONS.includes(section), `truncatedSections 里有未知段落 ${JSON.stringify(section)}`)
    }
  }

  const env = value.env
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    problems.push('env 缺失或不是对象')
  } else {
    check(VIA.has(env.via), `env.via 应为 agent-boot / agent-attach，实际是 ${JSON.stringify(env.via)}`)
    check(LOADERS.has(env.loader), `env.loader 未知：${JSON.stringify(env.loader)}`)
    check(typeof env.mcVersion === 'string', 'env.mcVersion 应为字符串')
    check(MAPPINGS.has(env.mappings), `env.mappings 未知：${JSON.stringify(env.mappings)}`)
    check(typeof env.adapter === 'string', 'env.adapter 应为字符串')
    check(SIDES.has(env.side), `env.side 应为 server / client，实际是 ${JSON.stringify(env.side)}`)
    check(env.java === null || env.java === undefined || Number.isInteger(env.java), 'env.java 应为整数或 null')
  }

  const provenance = value.provenance
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    problems.push('provenance 缺失或不是对象')
  } else {
    check(typeof provenance.sourceHash === 'string', 'provenance.sourceHash 应为字符串')
    check(Number.isInteger(provenance.durationMs) && provenance.durationMs >= 0, 'provenance.durationMs 应为非负整数')
  }

  if (value.registries === null || typeof value.registries !== 'object' || Array.isArray(value.registries)) {
    problems.push('registries 缺失或不是对象')
  } else {
    for (const [registryId, section] of Object.entries(value.registries)) {
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        problems.push(`registries.${registryId} 不是对象`)
        continue
      }
      check(Number.isInteger(section.count) && section.count >= 0, `registries.${registryId}.count 应为非负整数`)
      if (!Array.isArray(section.entries)) {
        problems.push(`registries.${registryId}.entries 应为数组`)
        continue
      }
      if (section.entries.length > 60000) {
        problems.push(`registries.${registryId}.entries 超出合理上限（${section.entries.length}）`)
      }
      for (const entry of section.entries.slice(0, 5)) {
        check(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `registries.${registryId} 的条目不是对象`)
        if (entry !== null && typeof entry === 'object') {
          check(typeof entry.id === 'string' && entry.id !== '', `registries.${registryId} 有条目缺 id`)
          check(typeof entry.owner === 'string', `registries.${registryId} 的条目 ${JSON.stringify(entry.id)} 缺 owner`)
        }
      }
    }
  }

  if (value.tags === null || typeof value.tags !== 'object' || Array.isArray(value.tags)) {
    problems.push('tags 缺失或不是对象')
  } else {
    for (const [registryId, tagsOfRegistry] of Object.entries(value.tags)) {
      if (tagsOfRegistry === null || typeof tagsOfRegistry !== 'object' || Array.isArray(tagsOfRegistry)) {
        problems.push(`tags.${registryId} 不是对象`)
        continue
      }
      for (const [tagId, members] of Object.entries(tagsOfRegistry)) {
        if (!Array.isArray(members) || members.some((member) => typeof member !== 'string')) {
          problems.push(`tags.${registryId}.${tagId} 应为字符串数组`)
        }
      }
    }
  }

  const recipes = value.recipes
  if (recipes === null || typeof recipes !== 'object' || Array.isArray(recipes)) {
    problems.push('recipes 缺失或不是对象')
  } else {
    check(Number.isInteger(recipes.count) && recipes.count >= 0, 'recipes.count 应为非负整数')
    if (!Array.isArray(recipes.entries)) {
      problems.push('recipes.entries 应为数组')
    } else {
      for (const entry of recipes.entries.slice(0, 5)) {
        check(typeof entry?.id === 'string', 'recipes 有条目缺 id')
        check(typeof entry?.type === 'string', 'recipes 有条目缺 type')
        if (entry?.result !== null && entry?.result !== undefined) {
          check(typeof entry.result.item === 'string', `配方 ${JSON.stringify(entry.id)} 的 result.item 应为字符串`)
          check(Number.isInteger(entry.result.count) && entry.result.count >= 1, `配方 ${JSON.stringify(entry.id)} 的 result.count 应为正整数`)
        }
        if (entry?.ingredients !== null && entry?.ingredients !== undefined) {
          check(Array.isArray(entry.ingredients), `配方 ${JSON.stringify(entry.id)} 的 ingredients 应为数组或 null`)
        }
      }
    }
  }

  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== 'string')) {
    problems.push('warnings 应为字符串数组')
  }
  if (!Array.isArray(value.errors)) {
    problems.push('errors 应为数组')
  } else {
    for (const entry of value.errors) {
      check(entry !== null && typeof entry === 'object', 'errors 里有一条不是对象')
      if (entry !== null && typeof entry === 'object') {
        check(ERROR_SECTIONS.has(entry.section), `errors 里有未知 section：${JSON.stringify(entry.section)}`)
        check(typeof entry.message === 'string', 'errors 里有一条缺 message')
      }
    }
  }

  return problems
}

/**
 * 解析一份 dump 文本。
 *
 * 不匹配 schema 一律抛 {@link AtlasSchemaError}（code=ATLAS_SCHEMA_MISMATCH）：
 * 调用方只有"能用"和"不能用"两种状态，不做"凑合读一半"。
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseDump(text) {
  if (typeof text !== 'string') {
    throw new AtlasSchemaError('dump 内容不是文本')
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new AtlasSchemaError(`dump 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const problems = validateDump(value)
  if (problems.length > 0) {
    throw new AtlasSchemaError(`dump 不符合 schema=1：${problems[0]}`, problems)
  }
  return /** @type {Record<string, any>} */ (value)
}
