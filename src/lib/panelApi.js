/**
 * 面板的方法表：只读（state / query）+ 工程识别（projects）+ 显式触发的导出（dump）。
 *
 * 与工具走同一个 `atlas` 门面——面板不是第二套实现，只是同一个服务的另一种调用方式。
 * 面板传下来的 `workspace` 是"当前会话目录"；不给时退回宿主默认（最近一个活跃会话）。
 * `projects` 走 starter 的 `ctx.mcdev.projects()`：面板据此选中会话所在的那个工程，
 * 并在工作区里没有 MC 工程时不显示入口。
 * @module minecraft-dev-atlas/lib/panelApi
 */

/**
 * @param {{ atlas: Record<string, any>, mcdev?: Record<string, any>, defaultRoot: () => string | undefined }} deps
 */
export function createPanelApi({ atlas, mcdev, defaultRoot }) {
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
    /**
     * 这个工作区里有哪些工程。`supported: false` 表示 starter 太老、没有 `ctx.mcdev.projects()`
     * ——客户端据此退回"总是显示入口"的旧行为，而不是把功能藏掉。
     */
    async 'data.projects'(payload = {}) {
      const target = resolve(payload)
      if (typeof mcdev?.projects !== 'function') {
        return {
          supported: false,
          workspace: target.workspace ?? null,
          projects: [],
        }
      }
      let scanned
      try {
        // 注意：starter 的 `projects.scan` 只用 workspace 解析**相对 root**，不拿它当扫描根
        // （`resolveRoot()` 里 `requested ?? resolveRoot()`）。面板的"当前会话目录"要变成
        // 绝对的 root 传下去，否则会退到宿主最近一个会话上——正是要修的那个 bug。
        const scanInput = {
          ...target,
          ...(target.root === undefined && typeof target.workspace === 'string' ? { root: target.workspace } : {}),
          ...(payload.refresh === true ? { refresh: true } : {}),
        }
        scanned = await mcdev.projects(scanInput)
      } catch (error) {
        return {
          supported: true,
          workspace: target.workspace ?? null,
          projects: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
      return {
        supported: true,
        workspace: typeof scanned?.root === 'string' ? scanned.root : (target.workspace ?? null),
        truncated: scanned?.truncated === true,
        projects: (Array.isArray(scanned?.projects) ? scanned.projects : []).map(projectSummary),
      }
    },

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
      if (typeof payload.taskPath === 'string' && payload.taskPath !== '') input.taskPath = payload.taskPath
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

/**
 * 给面板用的工程摘要：只留"选哪个、能不能导"需要的东西。
 * @param {Record<string, any>} project
 */
function projectSummary(project) {
  /** @type {Record<string, any>} */
  const view = {
    root: project.root,
    name: project.name,
    kind: project.kind,
    loader: project.loader,
    runTargets: (Array.isArray(project.runTargets) ? project.runTargets : []).map((target) => ({
      taskPath: target.taskPath,
      kind: target.kind,
      mode: target.mode,
      label: target.label,
    })),
  }
  for (const key of ['mcVersion', 'loaderVersion', 'modName', 'modId']) {
    if (typeof project[key] === 'string' && project[key] !== '') view[key] = project[key]
  }
  return view
}
