/**
 * 读我们自己的 agent jar：位置、manifest 里的契约字段、版本是否与 npm 包一致。
 *
 * 为什么自己解析 zip：插件是零依赖的，不能在运行时引 unzip 库；而 manifest 只是一个
 * 小条目，central directory + zlib 就够了。这段代码同时服务 prepack 校验（版本相等）
 * 与测试（Premain-Class / Agent-Class / MCDEV-Schema 都在）。
 * @module minecraft-dev-atlas/lib/jar
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

/** jar 在包里的固定位置。 */
export function jarPath() {
  return fileURLToPath(new URL('../../assets/mcdev-atlas.jar', import.meta.url))
}

/**
 * 从 zip 里取一个条目（只支持 stored / deflate，够读 manifest 与 properties）。
 * @param {Buffer} buffer
 * @param {string} name
 * @returns {Buffer | undefined}
 */
export function readZipEntry(buffer, name) {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd === undefined) return undefined
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return undefined
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (entryName === name) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return undefined
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.subarray(dataStart, dataStart + compressedSize)
      return method === 0 ? data : inflateRawSync(data)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

/**
 * @param {Buffer} buffer
 * @returns {number | undefined}
 */
function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return undefined
}

/**
 * 解析 manifest（含续行）。
 * @param {Buffer} text
 * @returns {Record<string, string>}
 */
export function parseManifest(text) {
  /** @type {Record<string, string>} */
  const fields = {}
  /** @type {string | undefined} */
  let current
  for (const line of text.toString('utf8').split(/\r?\n/)) {
    if (line === '') continue
    if (line.startsWith(' ') && current !== undefined) {
      fields[current] += line.slice(1)
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    current = line.slice(0, colon).trim()
    fields[current] = line.slice(colon + 1).trim()
  }
  return fields
}

/**
 * 读 jar 的 manifest 字段。
 * @param {string} [path]
 * @returns {Record<string, string>}
 */
export function readJarManifest(path = jarPath()) {
  const buffer = readFileSync(path)
  const entry = readZipEntry(buffer, 'META-INF/MANIFEST.MF')
  if (entry === undefined) throw new Error(`jar 里没有 META-INF/MANIFEST.MF：${path}`)
  return parseManifest(entry)
}

/**
 * 读 jar 里登记的 agent 版本（`Implementation-Version`）。
 * @param {string} [path]
 * @returns {string | undefined}
 */
export function readJarVersion(path = jarPath()) {
  const manifest = readJarManifest(path)
  return typeof manifest['Implementation-Version'] === 'string' ? manifest['Implementation-Version'] : undefined
}
