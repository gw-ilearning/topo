/**
 * 工作区布局（class 封装）
 *
 * 页面结构：
 *   ┌──────────────────────────────┐
 *   │           顶栏 TopBar          │  ← 上下布局的上半部分
 *   ├──────────┬───────────────────┤
 *   │ 布局类型  │                   │  ← 下半部分：左右布局
 *   │  菜单    │     G6 / 3D 画布   │
 *   │ (可收起) │                   │
 *   └──────────┴───────────────────┘
 *
 * 该类只负责「左侧菜单宽度 + 收起/展开」这一层布局状态，
 * 与具体渲染引擎无关，Vue 中可直接 `reactive(new WorkspaceLayout())` 使用。
 */

export const WORKSPACE_RAIL_STORAGE_KEY = 'topology-layout-rail-collapsed'

export class WorkspaceLayout {
  constructor({
    railWidth = 200,
    collapsedWidth = 56,
    collapsed = false,
  } = {}) {
    this.railWidth = Math.max(120, Number(railWidth) || 200)
    this.collapsedWidth = Math.max(40, Number(collapsedWidth) || 56)
    this.collapsed = Boolean(collapsed)
  }

  /** 左侧菜单当前宽度（px） */
  get width() {
    return this.collapsed ? this.collapsedWidth : this.railWidth
  }

  get isCollapsed() {
    return this.collapsed
  }

  /** 供模板直接绑定：:style="layout.railStyle" */
  get railStyle() {
    return { width: `${this.width}px` }
  }

  setCollapsed(value) {
    this.collapsed = Boolean(value)
    return this.collapsed
  }

  toggle() {
    return this.setCollapsed(!this.collapsed)
  }
}
