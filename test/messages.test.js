import assert from 'node:assert/strict'
import test from 'node:test'
import { activeLanguage, en, interpolate, t, zh } from '../src/client/lib/messages.js'

test('zh / en 逐键对齐', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(enKeys, zhKeys)
})

test('每条文案都不为空，且占位符两边一致', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string')
    assert.notEqual(value.trim(), '', key)
    const placeholders = new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))
    const enPlaceholders = new Set([...en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]))
    assert.deepEqual([...enPlaceholders].sort(), [...placeholders].sort(), key)
  }
})

test('t 会插值；缺参数时占位符原样保留', () => {
  assert.equal(t('props.stack', { n: 16 }), '堆叠 16')
  assert.equal(interpolate('{a} / {b}', { a: 'x' }), 'x / {b}')
  assert.equal(interpolate('plain'), 'plain')
})

test('未知 key 返回 key 本身（不抛错）', () => {
  assert.equal(t('nope.not.a.key'), 'nope.not.a.key')
})

test('没有宿主 locale 时退回中文（Node 里没有 navigator）', () => {
  assert.equal(activeLanguage(), 'zh')
})
