/**
 * 面板的展示格式化：与工具那边的 render.js 同一个口径（默认值省掉、只留有用的），
 * 但这里是给人看的表格，不是给模型的 token 预算。
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
 * @param {Record<string, any> | null | undefined} counts
 * @returns {string}
 */
export function countsText(counts) {
  if (counts === null || counts === undefined) return ''
  return t('panel.counts', {
    registries: counts.registries ?? 0,
    tags: counts.tags ?? 0,
    members: counts.tagMembers ?? 0,
    recipes: counts.recipes ?? 0,
  })
}

/**
 * 环境一行：loader + 版本、MC、映射、侧。
 * @param {Record<string, any> | null | undefined} env
 * @returns {string}
 */
export function envText(env) {
  if (env === null || env === undefined) return t('env.none')
  const loader = String(env.loader ?? t('loader.unknown'))
  const label = loader === 'neoforge' ? 'NeoForge' : loader === 'fabric' ? 'Fabric' : loader === 'forge' ? 'Forge' : loader
  const side = env.side === 'client' ? t('env.side.client') : t('env.side.server')
  return `${env.loaderVersion === undefined || env.loaderVersion === null ? label : `${label} ${env.loaderVersion}`} · MC ${env.mcVersion ?? '?'} · ${env.mappings ?? '?'} · ${side}`
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

/** 只保留一层命名空间，表格里不重复写 `minecraft:` 前缀。 */
export function shortId(id) {
  return String(id ?? '').replace(/^minecraft:/, '')
}
