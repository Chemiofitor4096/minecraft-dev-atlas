/**
 * 订阅工作区 store 的 React 钩子。
 *
 * 和 store 本身分开：`workspace.js` 不依赖 React，可以直接在 Node 测试里驱动
 * （`test/workspace.test.js`），只有这里需要 `useState` / `useEffect`。
 * @module minecraft-dev-atlas/client/useWorkspace
 */

import { useEffect, useState } from 'react'
import { workspaceStore } from './workspace.js'

/** @returns {ReturnType<typeof workspaceStore.get>} */
export function useWorkspace() {
  const [state, setState] = useState(workspaceStore.get())
  useEffect(() => workspaceStore.subscribe(setState), [])
  return state
}
