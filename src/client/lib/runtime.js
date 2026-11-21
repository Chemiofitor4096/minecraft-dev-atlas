/**
 * 客户端运行时句柄与「数据」面板的入口。
 *
 * 用模块级对象而不是 props：slot 组件的注入约定会随版本变，而 `ctx` 在 apply 时
 * 就确定了，组件里读它最稳（与 starter 的 runtime.js 同一做法）。
 * @module minecraft-dev-atlas/client/runtime
 */

/** 右侧栏「数据」标签的 kind。 */
export const DATA_KIND = 'atlas.data'

/** 标签类型 id（也是正文 slot 的 key）。 */
export const DATA_ID = 'minecraft-dev-atlas/data'

/** @type {{ ctx?: any }} */
export const runtime = {}

/** 打开数据面板（openTab 会顺带展开右侧栏）。 */
export function openDataTab() {
  const sidebar = runtime.ctx?.sidebarRight
  if (sidebar === undefined || typeof sidebar.openTab !== 'function') return false
  try {
    sidebar.openTab(DATA_KIND)
    return true
  } catch {
    return false
  }
}
