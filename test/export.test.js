import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exportDump } from '../src/lib/export.js'
import { dumpPath, metaPath } from '../src/lib/paths.js'
import { fakeMcdev, fakeProject, outFromJavaToolOptions, readFixtureDump, tempDir } from './helpers.js'

/**
 * 每个用例一个临时 DSH_HOME + 一个假工程 + 一个假 mcdev。
 * @param {import('node:test').TestContext} t
 * @param {{ launch?: Function, list?: Function }} [options]
 */
async function setup(t, options = {}) {
  const home = await tempDir(t, 'atlas-home-')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME
    } else {
      process.env.DSH_HOME = previousHome
    }
  })
  const project = await fakeProject(t)
  const logDir = await tempDir(t, 'atlas-log-')
  const jar = join(home, 'mcdev-atlas.jar')
  await writeFile(jar, 'stub-not-a-real-jar')
  const fake = fakeMcdev(options)
  return {
    home,
    project,
    logDir,
    fake,
    deps: { mcdev: fake.service, version: '0.1.0', jarPath: jar, jarVersion: '0.1.0' },
  }
}

/**
 * 假 launch：按 javaagent 里的 out= 写一份 fixture dump（generatedAt 是"现在"），再写日志。
 * @param {string} logDir
 * @param {Record<string, any>} [options]
 */
function writingLaunch(logDir, options = {}) {
  let counter = 0
  return async (input) => {
    counter += 1
    const option = input.env.JAVA_TOOL_OPTIONS
    const out = outFromJavaToolOptions(option)
    if (options.withDump !== false) {
      const dump = await readFixtureDump()
      if (typeof options.mutateDump === 'function') options.mutateDump(dump)
      dump.generatedAt = new Date(Date.now() + (options.generatedAtOffsetMs ?? 0)).toISOString()
      dump.provenance.projectRoot = input.root
      const hash = /sourcehash=([^,\s]+)/.exec(option)?.[1]
      dump.provenance.sourceHash = hash === undefined ? '' : decodeURIComponent(hash)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, JSON.stringify(dump), 'utf8')
    }
    const logPath = join(logDir, `launch-${counter}.log`)
    const lines = options.logLines ?? [
      '[mcdev-atlas] ready schema=1 loader=neoforge mappings=mojmap adapter=neoforge/mojmap/1.21@1',
      '[mcdev-atlas] section registries count=7',
      '[mcdev-atlas] wrote C:\\x\\dump.json bytes=9',
    ]
    await writeFile(logPath, lines.join('\n'), 'utf8')
    return {
      id: `launch-${counter}`,
      root: input.root,
      taskPath: input.taskPath,
      status: 'exited',
      outcome: options.outcome ?? 'normal',
      exitCode: options.exitCode ?? 0,
      logPath,
      timedOut: false,
      mode: 'daemon',
    }
  }
}

test('导出成功：落盘 dump + meta，返回计数与 launch', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir))

  const value = await exportDump(deps, { root: project })
  assert.equal(value.cached, false)
  assert.equal(value.path, dumpPath(project))
  assert.equal(value.counts.registries, 7)
  assert.equal(value.counts.byRegistry['minecraft:item'], 4)
  assert.equal(value.counts.tags, 3)
  assert.equal(value.counts.tagMembers, 3)
  assert.equal(value.counts.recipes, 2)
  assert.equal(value.launch.id, 'launch-1')
  assert.equal(value.launch.status, 'exited')

  const launch = fake.launchCalls[0]
  assert.equal(launch.taskPath, 'runServer')
  assert.equal(launch.root, project)
  assert.equal(launch.wait, 'exit')
  assert.match(launch.env.JAVA_TOOL_OPTIONS, /-javaagent:/)
  assert.match(launch.env.JAVA_TOOL_OPTIONS, /stop=true/)
  assert.match(launch.env.JAVA_TOOL_OPTIONS, /sections=registries,tags,recipes/)

  const meta = JSON.parse(await readFile(metaPath(project), 'utf8'))
  assert.equal(meta.schema, 1)
  assert.equal(meta.pluginVersion, '0.1.0')
  assert.equal(meta.counts.registries, 7)
  assert.match(meta.sourceHash, /^sha256:[0-9a-f]{64}$/)
})

test('第二次导出命中缓存：不再启动', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir))

  await exportDump(deps, { root: project })
  const value = await exportDump(deps, { root: project })
  assert.equal(value.cached, true)
  assert.equal(value.launch.status, 'cached')
  assert.equal(fake.launchCalls.length, 1)
  assert.ok(value.durationMs < 2000)
})

