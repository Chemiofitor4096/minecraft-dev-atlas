/**
 * 工具的中文渲染：只吃输出值，不碰 api、不碰文件。
 *
 * token 是这一层的第一约束：默认 50 条要压到 1k token 以内（M-A2 判据），
 * 所以能省的默认值省掉（堆叠 64、耐久 0），不能省的（id、owner、硬度）一条都不省。
 * @module minecraft-dev-atlas/tools/render
 */

const SIDE_TEXT = { server: '服务端', client: '客户端' }

/**
 * mc_data_dump 的渲染。
 * @param {Record<string, any>} value
 * @returns {string}
 */
export function describeDump(value) {
  const env = value.env ?? {}
  const lines = []
  if (value.cached === true) {
    lines.push(`缓存命中（sourceHash 未变，没有重起服务端）：${value.path}`)
  } else {
    const seconds = typeof value.durationMs === 'number' ? (value.durationMs / 1000).toFixed(1) : '?'
    lines.push(`导出完成（${seconds}s）：${value.path}`)
  }
  lines.push(`环境：${loaderText(env)} · ${env.mappings ?? '?'} · ${SIDE_TEXT[env.side] ?? env.side ?? '?'} · ${env.adapter ?? '?'}`)
  lines.push(`数量：${countsText(value.counts)}`)
  const errors = Array.isArray(value.errors) ? value.errors : []
  const warnings = Array.isArray(value.warnings) ? value.warnings : []
  const truncated = value.truncated === true
    ? ` · 已截断：${(value.truncatedSections ?? []).join(' / ') || '未知段落'}`
    : ''
  lines.push(`警告 ${warnings.length} · 错误 ${errors.length}${truncated}`)
  for (const error of errors.slice(0, 3)) {
    lines.push(`  ! ${error.section}：${short(error.message, 240)}`)
  }
  if (errors.length > 3) lines.push(`  ……另有 ${errors.length - 3} 条错误`)
  if (warnings.length > 0) lines.push(`  第一条警告：${short(warnings[0], 240)}`)
  if (typeof value.launch?.id === 'string') {
    lines.push(`实例：${value.launch.id}（${value.launch.outcome ?? value.launch.status ?? '?'}${value.launch.exitCode === undefined ? '' : `，退出码 ${value.launch.exitCode}`}）`)
  }
  if (typeof value.note === 'string' && value.note !== '') lines.push(`注意：${value.note}`)
  return lines.join('\n')
}

/**
 * mc_data_query 的渲染。
 * @param {Record<string, any>} value
 * @returns {string}
 */
export function describeQuery(value) {
  const digest = value.digest
  if (value.kind === 'digest' || digest !== undefined) {
    return renderDigest(digest ?? value, value)
  }
  const lines = []
  const start = typeof value.offset === 'number' ? value.offset + 1 : 1
  const end = start + (Array.isArray(value.items) ? value.items.length : 0) - 1
  const range = Array.isArray(value.items) && value.items.length > 0 ? `显示 ${start}–${end}` : '没有命中'
  if (value.kind === 'registry') {
    lines.push(`${value.registry} · 命中 ${value.matched ?? 0} · ${range}`)
    for (const item of value.items ?? []) lines.push(entryLine(item))
    if (Array.isArray(value.available)) lines.push(`已有注册表：${value.available.join('、')}`)
  } else if (value.kind === 'tag') {
    if (typeof value.tag === 'string') {
      lines.push(`${value.tag}（${value.registry ?? '?'}）· 命中 ${value.matched ?? 0} 个成员 · ${range}`)
      if (Array.isArray(value.items) && value.items.length > 0) lines.push(value.items.join('、'))
    } else {
      lines.push(`标签 · 命中 ${value.matched ?? 0} · ${range}`)
      for (const item of value.items ?? []) lines.push(`${item.tag}（${item.registry}）· ${item.count} 个成员`)
    }
  } else if (value.kind === 'recipe') {
    lines.push(`配方 · 命中 ${value.matched ?? 0} · ${range}`)
    for (const item of value.items ?? []) lines.push(recipeLine(item))
  } else {
    lines.push(JSON.stringify(value).slice(0, 500))
  }
  if (value.truncated === true && typeof value.nextOffset === 'number') {
    lines.push(`还有更多：offset=${value.nextOffset}（limit 上限 200）`)
  }
  if (value.stale === true) {
    lines.push('注意：这份缓存与当前工程不一致（源文件改过）；要新数据用 mc_data_dump refresh=true')
  }
  return lines.join('\n')
}

/**
 * 摘要：模型先看这一屏，再决定钻哪一段。
 * @param {Record<string, any>} digest
 * @param {Record<string, any>} [value]
 * @returns {string}
 */
