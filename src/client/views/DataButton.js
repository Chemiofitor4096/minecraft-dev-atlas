/**
 * 标题栏的「数据」按钮：点一下打开右侧栏的数据面板。
 *
 * 为什么放 `conversation.session.header.utilities`：starter 的胶囊也在那儿（order 15），
 * 排在它右边（16）最不容易在窄窗口里跟会话标题打架。
 * @module minecraft-dev-atlas/client/DataButton
 */

import { h } from '../lib/h.js'
import { IconTable } from '../lib/icons.js'
import { t } from '../lib/messages.js'
import { openDataTab } from '../lib/runtime.js'
import { useLocale } from '../lib/useLocale.js'

export function DataButton() {
  useLocale()
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
