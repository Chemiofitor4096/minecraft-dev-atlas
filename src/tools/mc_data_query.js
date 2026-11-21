import { defineTool } from '@deepseek-ai/dsh-tools'
import { rethrowToolError, rootArgs } from './shared.js'
import { describeQuery } from './render.js'

/**
 * `mc_data_query`：只读缓存，不起进程。先 digest 再钻取。
 * @param {Record<string, any>} atlas
 */
export function mcDataQueryTool(atlas) {
  return defineTool({
    name: 'mc_data_query',
    description: `Query the cached Minecraft data dump: digest first, then drill into one registry, tag or recipe by filter. Read-only and never starts the server; a missing dump means calling mc_data_dump first.`,
    parameters: {
      root: { type: 'string', description: 'Project directory; defaults to the current workspace. For a module of a multi-module build, pass the root returned by mc_data_dump' },
      kind: {
        type: 'string',
        enum: ['digest', 'registry', 'tag', 'recipe'],
        description: 'digest: grouped counts (start here); registry: entries; tag: tags or members; recipe: recipes by id or result',
      },
      registry: { type: 'string', description: 'Registry id for kind=registry, e.g. minecraft:item; also narrows kind=tag' },
      tag: { type: 'string', description: 'Tag id for kind=tag, e.g. minecraft:planks; omit it to list tags matching filter' },
      filter: { type: 'string', description: 'Case-insensitive id substring; for kind=recipe it also matches the result item' },
      limit: { type: 'number', description: 'Rows per call; default 50, max 200' },
      offset: { type: 'number', description: 'Start offset for paging; use nextOffset from the previous call' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          registry: { type: 'string' },
          tag: { type: 'string' },
          matched: { type: 'integer', required: true },
          items: { type: 'array', required: true, items: { type: 'json' } },
          truncated: { type: 'boolean', required: true },
          nextOffset: { type: 'integer' },
          available: { type: 'array', items: { type: 'string' } },
          digest: { type: 'object', additionalProperties: true },
          stale: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          generatedAt: { type: 'string', required: true },
          offset: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: describeQuery(value) }],
    },
    async execute(args, exec) {
      try {
        const result = await atlas.query({
          ...rootArgs(args, exec),
          kind: args.kind,
          registry: args.registry,
          tag: args.tag,
          filter: args.filter,
          limit: args.limit,
          offset: args.offset,
        })
        /** @type {Record<string, any>} */
        const value = {
          kind: result.kind ?? args.kind ?? 'digest',
          matched: Number.isInteger(result.matched) ? result.matched : 0,
          items: Array.isArray(result.items) ? result.items : [],
          truncated: result.truncated === true,
          stale: result.stale === true,
          path: result.path,
          generatedAt: result.generatedAt,
        }
        if (typeof result.registry === 'string') value.registry = result.registry
        if (typeof result.tag === 'string') value.tag = result.tag
        if (typeof result.nextOffset === 'number') value.nextOffset = result.nextOffset
        if (Array.isArray(result.available)) value.available = result.available
        if (result.kind === 'digest') value.digest = result
        if (Number.isInteger(args.offset)) value.offset = args.offset
        return value
      } catch (error) {
        rethrowToolError(error)
      }
    },
  })
}
