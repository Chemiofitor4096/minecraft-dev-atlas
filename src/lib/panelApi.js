/**
 * 面板的方法表：只读（state / query）+ 显式触发的导出（dump）。
 *
 * 与工具走同一个 `atlas` 门面——面板不是第二套实现，只是同一个服务的另一种调用方式。
 * 面板传下来的 `workspace` 是"当前会话目录"；不给时退回宿主默认（最近一个活跃会话）。
 * @module minecraft-dev-atlas/lib/panelApi
 */

/**
 * @param {{ atlas: Record<string, any>, defaultRoot: () => string | undefined }} deps
 */
export function createPanelApi({ atlas, defaultRoot }) {
  /**
   * @param {Record<string, any>} payload
   * @returns {{ root?: string, workspace?: string }}
   */
  const resolve = (payload) => {
    /** @type {{ root?: string, workspace?: string }} */
    const target = {}
    if (typeof payload.root === 'string' && payload.root !== '') target.root = payload.root
    const workspace = typeof payload.workspace === 'string' && payload.workspace !== ''
      ? payload.workspace
      : defaultRoot()
    if (typeof workspace === 'string' && workspace !== '') target.workspace = workspace
    return target
  }

  /** @param {unknown} value */
  const numberOrUndefined = (value) => (Number.isFinite(value) ? Number(value) : undefined)

  return {
    /** 这个工程有没有数据、新不新。 */
    async 'data.state'(payload = {}) {
      return await atlas.state(resolve(payload))
    },

    /** 摘要 / 注册表 / 标签 / 配方，形状与工具一致。 */
    async 'data.query'(payload = {}) {
      /** @type {Record<string, any>} */
      const query = {
        ...resolve(payload),
        kind: typeof payload.kind === 'string' ? payload.kind : 'digest',
      }
      if (typeof payload.registry === 'string' && payload.registry !== '') query.registry = payload.registry
      if (typeof payload.tag === 'string' && payload.tag !== '') query.tag = payload.tag
      if (typeof payload.filter === 'string') query.filter = payload.filter
      const limit = numberOrUndefined(payload.limit)
      if (limit !== undefined) query.limit = limit
      const offset = numberOrUndefined(payload.offset)
      if (offset !== undefined) query.offset = offset
      return await atlas.query(query)
    },

    /** 显式导出：面板上的「导出」按钮点一下才会走这里。 */
    async 'data.dump'(payload = {}) {
      /** @type {Record<string, any>} */
      const input = { ...resolve(payload), refresh: payload.refresh === true }
      if (Array.isArray(payload.sections)) input.sections = payload.sections
      const timeoutMs = numberOrUndefined(payload.timeoutMs)
      if (timeoutMs !== undefined) input.timeoutMs = timeoutMs
      return await atlas.dump(input)
    },

    /** 面板自检：确认路由挂上了、版本对得上。 */
    async ping() {
      return { ok: true, version: atlas.version }
    },
  }
}