export function renderDigest(digest, value) {
  const env = digest.env ?? {}
  const lines = []
  lines.push(`${loaderText(env)} · MC ${env.mcVersion ?? '?'} · ${env.mappings ?? '?'} · ${SIDE_TEXT[env.side] ?? env.side ?? '?'} · ${timeText(digest.generatedAt)}`)
  lines.push(`注册表 ${digest.counts?.registries ?? 0} · 标签 ${digest.counts?.tags ?? 0}（成员 ${digest.counts?.tagMembers ?? 0}）· 配方 ${digest.counts?.recipes ?? 0}`)
  for (const registry of digest.registries ?? []) {
    const owners = (registry.owners ?? []).map((owner) => `${owner.owner} ${owner.count}`).join(' · ')
    lines.push(`${registry.id} ${registry.count}：${owners || '（空）'}`)
  }
  const types = digest.recipes?.types ?? []
  if (types.length > 0) {
    lines.push(`配方类型：${types.map((type) => `${type.type.replace(/^minecraft:/, '')} ${type.count}`).join(' · ')}`)
  }
  if (digest.truncated === true) {
    lines.push(`已截断：${(digest.truncatedSections ?? []).join(' / ')}`)
  }
  if ((digest.errors ?? []).length > 0) {
    lines.push(`出错的段落：${(digest.errors ?? []).map((error) => `${error.section}（${short(error.message, 120)}）`).join('；')}`)
  }
  if (digest.warnings > 0) lines.push(`警告 ${digest.warnings} 条（看 dump 的 warnings[]）`)
  lines.push('钻取：kind=registry（可配 registry/filter）· kind=tag（tag 或 filter）· kind=recipe（filter）')
  if (value?.stale === true) lines.push('注意：缓存与当前工程不一致，要新数据用 mc_data_dump refresh=true')
  return lines.join('\n')
}

/**
 * @param {Record<string, any>} item
 * @returns {string}
 */
function entryLine(item) {
  const parts = [item.id, item.owner ?? '?']
  if (typeof item.class === 'string') parts.push(short(item.class, 80))
  const props = propsText(item.props)
  return `- ${parts.join(' · ')}${props}`
}

/**
 * 属性只写"非默认"的那些：默认值省下的 token 就是能多看的条数。
 * @param {Record<string, any> | null | undefined} props
 * @returns {string}
 */
function propsText(props) {
  if (props === null || props === undefined) return ''
  const parts = []
  if (typeof props.maxStackSize === 'number' && props.maxStackSize !== 64) parts.push(`堆叠${props.maxStackSize}`)
  if (typeof props.maxDamage === 'number' && props.maxDamage > 0) parts.push(`耐久${props.maxDamage}`)
  if (typeof props.hardness === 'number') parts.push(`硬度${props.hardness}`)
  return parts.length === 0 ? '' : ` · ${parts.join(' ')}`
}

/**
 * @param {Record<string, any>} recipe
 * @returns {string}
 */
function recipeLine(recipe) {
  const result = recipe.result === null || recipe.result === undefined
    ? '（无产物）'
    : `${recipe.result.count}× ${recipe.result.item}`
  const layers = Array.isArray(recipe.ingredients) ? recipe.ingredients : null
  let ingredients = ''
  if (layers !== null) {
    const shown = layers.slice(0, 3).map((layer) => (layer.length <= 1 ? (layer[0] ?? '空') : `{${layer.join('|')}}`))
    const more = layers.length > 3 ? ` …+${layers.length - 3}` : ''
    ingredients = ` ← ${shown.join(' + ')}${more}`
  }
  return `- ${recipe.id} · ${short(recipe.type, 60)} → ${result}${ingredients}`
}

/**
 * @param {Record<string, any>} counts
 * @returns {string}
 */
export function countsText(counts) {
  if (counts === null || counts === undefined) return '（无）'
  const byRegistry = Object.entries(counts.byRegistry ?? {})
    .map(([id, count]) => `${id.replace(/^minecraft:/, '')} ${count}`)
    .join(' / ')
  const registries = byRegistry === '' ? '' : `（${byRegistry}）`
  return `注册表 ${counts.registries ?? 0}${registries} · 标签 ${counts.tags ?? 0}（成员 ${counts.tagMembers ?? 0}）· 配方 ${counts.recipes ?? 0}`
}

/**
 * @param {Record<string, any>} env
 * @returns {string}
 */
export function loaderText(env) {
  const loader = String(env.loader ?? 'unknown')
  const label = loader === 'neoforge' ? 'NeoForge' : loader === 'fabric' ? 'Fabric' : loader === 'forge' ? 'Forge' : loader
  return env.loaderVersion === undefined || env.loaderVersion === null ? label : `${label} ${env.loaderVersion}`
}

/**
 * @param {string} iso
 * @returns {string}
 */
function timeText(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * @param {string} text
 * @param {number} length
 * @returns {string}
 */
function short(text, length) {
  const value = String(text ?? '')
  return value.length > length ? `${value.slice(0, length)}…` : value
}
