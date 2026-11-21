/**
 * 手绘图标：16px 栅格、1.5 描边、`currentColor`，和系统图标同一套视觉语言。
 * 不 import `dsh-client-ui-primitives`：客户端包是懒 CJS，顶层 require 解析不到会整包挂。
 * @module minecraft-dev-atlas/client/icons
 */

import { h } from './h.js'

/**
 * @param {number} size
 * @param {Array<any>} children
 */
function svg(size, children) {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    ...children,
  )
}

/** 数据面板：2×2 的格子，像一张表。 */
export function IconTable({ size = 14 } = {}) {
  return svg(size, [
    h('rect', { key: 'a', x: 2.5, y: 2.5, width: 4.6, height: 4.6, rx: 1, stroke: 'currentColor', 'stroke-width': 1.4 }),
    h('rect', { key: 'b', x: 8.9, y: 2.5, width: 4.6, height: 4.6, rx: 1, stroke: 'currentColor', 'stroke-width': 1.4 }),
    h('rect', { key: 'c', x: 2.5, y: 8.9, width: 4.6, height: 4.6, rx: 1, stroke: 'currentColor', 'stroke-width': 1.4 }),
    h('rect', { key: 'd', x: 8.9, y: 8.9, width: 4.6, height: 4.6, rx: 1, stroke: 'currentColor', 'stroke-width': 1.4 }),
  ])
}

/** 刷新：缺口圆 + 箭头。 */
export function IconRefresh({ size = 12 } = {}) {
  return svg(size, [
    h('path', {
      key: 'p',
      d: 'M12.6 8a4.6 4.6 0 1 1-1.5-3.4',
      stroke: 'currentColor',
      'stroke-width': 1.4,
      'stroke-linecap': 'round',
    }),
    h('path', { key: 'q', d: 'M12.9 2.4v3.1H9.8', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

/** 导出：向下的箭头落进托盘。 */
export function IconExport({ size = 12 } = {}) {
  return svg(size, [
    h('path', { key: 'a', d: 'M8 2.6v6.2', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
    h('path', { key: 'b', d: 'M5.4 6.4 8 9l2.6-2.6', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('path', { key: 'c', d: 'M3 10.6v1.9c0 .5.4.9.9.9h8.2c.5 0 .9-.4.9-.9v-1.9', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
  ])
}
