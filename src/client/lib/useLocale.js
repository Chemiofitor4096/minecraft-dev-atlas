/**
 * 跟随宿主语言的重绘钩子：`t()` 在调用时读语言，但语言切换不是本组件的 state，
 * 所以把"当前语言"做成外部 store，切语言时面板一起换。
 * @module minecraft-dev-atlas/client/useLocale
 */

import { useCallback, useSyncExternalStore } from 'react'
import { localeSource } from './messages.js'

/** @returns {string} 当前语言（仅用于建立依赖） */
export function useLocale() {
  const source = localeSource()
  const subscribe = useCallback((callback) => source.subscribe(callback), [source])
  const snapshot = useCallback(() => source.snapshot(), [source])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
