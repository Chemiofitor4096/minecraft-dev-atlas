/**
 * "当前会话是哪个工作区、里面哪个工程是我们该看的那个"。
 *
 * 面板本身拿不到会话上下文：右侧栏标签的正文只有 tab 信息。所以照 starter 的做法，
 * 由标题栏入口（`conversation.session.header.utilities` 的 DataButton）拿到
 * `sessionId` + `useSessions`，把当前会话 cwd 喂进这个模块级 store，面板订阅它。
 *
 * 这不是洁癖：没有它就只能用"宿主最近一个会话"当默认值——切会话后数据面板会停在
 * 别的工程上（starter 在 M26/M28 踩过同一个坑）。
 * @module minecraft-dev-atlas/client/workspace
 */

import { call } from './api.js'
import { pickProject } from './selection.js'
import { createStore } from './store.js'

export {
  hasMcProject,
  hasNearbyMcProject,
  isMcProject,
  mcProjects,
  nearbyMcProjects,
  pickProject,
  projectDepth,
  serverTargetOf,
} from './selection.js'

/** 识别结果复用窗口：切来切去不必每次都扫盘。 */
const SCAN_TTL_MS = 30_000

export const workspaceStore = createStore({
  /** @type {string | undefined} 当前会话的 cwd */
  cwd: undefined,
  /** @type {boolean} 是否已经有过一次识别结果 */
  ready: false,
  /** @type {boolean} */
  loading: false,
  /** @type {boolean} starter 是否提供 ctx.mcdev.projects() */
  supported: true,
  /** @type {Array<Record<string, any>>} */
  projects: [],
  /** @type {string | undefined} */
  selectedRoot: undefined,
  /** @type {string | undefined} */
  error: undefined,
  /** @type {number} */
  scannedAt: 0,
})

/** @type {Promise<void> | undefined} */
let inFlight
/** @type {string | undefined} */
let inFlightKey

/**
 * 会话 cwd 变了：清掉旧结果再识别（不清会把上一个工作区的工程短暂显示出来）。
 * @param {string | undefined} cwd
 */
export async function setWorkspace(cwd) {
  const normalized = typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  const current = workspaceStore.get()
  if (current.cwd === normalized && (current.ready === true || current.loading === true)) return
  workspaceStore.set({
    cwd: normalized,
    ready: false,
    loading: false,
    projects: [],
    selectedRoot: undefined,
    error: undefined,
  })
  await loadProjects(normalized, { refresh: true })
}

/**
 * 拉一次工作区的工程清单（`/atlas/api/data.projects` → starter 的 ctx.mcdev.projects）。
 * @param {string | undefined} cwd
 * @param {{ refresh?: boolean }} [options]
 */
export async function loadProjects(cwd, options = {}) {
  const key = String(cwd ?? '').toLowerCase()
  const state = workspaceStore.get()
  if (options.refresh !== true) {
    if (state.ready === true && String(state.cwd ?? '').toLowerCase() === key && Date.now() - state.scannedAt < SCAN_TTL_MS) {
      return
    }
    if (inFlight !== undefined && inFlightKey === key) {
      await inFlight
      return
    }
  }

  inFlightKey = key
  workspaceStore.set({ loading: true, error: undefined })
  inFlight = (async () => {
    try {
      const result = await call('data.projects', {
        ...(cwd === undefined ? {} : { workspace: cwd }),
        ...(options.refresh === true ? { refresh: true } : {}),
      })
      const projects = Array.isArray(result?.projects) ? result.projects : []
      const resolvedCwd = typeof result?.workspace === 'string' && result.workspace !== '' ? result.workspace : cwd
      const previous = workspaceStore.get().selectedRoot
      const stillThere = projects.some((project) => project.root === previous)
      const picked = stillThere ? previous : pickProject(projects, resolvedCwd)?.root
      workspaceStore.set({
        cwd: resolvedCwd,
        ready: true,
        loading: false,
        supported: result?.supported !== false,
        projects,
        selectedRoot: picked,
        error: typeof result?.error === 'string' ? result.error : undefined,
        scannedAt: Date.now(),
      })
    } catch (failure) {
      workspaceStore.set({
        ready: true,
        loading: false,
        projects: [],
        selectedRoot: undefined,
        error: messageOf(failure),
        scannedAt: Date.now(),
      })
    } finally {
      inFlight = undefined
      inFlightKey = undefined
    }
  })()
  await inFlight
}

/** @param {string} root */
export function selectProject(root) {
  workspaceStore.set({ selectedRoot: root })
}

/** 当前选中的工程对象。 */
export function selectedProject() {
  const state = workspaceStore.get()
  const found = state.projects.find((project) => project.root === state.selectedRoot)
  return found ?? pickProject(state.projects, state.cwd)
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function messageOf(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}
