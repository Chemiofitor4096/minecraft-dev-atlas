/**
 * 面板样式：一次性注入 `<style>`，**只使用 DSH 的设计 token**（`--dsw-*`）。
 *
 * 颜色走 `--dsw-alias-*`，字号/字体走 `--dsw-font-*`——不写字面色值，
 * 这样明暗主题、字号缩放都跟着宿主走（starter 的 styles.test.js 就是守这条）。
 * @module minecraft-dev-atlas/client/styles
 */

const STYLE_ID = 'minecraft-dev-atlas/styles'

export const CSS = `
.atlas-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
.atlas-pill:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.atlas-icon { display: inline-flex; align-items: center; }
.atlas-icon-text { display: inline-flex; align-items: center; gap: 4px; }

.atlas-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 10px 12px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}
.atlas-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.atlas-title { font: var(--dsw-font-xxs-strong-12); }
.atlas-chips { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }

.atlas-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.atlas-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow: hidden; }
.atlas-seg-item {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  padding: 3px 8px;
  cursor: pointer;
}
.atlas-seg-item[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.atlas-input {
  flex: 1 1 140px;
  min-width: 120px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}
.atlas-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.atlas-select {
  height: 24px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-export {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
.atlas-export:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.atlas-export:disabled { color: var(--dsw-alias-label-tertiary); cursor: progress; }
.atlas-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
.atlas-mini:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.atlas-mini:disabled { opacity: 0.5; cursor: default; }

.atlas-stale { color: var(--dsw-alias-state-warn-primary); font: var(--dsw-font-xxxs-11); }
.atlas-error {
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xxxs-11);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.atlas-hint { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }

.atlas-rows {
  flex: 1 1 auto;
  min-height: 80px;
  overflow: auto;
  border-top: 1px solid var(--dsw-alias-hairline);
  border-bottom: 1px solid var(--dsw-alias-hairline);
}
.atlas-row {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) 108px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 3px 4px;
  border-bottom: 1px solid var(--dsw-alias-hairline);
}
.atlas-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.atlas-row-tag { grid-template-columns: minmax(0, 1fr) 64px; cursor: pointer; }
.atlas-row-recipe { grid-template-columns: minmax(0, 1.2fr) 120px minmax(0, 0.8fr) minmax(0, 1fr); }
.atlas-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--dsw-font-mono);
  font-size: 11px;
}
.atlas-owner { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow: hidden; text-overflow: ellipsis; }
.atlas-props { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); overflow: hidden; text-overflow: ellipsis; }

.atlas-pager { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.atlas-foot { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); overflow-wrap: anywhere; line-height: 1.5; }

.atlas-empty { display: flex; flex-direction: column; gap: 8px; padding: 12px 2px; color: var(--dsw-alias-label-secondary); }
.atlas-loading { padding: 8px 4px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.atlas-back {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-accent);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
.atlas-members { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 6px 4px; }
.atlas-member { font-family: var(--dsw-font-mono); font-size: 11px; }
`

let injected = false

/** 注入一次样式；重复调用是幂等的。 */
export function ensureStyles() {
  if (injected) return
  injected = true
  try {
    if (typeof document === 'undefined') return
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  } catch {
    // 样式注入失败不影响功能，只是难看
  }
}
