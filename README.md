# minecraft-dev-atlas

A DeepSeek Harness (DSH) plugin that exports runtime data from a running Minecraft instance —
registries, tags and a recipe index — and serves it to the model at a controlled token cost.

It forms the second half of a two-package design:

```
minecraft-dev-starter   →  starts the game          (ctx.mcdev service)
minecraft-dev-atlas     →  reads runtime contents   (two tools and a Java agent)
```

The starter package does not depend on this plugin; removing the plugin leaves the starter unaffected.

## Motivation

Static analysis cannot determine which mod registered `minecraft:stone`, which items a mod adds,
which recipes exist after datapacks load, or which members a tag contains. This information exists
only at runtime.

A complete dump is approximately 1 MB (~210k tokens), larger than the context window, so the dump
is never placed in the model context:

- `mc_data_query` returns a digest first (one line per registry, grouped by namespace);
- drill-down is capped (50 rows by default, 200 maximum) and paged through `nextOffset`;
- the dump is a file read by both the panel and the tools: users browse it directly, while the model
  receives only summaries and matching rows.

## Requirements

- DSH with `minecraft-dev-starter >= 0.3` installed (this plugin injects `mcdev` and validates
  `capabilities` at startup);
- a Gradle Minecraft mod project with a server run target (`runServer`);
- v0.1 supports **NeoForge 1.21.x with Mojang mappings (mojmap)** only; without a matching adapter
  the plugin returns `ATLAS_UNSUPPORTED` instead of exporting incomplete data;
- Node ≥ 20; JDK 21 is required only to build the agent jar.

## Install (development)

```powershell
node <npm>/@deepseek-ai/dsh/lib/bin.js plugin --profile desktop add link:C:/Projects/minecraft-dev-atlas
```

Restart DSH afterwards. With `link:`, changes in the repository take effect on restart; `file:`
installs a copy, so later repository changes are not reflected in the installed copy.

The agent jar must be built before installation (it is not committed):

```powershell
npm install --legacy-peer-deps
npm run build
```

## Tools and panel

| Tool | Purpose | Cost |
|---|---|---|
| `mc_data_dump` | Starts `runServer` with `-javaagent` and exports registries, tags and recipes; results are cached by source hash | one server start and stop (30–60 s); cached afterwards |
| `mc_data_query` | Read-only digest, registry, tag and recipe queries | no process; fewer than 1k tokens for 50 rows |

The panel is a **Data** tab in the right sidebar, opened from a header button. It provides a
read-only table, search, export and paging. Data is retrieved through the host's `/atlas/api`, which
shares the same facade as the tools: users and the model read the same file, and the panel is not
subject to the token budget. The panel follows the current session's workspace and offers a project
selector when several projects exist. The header entry is hidden when the workspace contains no
nearby Minecraft project.

Both tools are mounted per step: when the workspace contains no Gradle project they are absent from
the schema and cannot be invoked.

## Data location

```
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/dump.json
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/meta.json
```

The plugin follows the starter's state directory convention: it creates only its own `data/`
subdirectory and writes no files into the user's project. `sourceHash` is computed from the names,
sizes and modification times of the build files and `src/**`; an unchanged hash returns the cache
(`cached: true`).

## Dump format

`schema = 1`; the authoritative definition is in the starter repository at
`doc/schema/dump-v1.schema.json`. Summary:

- each section succeeds or fails independently; a failed section has `count: 0`, `entries: []`
  and an entry in `errors[]`;
- truncation is explicit (`truncated`, `truncatedSections`, `max` per section);
- entries are sorted by id, tags by tag id and recipes by id; two exports of the same project differ
  only in `generatedAt` and `durationMs`;
- unreadable fields are `null` and are recorded in `warnings[]`; no value is inferred.

## Architecture

```
src/                    host side (ESM, no build)
  index.js              inject ['mcdev','tools'], capability validation, tool registration
  tools/                mc_data_dump / mc_data_query with Chinese rendering
  lib/                  paths, sourceHash, dump cache, export orchestration, error codes
engine/                 query engine (pure functions, zero dependencies): parseDump / indexDump / query / digest
agent/                  Java agent (Gradle, JDK 21, zero runtime dependencies)
  src/main/java/dev/mcdev/atlas/            skeleton: no game class names
  src/main/java/dev/mcdev/atlas/adapters/   adapters (NeoForge + mojmap): all reflection lives here
assets/mcdev-atlas.jar  build output (gitignored, shipped in the npm package)
```

The agent follows the starter's organization: all mapping knowledge is confined to adapters,
selected by `<loader>/<mappings>/<MC line>` from `adapters.properties`. Adding support for one
combination requires one class and one table entry.

## Commands

```powershell
node --test                     # engine, tools and export orchestration
npm run build                   # build the agent jar, copy it to assets/, verify manifest and version
node scripts/e2e-export.mjs C:\Projects\Test   # real export through the host path (needs JDK 21 and a server target)
```

## Status

- **M-A1 (done)**: agent skeleton, NeoForge/mojmap adapter, `mc_data_dump`, cache and schema validation.
  Verified on `C:\Projects\Test` (NeoForge 21.1.266 / MC 1.21.1): 1339 items, 1060 blocks, 707 tags
  (6891 members), 1290 recipes, `errors: []`. Cached re-export: 12 ms.
- **M-A2 (done)**: `mc_data_query` and digest, plus the panel's Data tab (header button → right-sidebar
  tab; read-only table, search, export, paging). Cached re-export: 12 ms; digest ≈ 138 tokens,
  50 registry rows ≈ 499 tokens.
- M-A3 (optional): attach mode, Fabric/yarn adapter, full recipe JSON.

## License

MIT
