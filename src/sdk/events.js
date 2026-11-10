/**
 * Topology SDK 稳定事件常量
 *
 * 业务侧应优先使用这些常量订阅事件，避免字符串拼写错误：
 *
 * ```js
 * view.on(TOPOLOGY_EVENTS.NODE_CLICK, (event) => console.log(event.id))
 * ```
 */

export const TOPOLOGY_EVENTS = Object.freeze({
  NODE_CLICK: 'node:highlight-click',
  NODE_CLICK_ALIAS: 'node:hight-light-click',
  NODE_DBLCLICK: 'node:highlight-dblclick',
  NODE_CONTEXT_ACTION: 'node:contextmenu-action',
  CANVAS_CLICK: 'canvas:highlight-click',
  SELECTION_CHANGE: 'selection:change',
  HOVER_CHANGE: 'hover:change',
  LAYOUT_CHANGE: 'layout:change',
  THEME_CHANGE: 'theme:change',
  STYLE_CHANGE: 'style:change',
  LABELS_CHANGE: 'labels:change',
  FILTER_CHANGE: 'filter:change',
  DATA_UPDATE: 'data:update',
  RENDER_COMPLETE: 'render:complete',
  VIEW_FIT: 'view:fit',
  VIEW_DESTROY: 'view:destroy',
  ANALYSIS_HIGHLIGHT: 'analysis:highlight',
  ANALYSIS_CLEAR: 'analysis:clear',
  ANALYSIS_PATH: 'analysis:path',
  SEARCH_HIGHLIGHT: 'search:highlight',
  DRILL_CHANGE: 'drill:change',
  AGGREGATION_CHANGE: 'aggregation:change',
  HISTORY_CHANGE: 'history:change',
  REALTIME_STATUS: 'realtime:status',
  STATE_CHANGE: 'state:change',
  EXPORT_COMPLETE: 'export:complete',
})

/** 兼容别名：旧业务可能已经使用错误拼写的 `hight-light` */
export const EVENT_ALIASES = Object.freeze({
  [TOPOLOGY_EVENTS.NODE_CLICK]: [TOPOLOGY_EVENTS.NODE_CLICK_ALIAS],
})

export const TOPOLOGY_EVENT_LIST = Object.freeze(Object.values(TOPOLOGY_EVENTS))

export default TOPOLOGY_EVENTS
