/**
 * 工程选择的纯函数：不依赖 React、不碰网络，测试里可以直接钉住。
 * @module minecraft-dev-atlas/client/selection
 */

/**
 * 识别到的工程里，哪些算 MC 工程（starter 给非 MC 的 Gradle 工程 kind=unknown）。
 * @param {Record<string, any> | undefined} project
 */
export function isMcProject(project) {
  return project !== undefined && project !== null && typeof project.kind === 'string' && project.kind !== 'unknown'
}

/** @param {Array<Record<string, any>> | undefined} projects */
export function mcProjects(projects) {
  return (Array.isArray(projects) ? projects : []).filter(isMcProject)
}

/** @param {Array<Record<string, any>> | undefined} projects */
export function hasMcProject(projects) {
  return mcProjects(projects).length > 0
}

/**
 * 工程的服务端运行目标：优先 kind=server，其次以 runServer 结尾的任务名。
 * @param {Record<string, any> | undefined} project
 * @returns {Record<string, any> | undefined}
 */
export function serverTargetOf(project) {
  const targets = Array.isArray(project?.runTargets) ? project.runTargets : []
  return targets.find((target) => target.kind === 'server')
    ?? targets.find((target) => typeof target.taskPath === 'string' && /(^|:)runServer$/.test(target.taskPath))
}

/**
 * 该看哪个工程：先认 cwd 本身，再在"附近"的工程里挑能跑服务端的，最后第一个。
 * "附近"（cwd 自身、直接子目录、或同一 Gradle 构建的模块）优先，
 * 避免扫描深度里的模板/夹具抢走默认项。
 * @param {Array<Record<string, any>> | undefined} projects
 * @param {string | undefined} cwd
 * @returns {Record<string, any> | undefined}
 */
export function pickProject(projects, cwd) {
  const all = mcProjects(projects)
  if (all.length === 0) return undefined
  const wanted = normalizePath(cwd)
  if (wanted !== undefined) {
    const exact = all.find((project) => normalizePath(project.root) === wanted)
    if (exact !== undefined) return exact
  }
  const nearby = nearbyMcProjects(projects, cwd)
  const pool = nearby.length > 0 ? nearby : all
  return pool.find((project) => serverTargetOf(project) !== undefined) ?? pool[0]
}

/**
 * 工程相对当前会话目录的深度：0 = 就是它自己，1 = 直接子目录，Infinity = 不在里面。
 * 用来判断"这个工作区本身是不是一个模组工程（或放着模组工程）"，
 * 而不是把扫描深度里的模板/夹具也当成"当前项目"。
 * @param {string | undefined} cwd
 * @param {string | undefined} root
 * @returns {number}
 */
export function projectDepth(cwd, root) {
  const from = normalizePath(cwd)
  const to = normalizePath(root)
  if (from === undefined || to === undefined) return Number.POSITIVE_INFINITY
  if (from === to) return 0
  if (!to.startsWith(`${from}/`)) return Number.POSITIVE_INFINITY
  return to.slice(from.length + 1).split('/').length
}

/**
 * 工作区里"近处"的 MC 工程：会话目录本身、它的直接子目录，或同一 Gradle 构建的模块。
 *
 * 最后一个条件是为多模块工程准备的：`settings.gradle` 把模块放在 `modules/core` 这类
 * 嵌套目录时，模块根的深度大于 1，但它与 cwd 共享 `gradleRoot`，仍然属于当前工作区。
 * 模板/夹具的 `gradleRoot` 是它们自己，因此不会被算进来。
 * @param {Array<Record<string, any>> | undefined} projects
 * @param {string | undefined} cwd
 */
export function nearbyMcProjects(projects, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return mcProjects(projects)
  const wanted = normalizePath(cwd)
  if (wanted === undefined) return mcProjects(projects)
  return mcProjects(projects).filter((project) => {
    if (projectDepth(cwd, project.root) <= 1) return true
    return normalizePath(project.gradleRoot) === wanted
  })
}

/** @param {Array<Record<string, any>> | undefined} projects @param {string | undefined} cwd */
export function hasNearbyMcProject(projects, cwd) {
  return nearbyMcProjects(projects, cwd).length > 0
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function normalizePath(value) {
  if (typeof value !== 'string' || value === '') return undefined
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}
