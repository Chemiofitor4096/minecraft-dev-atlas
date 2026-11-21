/**
 * 样式护栏：客户端不允许写字面色值/字号，一律走 DSH 的设计 token。
 * 这条和 starter 的 styles.test.js 同一个理由：换主题时会「一半跟着变、一半不变」。
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CSS } from '../src/client/lib/styles.js'

const CLIENT_SOURCES = fileURLToPath(new URL('../src/client/', import.meta.url))

/**
 * @param {string} dir
 * @param {string} prefix
 * @param {string[]} out
 */
async function collectJs(dir, prefix, out) {
  const items = await readdir(dir, { withFileTypes: true })
  for (const item of items) {
    const relative = `${prefix}${item.name}`
    if (item.isDirectory()) {
      await collectJs(join(dir, item.name), `${relative}/`, out)
    } else if (item.isFile() && item.name.endsWith('.js')) {
      out.push(relative)
    }
  }
}

test('CSS 非空且用的是 --dsw-* 令牌', () => {
  assert.ok(CSS.length > 200)
  const tokens = [...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1])
  assert.ok(tokens.length > 10)
  for (const token of tokens) assert.match(token, /^--dsw-/, token)
})

test('没有字面色值', () => {
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(CSS, /\brgba?\(/)
  assert.doesNotMatch(CSS, /\bhsla?\(/)
})

test('客户端源码里也没有字面色值', async () => {
  const files = []
  await collectJs(CLIENT_SOURCES, '', files)
  assert.ok(files.length >= 8)
  for (const file of files) {
    const text = await readFile(join(CLIENT_SOURCES, file), 'utf8')
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, `${file} 里有字面色值`)
    assert.doesNotMatch(text, /\brgba?\(/, `${file} 里有 rgb() 颜色`)
  }
})
