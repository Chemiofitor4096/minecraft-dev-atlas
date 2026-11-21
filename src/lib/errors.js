/**
 * 错误码：宿主唯一允许"往外说"的失败分类。
 *
 * 约定（与 starter 一致）：工具层把 code 翻成中文句子，句子必须带可核对的细节
 * （launch 记录、日志尾巴、缺失的段落），不写"可能失败了"。
 *
 * @module minecraft-dev-atlas/lib/errors
 */

/** 全部失败码及其含义（面板与 README 共用这一份）。 */
export const ERROR_CODES = {
  SERVICE_VERSION_MISMATCH: 'minecraft-dev-starter 版本太老，缺少 ctx.mcdev.launch',
  NO_RUN_TARGET: '这个目录不是 Gradle 工程，或者没有 runServer 目标',
  ALREADY_RUNNING: '这个工程已经有一个实例在跑；先停掉它再导出',
  LAUNCH_FAILED: '服务端没起来（构建失败 / 端口占用 / JDK 不匹配…），没有产出 dump',
  ATLAS_NOT_LOADED: '服务端起来了，但日志里没有 [mcdev-atlas] ready：Agent 没被加载',
  ATLAS_UNSUPPORTED: '这个运行时没有可用的 adapter 表（loader / mappings / MC 版本不认识）',
  ATLAS_TIMEOUT: '等导出超时；已写出的部分在 dump 里，看 errors[] 与日志尾巴',
  ATLAS_NO_DUMP: 'Agent 没有写出 dump（看日志里的 failed 行）',
  ATLAS_SCHEMA_MISMATCH: 'dump 不符合 schema=1',
  NO_DATA: '还没有导出过：先调用 mc_data_dump',
  AGENT_BUILD_MISSING: '包里没有可用的 agent jar（本地开发要先 npm run build）',
  BAD_REQUEST: '参数不合法',
  INTERNAL: '内部错误',
}

/** 带 code 与可诊断细节的错误。 */
export class AtlasError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES | string} code
   * @param {string} message
   * @param {Record<string, any>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AtlasError'
    this.code = code
    this.details = details
  }
}

/**
 * @param {keyof typeof ERROR_CODES | string} code
 * @param {string} message
 * @param {Record<string, any>} [details]
 * @returns {never}
 */
export function fail(code, message, details = {}) {
  throw new AtlasError(code, message, details)
}

/**
 * 把任意异常归一成 {@link AtlasError}；已经带 code 的原样返回。
 * @param {unknown} error
 * @param {string} [fallbackCode]
 * @returns {AtlasError}
 */
export function asAtlasError(error, fallbackCode = 'INTERNAL') {
  if (error instanceof AtlasError) return error
  const message = error instanceof Error ? error.message : String(error)
  const code = /** @type {any} */ (error)?.code
  return new AtlasError(typeof code === 'string' && code !== '' ? code : fallbackCode, message)
}
