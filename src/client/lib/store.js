/**
 * 极简可订阅状态：面板不需要状态库，一个工作区 + 一个选中工程就够。
 * 与 starter 的 store.js 同一实现（两边都要在 session 切换时把 cwd 传下来）。
 * @module minecraft-dev-atlas/client/store
 */

/**
 * @template {Record<string, unknown>} T
 * @param {T} initial
 */
export function createStore(initial) {
  /** @type {T} */
  let value = initial
  const listeners = new Set()

  return {
    /** @returns {T} */
    get() {
      return value
    },
    /** @param {Partial<T>} next */
    set(next) {
      value = { ...value, ...next }
      for (const listener of listeners) listener(value)
    },
    /**
     * @param {(value: T) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
