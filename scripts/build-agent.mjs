/**
 * 构建 agent jar 并校验 "jar 版本 == npm 包版本"。
 *
 * 用法：
 *   node scripts/build-agent.mjs            # 构建（gradlew jar）并拷到 assets/
 *   node scripts/build-agent.mjs --verify   # prepack 用：构建后再核对 manifest 与版本
 *   node scripts/build-agent.mjs --skip-build  # 只拷贝 + 校验（CI 里已经构建过）
 *
 * 为什么版本必须相等：包升级了、jar 还是旧的，是最难查的一类问题
 * （插件看起来装了新版本，反射却在按旧映射表干活）。这里不一致就直接失败。
 * @module minecraft-dev-atlas/scripts/build-agent
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJarManifest } from '../src/lib/jar.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agentDir = join(root, 'agent')
const builtJar = join(agentDir, 'build', 'libs', 'mcdev-atlas.jar')
const targetJar = join(root, 'assets', 'mcdev-atlas.jar')
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const args = new Set(process.argv.slice(2))

if (!args.has('--skip-build')) {
  // Windows 上 .bat 必须走 cmd.exe；不用 shell:true，免得参数被当字符串拼接
  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'cmd.exe' : './gradlew'
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', 'gradlew.bat', 'jar', '--console=plain', '--no-daemon']
    : ['jar', '--console=plain', '--no-daemon']
  console.log(`[build-agent] ${isWindows ? 'gradlew.bat' : './gradlew'} jar (JDK 21 required)`)
  const result = spawnSync(command, commandArgs, {
    cwd: agentDir,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`[build-agent] Gradle 构建失败（exit ${result.status ?? 'null'}）`)
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(builtJar)) {
  console.error(`[build-agent] 找不到构建产物：${builtJar}`)
  process.exit(1)
}

mkdirSync(dirname(targetJar), { recursive: true })
copyFileSync(builtJar, targetJar)

const manifest = readJarManifest(targetJar)
const problems = []
if (manifest['Premain-Class'] !== 'dev.mcdev.atlas.Premain') problems.push(`Premain-Class=${manifest['Premain-Class']}`)
if (manifest['Agent-Class'] !== 'dev.mcdev.atlas.AgentMain') problems.push(`Agent-Class=${manifest['Agent-Class']}`)
if (manifest['MCDEV-Schema'] !== '1') problems.push(`MCDEV-Schema=${manifest['MCDEV-Schema']}`)
if (manifest['Implementation-Version'] !== packageVersion) {
  problems.push(`Implementation-Version=${manifest['Implementation-Version']} ≠ package.json ${packageVersion}`)
}
if (problems.length > 0) {
  console.error(`[build-agent] manifest 不合契约：\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

const bytes = readFileSync(targetJar).length
console.log(`[build-agent] assets/mcdev-atlas.jar ${(bytes / 1024).toFixed(1)} KiB · version ${packageVersion} · schema 1`)
