/**
 * 真机 E2E（开发期脚本，不进 npm 包）：走宿主路径导一次。
 *
 * 与 starter 的 `launch` 同形：`cmd.exe /d /s /c` 起 `gradlew.bat runServer`，环境变量合并后
 * 交给子进程（Agent 就是靠这里拿到 `JAVA_TOOL_OPTIONS`）。然后交给 `exportDump` 走完整条
 * 宿主链路：sourceHash → 缓存判定 → 启动 → 读标记 → schema 校验 → meta → 摘要。
 *
 * 用法：node scripts/e2e-export.mjs [工程目录]
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexDump, parseDump } from '../engine/index.js'
import { exportDump } from '../src/lib/export.js'

const projectRoot = resolve(process.argv[2] ?? 'C:\\Projects\\Test')
const packageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const jar = fileURLToPath(new URL('../assets/mcdev-atlas.jar', import.meta.url))
const logDir = fileURLToPath(new URL('../test/tmp/', import.meta.url))

if (!existsSync(jar)) {
  console.error(`[e2e] 找不到 ${jar}：先跑 npm run build`)
  process.exit(1)
}
mkdirSync(logDir, { recursive: true })

let counter = 0

/** 与 starter 的 launch 契约同形的最小实现：起 gradlew、等退出、返回记录。 */
const mcdev = {
  version: packageVersion,
  capabilities: ['launch', 'stop', 'list', 'resolve-java'],
  async list() {
    return []
  },
  async stop() {
    return { id: 'e2e', status: 'exited' }
  },
  async resolveJava() {
    return { home: process.env.JAVA_HOME ?? 'java', major: 21, required: 21 }
  },
  async launch(input) {
    counter += 1
    const id = `e2e-${counter}`
    const logPath = join(logDir, `${id}.log`)
    const wrapper = join(input.root, 'gradlew.bat')
    if (!existsSync(wrapper)) throw Object.assign(new Error(`没有 ${wrapper}`), { code: 'BAD_TASK' })
    const command = `"${`"${wrapper}"`} ${input.taskPath} --console=plain"`
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: input.root,
      env: { ...process.env, ...(input.env ?? {}) },
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    const sink = createWriteStream(logPath)
    child.stdout.pipe(sink)
    child.stderr.pipe(sink)
    const timer = setTimeout(() => {
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    }, 360_000)
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('close', (code) => resolveExit(code ?? -1))
    }).finally(() => clearTimeout(timer))
    await new Promise((resolveSink) => sink.end(resolveSink))
    console.log(`[e2e] ${id} 退出码 ${exitCode}，日志 ${logPath}`)
    return {
      id,
      root: input.root,
      taskPath: input.taskPath,
      status: 'exited',
      outcome: exitCode === 0 ? 'normal' : 'crashed',
      exitCode,
      logPath,
      timedOut: false,
      mode: 'daemon',
    }
  },
}

console.log(`[e2e] 工程 ${projectRoot}`)
console.log(`[e2e] jar  ${jar}（${packageVersion}）`)

const value = await exportDump(
  { mcdev, version: packageVersion, jarPath: jar, jarVersion: packageVersion },
  { root: projectRoot, refresh: true, timeoutMs: 300_000 },
)

console.log(`[e2e] dump ${value.path}（${(value.bytes ?? 0) || (await readFile(value.path)).length} 字节）`)
console.log(`[e2e] env  ${value.env.adapter} · ${value.env.mcVersion} · ${value.env.side}`)
console.log(`[e2e] 数量 ${JSON.stringify(value.counts)}`)
console.log(`[e2e] 警告 ${value.warnings.length} · 错误 ${value.errors.length}`)
console.log(`[e2e] launch ${JSON.stringify(value.launch)}`)

const dump = parseDump(await readFile(value.path, 'utf8'))
const index = indexDump(dump)
const digest = engineDigest(index)
console.log('[e2e] digest:')
console.log(digest)

function engineDigest(indexValue) {
  const counts = indexValue.counts
  const lines = [
    `registries ${counts.registries} · tags ${counts.tags}（成员 ${counts.tagMembers}）· recipes ${counts.recipes}`,
  ]
  for (const [id, registry] of indexValue.registries) {
    const owners = [...registry.owners.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4)
    lines.push(`  ${id} ${registry.count}：${owners.map(([owner, count]) => `${owner} ${count}`).join(' · ')}`)
  }
  return lines.join('\n')
}
