import { defineTool } from '@deepseek-ai/dsh-tools'
import { clearGateCache, rethrowToolError, rootArgs } from './shared.js'
import { describeDump } from './render.js'

/**
 * `mc_data_dump`：起一次 headless 服务端（带 Agent），把注册表/标签/配方索引导出来。
 * @param {Record<string, any>} atlas
 */
export function mcDataDumpTool(atlas) {
  return defineTool({
    name: 'mc_data_dump',
    description: `Export Minecraft registries, tags and recipe index from a headless dev server into a cached dump. It starts runServer itself (30-60s) and reuses the dump while the project is unchanged, so do not start the server yourself.`,
    parameters: {
      root: { type: 'string', description: 'Project directory; defaults to the current workspace. For a multi-module build, point at the aggregator (a single server module is detected) or at the module itself' },
      sections: {
        type: 'array',
        description: 'Sections to export; default all three',
        items: { type: 'string', enum: ['registries', 'tags', 'recipes'] },
      },
      timeoutMs: { type: 'number', description: 'Cap for build + boot + export in ms; default 180000. The agent writes what it has before this fires' },
      refresh: { type: 'boolean', description: 'Ignore the cache and export again (after changing mod code or datapacks)' },
      taskPath: { type: 'string', description: 'Gradle server task; default runServer. For a multi-module build, :module:runServer selects that module automatically' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          root: { type: 'string' },
          taskPath: { type: 'string' },
          cached: { type: 'boolean', required: true },
          schema: { type: 'integer', required: true },
          env: { type: 'object', required: true, additionalProperties: true },
          counts: { type: 'object', required: true, additionalProperties: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          errors: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          truncated: { type: 'boolean', required: true },
          truncatedSections: { type: 'array', required: true, items: { type: 'string' } },
          launch: {
            type: 'object',
            required: true,
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              status: { type: 'string' },
              outcome: { type: 'string' },
              exitCode: { type: 'integer' },
              verdict: { type: 'string' },
              timedOut: { type: 'boolean', required: true },
              logPath: { type: 'string' },
              taskPath: { type: 'string' },
            },
          },
          durationMs: { type: 'integer' },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: describeDump(value) }],
    },
    async execute(args, exec) {
      try {
        const value = await atlas.dump({
          ...rootArgs(args, exec),
          sections: args.sections,
          timeoutMs: args.timeoutMs,
          refresh: args.refresh === true,
          taskPath: args.taskPath,
          signal: exec?.signal,
        })
        clearGateCache()
        return value
      } catch (error) {
        rethrowToolError(error)
      }
    },
  })
}
