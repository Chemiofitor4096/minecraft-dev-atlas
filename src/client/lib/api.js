/**
 * 客户端 ↔ 宿主的唯一通道。
 *
 * 必须用**相对路径**：桌面版外壳的页面是 `dsh-app://app/`，外壳把非静态路径转发给宿主；
 * 写成绝对 origin 会变成跨域（宿主不返回 CORS 头）。依据见 starter 的
 * `doc/调研-DSH插件机制.md` §2.2。
 * @module minecraft-dev-atlas/client/api
 */

/**
 * @template T
 * @param {string} method
 * @param {unknown} [payload]
 * @returns {Promise<T>}
 */
export async function call(method, payload) {
  const response = await fetch(`/atlas/api/${method}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`HTTP ${response.status}`)
  }
  if (body?.ok !== true) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
  }
  return body.result
}
