# minecraft-dev-atlas

A DeepSeek Harness (DSH) plugin that exports **what is actually inside a running Minecraft** — registries, tags and a recipe index — and lets the model query it without burning its context.

It is the second half of a two-package design:

```
minecraft-dev-starter   →  how to run the game         (ctx.mcdev service)
minecraft-dev-atlas     →  what is inside once it runs (two tools + a Java agent)
```

The starter knows nothing about this package. Uninstall it and the starter keeps working.

## Why

Static analysis cannot tell you which mod registered `minecraft:stone`, which items a mod added, which recipes exist after datapacks loaded, or what is actually in a tag. That data only exists at runtime.

A full dump is ~1 MB (~210k tokens), i.e. larger than the whole context window, so the dump **never** goes into the model:

- `mc_data_query` starts with a compact digest (one line per registry, grouped by namespace);
- drill-down is capped (50 rows by default, 200 max) with `nextOffset` paging;
- the dump lives in a file the panel and the model both read — humans browse it freely, the model only sees summaries and matching rows.

## Requirements

- DSH with `minecraft-dev-starter >= 0.3` (this plugin injects `mcdev` and handshakes its `capabilities`);
- a Gradle Minecraft mod project with a server run target (`runServer`);
- v0.1 supports **NeoForge 1.21.x + Mojang mappings (mojmap)** only — no adapter means `ATLAS_UNSUPPORTED`, not a half-empty dump;
- Node ≥ 20 for the host, JDK 21 only to build the agent jar.

## Install (development)

```powershell
node <npm>/@deepseek-ai/dsh/lib/bin.js plugin --profile desktop add link:C:/Projects/minecraft-dev-atlas
```

Then restart DSH. Editing the repo takes effect on restart; `link:` (not `file:`) keeps it live.

Build the agent jar before installing (it is not committed):

```powershell
npm install --legacy-peer-deps
npm run build
```

## Tools

| Tool | Does | Cost |
|---|---|---|
| `mc_data_dump` | Starts `runServer` with `-javaagent`, exports registries/tags/recipes, caches by source hash | one server boot (30–60 s), then cached |
| `mc_data_query` | Read-only digest / registry / tag / recipe queries over the cached dump | no process, <1k tokens for 50 rows |

Both tools are mounted per step: they only appear when the workspace actually contains a Gradle project.

## Where the data lives

```
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/dump.json
$DSH_HOME/mc-dev-starter/profiles/<profile>/data/<projectKey>/meta.json
```

Same state directory convention as the starter, own `data/` subdirectory, nothing written into your project. `sourceHash` is file name + size + mtime of the build files and `src/**`; same hash means the cache is returned (`cached: true`).

## Dump format

`schema = 1`; the authoritative definition lives in the starter repo at
`doc/schema/dump-v1.schema.json`. The summary:

- every section succeeds independently; a failed section is `count: 0`, `entries: []` **and** listed in `errors[]`;
- truncation is explicit (`truncated`, `truncatedSections`, `max` per section);
- entries are sorted by id, tags by tag id, recipe index by recipe id — two exports differ only in `generatedAt`/`durationMs`;
- missing fields are `null` plus a named `warnings[]` entry, never a guess.

## Architecture

```
src/                    host half (ESM, no build)
  index.js              inject ['mcdev','tools'], capability handshake, tool registration
  tools/                mc_data_dump / mc_data_query + Chinese renderers
  lib/                  paths, sourceHash, dump cache, export orchestration, error codes
engine/                 pure query engine (zero deps): parseDump / indexDump / query / digest
agent/                  Java agent (Gradle, JDK 21, zero runtime deps)
  src/main/java/dev/mcdev/atlas/            skeleton: no game class names
  src/main/java/dev/mcdev/atlas/adapters/   NeoForge + mojmap: all reflection lives here
assets/mcdev-atlas.jar  build output (gitignored, shipped in the npm package)
```

The agent mirrors the starter's shape: **every mapping detail lives in an adapter**, selected by
`<loader>/<mappings>/<MC line>` from `adapters.properties`. Adding a loader line is one class plus one row.

## Commands

```powershell
node --test                     # engine + tools + export orchestration
npm run build                   # build agent jar, copy to assets/, verify manifest/version
node scripts/e2e-export.mjs C:\Projects\Test   # real export through the host path (needs JDK 21 + a server target)
```

## Status

- **M-A1 (done)**: agent skeleton, NeoForge/mojmap adapter, `mc_data_dump`, cache + schema validation.
  Verified on `C:\Projects\Test` (NeoForge 21.1.266 / MC 1.21.1): 1339 items, 1060 blocks, 707 tags
  (6891 members), 1290 recipes, `errors: []`.
- **M-A2 (next)**: `mc_data_query` + digest (the engine and the tool exist; panel tab pending).
- M-A3 (optional): attach mode, Fabric/yarn adapter, full recipe JSON.

## License

MIT
