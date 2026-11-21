/**
 * 面板的展示格式化：与工具侧 render.js 使用同一套判断（默认值省略），
 * 但这里是给人看的表格，可以多留一点细节。
 * @module minecraft-dev-atlas/client/format
 */

import { t } from './messages.js'

/**
 * @param {Record<string, any> | null | undefined} props
 * @returns {string}
 */
export function propsText(props) {
  if (props === null || props === undefined) return ''
  const parts = []
  if (typeof props.maxStackSize === 'number' && props.maxStackSize !== 64) {
    parts.push(t('props.stack', { n: props.maxStackSize }))
  }
  if (typeof props.maxDamage === 'number' && props.maxDamage > 0) {
    parts.push(t('props.damage', { n: props.maxDamage }))
  }
  if (typeof props.hardness === 'number') {
    parts.push(t('props.hardness', { n: props.hardness }))
  }
  return parts.join(' · ')
}

/**
 * @param {Record<string, any> | null | undefined} result
 * @returns {string}
 */
export function resultText(result) {
  if (result === null || result === undefined) return '—'
  return `${result.count}× ${result.item}`
}

/**
 * 材料按层分组：单层直接写 id，多层写成 `{a|b}`，超过三层折叠。
 * @param {Array<Array<string>> | null | undefined} ingredients
 * @returns {string}
 */
export function ingredientsText(ingredients) {
  if (!Array.isArray(ingredients)) return '—'
  const layers = ingredients.slice(0, 3).map((layer) => (layer.length <= 1 ? (layer[0] ?? '—') : `{${layer.join('|')}}`))
  const more = ingredients.length > 3 ? ` +${ingredients.length - 3}` : ''
  return `${layers.join(' + ')}${more}`
}

/**
 * 完整的导出环境描述：面板里放不进标题，通常用作悬停提示。
 * @param {Record<string, any> | null | undefined} env
 * @returns {string}
 */
export function envText(env) {
  if (env === null || env === undefined) return ''
  const side = env.side === 'client' ? t('env.side.client') : t('env.side.server')
  return `${loaderLabel(env.loader)}${env.loaderVersion === undefined || env.loaderVersion === null ? '' : ` ${env.loaderVersion}`} · MC ${env.mcVersion ?? '?'} · ${env.mappings ?? '?'} · ${side}`
}

/**
 * loader 的展示名。
 * @param {string | undefined} loader
 * @returns {string}
 */
export function loaderLabel(loader) {
  const value = String(loader ?? '')
  if (value === 'neoforge') return 'NeoForge'
  if (value === 'fabric') return 'Fabric'
  if (value === 'forge') return 'Forge'
  if (value === '' || value === 'unknown') return t('loader.unknown')
  return value
}

/**
 * 资源路径（去掉命名空间）：表格里 id 与命名空间分两列展示。
 * @param {string} id
 * @returns {string}
 */
export function pathOf(id) {
  const value = String(id ?? '')
  const colon = value.indexOf(':')
  return colon < 0 ? value : value.slice(colon + 1)
}

/**
 * @param {string} iso
 * @returns {string}
 */
export function timeText(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
