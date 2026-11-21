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
  SERVICE_VERSION_MISMATCH: 'minecraft-dev-starter 版本过低，缺少 ctx.mcdev.launch',
  NO_RUN_TARGET: '该目录不是 Gradle 工程，或缺少 runServer 目标',
  ALREADY_RUNNING: '该工程已有运行中的实例，需先停止再导出',
  LAUNCH_FAILED: '服务端未能启动（构建失败、端口占用、JDK 不匹配等），未生成 dump',
  ATLAS_NOT_LOADED: '服务端已启动，但日志中没有 [mcdev-atlas] ready：Agent 未被加载',
  ATLAS_UNSUPPORTED: '当前运行时没有可用的 adapter 表（loader、mappings 或 MC 版本不受支持）',
  ATLAS_TIMEOUT: '导出超时；已写出的部分保留在 dump 中，请查看 errors[] 与日志末尾',
  ATLAS_NO_DUMP: 'Agent 未写出 dump（见日志中的 failed 行）',
  ATLAS_SCHEMA_MISMATCH: 'dump 不符合 schema=1',
  NO_DATA: '尚未导出数据，请先调用 mc_data_dump',
  AGENT_BUILD_MISSING: '包内没有可用的 agent jar（本地开发需先执行 npm run build）',
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
