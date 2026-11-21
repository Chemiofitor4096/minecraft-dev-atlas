/**
 * 面板样式：一次性注入 `<style>`，只使用 DSH 的设计 token（`--dsw-*`）。
 *
 * 颜色一律走 `--dsw-alias-*`，字体走 `--dsw-font-*`，不写字面色值。
 * 布局以密度为先：表头固定、行高 22px，便于一屏浏览更多条目。
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
  gap: 6px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  padding: 8px 10px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

.atlas-context { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.atlas-context-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
.atlas-project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-primary);
}
.atlas-chip {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-counts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-count-label { color: var(--dsw-alias-label-tertiary); }
.atlas-count-value { margin-left: 3px; color: var(--dsw-alias-label-primary); }
.atlas-count-note { margin-left: 2px; color: var(--dsw-alias-label-tertiary); }
.atlas-count-sep { color: var(--dsw-alias-label-tertiary); }

.atlas-project-bar { display: flex; align-items: center; gap: 6px; }

.atlas-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.atlas-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow: hidden; }
.atlas-seg-item {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  padding: 3px 9px;
  cursor: pointer;
}
.atlas-seg-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.atlas-seg-item[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  box-shadow: inset 0 -2px 0 var(--dsw-alias-accent);
}

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
.atlas-select-sm { height: 20px; padding: 0 4px; }
.atlas-export {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-accent);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-accent);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
.atlas-export:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.atlas-export:disabled { border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-tertiary); cursor: progress; }
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
.atlas-mini:disabled { opacity: 0.45; cursor: default; }
.atlas-icon-button { width: 24px; padding: 0; justify-content: center; }

.atlas-stale,
.atlas-error {
  padding: 3px 6px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  font: var(--dsw-font-xxxs-11);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.atlas-stale { border-left-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.atlas-error { border-left-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.atlas-hint { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }

.atlas-table {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--dsw-alias-hairline);
  border-bottom: 1px solid var(--dsw-alias-hairline);
}
.atlas-tbody { flex: 1 1 auto; min-height: 0; overflow: auto; }
.atlas-thead {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 8px;
  padding: 3px 6px;
  border-bottom: 1px solid var(--dsw-alias-hairline);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-thead-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono);
}
.atlas-row {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) 108px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 22px;
  padding: 2px 6px;
  border-bottom: 1px solid var(--dsw-alias-hairline);
  font: var(--dsw-font-xxxs-11);
}
.atlas-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.atlas-thead:hover { background: var(--dsw-alias-bg-layer-2); }
.atlas-row-tag { grid-template-columns: minmax(0, 1fr) 56px; cursor: pointer; }
.atlas-row-recipe { grid-template-columns: minmax(0, 1.4fr) 96px minmax(0, 1fr) minmax(0, 1.2fr); }
.atlas-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono);
  font-size: 11px;
}
.atlas-owner {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-props {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-num { text-align: right; color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono); }

.atlas-members { display: flex; flex-wrap: wrap; gap: 2px 12px; padding: 6px; }
.atlas-member { color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono); font-size: 11px; }

.atlas-pager {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-range { flex: none; }
.atlas-page-size { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.atlas-pager-btns { display: inline-flex; gap: 4px; }

.atlas-foot {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.atlas-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.atlas-time { flex: none; }
.atlas-dot { flex: none; }

.atlas-empty { display: flex; flex-direction: column; gap: 8px; padding: 12px 2px; color: var(--dsw-alias-label-secondary); }
.atlas-empty-title { font: var(--dsw-font-xxs-strong-12); color: var(--dsw-alias-label-primary); }
.atlas-loading { padding: 8px 6px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.atlas-back {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-accent);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
}
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
    document.body.appendChild(style)
  } catch {
    // 样式注入失败不影响功能
  }
}