test('工程改动后缓存失效（sourceHash 变了）', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir))
  await exportDump(deps, { root: project })
  await writeFile(join(project, 'src/main/java/Changed.java'), 'class Changed {}\n', 'utf8')
  const value = await exportDump(deps, { root: project })
  assert.equal(value.cached, false)
  assert.equal(fake.launchCalls.length, 2)
})

test('refresh=true 强制重导', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir))
  await exportDump(deps, { root: project })
  const value = await exportDump(deps, { root: project, refresh: true })
  assert.equal(value.cached, false)
  assert.equal(fake.launchCalls.length, 2)
})

test('没写出 dump、日志里也没有标记 → ATLAS_NOT_LOADED', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir, {
    withDump: false,
    logLines: ['> Task :runServer', 'Picked up JAVA_TOOL_OPTIONS: -javaagent:...'],
  }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_NOT_LOADED')
      assert.match(error.message, /Agent 没生效/)
      return true
    },
  )
})

test('日志里只有 inert → ATLAS_NOT_LOADED 且说明原因', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir, {
    withDump: false,
    logLines: ['[mcdev-atlas] inert reason=no-game-classes'],
  }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_NOT_LOADED')
      assert.match(error.message, /no-game-classes/)
      return true
    },
  )
})

test('没有 adapter → ATLAS_UNSUPPORTED，带探测到的三元组', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir, {
    withDump: false,
    logLines: ['[mcdev-atlas] unsupported loader=fabric mappings=yarn mc=1.22 reason=no-adapter'],
  }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_UNSUPPORTED')
      assert.equal(error.details.env.loader, 'fabric')
      assert.match(error.message, /fabric/)
      return true
    },
  )
})

test('Agent ready 但没写 dump → ATLAS_NO_DUMP', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir, {
    withDump: false,
    logLines: [
      '[mcdev-atlas] ready schema=1 loader=neoforge',
      '[mcdev-atlas] failed stage=write error=IOException:disk',
    ],
  }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_NO_DUMP')
      assert.match(error.message, /write=IOException:disk/)
      return true
    },
  )
})

test('旧 dump 不算这次的产出', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  const old = await readFixtureDump()
  old.generatedAt = '2020-01-01T00:00:00.000Z'
  await mkdir(dirname(dumpPath(project)), { recursive: true })
  await writeFile(dumpPath(project), JSON.stringify(old), 'utf8')
  fake.setLaunch(writingLaunch(logDir, { withDump: false }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_NO_DUMP')
      return true
    },
  )
})

test('dump 不符合 schema → ATLAS_SCHEMA_MISMATCH 并列出问题', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir, {
    mutateDump: (dump) => {
      dump.schema = 2
    },
  }))
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ATLAS_SCHEMA_MISMATCH')
      assert.ok(Array.isArray(error.details.problems))
      assert.match(error.message, /schema/)
      return true
    },
  )
})

test('任务不存在（starter 的 BAD_TASK）→ NO_RUN_TARGET', async (t) => {
  const { project, fake, deps } = await setup(t, {
    launch: async () => {
      throw Object.assign(new Error('unknown task runServer'), { code: 'BAD_TASK' })
    },
  })
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'NO_RUN_TARGET')
      assert.match(error.message, /runServer/)
      return true
    },
  )
  assert.equal(fake.launchCalls.length, 1)
})

test('工程已经在跑 → ALREADY_RUNNING，不启动新实例', async (t) => {
  const { project, fake, deps } = await setup(t, {
    list: async () => [{ id: 'launch-7', status: 'running', taskPath: 'runServer' }],
  })
  await assert.rejects(
    () => exportDump(deps, { root: project }),
    (error) => {
      assert.equal(error.code, 'ALREADY_RUNNING')
      assert.match(error.message, /launch-7/)
      return true
    },
  )
  assert.equal(fake.launchCalls.length, 0)
})

test('不是 Gradle 工程 → NO_RUN_TARGET，连 launch 都不试', async (t) => {
  const { fake, deps } = await setup(t)
  const empty = await tempDir(t, 'atlas-empty-')
  await assert.rejects(
    () => exportDump(deps, { root: empty }),
    (error) => error.code === 'NO_RUN_TARGET',
  )
  assert.equal(fake.launchCalls.length, 0)
})

test('自定义 taskPath 会被校验并传下去', async (t) => {
  const { project, logDir, fake, deps } = await setup(t)
  fake.setLaunch(writingLaunch(logDir))
  await exportDump(deps, { root: project, taskPath: ':fabric:runServer' })
  assert.equal(fake.launchCalls[0].taskPath, ':fabric:runServer')

  await assert.rejects(
    () => exportDump(deps, { root: project, taskPath: 'runServer; rm -rf /' }),
    (error) => error.code === 'BAD_REQUEST',
  )
})
