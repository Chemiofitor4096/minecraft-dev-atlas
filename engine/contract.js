/**
 * jar 契约：宿主与 Agent 之间唯一的两处字符串约定。
 *
 * - `javaAgentOption()`：把"导出到哪、导哪几段、多久超时"拼成 `-javaagent:…=…`；
 * - `readLogMarkers()`：把 Agent 的一行日志解析成结构，宿主据此判断"加载了没有、导到哪了"。
 *
 * 两者都是纯函数，测试里可以直接钉住字符串形态（见 test/contract.test.js）。
 *
 * @module minecraft-dev-atlas/engine/contract
 */

/** Agent 的能力清单（宿主的版本/能力握手）。 */
export const ATLAS_CAPABILITIES = [
  'dump',
  'query',
  'digest',
  'sections:registries',
  'sections:tags',
  'sections:recipes',
  'agent-boot',
]

/** Agent 日志的固定前缀，宿主按它过滤。 */
export const LOG_PREFIX = '[mcdev-atlas]'

/** 三类段落。 */
const SECTIONS = ['registries', 'tags', 'recipes']

/**
 * 拼 `-javaagent:` 选项。
 *
 * 值的编码规则：`encodeURIComponent`。因为这条字符串要塞进 `JAVA_TOOL_OPTIONS`，
 * 而 JVM 按空白切分、Agent 自己按逗号切分，所以路径里出现空格/逗号必须被编码。
 * jar 路径本身不能编码，因此干脆拒绝带空白/逗号/等号的路径——那种情况下报错比猜安全。
 *
 * @param {{ jar: string, out: string, sections?: string[], timeoutMs?: number, loader?: string, mappings?: string, stop?: boolean, max?: number, root?: string, sourceHash?: string }} options
 * @returns {string}
 */
export function javaAgentOption(options) {
  if (typeof options?.jar !== 'string' || options.jar === '') {
    throw new Error('javaAgentOption 需要 jar 路径')
  }
  if (typeof options?.out !== 'string' || options.out === '') {
    throw new Error('javaAgentOption 需要 out 路径')
  }
  assertPath(options.jar, 'jar')
  assertPath(options.out, 'out')

  /** @type {string[]} */
  const pairs = [`out=${encodeURIComponent(options.out)}`]

  const sections = Array.isArray(options.sections) && options.sections.length > 0 ? options.sections : SECTIONS
  for (const section of sections) {
    if (!SECTIONS.includes(section)) {
      throw new Error(`未知段落 ${JSON.stringify(section)}（可用：${SECTIONS.join(' / ')}）`)
    }
  }
  pairs.push(`sections=${sections.join(',')}`)

  if (options.stop !== undefined) pairs.push(`stop=${options.stop === true ? 'true' : 'false'}`)
  if (Number.isFinite(options.timeoutMs)) pairs.push(`timeout=${Math.trunc(Number(options.timeoutMs))}`)
  if (Number.isFinite(options.max)) pairs.push(`max=${Math.trunc(Number(options.max))}`)
  if (typeof options.loader === 'string' && options.loader !== '' && options.loader !== 'auto') {
    pairs.push(`loader=${encodeURIComponent(options.loader)}`)
  }
  if (typeof options.mappings === 'string' && options.mappings !== '' && options.mappings !== 'auto') {
    pairs.push(`mappings=${encodeURIComponent(options.mappings)}`)
  }
  if (typeof options.root === 'string' && options.root !== '') {
    pairs.push(`root=${encodeURIComponent(options.root)}`)
  }
  if (typeof options.sourceHash === 'string' && options.sourceHash !== '') {
    pairs.push(`sourcehash=${encodeURIComponent(options.sourceHash)}`)
  }

  return `-javaagent:${options.jar}=${pairs.join(',')}`
}

/**
 * 路径里出现 JVM/Agent 的分隔符就没法可靠传递：宁可现在报错，不要等游戏里静默不生效。
 * @param {string} value
 * @param {string} label
 */
function assertPath(value, label) {
  if (/[\s,=]/.test(value)) {
    throw new Error(
      `${label} 路径里有空白、逗号或等号，无法放进 JAVA_TOOL_OPTIONS：${value}（换一个不含这些字符的目录）`,
    )
  }
}

/**
 * 解析一行日志。不是我们的标记返回 null。
 *
 * 形如：`[mcdev-atlas] section registries count=1240`
 * 第一个不带等号的词记作 `name`（section 名 / 写出的路径），其余必须是 key=value。
 * @param {string} line
 * @returns {{ kind: string, name?: string, [key: string]: string } | null}
 */
export function readLogMarkers(line) {
  if (typeof line !== 'string' || !line.includes(LOG_PREFIX)) return null
  const marker = /\[mcdev-atlas\]\s+([A-Za-z][A-Za-z0-9_-]*)((?:\s+[^\s]+)*)/.exec(line)
  if (marker === null) return null
  /** @type {{ kind: string, name?: string, [key: string]: string }} */
  const parsed = { kind: marker[1] }
  for (const pair of marker[2].trim().split(/\s+/)) {
    if (pair === '') continue
    const equals = pair.indexOf('=')
    if (equals <= 0) {
      if (parsed.name === undefined) parsed.name = pair
      continue
    }
    parsed[pair.slice(0, equals)] = pair.slice(equals + 1)
  }
  return parsed
}

/**
 * 从一份日志里挑出所有标记（宿主用：判断 ready / inert / wrote / failed）。
 * @param {string} text
 * @returns {Array<{ kind: string, [key: string]: string }>}
 */
export function readAllMarkers(text) {
  if (typeof text !== 'string' || text === '') return []
  /** @type {Array<{ kind: string, [key: string]: string }>} */
  const markers = []
  for (const line of text.split(/\r?\n/)) {
    const marker = readLogMarkers(line)
    if (marker !== null) markers.push(marker)
  }
  return markers
}
