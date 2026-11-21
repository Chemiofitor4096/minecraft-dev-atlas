/**
 * 标题栏的「数据」按钮：点一下打开右侧栏的数据面板。
 *
 * 它同时是"当前会话在哪个工作区"的传感器：会话头 slot 会把 `sessionId` 与 `useSessions`
 * 交给组件（starter 的胶囊就是这么拿到 cwd 的），这里把 cwd 喂进 workspace store。
 * 没有识别到 MC 工程时按钮不渲染——工作区里没有可导出的东西，入口就不该常驻。
 * @module minecraft-dev-atlas/client/DataButton
 */

import { useEffect } from 'react'
import { h } from '../lib/h.js'
import { IconTable } from '../lib/icons.js'
import { t } from '../lib/messages.js'
import { openDataTab } from '../lib/runtime.js'
import { useLocale } from '../lib/useLocale.js'
import { hasNearbyMcProject, setWorkspace } from '../lib/workspace.js'
import { useWorkspace } from '../lib/useWorkspace.js'

/**
 * 入口：有会话标准工具（sessionId + useSessions）就按会话取 cwd，否则退回宿主默认。
 * @param {{ sessionId?: string, useSessions?: any }} [props]
 */
export function DataButton(props) {
  if (props?.useSessions === undefined) return h(DataButtonBody, { cwd: undefined })
  return h(SessionDataButton, props)
}

/**
 * @param {{ sessionId?: string, useSessions: any }} props
 */
function SessionDataButton(props) {
  const cwd = props.useSessions((state) => state.byId?.[props.sessionId]?.cwd)
  return h(DataButtonBody, { cwd: typeof cwd === 'string' && cwd !== '' ? cwd : undefined })
}

/**
 * @param {{ cwd?: string }} props
 */
function DataButtonBody({ cwd }) {
  useLocale()
  const workspace = useWorkspace()

  useEffect(() => {
    void setWorkspace(cwd)
  }, [cwd])

  // 老 starter 没有 ctx.mcdev.projects()（或识别失败）时按可见处理：
  // 宁可多一个按钮，也不要让"识别不出来"变成"功能消失"。
  const unknown = workspace.supported === false || workspace.error !== undefined
  const visible = unknown || (workspace.ready === true && hasNearbyMcProject(workspace.projects, workspace.cwd))
  if (visible !== true) return null

  return h(
    'button',
    {
      type: 'button',
      className: 'atlas-pill',
      title: t('button.dataTitle'),
      onClick: () => {
        openDataTab()
      },
    },
    h('span', { className: 'atlas-icon' }, h(IconTable, { size: 13 })),
    t('button.data'),
  )
}
