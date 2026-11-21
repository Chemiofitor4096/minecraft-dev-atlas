/**
 * 客户端入口（cordis 插件形状：inject + apply）。
 *
 * 三处挂载：
 *   - 会话标题栏的「数据」按钮（`conversation.session.header.utilities`，排在 starter 胶囊右边）
 *   - 右侧栏「数据」标签类型
 *   - 该标签的正文与标题 chip
 *
 * @module minecraft-dev-atlas/client
 */

import { DataButton } from './views/DataButton.js'
import { DataTab } from './views/DataTab.js'
import { attachLocale, t } from './lib/messages.js'
import { h } from './lib/h.js'
import { IconTable } from './lib/icons.js'
import { DATA_ID, DATA_KIND, runtime } from './lib/runtime.js'
import { ensureStyles } from './lib/styles.js'

export const name = 'atlas-client'

/** cordis 只把 inject 里声明过的服务交给插件；三个都在 web 组合里。 */
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

/**
 * @param {any} ctx
 */
export function apply(ctx) {
  runtime.ctx = ctx
  ensureStyles()

  // 0) 文案：跟随宿主 locale；拿不到就退回本地词典。
  try {
    if (!attachLocale(ctx) && typeof ctx.inject === 'function') {
      ctx.inject(['locale'], (scoped) => {
        attachLocale(scoped)
      })
    }
  } catch {
    // 翻译失败不影响面板挂载
  }

  // 1) 标题栏按钮
  try {
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'minecraft-dev-atlas:data-button',
          // starter 的胶囊在 15，我们排它右边
          order: 16,
          registrant: 'minecraft-dev-atlas',
        },
        DataButton,
      ),
    )
  } catch {
    // 槽位不可用时面板仍可从右侧栏的历史标签打开
  }

  // 2) 标签类型
  try {
    ctx.effect(
      () => ctx.sidebarRightTabs.register({ id: DATA_ID, kind: DATA_KIND, title: () => t('tab.data') }),
      'atlas: data tab type',
    )
  } catch {
    // 同上
  }

  // 3) 标签正文（有的版本要求先等 slot 声明）
  const registerBody = () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: DATA_ID }, DataTab)
  try {
    registerBody()
  } catch {
    try {
      ctx.slots.inject('sidebar.right.pane.tab', registerBody)
    } catch {
      // 正文没挂上就只是一个空标签，不影响宿主
    }
  }

  // 4) 标签条上的标题 chip：图标 + 文字
  try {
    ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: DATA_ID }, () =>
        h(
          'span',
          { className: 'atlas-icon-text' },
          h('span', { className: 'atlas-icon' }, h(IconTable, { size: 14 })),
          t('tab.data'),
        ),
      ),
    )
  } catch {
    // 没有 chip 也有默认标题
  }
}
