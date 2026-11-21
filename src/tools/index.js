/**
 * 模型侧工具：两个，一个起进程（dump），一个只读（query）。
 *
 * 两者都按步挂载：工作区里没有 Gradle 工程时它们不进 schema、也不可调用（工具 schema
 * 每步都要付上下文，见 starter 的 M25）。判不出来时按可见处理。
 * @module minecraft-dev-atlas/tools
 */

import { projectToolVisible } from './shared.js'
import { mcDataDumpTool } from './mc_data_dump.js'
import { mcDataQueryTool } from './mc_data_query.js'

/** 注册顺序就是模型看到的顺序：先导出，再查询。 */
const TOOLS = [
  { create: mcDataDumpTool, gated: true },
  { create: mcDataQueryTool, gated: true },
]

/**
 * @param {any} ctx
 * @param {{ atlas: Record<string, any> }} deps
 */
export function applyTools(ctx, deps) {
  const gate = { when: (context) => projectToolVisible(context?.agent) }
  for (const tool of TOOLS) {
    const definition = tool.create(deps.atlas)
    if (tool.gated === true) ctx.tools.register(definition, gate)
    else ctx.tools.register(definition)
  }
}
