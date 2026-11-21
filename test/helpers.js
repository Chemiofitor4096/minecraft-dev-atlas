/**
 * 测试脚手架：临时目录、读 fixture、假 mcdev。
 * 不引测试框架（node --test 自带），也不 mock 游戏类——反射的 mock 没有意义。
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const FIXTURE_DUMP = new URL('./fixtures/dump-small.json', import.meta.url)

/** @returns {Promise<Record<string, any>>} */
export async function readFixtureDump() {
  return JSON.parse(await readFile(FIXTURE_DUMP, 'utf8'))
}

/**
 * 造一个临时目录；after 里自动删（调用方负责传给 t.after）。
 * @param {import('node:test').TestContext} t
 * @param {string} [prefix]
 * @returns {Promise<string>}
 */
export async function tempDir(t, prefix = 'atlas-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/**
 * 造一个"看起来像 Gradle 工程"的目录。
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [files] 相对路径 → 内容
 * @returns {Promise<string>}
 */
export async function fakeProject(t, files = { 'build.gradle': "plugins { id 'java' }\n", 'src/main/java/App.java': 'class App {}\n' }) {
  const dir = await tempDir(t, 'atlas-project-')
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return dir
}

/**
 * 从 JAVA_TOOL_OPTIONS 里解出 `out=`（假 launch 用它决定往哪写 dump）。
 * @param {string} javaToolOptions
 * @returns {string}
 */
export function outFromJavaToolOptions(javaToolOptions) {
  const match = /-javaagent:[^=]+=([^\s]+)/.exec(javaToolOptions)
  if (match === null) throw new Error(`JAVA_TOOL_OPTIONS 里没有 javaagent：${javaToolOptions}`)
  for (const pair of match[1].split(',')) {
    if (pair.startsWith('out=')) return decodeURIComponent(pair.slice(4))
  }
  throw new Error(`javaagent 参数里没有 out：${match[1]}`)
}

/**
 * 假 mcdev 服务：形状与 starter 的 ctx.mcdev 一致。
 *
 * `launch` 的行为由调用方给：默认写一份 fixture dump（generatedAt 为"现在"），
 * 并返回一条正常的退出记录。launchCalls 记录每次入参，用来断言缓存没有重起。
 * @param {{ launch?: (input: Record<string, any>) => Promise<Record<string, any>>, list?: () => Promise<Array<Record<string, any>>> }} [options]
 */
export function fakeMcdev(options = {}) {
  /** @type {Array<Record<string, any>>} */
  const launchCalls = []
  /** @type {Array<Record<string, any>>} */
  const stopCalls = []
  const state = {
    launch: options.launch ?? (async () => {
      throw new Error('fakeMcdev: 没有给 launch 实现')
    }),
    list: options.list ?? (async () => []),
  }
  return {
    launchCalls,
    stopCalls,
    setLaunch(fn) {
      state.launch = fn
    },
    setList(fn) {
      state.list = fn
    },
    service: {
      version: '0.3.0',
      capabilities: ['launch', 'stop', 'list', 'resolve-java'],
      async launch(input) {
        launchCalls.push(input)
        return await state.launch(input)
      },
      async stop(input) {
        stopCalls.push(input)
        return { id: input?.id ?? 'launch-1', status: 'exited' }
      },
      async list() {
        return await state.list()
      },
      async resolveJava() {
        return { home: 'C:\\jdk-21', major: 21, required: 21 }
      },
    },
  }
}

/** 文件在不在。 */
export function exists(path) {
  return existsSync(path)
}
