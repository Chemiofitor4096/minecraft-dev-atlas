import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATLAS_CAPABILITIES,
  javaAgentOption,
  readAllMarkers,
  readLogMarkers,
} from '../engine/contract.js'

const JAR = 'C:\\tools\\mcdev-atlas.jar'
const OUT = 'C:\\data\\dump.json'

test('javaAgentOption：默认导出三段、路径做 URL 编码', () => {
  const option = javaAgentOption({ jar: JAR, out: OUT })
  assert.equal(
    option,
    `-javaagent:${JAR}=out=C%3A%5Cdata%5Cdump.json,sections=registries,tags,recipes`,
  )
})

test('javaAgentOption：可选参数只在给了值时出现', () => {
  const option = javaAgentOption({
    jar: JAR,
    out: OUT,
    sections: ['registries'],
    timeoutMs: 120_000,
    stop: true,
    max: 20_000,
    loader: 'neoforge',
    mappings: 'mojmap',
    root: 'C:\\Projects\\Test',
    sourceHash: 'sha256:abc',
  })
  assert.match(option, /sections=registries,stop=true/)
  assert.match(option, /stop=true/)
  assert.match(option, /timeout=120000/)
  assert.match(option, /max=20000/)
  assert.match(option, /loader=neoforge/)
  assert.match(option, /root=C%3A%5CProjects%5CTest/)
  assert.match(option, /sourcehash=sha256%3Aabc/)
})

test('javaAgentOption：未知段落直接报错（不悄悄忽略）', () => {
  assert.throws(() => javaAgentOption({ jar: JAR, out: OUT, sections: ['loot'] }), /未知段落/)
})

test('javaAgentOption：路径里有空格/逗号/等号就报错', () => {
  assert.throws(() => javaAgentOption({ jar: 'C:\\a b\\x.jar', out: OUT }), /空白/)
  assert.throws(() => javaAgentOption({ jar: JAR, out: 'C:\\a,b\\dump.json' }), /逗号/)
  assert.throws(() => javaAgentOption({ jar: 'C:\\a=b\\x.jar', out: OUT }), /等号/)
})

test('readLogMarkers：ready 行', () => {
  const marker = readLogMarkers('[mcdev-atlas] ready schema=1 loader=neoforge mappings=mojmap adapter=neoforge/mojmap/1.21@1')
  assert.deepEqual(marker, {
    kind: 'ready',
    schema: '1',
    loader: 'neoforge',
    mappings: 'mojmap',
    adapter: 'neoforge/mojmap/1.21@1',
  })
})

test('readLogMarkers：section / wrote / failed / inert / unsupported', () => {
  assert.deepEqual(readLogMarkers('[mcdev-atlas] section registries count=1240'), {
    kind: 'section', name: 'registries', count: '1240',
  })
  assert.deepEqual(readLogMarkers('[mcdev-atlas] wrote C:\\x\\dump.json bytes=123'), {
    kind: 'wrote', name: 'C:\\x\\dump.json', bytes: '123',
  })
  assert.deepEqual(readLogMarkers('[mcdev-atlas] failed stage=write error=IOException:disk'), {
    kind: 'failed', stage: 'write', error: 'IOException:disk',
  })
  assert.deepEqual(readLogMarkers('[mcdev-atlas] inert reason=gradle-daemon'), {
    kind: 'inert', reason: 'gradle-daemon',
  })
  const unsupported = readLogMarkers('[mcdev-atlas] unsupported loader=fabric mappings=yarn mc=1.21 reason=no-adapter')
  assert.equal(unsupported.kind, 'unsupported')
  assert.equal(unsupported.reason, 'no-adapter')
})

test('readLogMarkers：普通日志与空行返回 null', () => {
  assert.equal(readLogMarkers('> Task :compileJava'), null)
  assert.equal(readLogMarkers('[minecraft-dev] ready'), null)
  assert.equal(readLogMarkers(''), null)
  assert.equal(readLogMarkers(undefined), null)
})

test('readAllMarkers：多行里只挑我们的标记', () => {
  const text = [
    'Picked up JAVA_TOOL_OPTIONS: -javaagent:...',
    '> Task :runServer',
    '[mcdev-atlas] ready schema=1 loader=neoforge',
    'Done (1.2s)! For help, type "help"',
    '[mcdev-atlas] section registries count=7',
    '[mcdev-atlas] wrote C:\\x\\dump.json bytes=9',
  ].join('\r\n')
  const markers = readAllMarkers(text)
  assert.deepEqual(markers.map((marker) => marker.kind), ['ready', 'section', 'wrote'])
})

test('能力清单覆盖两类工具与三段数据', () => {
  for (const capability of ['dump', 'query', 'digest', 'sections:registries', 'sections:tags', 'sections:recipes', 'agent-boot']) {
    assert.ok(ATLAS_CAPABILITIES.includes(capability), capability)
  }
})
