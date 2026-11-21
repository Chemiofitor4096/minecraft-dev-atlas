import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { looksLikeGradleProject, nearProject, sourceFingerprint, sourceHash } from '../src/lib/project.js'
import { fakeProject, tempDir } from './helpers.js'

test('looksLikeGradleProject：认识四种构建文件与 wrapper', async (t) => {
  const project = await fakeProject(t, { 'settings.gradle.kts': 'rootProject.name = "x"\n' })
  assert.equal(looksLikeGradleProject(project), true)
  const wrapperOnly = await fakeProject(t, { 'gradlew.bat': '@echo off\n' })
  assert.equal(looksLikeGradleProject(wrapperOnly), true)
  const empty = await tempDir(t)
  assert.equal(looksLikeGradleProject(empty), false)
})

test('nearProject：自己、直接子目录、以及找不到', async (t) => {
  const project = await fakeProject(t)
  assert.equal(nearProject(project), project)

  const parent = await tempDir(t)
  const child = join(parent, 'demo')
  await mkdir(child, { recursive: true })
  await writeFile(join(child, 'build.gradle'), "plugins { id 'java' }\n", 'utf8')
  assert.equal(nearProject(parent), child)

  const nothing = await tempDir(t)
  assert.equal(nearProject(nothing), undefined)
  assert.equal(nearProject(''), undefined)
})

test('sourceFingerprint：稳定、可读、改大小会变', async (t) => {
  const project = await fakeProject(t, {
    'build.gradle': "plugins { id 'java' }\n",
    'gradle.properties': 'minecraft_version=1.21.1\n',
    'src/main/java/App.java': 'class App {}\n',
  })
  const first = await sourceFingerprint(project)
  const second = await sourceFingerprint(project)
  assert.equal(first.hash, second.hash)
  assert.match(first.hash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(first.truncated, false)
  assert.ok(first.files >= 3)

  await writeFile(join(project, 'src/main/java/App.java'), 'class App { int x = 1; }\n', 'utf8')
  const changed = await sourceFingerprint(project)
  assert.notEqual(changed.hash, first.hash)
  assert.equal(await sourceHash(project), changed.hash)
})

test('sourceFingerprint：只动 mtime 也会变（不需要读内容）', async (t) => {
  const project = await fakeProject(t, {
    'build.gradle': "plugins { id 'java' }\n",
    'src/main/java/App.java': 'class App {}\n',
  })
  const before = await sourceFingerprint(project)
  const target = join(project, 'src/main/java/App.java')
  const info = await stat(target)
  const later = new Date(info.mtimeMs + 60_000)
  await utimes(target, later, later)
  const after = await sourceFingerprint(project)
  assert.notEqual(after.hash, before.hash)
})

test('sourceFingerprint：没有 src 也能算（只看构建文件）', async (t) => {
  const project = await fakeProject(t, { 'build.gradle.kts': 'plugins { java }\n' })
  const fingerprint = await sourceFingerprint(project)
  assert.equal(fingerprint.files, 1)
})
