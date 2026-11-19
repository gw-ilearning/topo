import { Graph } from '@antv/g6'
import { G6_DEFAULT_LAYOUT, getG6LayoutPreset, resolveG6LayoutOptions } from './layouts.js'
import {
  buildComboOptions,
  buildEdgeOptions,
  buildGridPlugin,
  buildGroupPanelOptions,
  buildNodeOptions,
  g6NodeAccent,
  g6NodeShape,
  g6NodeSize,
  resolveG6Theme,
} from './theme.js'
import { g6DataSignature, toG6Data } from './data.js'
import {
  COMBO_LAYER_DEFAULTS,
  COMBO_LAYER_LAYOUT_ID,
  NETWORK_LAYER_BUCKETS,
  isComboLayerLayout,
} from './comboConfig.js'
import {
  GROUP_LAYER_LAYOUT_ID,
  isGroupLayerLayout,
  isGroupPanelData,
} from './groupConfig.js'
import { toGroupData } from './groupData.js'
import { GroupLayerRuntime } from './groupRuntime.js'
import {
  findRectOverlaps,
  rectFromTopLeft,
  rectsOverlap,
  separateRectRows,
  separateRects,
} from './collision.js'
import { extractSubgraph } from '../topology/transform.js'
import './comboLayerLayout.js'
import './trapezoidCombo.js'
import './groupLayerLayout.js'
import './groupPanelNode.js'
import {
  collectNeighborhood,
  createGraphIndex,
  impactSummary,
  searchGraphNodes,
  shortestPath,
  worstStatus,
} from './analysis.js'
import { EVENT_ALIASES, TOPOLOGY_EVENTS } from '../sdk/events.js'

/**
 * 自动扩展面板时预留的视觉余量（像素）。
 *
 * 闭式解算出的斜边会「刚好」切在节点渲染包围盒的角上，
 * 浮点误差、hover 光晕、标签重绘都会让这个角被判成溢出，
 * 因此在左右各多留几像素，保证面板视觉上完全包住节点。
 */
const COMBO_FIT_MARGIN = 4

/**
 * 分层 zIndex 的步长与段内偏移。
 *
 * 每层独占一个 `Z_LAYER_STEP` 宽的 z 区间：
 *
 * ```
 * 较近层 combo → +Z_EDGE_OFFSET 较近层边 → +Z_NODE_OFFSET 较近层节点
 *   → +Z_LAYER_STEP 较远层 combo → ...
 * ```
 *
 * 跨层连线取「较近层 combo + Z_EDGE_OFFSET」，于是自然落在
 * 较近层面板之上、较远层面板之下，同时仍在两端节点之下。
 */
const Z_LAYER_STEP = 100
const Z_LAYER_BASE = 100
const Z_EDGE_OFFSET = 40
const Z_NODE_OFFSET = 60

const DEFAULT_BEHAVIORS = [
  'drag-canvas',
  'zoom-canvas',
  // dropEffect 默认是 'move'，G6 会在每次 pointermove 时重算 Combo 包围盒，
  // 节点一多就会出现拖拽卡顿；这里改成 'none'，拖动结束后再统一刷新一次。
  { type: 'drag-element', dropEffect: 'none', hideEdge: 'none' },
]

function normalizeBehaviors(behaviors) {
  const list = Array.isArray(behaviors) && behaviors.length ? behaviors : DEFAULT_BEHAVIORS
  return list.map((behavior) => {
    if (behavior === 'drag-element') {
      return { type: 'drag-element', dropEffect: 'none', hideEdge: 'none' }
    }
    if (
      behavior &&
      typeof behavior === 'object' &&
      behavior.type === 'drag-element' &&
      behavior.dropEffect == null
    ) {
      return { ...behavior, dropEffect: 'none' }
    }
    return behavior
  })
}

function dataSignature(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const NODE_VISUAL_KEYS = ['name', 'type', 'status', 'kind', 'degree', 'group', 'color', 'hideLabel', 'size', 'highlight']
const EDGE_VISUAL_KEYS = ['status', 'type', 'source', 'target', 'highlight']

function visualSignature(value, keys) {
  return keys.map((key) => value?.[key] ?? '').join('|')
}

/** 解析 Combo 内边距，顺序与 CSS 一致：[上, 右, 下, 左] */
function normalizePadding(value) {
  if (Array.isArray(value)) {
    const [top = 0, right = top, bottom = top, left = right] = value
    return [Number(top) || 0, Number(right) || 0, Number(bottom) || 0, Number(left) || 0]
  }
  const all = Number(value) || 0
  return [all, all, all, all]
}

function paddingEquals(a, b) {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.5)
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function defaultPluginFlags(source = {}) {
  return {
    minimap: source.minimap !== false,
    history: source.history !== false,
    contextmenu: source.contextmenu !== false,
    watermark: Boolean(source.watermark),
    fullscreen: source.fullscreen !== false,
    hull: Boolean(source.hull),
  }
}

/**
 * G6 5 页面控制器
 *
 * 只使用 G6 的 Graph / 布局 / 交互 / 画布能力，不引用 Three.js 的任何模块。
 * 可被 Vue 组件和对外 SDK 同时复用。
 *
 * 事件：
 * 控制器会把业务事件通过 graph.emit(...) 抛到 G6 实例上，
 * 因此业务既可以订阅 `view.on(...)`，也可以订阅 `view.graph.on(...)`。
 */
export class G6TopologyGraph {
  constructor(container, options = {}) {
    if (!container) throw new Error('[g6] 缺少渲染容器')

    this.container = container
    this.callbacks = options
    this.themeName = options.theme === 'light' ? 'light' : 'dark'
    this.customTheme = options.theme && typeof options.theme === 'object' ? options.theme : null
    this.showLabels = options.showLabels !== false
    this.layoutId = options.layout || G6_DEFAULT_LAYOUT
    this.layoutOverrides = options.layoutOptions || {}
    this.styleConfig = options.style || {}
    this.behaviors = normalizeBehaviors(options.behaviors)
    this.autoFit = options.autoFit !== false
    this.animation = options.animation !== false
    // 初始化 / 重建图时不播动画：动画中间态会让 Combo 包围盒先大后小，
    // 造成层宽「先收缩再扩大」的视觉抖动。
    this._suppressAnimation = false
    // 渲染后对层 / 节点做一次真实包围盒碰撞修正
    this.resolveOverlaps = options.resolveOverlaps !== false
    this._resolvingOverlaps = false
    this._resolveStartedAt = 0
    // 2.5D 灭点（世界坐标），布局完成后根据层包围盒计算
    this._perspectiveOrigin = null
    // 首帧包围盒可能还没算好，灭点计算会延迟重试
    this._perspectiveTimer = null
    this._perspectiveAttempts = 0
    this._settleTimer = null
    this._settlePasses = 0
    // 拖拽结束后延迟执行的 Combo 防重叠修正
    this._dragResolveTimer = null
    // 拖动开始前各层的标准间距快照，松手后按它恢复均匀层距
    this._layerGapSnapshot = null
    // 拖动 + 松手修正期间持有动画关闭状态，稳定后统一恢复
    this._dragAnimationHold = false
    // 稳定布局后冻结的每层左右斜率 [left, right]。
    // 斜率 = 顶边收窄量 / 层高，拖动时保持它不变即可让底边左右内角恒定；
    // 重新布局 / relayout 时会按统一灭点重新冻结。
    this._layerSlopes = null
    this.destroying = false
    // 拖拽期间暂停高亮刷新与 Minimap 重绘，避免每帧重复计算
    this._dragging = false
    // 节点拖拽扩展：正在拖动的节点、缓存的节点块偏移、待执行的面板扩展
    this._dragNodeId = null
    this._dragConstraint = null
    this._growPending = false
    this._minimapPaused = false
    this.watermarkText = options.watermarkText || 'TOPOLOGY NEXUS'
    this.pluginFlags = defaultPluginFlags(options.plugins || options)

    this.graph = null
    // Group 分层的运行时（面板拖拽联动 / 尺寸拟合 / 层级），惰性创建
    this._groupRuntimeInstance = null
    // 右键「展开子拓扑」的会话状态：parentId -> { nodes, links, nodeIds, edgeIds }
    // 只存在于控制器内存中，不写入 payload，轮询时由 _expandedPayload() 重新合并
    this._expanded = new Map()
    // 展开前记录的层面板几何：panelId -> { base, synced, dirty }
    // 折叠回原始成员时用它精确还原，避免 syncPanel 与布局阶段尺寸口径不同造成的轻微漂移
    this._panelSnapshots = new Map()
    this.payload = null
    this.data = { nodes: [], edges: [] }
    this.signature = ''
    this.elements = new Map()
    this.edgesByNode = new Map()
    this.index = createGraphIndex(this.data)
    this.colorMode = 'status'
    this.directed = false
    this.selectedId = null
    this.hoverId = null
    this.statusFilter = null
    this.mounted = false

    // 分析态：邻域 / 路径 / 搜索结果
    this.emphasis = null // { nodes: Set, edges: Set, type, root }
    this.searchMatches = new Set()

    this._nodeSig = new Map()
    this._edgeSig = new Map()
    this._nodeVisualSig = new Map()
    this._edgeVisualSig = new Map()
    this._stateSig = new Map()

    this._applyContainerTheme()
  }

  get theme() {
    const base = resolveG6Theme(this.themeName)
    if (!this.customTheme) return base
    return {
      ...base,
      ...this.customTheme,
      status: { ...base.status, ...(this.customTheme.status || {}) },
    }
  }

  /* ------------------------------ 配置解析 ------------------------------ */

  _applyContainerTheme() {
    this.container.style.background = this._background()
  }

  _perLayoutStyle() {
    return this.styleConfig.layouts?.[this.layoutId] || {}
  }

  _layoutOptions() {
    const perLayout = this._perLayoutStyle()
    return resolveG6LayoutOptions(this.layoutId, {
      ...(this.layoutOverrides || {}),
      ...(perLayout.layoutOptions || {}),
    })
  }

  _nodeOverrides() {
    const style = this.styleConfig
    const perLayout = this._perLayoutStyle()
    return [style.node ?? style.nodeStyle, perLayout.node ?? perLayout.nodeStyle].filter(Boolean)
  }

  _edgeOverrides() {
    const style = this.styleConfig
    const perLayout = this._perLayoutStyle()
    return [style.edge ?? style.edgeStyle, perLayout.edge ?? perLayout.edgeStyle].filter(Boolean)
  }

  _background() {
    return (
      this._perLayoutStyle().background ||
      this.styleConfig.background ||
      this.theme.background
    )
  }

  _gridEnabled() {
    const perLayout = this._perLayoutStyle().grid
    if (perLayout === false) return false
    if (perLayout && typeof perLayout === 'object') return true
    return this.styleConfig.grid !== false
  }

  _gridOptions() {
    const theme = this.theme
    return {
      key: 'grid-line',
      ...buildGridPlugin(theme),
      ...(this.styleConfig.grid || {}),
      ...(this._perLayoutStyle().grid || {}),
      type: 'grid-line',
    }
  }

  _nodeOptions() {
    return buildNodeOptions(this.theme, {
      showLabels: this.showLabels,
      colorMode: this.colorMode,
      overrides: this._nodeOverrides(),
      // Group 分层：给面板节点单独一套梯形样式与自定义节点类型
      panel: this._isGroupMode()
        ? buildGroupPanelOptions(this.theme, {
            showLabels: this.showLabels,
            layoutOptions: this._layoutOptions(),
          })
        : null,
    })
  }

  _edgeOptions() {
    return buildEdgeOptions(this.theme, {
      directed: this.directed,
      overrides: this._edgeOverrides(),
    })
  }

  _isComboMode() {
    if (isComboLayerLayout(this.layoutId)) return true
    return this._perLayoutStyle().combos === true
  }

  /** 是否启用「分层 Group」：层是普通节点，不是 Combo */
  _isGroupMode() {
    return isGroupLayerLayout(this.layoutId)
  }

  /** 当前数据模式：决定 `_ingest` 生成 combos 还是 group 面板节点 */
  _dataMode() {
    if (this._isGroupMode()) return 'group'
    if (this._isComboMode()) return 'combo'
    return 'plain'
  }

  /** Group 运行时（只有 group 布局才会创建） */
  _group() {
    if (!this._isGroupMode() || !this.graph) return null
    if (!this._groupRuntimeInstance) {
      this._groupRuntimeInstance = new GroupLayerRuntime(this)
    }
    return this._groupRuntimeInstance
  }

  _comboOptions() {
    return buildComboOptions(this.theme, {
      showLabels: this.showLabels,
      layoutOptions: {
        ...this._layoutOptions(),
        // 2.5D 灭点：所有梯形侧边延长线汇聚到该点
        perspectiveOrigin: this._perspectiveOrigin || undefined,
        // 每层冻结的左右斜率：拖动时优先按它绘制，保证底边内角不变
        layerSlopes: this._layerSlopes || undefined,
        // 自定义倾角兜底：布局阶段尚未冻结时也按同一角度绘制
        trapezoidSlope: this._trapezoidSlope(),
      },
    })
  }

  _contextMenuItems(event) {
    const id = event?.target?.id ? String(event.target.id) : null
    if (!id) return []
    const data = this.elements.get(id)
    // 分组面板只是层背景，不提供节点菜单
    if (!data || isGroupPanelData(data)) return []

    const items = []
    items.push({ name: '查看详情 / Details', value: `detail:${id}` })
    items.push({ name: '聚焦节点 / Focus', value: `focus:${id}` })
    items.push({ name: '高亮上下游 / Neighbors', value: `neighbors:${id}` })

    if (data.subgraph || data.children?.length) {
      if (this._expanded.has(id)) {
        items.push({ name: '折叠子拓扑 / Collapse', value: `collapse:${id}` })
      } else {
        items.push({ name: '展开子拓扑 / Expand', value: `expand:${id}` })
      }
      items.push({ name: '下钻子拓扑 / Drill down', value: `drill:${id}` })
    }
    if (data.kind === 'group') {
      items.push({ name: '展开聚合组 / Expand group', value: `drill:${id}` })
    }
    items.push({ name: '复制 ID / Copy ID', value: `copy:${id}` })
    return items
  }

  _pluginOptions() {
    const theme = this.theme
    const plugins = []
    if (this._gridEnabled()) plugins.push(this._gridOptions())
    if (this.pluginFlags.minimap) {
      plugins.push({
        key: 'minimap',
        type: 'minimap',
        size: [168, 116],
        position: 'right-bottom',
        padding: 8,
        delay: 120,
        // 背景 / 边框交给 CSS 变量，主题切换时自动跟随，无需重建插件
        containerStyle: {
          borderRadius: '8px',
          overflow: 'hidden',
        },
        maskStyle: {
          fill: theme.edgeActive,
          fillOpacity: 0.12,
          stroke: theme.edgeActive,
          lineWidth: 1,
        },
      })
    }
    if (this.pluginFlags.history) {
      plugins.push({ key: 'history', type: 'history', stackSize: 60 })
    }
    if (this.pluginFlags.contextmenu) {
      plugins.push({
        key: 'contextmenu',
        type: 'contextmenu',
        trigger: 'contextmenu',
        // 只有节点有菜单项，避免在画布 / 边 / Combo 上弹出空白菜单
        enable: (event) => event?.targetType === 'node',
        onClick: (value) => this._handleContextAction(value),
        getItems: (event) => this._contextMenuItems(event),
      })
    }
    if (this.pluginFlags.watermark) {
      plugins.push({
        key: 'watermark',
        type: 'watermark',
        text: this.watermarkText,
        textFill: theme.nodeLabel,
        opacity: this.themeName === 'light' ? 0.08 : 0.05,
        textFontSize: 14,
      })
    }
    if (this.pluginFlags.fullscreen) {
      plugins.push({ key: 'fullscreen', type: 'fullscreen', autoFit: true })
    }
    if (this.pluginFlags.hull) {
      plugins.push({
        key: 'hull-analysis',
        type: 'hull',
        members: [...(this.emphasis?.nodes || [])],
        padding: 16,
        fill: theme.edgeActive,
        fillOpacity: 0.05,
        stroke: theme.edgeActive,
        lineWidth: 1,
        strokeOpacity: 0.4,
        corner: 'rounded',
      })
    }
    return plugins
  }

  _graphOptions() {
    return {
      container: this.container,
      autoResize: true,
      animation: this._suppressAnimation ? false : this.animation,
      // 画布本身保持透明，主题背景由 host 元素的 CSS 负责。
      // 这样深浅主题切换无需重建画布，也不会残留上一套主题的背景位图。
      background: 'transparent',
      // 画布内边距：fitView 时在四周留出余量，避免梯形侧边 / 投影贴边被裁
      padding: 16,
      data: this.data,
      layout: this._layoutOptions(),
      node: this._nodeOptions(),
      edge: this._edgeOptions(),
      combo: this._comboOptions(),
      behaviors: this.behaviors,
      plugins: this._pluginOptions(),
    }
  }

  /**
   * 在一次「重建图 / 重新布局」中临时关闭动画。
   *
   * G6 的布局动画会从旧坐标插值到新坐标，期间 Combo 包围盒反映的是
   * 中间状态；如果此时计算灭点、拟合 padding，就会先得到一个偏大或
   * 偏小的面板，动画结束后再修正，表现为层宽抖动。
   *
   * 关闭动画后所有元素直接落到最终坐标，Combo 包围盒一次到位，
   * 灭点与 padding 也只需计算一次。
   */
  /** 设置动画开关；Combo 重建 / 拖拽期间用它临时关闭过渡 */
  _setAnimationSuppressed(suppress) {
    this._suppressAnimation = Boolean(suppress)
    if (!this.graph) return
    try {
      this.graph.setOptions({ animation: this._suppressAnimation ? false : this.animation })
    } catch {
      // 图尚未初始化完成或正在销毁时没有可设置的选项
    }
  }

  async _withoutAnimation(task) {
    // Combo / Group 分层都需要按渲染包围盒拟合面板与灭点，
    // 其他布局保留原有过渡动画，避免无谓的行为变化。
    if (!this._isComboMode() && !this._isGroupMode()) return task()
    const restore = !this._suppressAnimation
    if (restore) this._setAnimationSuppressed(true)
    try {
      return await task()
    } finally {
      if (restore) this._setAnimationSuppressed(false)
    }
  }

  /** 拖拽结束且修正完成后，释放拖拽期间持有的动画关闭状态 */
  _releaseDragAnimation() {
    if (!this._dragAnimationHold) return
    this._dragAnimationHold = false
    this._setAnimationSuppressed(false)
  }

  _applyOptions() {
    if (!this.graph) return
    this.graph.setOptions({
      // 画布透明，主题背景交给 host 的 CSS
      background: 'transparent',
      node: this._nodeOptions(),
      edge: this._edgeOptions(),
      combo: this._comboOptions(),
    })
    this._updateGridPlugin()
  }

  _updateGridPlugin() {
    if (!this.graph) return
    try {
      if (this._gridEnabled()) {
        if (this.graph.getPlugins().some?.((plugin) => plugin.key === 'grid-line')) {
          this.graph.updatePlugin(this._gridOptions())
        } else {
          this.graph.setPlugins([...this.graph.getPlugins(), this._gridOptions()])
        }
      } else if (this.graph.getPlugins().some?.((plugin) => plugin.key === 'grid-line')) {
        this.graph.setPlugins(this.graph.getPlugins().filter((plugin) => plugin.key !== 'grid-line'))
      }
    } catch (error) {
      console.warn('[g6] 网格插件更新失败', error)
    }
  }

  /** 插件开关变化时整体替换插件列表（会重置历史记录） */
  setPluginFlags(flags = {}) {
    this.pluginFlags = { ...this.pluginFlags, ...flags }
    if (this.graph) {
      try {
        this.graph.setPlugins(this._pluginOptions())
      } catch (error) {
        console.warn('[g6] 插件更新失败', error)
      }
    }
    return this
  }

  getPluginFlags() {
    return { ...this.pluginFlags }
  }

  _handleContextAction(value) {
    if (!value || !this.graph) return
    const [action, id] = String(value).split(':')
    if (!action || !id) return
    const data = this.elements.get(id)
    if (action === 'focus') this.focus(id)
    else if (action === 'neighbors') this.highlightNeighbors(id, { depth: 2 })
    else if (action === 'expand') {
      // 展开 / 折叠是异步渲染，事件由方法内部在完成后发出
      this.expandNode(id).catch(() => {})
      return
    } else if (action === 'collapse') {
      this.collapseNode(id).catch(() => {})
      return
    } else if (action === 'drill') this.callbacks.onContextAction?.({ action: 'drill', id, data })
    else if (action === 'copy') {
      try {
        navigator.clipboard?.writeText(id)
      } catch {
        // 忽略剪贴板权限异常
      }
    } else if (action === 'detail') {
      this.select(id)
      this.callbacks.onContextAction?.({ action: 'detail', id, data })
    }
    this._emitCustom(TOPOLOGY_EVENTS.NODE_CONTEXT_ACTION, { action, id, data })
  }

  /**
   * 就地展开节点的子拓扑（右键「展开子拓扑」）。
   *
   * 与「下钻」的区别：父节点保留，子节点并进当前图，不替换视图。
   * 增量插入策略：
   * - 只向当前层追加节点，其他层的坐标完全不动；
   * - 子节点继承父节点的 layer / group，因此落在同一个分组面板；
   * - 空间不够时优先增加列数，保持层高不变；
   * - 面板交由 GroupLayerRuntime.syncPanel() 重新拟合。
   */
  async expandNode(id) {
    if (!this.graph || this.destroying) return false
    const key = String(id)
    if (this._expanded.has(key)) return false

    const parentData = this.elements.get(key)
    if (!parentData) return false
    if (isGroupPanelData(parentData)) return false

    const sub = extractSubgraph(
      { nodes: [parentData], meta: this.payload?.meta || {} },
      key,
    )
    if (!sub || !sub.nodes?.length) return false

    const parentNode = this.data.nodes.find((node) => String(node.id) === key)
    const isGroup = this._isGroupMode()
    const scale = Number(parentData.__groupScale ?? parentData.__comboScale) || 1

    const degree = new Map()
    for (const link of sub.links || []) {
      degree.set(String(link.source), (degree.get(String(link.source)) || 0) + 1)
      degree.set(String(link.target), (degree.get(String(link.target)) || 0) + 1)
    }

    const payloadChildren = []
    const nodeIds = []
    for (const child of sub.nodes) {
      const childId = String(child.id)
      if (this.elements.has(childId)) continue
      payloadChildren.push({
        ...child,
        id: childId,
        // 子图节点是父节点的下钻视图，统一归到父层，避免全部掉进「未分层」
        layer: parentData.layer,
        group: child.group || parentData.group,
        kind: child.kind || 'node',
        degree: degree.get(childId) || 0,
        __expandedFrom: key,
      })
      nodeIds.push(childId)
    }
    if (!payloadChildren.length) return false

    const childLinks = (sub.links || []).filter(
      (link) =>
        nodeIds.includes(String(link.source)) &&
        nodeIds.includes(String(link.target)),
    )

    const positions = this._placeExpandedChildren({
      parentId: key,
      parentData,
      children: payloadChildren,
      scale,
    })

    const graphNodes = payloadChildren.map((raw) => {
      const data = { ...raw }
      if (isGroup) {
        data.__groupId = parentData.__groupId
        data.__groupPanelId = parentData.__groupPanelId
        data.__groupScale = parentData.__groupScale
      } else if (parentData.__comboScale != null) {
        data.__comboScale = parentData.__comboScale
      }
      const node = {
        id: String(raw.id),
        data,
        style: { ...(positions.get(String(raw.id)) || {}), zIndex: 1 },
      }
      if (!isGroup && parentNode?.combo) node.combo = parentNode.combo
      return node
    })

    const graphEdges = childLinks.map((link) => ({
      id: String(link.id),
      source: String(link.source),
      target: String(link.target),
      data: { ...link, __expandedFrom: key },
    }))

    // 先记录状态再写入 G6，绘制过程中就能按新成员拟合面板
    this._expanded.set(key, {
      parentId: key,
      nodes: payloadChildren.map((node) => ({ ...node })),
      links: childLinks.map((link) => ({ ...link })),
      nodeIds,
      edgeIds: graphEdges.map((edge) => edge.id),
    })

    this.graph.addNodeData(graphNodes)
    if (graphEdges.length) this.graph.addEdgeData(graphEdges)

    this.data.nodes.push(...graphNodes)
    this.data.edges.push(...graphEdges)
    for (const node of graphNodes) this.elements.set(String(node.id), node.data)
    for (const edge of graphEdges) {
      if (!this.edgesByNode.has(edge.source)) this.edgesByNode.set(edge.source, [])
      if (!this.edgesByNode.has(edge.target)) this.edgesByNode.set(edge.target, [])
      this.edgesByNode.get(edge.source).push(edge)
      if (edge.source !== edge.target) this.edgesByNode.get(edge.target).push(edge)
    }
    this.index = createGraphIndex(this.data)
    this._syncSignatures()

    await this.graph.draw({ animation: false })

    // 只扩展父节点所在层；其他层的 x / y / size 完全不动
    const panelId = parentData.__groupPanelId
    if (panelId) {
      this._snapshotPanel(panelId)
      this._group()?.syncPanel(panelId, { draw: false })
      await this.graph.draw({ animation: false })
      this._recordSyncedPanel(panelId)
      await this._group()?.applyZOrder?.()
    }

    // 层变宽后新节点可能在视口外：只调整视角，不改任何层的世界坐标
    if (this.autoFit) await this.graph.fitView(undefined, { duration: 220 })

    this.applyStates()
    this._emitCustom(TOPOLOGY_EVENTS.NODE_CONTEXT_ACTION, {
      action: 'expand',
      id: key,
      data: parentData,
      count: payloadChildren.length,
    })
    return true
  }

  /**
   * 原地收缩节点的子拓扑（右键「折叠子拓扑」）。
   *
   * 会级联移除「子节点自己又被展开」的内容，避免留下孤儿节点。
   */
  async collapseNode(id) {
    if (!this.graph || this.destroying) return false
    const key = String(id)
    const entry = this._expanded.get(key)
    if (!entry) return false

    const nodeIds = new Set(entry.nodeIds)
    const edgeIds = new Set(entry.edgeIds)

    // 子节点可能自己也被展开过，递归收集
    let changed = true
    while (changed) {
      changed = false
      for (const [parentId, child] of [...this._expanded]) {
        if (parentId === key || !nodeIds.has(parentId)) continue
        child.nodeIds.forEach((nodeId) => nodeIds.add(nodeId))
        child.edgeIds.forEach((edgeId) => edgeIds.add(edgeId))
        this._expanded.delete(parentId)
        changed = true
      }
    }
    this._expanded.delete(key)

    const parentData = this.elements.get(key)
    const panelId = parentData?.__groupPanelId

    this.graph.removeEdgeData([...edgeIds])
    this.graph.removeNodeData([...nodeIds])

    this.data = {
      ...this.data,
      nodes: this.data.nodes.filter((node) => !nodeIds.has(String(node.id))),
      edges: this.data.edges.filter((edge) => {
        const id = String(edge.id)
        return (
          !edgeIds.has(id) &&
          !nodeIds.has(String(edge.source)) &&
          !nodeIds.has(String(edge.target))
        )
      }),
    }
    for (const nodeId of nodeIds) this.elements.delete(nodeId)
    this.edgesByNode = new Map()
    for (const edge of this.data.edges) {
      if (!this.edgesByNode.has(edge.source)) this.edgesByNode.set(edge.source, [])
      if (!this.edgesByNode.has(edge.target)) this.edgesByNode.set(edge.target, [])
      this.edgesByNode.get(edge.source).push(edge)
      if (edge.source !== edge.target) this.edgesByNode.get(edge.target).push(edge)
    }
    this.index = createGraphIndex(this.data)
    this._syncSignatures()

    await this.graph.draw({ animation: false })

    if (panelId) {
      const snapshot = this._panelSnapshots.get(panelId)
      const stillExpanded = [...this._expanded.values()].some(
        (item) => this.elements.get(item.parentId)?.__groupPanelId === panelId,
      )
      // 该层已回到原始成员、且期间没有被手动拖动：直接还原展开前的几何
      if (!stillExpanded && snapshot?.base && !snapshot.dirty) {
        this._restorePanel(panelId, snapshot.base)
        this._panelSnapshots.delete(panelId)
      } else {
        this._group()?.syncPanel(panelId, { draw: false })
      }
      await this.graph.draw({ animation: false })
      await this._group()?.applyZOrder?.()
    }

    if (this.autoFit) await this.graph.fitView(undefined, { duration: 220 })

    this.applyStates()
    this._emitCustom(TOPOLOGY_EVENTS.NODE_CONTEXT_ACTION, {
      action: 'collapse',
      id: key,
      data: parentData || null,
      count: nodeIds.size,
    })
    return true
  }

  /** 第一次展开某层时，记录面板的原始几何 */
  _snapshotPanel(panelId) {
    if (this._panelSnapshots.has(panelId)) return
    const runtime = this._group()
    const panel = runtime?.panelById(panelId)
    if (!panel) return
    let position = [0, 0]
    try {
      position = this.graph.getElementPosition(panelId) || position
    } catch {
      // 元素可能尚未渲染
    }
    const size = Array.isArray(panel.style?.size) ? [...panel.style.size] : [0, 0]
    const sideSlopes = Array.isArray(panel.style?.sideSlopes)
      ? [...panel.style.sideSlopes]
      : undefined
    this._panelSnapshots.set(panelId, {
      base: { x: position[0], y: position[1], size, sideSlopes },
      synced: null,
      // 用户手动拖过面板 / 层内节点后，不再盲目还原，交给 syncPanel 重新拟合
      dirty: false,
    })
  }

  /** 记录本次展开拟合后的几何，用于判断层是否仍在展开状态 */
  _recordSyncedPanel(panelId) {
    const snapshot = this._panelSnapshots.get(panelId)
    if (!snapshot) return
    const panel = this._group()?.panelById(panelId)
    if (!panel) return
    let position = [0, 0]
    try {
      position = this.graph.getElementPosition(panelId) || position
    } catch {
      return
    }
    snapshot.synced = {
      x: position[0],
      y: position[1],
      size: Array.isArray(panel.style?.size) ? [...panel.style.size] : [0, 0],
    }
  }

  /** 折叠回原始成员后，把面板恢复到展开前的几何 */
  _restorePanel(panelId, base) {
    if (!base) return false
    const panel = this._group()?.panelById(panelId)
    if (!panel) return false
    const style = { x: base.x, y: base.y, size: [...base.size] }
    if (Array.isArray(base.sideSlopes)) {
      style.sideSlopes = [...base.sideSlopes]
      panel.data = { ...(panel.data || {}), __groupSlopes: [...base.sideSlopes] }
    }
    panel.style = { ...(panel.style || {}), ...style }
    this.graph.updateNodeData([{ id: panelId, style }])
    return true
  }

  /** 面板被用户拖动过：标记脏，折叠时不再还原快照 */
  _notePanelEdited(panelId) {
    if (!panelId) return
    const snapshot = this._panelSnapshots.get(String(panelId))
    if (snapshot) snapshot.dirty = true
  }

  /**
   * 为展开的子节点选择局部位置。
   *
   * 规则：
   * - 从父节点右侧开始，按网格向右 / 向下铺开；
   * - 只和**同一层**已有节点做避让，不移动任何老节点；
   * - 纵向空间按到下一层的距离计算，空间不够优先增加列数，保持层高。
   */
  _placeExpandedChildren({ parentId, parentData, children, scale }) {
    const positions = new Map()
    const parentRect = this._renderRectOf(parentId)
    if (!parentRect) return positions

    const sizes = children.map((data) => this._expandedBlockSize(data, scale))
    const maxWidth = Math.max(1, ...sizes.map((size) => size.width))
    const maxHeight = Math.max(1, ...sizes.map((size) => size.height))
    const cellWidth = maxWidth + 40
    const cellHeight = maxHeight + 22

    const panelId = parentData.__groupPanelId || null
    const occupied = []
    let layerRight = parentRect.right
    for (const node of this.graph.getData().nodes || []) {
      if (String(node.id) === parentId) continue
      if (panelId && String(node.data?.__groupPanelId || '') !== String(panelId)) continue
      const rect = this._renderRectOf(node.id)
      if (!rect) continue
      occupied.push(rect)
      layerRight = Math.max(layerRight, rect.right)
    }

    // 从「该层最右侧」之外开始排，保证不压住已有节点，也不必把老节点往下挤
    const maxRows = this._availableRows(parentRect, panelId, cellHeight)
    const cols = Math.max(1, Math.min(6, Math.ceil(children.length / maxRows)))
    const anchorX = layerRight + 26 + cellWidth / 2
    const anchorY = parentRect.top + parentRect.height / 2

    children.forEach((data, index) => {
      const nodeId = String(data.id)
      const size = sizes[index]
      const col = index % cols
      let x = anchorX + col * cellWidth
      let y = anchorY + Math.floor(index / cols) * cellHeight
      let rect = rectFromTopLeft(
        nodeId,
        x - size.width / 2,
        y - size.height / 2,
        size.width,
        size.height,
      )

      // 兜底避让：估计尺寸与真实渲染有误差时，向下顺延
      let guard = 0
      while (occupied.some((item) => rectsOverlap(item, rect, 6)) && guard < 80) {
        guard += 1
        y += cellHeight * 0.6
        rect = rectFromTopLeft(
          nodeId,
          x - size.width / 2,
          y - size.height / 2,
          size.width,
          size.height,
        )
      }

      occupied.push(rect)
      positions.set(nodeId, { x, y })
    })

    return positions
  }

  /** 估算展开子节点的渲染块尺寸（节点本体 + 下方标签） */
  _expandedBlockSize(data, scale) {
    const raw = g6NodeSize(data)
    const base = Array.isArray(raw) ? raw : [raw, raw]
    const nodeWidth = (Number(base[0]) || 24) * scale
    const nodeHeight = (Number(base[1]) || 24) * scale
    const show = data.hideLabel !== true
    const font = (data.kind === 'rack' ? 11 : 10.5) * scale
    const text = String(data.name || data.id || '')
    let units = 0
    for (const char of text) {
      if (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) units += 1
      else if (char === ' ') units += 0.32
      else units += 0.56
    }
    const labelWidth = show ? Math.min(280, units * font + 14) : 0
    const labelHeight = show ? font * 1.25 + 2 + 7 * scale : 0
    return {
      width: Math.max(nodeWidth, labelWidth),
      height: nodeHeight + labelHeight,
    }
  }

  /** 当前层向下可用多少行，避免因为子节点太多把层高撑到下一层 */
  _availableRows(parentRect, panelId, cellHeight) {
    if (!panelId) return 4
    const runtime = this._group()
    const panel = runtime?.panelById(panelId)
    const rect = panel ? runtime.panelRect(panel) : null
    if (!rect) return 4

    const next = (runtime.panels() || [])
      .filter((item) => String(item.id) !== String(panelId))
      .map((item) => runtime.panelRect(item))
      .filter((item) => item && item.top > rect.top + 1)
      .sort((a, b) => a.top - b.top)[0]

    if (!next) return 4
    // 层面板底部 = 成员包围盒底部 + 下内边距；预留这一块再去算能放几行
    const padBottom = runtime._basePadding()[2]
    const spare =
      next.top - runtime._minLayerGap() - (parentRect.bottom + padBottom)
    if (spare <= 0) return 1
    return Math.max(1, Math.min(4, 1 + Math.floor(spare / cellHeight)))
  }

  /** 分层归并规则：目前网络场景归并为「核心 / 汇聚 / 接入」三层 */
  _layerBuckets(payload) {
    return payload?.meta?.scene === 'network' ? NETWORK_LAYER_BUCKETS : undefined
  }

  /**
   * 把「右键展开」的子拓扑合并回原始 payload。
   *
   * 只在数据层做合并，不碰渲染：
   * - 子节点已经继承父节点的 `layer / group`，会被 Group 布局自然归到同一层；
   * - 轮询调用 `_ingest()` 时重新合并，展开状态不会因为刷新丢失；
   * - 父节点已从 payload 消失时跳过该条展开记录，避免产生孤儿节点。
   */
  _expandedPayload(payload) {
    if (!this._expanded.size || !payload?.nodes) return payload
    const nodes = [...payload.nodes]
    const links = [...(payload.links || [])]
    const nodeIds = new Set(nodes.map((node) => String(node.id)))
    const linkIds = new Set(links.map((link) => String(link.id)))

    for (const [parentId, entry] of this._expanded) {
      if (!nodeIds.has(String(parentId))) continue
      for (const node of entry.nodes) {
        const id = String(node.id)
        if (nodeIds.has(id)) continue
        nodeIds.add(id)
        nodes.push(node)
      }
      for (const link of entry.links) {
        const id = String(link.id)
        if (linkIds.has(id)) continue
        linkIds.add(id)
        links.push(link)
      }
    }
    return { ...payload, nodes, links }
  }

  _ingest(payload) {
    this.payload = payload
    // 展开的子图先并回数据，再按当前模式生成 G6 数据
    const source = this._expandedPayload(payload)
    const mode = this._dataMode()
    if (mode === 'group') {
      // Group 版：不生成 Combo，层编译成普通「面板节点」
      this.data = toGroupData(source, {
        ...this._layoutOptions(),
        layerBuckets: this._layerBuckets(payload),
      })
    } else {
      this.data = toG6Data(source, {
        combos: mode === 'combo',
        // 只有自研分层布局才启用 2.5D 透视缩放；其他布局即使生成 Combo 也保持 1:1
        comboOptions: isComboLayerLayout(this.layoutId)
          ? { ...this._layoutOptions(), layerBuckets: this._layerBuckets(payload) }
          : { perspective: false },
      })
    }
    this.signature = g6DataSignature(this.data)
    this.elements = new Map(this.data.nodes.map((node) => [node.id, node.data]))
    this.edgesByNode = new Map()
    for (const edge of this.data.edges) {
      if (!this.edgesByNode.has(edge.source)) this.edgesByNode.set(edge.source, [])
      if (!this.edgesByNode.has(edge.target)) this.edgesByNode.set(edge.target, [])
      this.edgesByNode.get(edge.source).push(edge)
      if (edge.source !== edge.target) this.edgesByNode.get(edge.target).push(edge)
    }
    this.index = createGraphIndex(this.data)
    this.colorMode = payload?.meta?.colorMode === 'group' ? 'group' : 'status'
    this.directed = payload?.meta?.directed === true || payload?.meta?.scene === 'graph'
    this._syncSignatures()
    this._pruneEmphasis()
  }

  _syncSignatures() {
    this._nodeSig = new Map(this.data.nodes.map((node) => [node.id, dataSignature(node.data)]))
    this._edgeSig = new Map(this.data.edges.map((edge) => [edge.id, dataSignature(edge.data)]))
    this._nodeVisualSig = new Map(
      this.data.nodes.map((node) => [node.id, visualSignature(node.data, NODE_VISUAL_KEYS)]),
    )
    this._edgeVisualSig = new Map(
      this.data.edges.map((edge) => [edge.id, visualSignature(edge.data, EDGE_VISUAL_KEYS)]),
    )
  }

  _pruneEmphasis() {
    if (this.emphasis) {
      const nodes = new Set([...this.emphasis.nodes].filter((id) => this.elements.has(id)))
      const edges = new Set([...this.emphasis.edges].filter((id) => this.index.edgesById.has(id)))
      this.emphasis = nodes.size ? { ...this.emphasis, nodes, edges } : null
    }
    if (this.searchMatches.size) {
      this.searchMatches = new Set([...this.searchMatches].filter((id) => this.elements.has(id)))
    }
  }

  /* ------------------------------ 自定义事件 ------------------------------ */

  _emitCustom(name, payload) {
    if (!this.graph) return
    this.graph.emit(name, payload)
    this.callbacks.onEvent?.(name, payload)
    for (const alias of EVENT_ALIASES[name] || []) {
      this.graph.emit(alias, payload)
      this.callbacks.onEvent?.(alias, payload)
    }
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  async mount(payload, config = {}) {
    if (config.theme) this._setThemeValue(config.theme)
    if (config.layout) this.layoutId = config.layout
    if (config.layoutOptions) this.layoutOverrides = config.layoutOptions
    if (config.showLabels != null) this.showLabels = config.showLabels !== false
    if (config.behaviors) this.behaviors = normalizeBehaviors(config.behaviors)
    if (config.autoFit != null) this.autoFit = config.autoFit !== false
    if (config.animation != null) this.animation = config.animation !== false
    if (config.resolveOverlaps != null) this.resolveOverlaps = config.resolveOverlaps !== false
    if (config.style) this.styleConfig = config.style
    if (config.plugins) this.pluginFlags = { ...this.pluginFlags, ...defaultPluginFlags(config.plugins) }
    if (config.watermarkText) this.watermarkText = config.watermarkText

    this._ingest(payload)
    this._applyContainerTheme()

    // 首次挂载时容器保持隐藏：等灭点、padding 与碰撞修正全部稳定后再显示，
    // 避免用户看到中间态的层宽（先收缩再扩大）。
    const previousVisibility = this.container.style.visibility
    this.container.style.visibility = 'hidden'

    try {
      await this._withoutAnimation(async () => {
        this.graph = new Graph(this._graphOptions())
        this._bindEvents()

        await this.graph.render()
        this.mounted = true
        // 布局态：先按统一灭点绘制，再在末尾冻结每层斜率
        this._resetLayerSlopes()
        await this._syncPerspectiveOrigin()
        this._bindHistory()
        await this._resolveRenderedOverlaps()
        await this._freezeLayerSlopes()
        if (this.autoFit) await this.graph.fitView(undefined, { duration: 180 })
        this.applyStates()
        // 层级必须在节点 / 层完全稳定后再定，跨层连线才能正确夹在两层之间
        await this._applyStackZOrder()
        // 等最终一帧画完再解除隐藏，保证显示出来就是稳定状态
        await this._waitFrames(1)
      })
    } finally {
      this.container.style.visibility = previousVisibility
    }

    this._emitCustom(TOPOLOGY_EVENTS.RENDER_COMPLETE, {
      nodes: this.data.nodes.length,
      edges: this.data.edges.length,
      layout: this.layoutId,
    })
    return this
  }

  async setData(payload, { relayout = false } = {}) {
    if (!this.graph) return this.mount(payload)

    const previousSignature = this.signature
    const previousColorMode = this.colorMode
    const previousDirected = this.directed

    // 先按元素级别计算差异，轮询时只有真正变化的数据才会重绘
    const previousNodes = new Map(this._nodeSig)
    const previousEdges = new Map(this._edgeSig)
    const previousNodeVisual = new Map(this._nodeVisualSig)
    const previousEdgeVisual = new Map(this._edgeVisualSig)
    this._ingest(payload)

    if (this.signature !== previousSignature || relayout) {
      // 全量重渲染会重新走布局，旧的展开几何快照不再可信
      this._panelSnapshots.clear()
      await this._withoutAnimation(async () => {
        this._resetLayerSlopes()
        this._applyOptions()
        this.graph.setData(this.data)
        await this.graph.render()
        await this._syncPerspectiveOrigin()
        await this._resolveRenderedOverlaps()
        await this._freezeLayerSlopes()
        if (this.autoFit) await this.graph.fitView(undefined, { duration: 220 })
        this._stateSig.clear()
      })
    } else {
      const changedNodes = this.data.nodes.filter(
        (node) => previousNodes.get(node.id) !== this._nodeSig.get(node.id),
      )
      const changedEdges = this.data.edges.filter(
        (edge) => previousEdges.get(edge.id) !== this._edgeSig.get(edge.id),
      )

      if (!changedNodes.length && !changedEdges.length) {
        // 数据没有变化时完全跳过渲染，避免轮询造成的周期性卡顿
        return
      }

      // 只有影响视觉的字段变化才重绘；仅指标变化时只更新数据，不触发整图渲染
      const nodesNeedDraw = changedNodes.some(
        (node) => previousNodeVisual.get(node.id) !== this._nodeVisualSig.get(node.id),
      )
      const edgesNeedDraw = changedEdges.some(
        (edge) => previousEdgeVisual.get(edge.id) !== this._edgeVisualSig.get(edge.id),
      )

      if (changedNodes.length) this.graph.updateNodeData(changedNodes)
      if (changedEdges.length) this.graph.updateEdgeData(changedEdges)
      if (previousColorMode !== this.colorMode || previousDirected !== this.directed) {
        this._applyOptions()
      }
      if (nodesNeedDraw || edgesNeedDraw) await this.graph.draw()
    }

    this.applyStates()
    // 增量更新也可能新增 / 删除节点与连线，层级需要重新对齐
    await this._applyStackZOrder()
    this._emitCustom(TOPOLOGY_EVENTS.DATA_UPDATE, {
      nodes: this.data.nodes.length,
      edges: this.data.edges.length,
      signature: this.signature,
    })
  }

  async setLayout(id, options) {
    if (!id) return
    const sameLayout = id === this.layoutId
    if (sameLayout && !options) return

    const previousDataMode = this._dataMode()
    this.layoutId = id
    if (options && typeof options === 'object') this.layoutOverrides = options
    if (!this.graph) return

    this.graph.stopLayout?.()

    await this._withoutAnimation(async () => {
      this._resetLayerSlopes()
      this._applyOptions()

      const nextDataMode = this._dataMode()
      if (previousDataMode !== nextDataMode && this.payload) {
        // 在「普通 / Combo / Group」三种数据形态之间切换时，
        // 需要重新生成数据（combos 或面板节点），不能只调 layout
        this._ingest(this.payload)
        this.graph.setData(this.data)
        this._stateSig.clear()
        await this.graph.render()
        await this._syncPerspectiveOrigin()
      } else {
        await this.graph.layout(this._layoutOptions())
        await this._syncPerspectiveOrigin()
      }

      await this._resolveRenderedOverlaps()
      await this._freezeLayerSlopes()
      if (this.autoFit) await this.graph.fitView(undefined, { duration: 260 })
      this.applyStates()
      await this._applyStackZOrder()
    })
    this._emitCustom(TOPOLOGY_EVENTS.LAYOUT_CHANGE, {
      layout: this.layoutId,
      options: this._layoutOptions(),
    })
  }

  /**
   * 更新当前布局参数并重新布局。
   *
   * 与 setLayout 的区别：setLayout 在 Combo 模式不变时只调用 graph.layout()，
   * 不会重新生成数据里的 __comboScale / data.scale；而 2.5D 开关需要
   * 重新计算节点缩放、层面板样式并整图渲染，否则视觉不会变化。
   */
  async setLayoutOptions(options) {
    if (options && typeof options === 'object') this.layoutOverrides = options
    if (!this.graph || !this.payload) return

    this.graph.stopLayout?.()

    await this._withoutAnimation(async () => {
      this._resetLayerSlopes()
      this._ingest(this.payload)
      this._applyOptions()
      // 先同步布局配置，否则 render() 会继续使用挂载时的旧参数
      this.graph.setLayout?.(this._layoutOptions())
      this.graph.setData(this.data)
      this._stateSig.clear()
      await this.graph.render()
      await this._syncPerspectiveOrigin()
      await this._resolveRenderedOverlaps()
      await this._freezeLayerSlopes()
      if (this.autoFit) await this.graph.fitView(undefined, { duration: 240 })
      this.applyStates()
      await this._applyStackZOrder()
    })
    this._emitCustom(TOPOLOGY_EVENTS.LAYOUT_CHANGE, {
      layout: this.layoutId,
      options: this._layoutOptions(),
      reason: 'options',
    })
  }

  /**
   * 重新整理当前布局。
   * 拖动 Combo 面板或节点后，可用它恢复分层 / 布局的默认位置。
   */
  async relayout() {
    if (!this.graph) return
    // 重新布局会重算面板几何，旧快照失效
    this._panelSnapshots.clear()
    this.graph.stopLayout?.()
    await this._withoutAnimation(async () => {
      this._resetLayerSlopes()
      await this.graph.layout(this._layoutOptions())
      await this._syncPerspectiveOrigin()
      await this._resolveRenderedOverlaps()
      await this._freezeLayerSlopes()
      if (this.autoFit) await this.graph.fitView(undefined, { duration: 260 })
      this.applyStates()
      await this._applyStackZOrder()
    })
    this._emitCustom(TOPOLOGY_EVENTS.LAYOUT_CHANGE, {
      layout: this.layoutId,
      options: this._layoutOptions(),
      reason: 'relayout',
    })
  }

  /**
   * 等待若干帧，让 G6 完成坐标写入、Combo 包围盒重算与画布重绘。
   *
   * Combo 的位置和尺寸由子元素推导，`translateElementBy` 之后需要等
   * 至少一帧才能读到正确的渲染包围盒；否则碰撞修正会在旧坐标上反复计算。
   * 同时用定时器兜底，避免后台标签页里 requestAnimationFrame 被暂停而卡死。
   */
  _waitFrames(count = 2, fallbackMs = 120) {
    return new Promise((resolve) => {
      let remaining = Math.max(1, count)
      let finished = false
      let timer = null
      const finish = () => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        resolve()
      }
      const tick = () => {
        remaining -= 1
        if (remaining <= 0) finish()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      timer = setTimeout(finish, fallbackMs)
    })
  }

  /**
   * 元素的稳定包围盒（世界坐标，只含 key + label，不含投影与 hover halo）。
   *
   * `graph.getElementRenderBounds()` 会把 `shadowBlur` 也算进去：
   * 节点 hover 时 shadowBlur 变大，同一个节点测出来的尺寸会突然大几十像素，
   * 面板就会随鼠标移入移出忽大忽小。这里改取各 shape 的 `getBounds()`，
   * 结果只跟节点位置有关，拖动 / 拟合过程中保持稳定。
   */
  _stableBoundsOf(id) {
    const element = this.graph?.context?.element?.getElement?.(id)
    const shapes = element
      ? ['key', 'label'].map((name) => element.getShape?.(name)).filter(Boolean)
      : []
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const shape of shapes) {
      const bounds = typeof shape.getBounds === 'function' ? shape.getBounds() : null
      if (!bounds?.min || !bounds?.max) continue
      left = Math.min(left, bounds.min[0])
      right = Math.max(right, bounds.max[0])
      top = Math.min(top, bounds.min[1])
      bottom = Math.max(bottom, bounds.max[1])
    }
    if (Number.isFinite(left) && Number.isFinite(top)) {
      return { min: [left, top], max: [right, bottom] }
    }
    // 极端情况下（shape 还没渲染完）退回渲染包围盒
    return this.graph?.getElementRenderBounds?.(id) || null
  }

  /** 读取节点稳定包围盒（本体 + 标签），转换为左上角矩形 */
  _renderRectOf(id) {
    const bounds = this._stableBoundsOf(id)
    if (!bounds?.min || !bounds?.max) return null
    return rectFromTopLeft(
      String(id),
      bounds.min[0],
      bounds.min[1],
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
    )
  }

  /**
   * Combo 的「几何矩形」：位置 + keyShape 尺寸，不含阴影、标签等渲染扩展。
   *
   * 2.5D 梯形顶边会向灭点方向平移，用渲染包围盒判断层重叠会把
   * 「不可见的梯形外扩」也算进去，导致碰撞修正平移层、破坏节点的梯形分布。
   * 因此层之间只用几何矩形做碰撞判断，节点则用 `_stableBoundsOf` 的稳定包围盒。
   */
  _comboRectOf(id) {
    const element = this.graph?.context?.element?.getElement?.(id)
    if (!element) return null
    const position =
      typeof element.getPosition === 'function'
        ? element.getPosition()
        : [element.attributes?.x, element.attributes?.y]
    const size =
      typeof element.getKeySize === 'function'
        ? element.getKeySize(element.attributes)
        : element.attributes?.size
    if (!position || !size) return null
    const width = Array.isArray(size) ? Number(size[0]) : Number(size)
    const height = Array.isArray(size) ? Number(size[1]) : Number(size)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    return rectFromTopLeft(
      String(id),
      Number(position[0]) - width / 2,
      Number(position[1]) - height / 2,
      width,
      height,
    )
  }

  /** 批量应用矩形分离偏移，返回实际移动的元素数量 */
  async _applyRectShifts(rects, shifts) {
    const offsets = {}
    for (const rect of rects) {
      const shift = shifts.get(rect.id)
      if (!shift) continue
      const dx = Number(shift.dx) || 0
      const dy = Number(shift.dy) || 0
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) offsets[rect.id] = [dx, dy]
    }
    const ids = Object.keys(offsets)
    if (!ids.length) return 0
    await this.graph.translateElementBy(offsets, false)
    return ids.length
  }

  /** 碰撞修正是否异常卡住（例如后台标签页 rAF 暂停导致 draw 不返回） */
  _isResolveStuck(maxMs = 5000) {
    if (!this._resolvingOverlaps) return false
    if (!this._resolveStartedAt) return true
    if (Date.now() - this._resolveStartedAt <= maxMs) return false
    this._resolvingOverlaps = false
    this._resolveStartedAt = 0
    return true
  }

  /**
   * 强制 G6 按最新子元素重算 Combo 包围盒。
   *
   * G6 5 只在 `draw()` 时处理 `ComboUpdated` 变更并重算 Combo 尺寸，
   * 但 `draw()` 内部会等待渲染动画；在后台标签页里 rAF 可能被暂停，
   * 因此这里加超时兜底，避免碰撞修正一直卡在等待中。
   */
  async _drawCombos(timeout = 800) {
    if (!this.graph) return
    try {
      // translateElementBy 只移动元素本身，不会把 Combo 标记为「已更新」，
      // 因此 draw() 不会按新的子元素包围盒重算面板尺寸。
      // 这里先主动刷新层的 ComboUpdated 变更，再 draw()。
      const model = this.graph.context?.model
      if (model?.refreshComboData) {
        const combos = this.graph.getData().combos || []
        for (const combo of combos) model.refreshComboData(combo.id)
      }
      await Promise.race([
        this.graph.draw(),
        new Promise((resolve) => setTimeout(resolve, timeout)),
      ])
    } catch {
      // 绘制失败时继续用现有包围盒兜底
    }
  }

  /**
   * 根据当前层包围盒计算 2.5D 灭点（纯计算，不改变图的状态）。
   *
   * 灭点位于整体水平中心、最上层上方「总高度 × vanishingDistance」处。
   * @returns {[number, number] | null} 计算不出时返回 null
   */
  _computePerspectiveOrigin(layoutOptions = this._layoutOptions()) {
    if (!this.graph) return null
    const data = this.graph.getData()
    // Combo 版取层 Combo，Group 版取面板节点；两者都用几何矩形而非渲染包围盒
    const layers = this._isGroupMode()
      ? (data.nodes || []).filter((node) => isGroupPanelData(node.data))
      : (data.combos || []).filter((combo) => combo.data?.kind === 'layer')
    if (!layers.length) return null

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const combo of layers) {
      // 用元素自身的位置与 keyShape 尺寸计算，而不是渲染包围盒：
      // 渲染包围盒包含阴影（shadowBlur / shadowOffsetY）和描边，
      // 会让灭点整体下移几像素，导致斜边延长线无法精确交汇。
      const element = this.graph.context?.element?.getElement?.(combo.id)
      let x = NaN
      let y = NaN
      let width = NaN
      let height = NaN
      if (element && typeof element.getKeySize === 'function') {
        const position =
          typeof element.getPosition === 'function'
            ? element.getPosition()
            : [element.attributes?.x, element.attributes?.y]
        const size = element.getKeySize(element.attributes)
        if (position && size) {
          x = Number(position[0])
          y = Number(position[1])
          width = Number(size[0])
          height = Number(size[1])
        }
      }
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        const bounds = this.graph.getElementRenderBounds(combo.id)
        if (!bounds?.min || !bounds?.max) continue
        x = (bounds.min[0] + bounds.max[0]) / 2
        y = (bounds.min[1] + bounds.max[1]) / 2
        width = bounds.max[0] - bounds.min[0]
        height = bounds.max[1] - bounds.min[1]
      }
      minX = Math.min(minX, x - width / 2)
      maxX = Math.max(maxX, x + width / 2)
      minY = Math.min(minY, y - height / 2)
      maxY = Math.max(maxY, y + height / 2)
    }
    // 首帧 Combo 还没完成绘制时包围盒不可用
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

    const height = Math.max(1, maxY - minY)
    const ratio = Number(
      layoutOptions.vanishingDistance ?? COMBO_LAYER_DEFAULTS.vanishingDistance,
    )
    return [(minX + maxX) / 2, minY - height * Math.max(0, ratio)]
  }

  /**
   * 根据当前层包围盒计算 2.5D 灭点，并重新应用 Combo 样式。
   *
   * 所有层的梯形收窄量都按「底边端点 → 灭点」的连线计算，
   * 因此所有梯形的侧边延长线都汇聚到同一个点。
   *
   * 灭点只在布局 / 数据变化后重算；拖动节点或面板时保持不变，
   * 保证拖动过程中梯形始终朝同一个中心点收拢。
   */
  async _syncPerspectiveOrigin(attempt = 0) {
    if (
      !this.graph ||
      this.destroying ||
      (!this._isComboMode() && !this._isGroupMode())
    ) {
      this._perspectiveOrigin = null
      return
    }
    const layoutOptions = this._layoutOptions()
    if (layoutOptions.perspective === false) {
      this._perspectiveOrigin = null
      return
    }

    const origin = this._computePerspectiveOrigin(layoutOptions)
    if (!origin) {
      this._schedulePerspectiveSync(attempt)
      return
    }

    this._perspectiveAttempts = 0

    const previous = this._perspectiveOrigin
    const sameOrigin =
      previous &&
      Math.abs(previous[0] - origin[0]) < 0.5 &&
      Math.abs(previous[1] - origin[1]) < 0.5
    // 有冻结斜率时形状由斜率决定，灭点没变就不用重绘；
    // 没有冻结斜率说明正处于布局态，需要重新应用样式，把旧的冻结属性清掉。
    if (sameOrigin && this._layerSlopes) return

    this._perspectiveOrigin = origin
    this._applyOptions()
    await this._drawCombos()
  }

  /** 首帧 Combo 包围盒尚未就绪时，延迟重试计算灭点 */
  _schedulePerspectiveSync(attempt = 0) {
    if (this.destroying || attempt >= 20) return
    if (this._perspectiveTimer) clearTimeout(this._perspectiveTimer)
    const delay = attempt === 0 ? 80 : 150
    this._perspectiveTimer = setTimeout(() => {
      this._perspectiveTimer = null
      if (!this.graph || this.destroying) return
      this._syncPerspectiveOrigin(attempt + 1).catch(() => {})
    }, delay)
  }

  /**
   * 清空冻结斜率，回到「按统一灭点绘制」的布局态。
   *
   * 重新布局 / relayout / 切换 2.5D 时调用：
   * 布局阶段先用灭点公式把梯形摆到统一透视，稳定后再冻结每层斜率。
   */
  _resetLayerSlopes() {
    this._layerSlopes = null
  }

  /**
   * 把自定义梯形倾角换算成「收窄量 / 层高」斜率。
   *
   * `trapezoidAngle` 定义为侧边相对竖直方向的夹角（度）：
   * - 0° 时斜率为 0，梯形退化为矩形；
   * - 角度越大，侧边越斜；
   * - 左右两侧共用同一个斜率，因此左下 / 右下内角完全一致。
   *
   * 显式传入 `null` 时返回 null，回退到统一灭点模式。
   */
  _trapezoidSlope() {
    const options = this._layoutOptions()
    if (options.perspective === false) return null
    const raw = options.trapezoidAngle
    if (raw === null || raw === false) return null
    const angle = Number(raw ?? COMBO_LAYER_DEFAULTS.trapezoidAngle)
    if (!Number.isFinite(angle)) return null
    // 限制在 45° 以内，避免极端角度下顶边翻转
    const clamped = Math.min(44.9, Math.max(0, angle))
    return Math.tan((clamped * Math.PI) / 180)
  }

  /**
   * 取某层当前应使用的左右斜率。
   *
   * 拖动 / 稳定后优先使用冻结斜率；布局阶段则直接用自定义倾角兜底，
   * 保证布局、padding 拟合、拖拽三个阶段使用同一套角度。
   */
  _slopesForLayer(id) {
    const frozen = this._layerSlopes?.[id]
    if (Array.isArray(frozen) && frozen.length === 2) return frozen
    const slope = this._trapezoidSlope()
    return slope == null ? null : [slope, slope]
  }

  /** 比较两组冻结斜率是否一致（用于避免无意义的重绘） */
  _slopesEqual(previous, next) {
    if (!previous || !next) return false
    const previousIds = Object.keys(previous)
    if (previousIds.length !== Object.keys(next).length) return false
    for (const id of previousIds) {
      const a = previous[id]
      const b = next[id]
      if (!a || !b) return false
      if (
        Math.abs(Number(a[0]) - Number(b[0])) > 0.0005 ||
        Math.abs(Number(a[1]) - Number(b[1])) > 0.0005
      ) {
        return false
      }
    }
    return true
  }

  /**
   * 记录每层梯形的左右斜率。
   *
   * 梯形底边为完整宽度，顶边左右各收窄 `inset = slope × 高度`，
   * 因此「收窄量 / 高度」就是底边内角的正切值。
   *
   * 默认使用自定义倾角：左右斜率相同，所有层角度一致。
   * `trapezoidAngle` 为 `null` 时回退为统一灭点模式（左、右斜率可能不同）。
   * 冻结后拖动节点 / 层时保持不变，无论层怎么平移、变宽、变高，内角都不会变化。
   *
   * @param {[number, number]} [origin] 当前灭点，默认取控制器缓存的灭点
   * @returns {boolean} 斜率是否发生变化（需要重新应用样式）
   */
  _captureLayerSlopes(origin = this._perspectiveOrigin) {
    if (!this.graph || !this._isComboMode()) return false
    const layoutOptions = this._layoutOptions()
    if (layoutOptions.perspective === false) {
      if (!this._layerSlopes) return false
      this._layerSlopes = null
      return true
    }

    const next = {}
    let captured = 0
    const combos = (this.graph.getData().combos || []).filter(
      (combo) => combo.data?.kind === 'layer',
    )
    const angleSlope = this._trapezoidSlope()
    if (angleSlope != null) {
      // 自定义倾角：左右完全对称，不依赖灭点和层宽高
      for (const combo of combos) {
        next[combo.id] = [angleSlope, angleSlope]
        captured += 1
      }
    } else {
      // 兜底：按统一灭点计算左右斜率
      if (!Array.isArray(origin) || origin.length !== 2) return false
      const originX = Number(origin[0])
      const originY = Number(origin[1])
      if (!Number.isFinite(originX) || !Number.isFinite(originY)) return false
      for (const combo of combos) {
        const rect = this._comboRectOf(combo.id)
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue
        const distance = rect.bottom - originY
        // 灭点必须在层底边上方，否则斜率无意义
        if (!(distance > 1)) continue
        next[combo.id] = [
          (originX - rect.left) / distance,
          (rect.right - originX) / distance,
        ]
        captured += 1
      }
    }

    if (!captured || this._slopesEqual(this._layerSlopes, next)) return false
    this._layerSlopes = next
    return true
  }

  /**
   * 布局稳定后冻结斜率，并把新样式写回 Combo。
   *
   * 冻结前按最终层几何重新计算一次灭点：padding 拟合可能微调了层宽高，
   * 用最新灭点冻结才能让所有梯形严格汇聚到同一个点。
   * 冻结时梯形仍按统一灭点绘制，因此冻结后的形状与当前可见形状完全一致，
   * 不会出现「重新布局后角度跳一下」的问题。
   */
  async _freezeLayerSlopes() {
    if (!this.graph || !this._isComboMode()) return
    const layoutOptions = this._layoutOptions()
    if (layoutOptions.perspective !== false) {
      const origin = this._computePerspectiveOrigin(layoutOptions)
      if (origin) this._perspectiveOrigin = origin
    }
    if (!this._captureLayerSlopes()) return
    this._applyOptions()
    await this._drawCombos()
  }

  /* ------------------------------ 元素层级 ------------------------------ */

  /**
   * 应用分层 zIndex：让跨层连线「源层在下、目标层在上」。
   *
   * 2.5D 视图里每层都是一块半透明面板，连线压在面板上会被填充色染色。
   * 正确的纵深关系是：
   *
   * - 连线从较远（上方）的层出发 → 该段应被源层面板压住，看起来是「钻进面板里」；
   * - 连线落到较近（下方）的层 → 该段应浮在目标层面板之上，保持清晰。
   *
   * G6 每个元素只有一个 zIndex，所以这里让层按视觉深度**倒序**分配
   * （越靠上 = 越远 = zIndex 越高），跨层边再取「较近层 combo + 偏移」：
   *
   * ```
   * 较近层 combo  <  跨层边  <  较远层 combo  <  较远层边  <  较远层节点
   * ```
   *
   * 层与层在平面上并不重叠，倒序分配不会改变任何面板的可见遮挡，
   * 只影响面板与连线之间的前后关系。同层内的边、节点分别取 combo 的固定偏移，
   * 保证节点永远在边之上。
   */
  async _applyStackZOrder() {
    // Group 分层：面板是普通节点，层级规则由运行时按同一套 z 区间计算
    if (this._isGroupMode()) {
      await this._group()?.applyZOrder()
      return
    }
    if (!this.graph || this.destroying || !this._isComboMode()) return
    const data = this.graph.getData()
    const layers = (data.combos || []).filter((combo) => combo.data?.kind === 'layer')
    if (!layers.length) return

    // 1. 按视觉位置确定深度：越靠上 = 越远 = zIndex 越高
    const ordered = layers
      .map((combo, index) => {
        const rect = this._comboRectOf(combo.id)
        return {
          id: String(combo.id),
          top: Number.isFinite(rect?.top) ? rect.top : null,
          order: Number(combo.data?.order ?? index),
        }
      })
      .sort((a, b) => {
        if (a.top != null && b.top != null && Math.abs(a.top - b.top) > 0.5) {
          return a.top - b.top
        }
        return a.order - b.order
      })

    const depthIndex = new Map()
    const depthZ = []
    ordered.forEach((item, index) => {
      depthIndex.set(item.id, index)
      depthZ.push(Z_LAYER_BASE + (ordered.length - index) * Z_LAYER_STEP)
    })

    const zIndexes = {}
    ordered.forEach((item, index) => {
      zIndexes[item.id] = depthZ[index]
    })

    // 2. 节点：始终浮在自己所属层的面板之上
    const layerOfNode = new Map()
    for (const node of data.nodes || []) {
      const nodeId = String(node.id)
      const layerId = String(node.combo || node.data?.combo || '')
      if (!layerId) continue
      layerOfNode.set(nodeId, layerId)
      const index = depthIndex.get(layerId)
      if (index == null) continue
      zIndexes[nodeId] = depthZ[index] + Z_NODE_OFFSET
    }

    // 3. 连线：同层边浮在本层面板上；跨层边取「较近层」的区间
    for (const edge of data.edges || []) {
      const sourceIndex = depthIndex.get(layerOfNode.get(String(edge.source)))
      const targetIndex = depthIndex.get(layerOfNode.get(String(edge.target)))
      if (sourceIndex == null && targetIndex == null) continue
      const near = Math.max(sourceIndex ?? -1, targetIndex ?? -1)
      if (near < 0) continue
      zIndexes[String(edge.id)] = depthZ[near] + Z_EDGE_OFFSET
    }

    // 4. 只提交真正变化的层级，避免稳定态下反复重绘
    const changes = {}
    let count = 0
    const elementRegistry = this.graph.context?.element
    for (const [id, value] of Object.entries(zIndexes)) {
      // 刚被删除的元素不再提交，否则 setElementZIndex 会抛错
      if (
        typeof elementRegistry?.getElement === 'function' &&
        !elementRegistry.getElement(id)
      ) {
        continue
      }
      let current = null
      try {
        current = this.graph.getElementZIndex(id)
      } catch {
        current = null
      }
      if (current === value) continue
      changes[id] = value
      count += 1
    }
    if (!count) return

    try {
      await this.graph.setElementZIndex(changes)
    } catch {
      // 元素可能刚好被删除，忽略这一次层级刷新
    }
  }

  /**
   * 使用 G6 的真实包围盒做最终碰撞修正。
   *
   * 布局阶段已经用数学方式保证不重叠；这里再按实际渲染尺寸兜底，
   * 把节点标签背景、阴影、描边等「布局阶段无法精确测量」的像素也算进去。
   */
  async _resolveRenderedOverlaps({ settle = false } = {}) {
    if (!this.resolveOverlaps || !this.graph || !this._isComboMode()) return
    if (this._resolvingOverlaps) {
      this._isResolveStuck()
      if (this._resolvingOverlaps) return
    }
    this._resolvingOverlaps = true
    this._resolveStartedAt = Date.now()
    const maxRounds = 8

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        // 等 Combo 包围盒按最新子元素重算后再测量；
        // G6 只在 draw() 时重算 Combo 包围盒，单纯等帧读到的是旧尺寸。
        await this._drawCombos()
        await this._waitFrames(1)
        if (!this.graph) return
        // 初始布局的面板 padding 是布局参数给的固定值，节点标签可能已经探出斜边；
        // 每轮先按当前节点位置拟合一次，保证后面测到的重叠是「真实面板」的重叠。
        await this._fitComboPaddings()
        let moved = 0
        const data = this.graph.getData()
        const combos = data.combos || []
        const rectsFor = (ids) => ids.map((id) => this._renderRectOf(id)).filter(Boolean)
        const comboRectsFor = (ids) =>
          ids.map((id) => this._comboRectOf(id)).filter(Boolean)

        // 1. 节点（含标签）互不重叠
        const nodeRects = rectsFor((data.nodes || []).map((node) => node.id))
        if (findRectOverlaps(nodeRects, 1).length) {
          const shifts = separateRects(nodeRects, { gap: 2, axis: 'auto' })
          moved += await this._applyRectShifts(nodeRects, shifts)
        }

        // 2. 层面板互不重叠，只向下推开，保持从上到下的层序
        const layerRects = comboRectsFor(
          combos.filter((combo) => combo.data?.kind === 'layer').map((combo) => combo.id),
        )
        if (findRectOverlaps(layerRects, 4).length) {
          const rowShifts = separateRectRows(layerRects, 6)
          const shifts = new Map(
            [...rowShifts].map(([id, dy]) => [id, { dx: 0, dy }]),
          )
          moved += await this._applyRectShifts(layerRects, shifts)
        }

        if (!moved) break
      }

      // 最后再让画布稳定一帧，保证 fitView / 截图拿到的是修正后的坐标
      await this._waitFrames(1)
      // 层被平移后，重新以整体包围盒计算灭点，
      // 保证所有梯形射线仍然汇聚到新的中心点
      await this._syncPerspectiveOrigin()
      // 灭点变化会改变斜边角度，最后再按最终灭点拟合一次 padding，
      // 否则刚算好的面板可能又装不下节点标签。
      await this._fitComboPaddings()
    } finally {
      this._resolvingOverlaps = false
      this._resolveStartedAt = 0
    }

    // G6 的元素过渡动画约 300ms，动画期间读到的包围盒不可靠。
    // 修正后若仍有残留重叠，补一轮延迟检查；最多补两轮，避免无限循环。
    let clean = true
    try {
      clean = this.checkOverlaps().ok
    } catch {
      clean = true
    }
    if (clean) {
      this._settlePasses = 0
    } else if (!settle) {
      this._settlePasses = 0
      this._scheduleSettleResolve()
    } else if (this._settlePasses < 2) {
      this._settlePasses += 1
      this._scheduleSettleResolve(320)
    }
  }

  /** 延迟一次「动画落定后」的碰撞修正，避免过渡期间测量导致的残留重叠 */
  _scheduleSettleResolve(delay = 460) {
    if (this._settleTimer) clearTimeout(this._settleTimer)
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null
      if (!this.graph || !this.resolveOverlaps) return
      this._resolveRenderedOverlaps({ settle: true }).catch(() => {})
    }, delay)
  }

  /**
   * 拖拽结束后只修正层之间的重叠。
   *
   * 节点被拖到层边缘时，层包围盒会随子节点变大，可能伸进下一层；
   * 拖动层面板本身也可能直接叠到别的层上。
   *
   * 与 `_resolveRenderedOverlaps()` 的区别：
   * - 这里不重新排布节点，保留用户刚拖好的位置；
   * - 只平移「层」，按拖动前的标准间距恢复整组层的纵向节奏，保持层序。
   */
  async _resolveComboOverlaps() {
    if (!this.graph || !this._isComboMode() || this.destroying) {
      this._releaseDragAnimation()
      return
    }
    // 其它碰撞修正正在进行时，排队等它结束再跑，避免互相打架
    if (this._resolvingOverlaps) {
      this._isResolveStuck()
      if (this._resolvingOverlaps) {
        this._scheduleDragOverlapResolve(120)
        return
      }
    }
    this._resolvingOverlaps = true
    this._resolveStartedAt = Date.now()

    try {
      // 松手后的修正必须立刻可见：临时关闭动画，避免 G6 过渡让层「过一会儿」才推开
      await this._withoutAnimation(async () => {
        // G6 只有在 draw() 时才会按最新子元素重算 Combo 包围盒；
        // 拖动节点后如果只 refreshComboData，面板尺寸会停留在旧值。
        await this._drawCombos()
        // 先按最终节点位置重新拟合 padding，保证面板完整包住节点，
        // 再测量 Combo 之间的重叠，避免「面板不够大」被误当成重叠处理。
        await this._fitComboPaddings()
        if (!this.graph || this.destroying) return

        const data = this.graph.getData()
        const combos = data.combos || []
        const layerRects = combos
          .filter((combo) => combo.data?.kind === 'layer')
          .map((combo) => this._comboRectOf(combo.id))
          .filter(Boolean)

        // 层与层：按拖动前的标准间距重新排布，保持整组层距均匀。
        // `_layerSpacingShifts()` 会一次算出所有层的最终位置，
        // 平移不会改变层尺寸，因此不需要多轮迭代。
        if (findRectOverlaps(layerRects, 4).length) {
          const rowShifts = this._layerSpacingShifts(layerRects, combos)
          const shifts = new Map(
            [...rowShifts].map(([id, dy]) => [id, { dx: 0, dy }]),
          )
          await this._applyRectShifts(layerRects, shifts)
          await this._drawCombos()
        }

        await this._waitFrames(1)
        // 注意：手动拖拽期间灭点保持不变，保证所有梯形继续汇聚到同一个点；
        // 平移 Combo 不会改变梯形形状，因此这里不再重算灭点，避免 padding 失效。
        // 修正后重新快照层距，连续拖动时以最新稳定间距为准。
        this._layerGapSnapshot = this._captureLayerGaps()
      })
    } finally {
      this._resolvingOverlaps = false
      this._resolveStartedAt = 0
      this._releaseDragAnimation()
    }
    // 层被推开后上下顺序可能变化，按最终位置重新分配层级
    this._applyStackZOrder().catch(() => {})
  }

  /**
   * 记录当前各层之间的标准间距。
   *
   * 节点拖动会改变层高，层面板被拖动则可能直接压到相邻层。
   * 松手后如果只按最小间距「推开」，被推开的层会贴着一条很窄的缝，
   * 与其它层原本的间距不一致；这里在拖动开始前快照正常间距，
   * 修正时按快照恢复整组层的纵向节奏。
   */
  _captureLayerGaps() {
    if (!this.graph || !this._isComboMode()) return null
    const combos = (this.graph.getData().combos || []).filter(
      (combo) => combo.data?.kind === 'layer',
    )
    const rects = combos.map((combo) => this._comboRectOf(combo.id)).filter(Boolean)
    if (rects.length < 2) return null
    const order = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
    const gaps = []
    for (let i = 1; i < order.length; i += 1) {
      const gap = order[i].top - order[i - 1].bottom
      gaps.push({
        id: order[i].id,
        prev: order[i - 1].id,
        // 拖动开始时若已经重叠，这一对间距不可信，修正时改用默认公式
        gap: gap > 0 ? gap : null,
      })
    }
    return gaps
  }

  /** 没有可用快照时，按布局参数推导层间标准间距 */
  _defaultLayerGap(prevId, nextId, combos) {
    const options = this._layoutOptions()
    const layerGap = Math.max(
      8,
      Number(options.layerGap) || COMBO_LAYER_DEFAULTS.layerGap,
    )
    const minLayerGap =
      Math.max(Number(options.minLayerGap) || COMBO_LAYER_DEFAULTS.minLayerGap, 8) +
      Math.max(0, Number(options.safetyGap) || 0)
    const byId = new Map(combos.map((combo) => [combo.id, combo]))
    const prevScale = Number(byId.get(prevId)?.data?.scale) || 1
    const nextScale = Number(byId.get(nextId)?.data?.scale) || 1
    return Math.max(minLayerGap, layerGap * ((prevScale + nextScale) / 2))
  }

  /**
   * 按标准间距重排层：第一层不动，后续层依次落在上一层下方。
   *
   * 与 `separateRectRows(rects, gap)` 的区别：
   * - 每一对相邻层的目标间距可以不同（2.5D 下各层缩放不同）；
   * - 间距偏大时也会向上收拢，保证整组层距均匀；
   * - 层序被拖动改变时按层序索引复用快照层距，避免回退到默认公式造成层距跳变。
   */
  _layerSpacingShifts(rects, combos) {
    const order = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
    const shifts = new Map(order.map((rect) => [rect.id, 0]))
    const snapshot = Array.isArray(this._layerGapSnapshot)
      ? this._layerGapSnapshot
      : []
    const byNext = new Map(snapshot.map((item) => [item.id, item]))

    for (let i = 1; i < order.length; i += 1) {
      const prev = order[i - 1]
      const current = order[i]
      const entry = byNext.get(current.id)
      // 拖动可能让层跨越相邻层、改变上下顺序，此时 `{id, prev}` 不再对应。
      // 先按相邻关系复用同一对层的层距；顺序变化后退回按层序索引复用快照层距，
      // 保证无论层序怎么变，整组层距都与拖动前保持一致。
      const matched =
        entry?.prev === prev.id && entry.gap > 0 ? entry.gap : null
      const sequenced = snapshot[i - 1]
      const targetGap =
        matched ??
        (sequenced?.gap > 0
          ? sequenced.gap
          : this._defaultLayerGap(prev.id, current.id, combos))
      const prevBottom = prev.top + shifts.get(prev.id) + prev.height
      const currentTop = current.top + shifts.get(current.id)
      const delta = prevBottom + targetGap - currentTop
      if (Math.abs(delta) > 0.5) {
        shifts.set(current.id, shifts.get(current.id) + delta)
      }
    }

    return shifts
  }

  /** 延迟执行拖拽后的 Combo 防重叠修正，等拖拽动画与包围盒稳定 */
  _scheduleDragOverlapResolve(delay = 32) {
    if (this._dragResolveTimer) clearTimeout(this._dragResolveTimer)
    this._dragResolveTimer = setTimeout(() => {
      this._dragResolveTimer = null
      if (!this.graph || !this.resolveOverlaps || this.destroying) {
        this._releaseDragAnimation()
        return
      }
      this._resolveComboOverlaps().catch(() => {
        this._releaseDragAnimation()
      })
    }, delay)
  }

  /**
   * 检查当前 Combo 分层布局是否存在重叠。
   *
   * 返回节点、层面板两类重叠对，可用于调试或自动化测试。
   * `groups` 字段保留为空数组，兼容旧调用方：
   *
   * ```js
   * const report = view.controller.checkOverlaps()
   * if (!report.ok) console.warn(report)
   * ```
   */
  checkOverlaps({ gap = 0 } = {}) {
    if (this._isGroupMode()) {
      const report = this._group()?.checkOverlaps({ gap })
      if (!report) return { ok: true, nodes: [], groups: [], layers: [] }
      return {
        ok: report.ok,
        nodes: (report.nodes || []).map(([a, b]) => ({ a, b })),
        groups: [],
        layers: (report.panels || []).map(([a, b]) => ({ a, b })),
      }
    }
    if (!this.graph || !this._isComboMode()) {
      return { ok: true, nodes: [], groups: [], layers: [] }
    }
    const data = this.graph.getData()
    const rectsFor = (ids) =>
      ids.map((id) => this._renderRectOf(id)).filter(Boolean)
    const comboRectsFor = (ids) =>
      ids.map((id) => this._comboRectOf(id)).filter(Boolean)
    const toPairs = (pairs) =>
      pairs.map(([a, b]) => ({ a: a.id, b: b.id }))
    const combos = data.combos || []

    const nodes = toPairs(
      findRectOverlaps(rectsFor((data.nodes || []).map((node) => node.id)), gap),
    )
    // 层用几何矩形判断，避免阴影 / 梯形外扩造成的误判
    const layers = toPairs(
      findRectOverlaps(
        comboRectsFor(
          combos.filter((combo) => combo.data?.kind === 'layer').map((combo) => combo.id),
        ),
        gap,
      ),
    )

    return {
      ok: !nodes.length && !layers.length,
      nodes,
      groups: [],
      layers,
    }
  }

  _setThemeValue(value) {
    if (value && typeof value === 'object') {
      this.customTheme = value
      this.themeName = value.mode === 'light' ? 'light' : this.themeName
    } else {
      this.customTheme = null
      this.themeName = value === 'light' ? 'light' : 'dark'
    }
  }

  async setTheme(value) {
    const previous = this.themeName
    this._setThemeValue(value)
    this._applyContainerTheme()
    if (!this.graph) return
    this._applyOptions()
    await this.graph.draw()
    await this._resolveRenderedOverlaps()
    if (previous !== this.themeName || typeof value === 'object') {
      this._emitCustom(TOPOLOGY_EVENTS.THEME_CHANGE, { theme: this.themeName })
    }
  }

  async setShowLabels(value) {
    const next = value !== false
    if (this.showLabels === next) return
    this.showLabels = next
    if (!this.graph) return
    this._applyOptions()
    await this.graph.draw()
    await this._resolveRenderedOverlaps()
    this._emitCustom(TOPOLOGY_EVENTS.LABELS_CHANGE, { showLabels: next })
  }

  async setStyle(style = {}) {
    this.styleConfig = style || {}
    this._applyContainerTheme()
    if (!this.graph) return
    this._applyOptions()
    await this.graph.draw()
    await this._resolveRenderedOverlaps()
    this._emitCustom(TOPOLOGY_EVENTS.STYLE_CHANGE, { style: this.styleConfig })
  }

  async setStatusFilter(statuses) {
    const list = Array.isArray(statuses) ? statuses : []
    const next = list.length ? new Set(list) : null
    const same =
      (this.statusFilter === null && next === null) ||
      (this.statusFilter && next && this.statusFilter.size === next.size &&
        [...next].every((item) => this.statusFilter.has(item)))
    if (same) return

    this.statusFilter = next
    this.applyStates()
    this._emitCustom(TOPOLOGY_EVENTS.FILTER_CHANGE, { statuses: list })
  }

  /* ------------------------------ 状态样式 ------------------------------ */

  _isNodeDimmed(id) {
    if (!this.statusFilter) return false
    const status = this.elements.get(id)?.status
    return Boolean(status && !this.statusFilter.has(status))
  }

  _isEmphasizedNode(id) {
    return Boolean(this.emphasis?.nodes?.has(id) || this.searchMatches.has(id))
  }

  _nodeState(id) {
    const active = id === this.selectedId || id === this.hoverId
    const emphasized = this._isEmphasizedNode(id)
    const dimmedByEmphasis = Boolean(this.emphasis?.nodes?.size) && !emphasized
    return [
      ...(this._isNodeDimmed(id) || dimmedByEmphasis ? ['dimmed'] : []),
      ...(active ? ['active'] : []),
      ...(emphasized ? ['highlight'] : []),
    ]
  }

  _edgeState(edge) {
    const status = edge.data?.status
    const off = Boolean(this.statusFilter && status && !this.statusFilter.has(status))
    const endpointDim = this._isNodeDimmed(edge.source) || this._isNodeDimmed(edge.target)
    const active =
      (this.selectedId && (edge.source === this.selectedId || edge.target === this.selectedId)) ||
      (this.hoverId && (edge.source === this.hoverId || edge.target === this.hoverId))
    const emphasized = Boolean(this.emphasis?.edges?.has(edge.id))
    const dimmedByEmphasis = Boolean(this.emphasis?.nodes?.size) && !emphasized
    return [
      ...(off || endpointDim || dimmedByEmphasis ? ['dimmed'] : []),
      ...(active ? ['active'] : []),
      ...(emphasized ? ['highlight'] : []),
    ]
  }

  /** 只把真正发生变化的元素状态提交给 G6，避免每次选中都重刷整图 */
  _setStates(states) {
    if (!this.graph) return
    const changed = {}
    let count = 0
    for (const id of Object.keys(states)) {
      const list = states[id]
      const sig = list.join('|')
      if (this._stateSig.get(id) === sig) continue
      this._stateSig.set(id, sig)
      changed[id] = list
      count += 1
    }
    if (count) this.graph.setElementState(changed, false)
  }

  applyStates() {
    if (!this.graph || !this.data) return
    const states = {}
    for (const node of this.data.nodes) states[node.id] = this._nodeState(node.id)
    for (const edge of this.data.edges) states[edge.id] = this._edgeState(edge)
    this._setStates(states)
  }

  /** 交互态只更新上一个/当前节点及其相邻边，避免整图刷新 */
  _applyInteractionStates(previousId, nextId) {
    if (!this.graph) return
    const states = {}
    if (previousId) states[previousId] = this._nodeState(previousId)
    if (nextId) states[nextId] = this._nodeState(nextId)

    const touched = new Set()
    for (const id of [previousId, nextId]) {
      if (!id) continue
      for (const edge of this.edgesByNode.get(id) || []) {
        if (touched.has(edge.id)) continue
        touched.add(edge.id)
        states[edge.id] = this._edgeState(edge)
      }
    }

    this._setStates(states)
  }

  /* ------------------------------ 分析能力 ------------------------------ */

  /**
   * 高亮 N 跳上下游。
   * @param {string} id
   * @param {{ depth?: number, direction?: 'both'|'out'|'in' }} options
   */
  highlightNeighbors(id, options = {}) {
    if (!this.graph || !this.elements.has(String(id))) return null
    const depth = Math.max(1, Number(options.depth) || 1)
    const direction = options.direction || 'both'
    const result = collectNeighborhood(this.index, id, { depth, direction })
    this.emphasis = { nodes: result.nodes, edges: result.edges, type: 'neighbors', root: String(id), depth, direction }
    this._stateSig.clear()
    this.applyStates()
    this._updateHull()
    const payload = {
      id: String(id),
      depth,
      direction,
      nodes: [...result.nodes],
      edges: [...result.edges],
      count: result.nodes.size,
    }
    this._emitCustom(TOPOLOGY_EVENTS.ANALYSIS_HIGHLIGHT, payload)
    return payload
  }

  /** 影响面：默认下游，depth 不传表示全量 */
  analyzeImpact(id, options = {}) {
    const summary = impactSummary(this.index, id, options)
    this.emphasis = {
      nodes: summary.nodes,
      edges: summary.edges,
      type: 'impact',
      root: String(id),
      direction: summary.direction,
    }
    this._stateSig.clear()
    this.applyStates()
    this._updateHull()
    this._emitCustom(TOPOLOGY_EVENTS.ANALYSIS_HIGHLIGHT, {
      ...summary,
      nodes: [...summary.nodes],
      edges: [...summary.edges],
    })
    return summary
  }

  /**
   * 查找并高亮最短路径。
   * @returns {{ found:boolean, nodes:string[], edges:string[], distance:number }}
   */
  findPath(source, target, options = {}) {
    if (!this.graph) return { found: false, nodes: [], edges: [], distance: Infinity }
    const result = shortestPath(this.index, source, target, options)
    if (result.found) {
      this.emphasis = {
        nodes: new Set(result.nodes),
        edges: new Set(result.edges),
        type: 'path',
        root: String(source),
        target: String(target),
      }
      this._stateSig.clear()
      this.applyStates()
      this._updateHull()
    }
    this._emitCustom(TOPOLOGY_EVENTS.ANALYSIS_PATH, result)
    return result
  }

  /** 根据关键字高亮所有匹配节点 */
  highlightSearch(query) {
    if (!this.graph) return []
    const matches = searchGraphNodes(this.data, query)
    this.searchMatches = new Set(matches)
    if (matches.length) {
      const set = new Set(matches)
      const edges = new Set()
      for (const edge of this.data.edges) {
        if (set.has(edge.source) && set.has(edge.target)) edges.add(edge.id)
      }
      this.emphasis = { nodes: set, edges, type: 'search', root: null }
    } else {
      this.emphasis = null
    }
    this._stateSig.clear()
    this.applyStates()
    this._updateHull()
    this._emitCustom(TOPOLOGY_EVENTS.SEARCH_HIGHLIGHT, { query, matches })
    return matches
  }

  clearHighlight() {
    if (!this.emphasis && !this.searchMatches.size) return
    this.emphasis = null
    this.searchMatches.clear()
    this._stateSig.clear()
    this.applyStates()
    this._updateHull()
    this._emitCustom(TOPOLOGY_EVENTS.ANALYSIS_CLEAR, {})
  }

  _updateHull() {
    if (!this.graph || !this.pluginFlags.hull) return
    try {
      const members = this.emphasis?.nodes?.size ? [...this.emphasis.nodes] : []
      const theme = this.theme
      this.graph.updatePlugin({
        key: 'hull-analysis',
        members,
        padding: 16,
        fill: theme.edgeActive,
        fillOpacity: 0.05,
        stroke: theme.edgeActive,
        lineWidth: 1,
        strokeOpacity: 0.4,
        corner: 'rounded',
      })
      // updatePlugin 只把 members / 样式合并进插件 options（BaseExtension.update
      // 不会触发 Hull 重算路径）。Hull 只在 AFTER_RENDER / 成员元素自身更新时重算，
      // 而高亮上下游时被高亮节点状态没变（只是其他节点置灰），AFTER_ELEMENT_UPDATE
      // 不会为它们触发；仅靠 draw() 的 AFTER_RENDER 在某些时序下会被短路跳过，
      // 这就是「轮廓要等鼠标移入成员节点才出现」的根因。
      // 因此直接拿插件实例强制重算路径，不依赖事件时序。
      const hull = this.graph.getPluginInstance?.('hull-analysis')
      if (hull?.shape && typeof hull.updateMember === 'function') {
        // updateMember 内部以 forceUpdate=true 重算 path 并立即更新 shape
        hull.updateMember(members)
      } else {
        // 实例尚未就绪（首次渲染前）时回退到主动重绘，由 AFTER_RENDER 兜底
        this.graph.draw({ animation: false }).catch(() => {})
      }
    } catch (error) {
      console.warn('[g6] Hull 更新失败', error)
    }
  }

  getEmphasis() {
    if (!this.emphasis) return null
    return {
      type: this.emphasis.type,
      root: this.emphasis.root,
      nodes: [...this.emphasis.nodes],
      edges: [...this.emphasis.edges],
    }
  }

  /* ------------------------------ 视图控制 ------------------------------ */

  async zoomBy(ratio) {
    if (!this.graph) return
    await this.graph.zoomBy(ratio, { duration: 160 })
  }

  async zoomTo(value) {
    if (!this.graph) return
    await this.graph.zoomTo(value, { duration: 160 })
  }

  async resetZoom() {
    if (!this.graph) return
    await this.graph.zoomTo(1, { duration: 160 })
  }

  async toggleFullscreen() {
    if (!this.graph) return
    const plugin = this.graph.getPluginInstance?.('fullscreen')
    if (!plugin) return
    if (document.fullscreenElement) plugin.exit?.()
    else plugin.request?.()
  }

  /* ------------------------------ 历史记录 ------------------------------ */

  _history() {
    if (!this.graph || this.destroying) return null
    try {
      return this.graph.getPluginInstance?.('history') || null
    } catch {
      // 渲染器切换 / 销毁过程中插件控制器可能已释放，静默降级
      return null
    }
  }

  _bindHistory() {
    const history = this._history()
    if (!history?.on) return
    for (const action of ['undo', 'redo', 'change']) {
      history.on(action, () => {
        this._emitCustom(TOPOLOGY_EVENTS.HISTORY_CHANGE, {
          action,
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
        })
        this.callbacks.onHistory?.({ action, canUndo: this.canUndo(), canRedo: this.canRedo() })
      })
    }
  }

  canUndo() {
    return Boolean(this._history()?.canUndo?.())
  }

  canRedo() {
    return Boolean(this._history()?.canRedo?.())
  }

  undo() {
    const history = this._history()
    if (!history?.canUndo?.()) return false
    history.undo()
    this._emitCustom(TOPOLOGY_EVENTS.HISTORY_CHANGE, { action: 'undo' })
    return true
  }

  redo() {
    const history = this._history()
    if (!history?.canRedo?.()) return false
    history.redo()
    this._emitCustom(TOPOLOGY_EVENTS.HISTORY_CHANGE, { action: 'redo' })
    return true
  }

  /* ------------------------------ 交互 ------------------------------ */

  _bindEvents() {
    const graph = this.graph

    graph.on('node:pointerenter', (event) => this._handleHover(event, true))
    graph.on('node:pointerleave', (event) => this._handleHover(event, false))
    graph.on('node:click', (event) => {
      const id = event.target?.id ? String(event.target.id) : null
      if (!id) return
      // 分组面板只是层的背景，不参与节点选中
      if (isGroupPanelData(this.elements.get(id))) return
      this.select(id)
      this._emitCustom(TOPOLOGY_EVENTS.NODE_CLICK, {
        id,
        kind: this.elements.get(id)?.kind === 'rack' ? 'rack' : 'node',
        data: this.elements.get(id) || null,
      })
    })
    graph.on('node:dblclick', (event) => {
      const id = event.target?.id ? String(event.target.id) : null
      if (!id) return
      if (isGroupPanelData(this.elements.get(id))) return
      graph.focusElement(id)
      this._emitCustom(TOPOLOGY_EVENTS.NODE_DBLCLICK, {
        id,
        kind: this.elements.get(id)?.kind === 'rack' ? 'rack' : 'node',
        data: this.elements.get(id) || null,
      })
    })
    graph.on('canvas:click', () => {
      this.clearSelection()
      this._emitCustom(TOPOLOGY_EVENTS.CANVAS_CLICK, {})
    })
    graph.on('canvas:pointerleave', () => {
      if (!this.hoverId) return
      const previous = this.hoverId
      this.hoverId = null
      this._applyInteractionStates(previous, null)
      this.callbacks.onHover?.(null)
      this._emitCustom(TOPOLOGY_EVENTS.HOVER_CHANGE, null)
    })

    for (const type of ['node', 'combo']) {
      graph.on(`${type}:dragstart`, (event) => this._beginDrag(event))
      // 拖动节点时按帧扩展所属层，让面板始终包住节点
      graph.on(`${type}:drag`, () => {
        this._queueComboGrow()
        // Group 版：拖面板时带动层内节点；拖节点时扩展面板
        this._group()?.drag()
      })
      graph.on(`${type}:dragend`, (event) => this._endDrag(event))
    }
  }

  /* ------------------------------ 拖拽性能优化 ------------------------------ */

  _beginDrag(event) {
    if (this._dragging) return
    this._dragging = true
    // Group 分层：记录拖拽会话（面板 -> 成员联动 / 节点 -> 面板扩展）
    this._group()?.beginDrag(event)
    // 拖动会改变层高 / 层位置，先记住拖动前的标准层距，松手后按它恢复均匀间距
    this._layerGapSnapshot = this._captureLayerGaps()
    // 正常挂载后斜率已冻结；这里兜底处理「首次布局尚未稳定就开始拖动」的情况
    if (this._isComboMode() && !this._layerSlopes && this._captureLayerSlopes()) {
      this._applyOptions()
    }
    // 拖动期间层宽高实时变化，关掉过渡动画可让面板立即跟随，
    // 同时避免松手时还在跑的 draw 动画把修正延后。
    if (this._isComboMode() || this._isGroupMode()) {
      this._dragAnimationHold = true
      this._setAnimationSuppressed(true)
    }

    // 节点拖拽约束：dragstart 时缓存所属层的几何边界与节点块偏移。
    // 拖动过程中层不会变化，因此只需测量一次，pointermove 时只做纯数学裁剪。
    this._dragNodeId = null
    this._dragConstraint = null
    const dragId = event?.target?.id ? String(event.target.id) : null
    if (dragId && this.elements.has(dragId)) {
      const constraint = this._nodeDragConstraint(dragId)
      if (constraint) {
        this._dragNodeId = dragId
        this._dragConstraint = constraint
      }
    }

    // 拖拽时鼠标会不断掠过其它节点，关闭 hover 高亮可省掉大量状态重算与 Vue 重渲染
    if (this.hoverId) {
      const previous = this.hoverId
      this.hoverId = null
      this._applyInteractionStates(previous, null)
      this.callbacks.onHover?.(null)
      this._emitCustom(TOPOLOGY_EVENTS.HOVER_CHANGE, null)
    }

    this._pauseMinimap()
  }

  /**
   * 计算节点拖拽时的几何信息：节点块（本体 + 标签）相对节点中心的四边偏移。
   *
   * 拖动过程中只测量一次，pointermove 时用它推导层需要的新包围盒，
   * 不再重复读取渲染包围盒。
   */
  _nodeDragConstraint(id) {
    if (!this.graph || !this._isComboMode()) return null
    const data = this.graph.getData()
    const node = (data.nodes || []).find((item) => item.id === id)
    const parentId = node?.combo || node?.data?.combo
    if (!parentId) return null

    const nodeEl = this.graph.context?.element?.getElement?.(id)
    if (!nodeEl) return null

    const bounds = this._stableBoundsOf(id)
    if (!bounds?.min || !bounds?.max) return null

    const position = nodeEl.getPosition?.() || [
      Number(node?.style?.x) || 0,
      Number(node?.style?.y) || 0,
    ]

    return {
      parentId: String(parentId),
      // 节点块（本体 + 下方标签）相对节点中心的偏移
      left: bounds.min[0] - position[0],
      right: bounds.max[0] - position[0],
      top: bounds.min[1] - position[1],
      bottom: bounds.max[1] - position[1],
    }
  }

  /** 每帧最多扩展一次面板，避免 pointermove 高频触发重绘 */
  _queueComboGrow() {
    if (!this._dragNodeId || this._growPending) return
    this._growPending = true
    const run = () => {
      this._growPending = false
      this._growCombosForDraggedNode()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  /**
   * 按正在拖动的节点扩展所属层，而不是把节点锁死在固定尺寸里。
   *
   * G6 的 Combo 尺寸 = 子元素包围盒 + padding，所以只要把节点算进子元素包围盒，
   * 面板就会自动变宽变高。梯形面板上窄下宽，内容块顶边的左右角最容易越界，
   * 因此额外计算所需的左右 padding：
   *
   * 设 t = (blockTop - originY) / (panelBottom - originY)，
   * 面板左边界在 blockTop 处为 originX + (childrenLeft - padLeft - originX) * t，
   * 令其 <= blockLeft，即可解出 padLeft 的闭式解。
   *
   * 这样节点永远落在层梯形内部，层宽高随节点位置实时变化。
   */
  _growCombosForDraggedNode() {
    const id = this._dragNodeId
    const constraint = this._dragConstraint
    if (!id || !constraint || !this.graph || this.destroying) return

    const data = this.graph.getData()
    const node = (data.nodes || []).find((item) => item.id === id)
    const layerId = node?.combo || node?.data?.combo || constraint.parentId
    if (!layerId) return

    const x = Number(node.style?.x) || 0
    const y = Number(node.style?.y) || 0
    const block = {
      left: x + constraint.left,
      right: x + constraint.right,
      top: y + constraint.top,
      bottom: y + constraint.bottom,
    }

    const options = this._layoutOptions()
    const origin = this._perspectiveOrigin
    const combos = data.combos || []

    const layer = combos.find((combo) => combo.id === layerId)
    if (!layer) return

    // 逐个检查层内节点块，取「包住所有子节点」所需的最小 padding。
    // 不能用整体包围盒代替：左边缘的节点通常不在最上方，
    // 用包围盒会把梯形最窄处也当成有内容，导致面板被过度撑大。
    const childRects = []
    for (const item of data.nodes || []) {
      if (item.combo !== layerId) continue
      if (item.id === id) {
        childRects.push(block)
        continue
      }
      const rect = this._renderRectOf(item.id)
      if (rect) childRects.push(this._rectBox(rect))
    }
    if (!childRects.length) return

    const baseLayerPad = normalizePadding(
      options.layerPadding ?? COMBO_LAYER_DEFAULTS.layerPadding,
    )
    const layerPad = this._requiredSidePadding({
      rects: childRects,
      padding: baseLayerPad,
      origin,
      slopes: this._slopesForLayer(layerId),
    })
    const layerChanged = !paddingEquals(
      layerPad,
      normalizePadding(layer.style?.padding ?? baseLayerPad),
    )
    if (!layerChanged) return

    this.graph.updateComboData([{ id: layerId, style: { padding: layerPad } }])

    // G6 不会自动重算 Combo 尺寸，必须显式刷新
    this._refreshComboFor(layerId)
    this._drawCombos(400).catch(() => {})
  }

  /**
   * G6 碰撞矩形 -> 上下左右边界
   *
   * 注意 `rectFromTopLeft` / `rectFromCenter` 返回的 `x`、`y` 是**中心点**，
   * 左上角是 `left`、`top`，这里必须用后者，否则整体会偏移半个尺寸。
   */
  _rectBox(rect) {
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }
  }

  /** 多个矩形的并集包围盒 */
  _unionRects(rects) {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const rect of rects) {
      left = Math.min(left, rect.left)
      right = Math.max(right, rect.right)
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    return { left, right, top, bottom }
  }

  /**
   * 计算把一组内容矩形包进梯形面板所需的左右内边距（上下保持基础值）。
   *
   * 两种模式：
   * - 有冻结斜率（拖动 / 拖拽修正）：顶边收窄量 = 斜率 × 层高，
   *   面板左边界为 `panelLeft + slopeLeft × (panelBottom - y)`，
   *   按内容块最上边（边界最窄处）解出 padLeft / padRight 的闭式解；
   *   这样整个拖动过程内角恒定，又保证节点不会探出梯形。
   * - 无冻结斜率（布局阶段）：按统一灭点射线计算，保证所有层汇聚到同一点。
   */
  _requiredSidePadding({ rects, padding, origin, slopes }) {
    const [padTop, padRight, padBottom, padLeft] = padding
    if (!Array.isArray(rects) || !rects.length) {
      return [padTop, padRight, padBottom, padLeft]
    }
    const union = this._unionRects(rects)
    if (!union) return [padTop, padRight, padBottom, padLeft]

    // 优先使用冻结斜率：顶边收窄量只与层高有关，底边内角保持不变
    if (Array.isArray(slopes) && slopes.length === 2) {
      const slopeLeft = Number(slopes[0])
      const slopeRight = Number(slopes[1])
      if (Number.isFinite(slopeLeft) && Number.isFinite(slopeRight)) {
        const panelBottom = union.bottom + padBottom
        let left = padLeft
        let right = padRight
        for (const rect of rects) {
          // 边界随 y 线性收窄，内容块顶边是最严格的位置
          const drop = panelBottom - rect.top
          if (!(drop > 0)) continue
          left = Math.max(left, union.left - rect.left + slopeLeft * drop)
          right = Math.max(right, rect.right - union.right + slopeRight * drop)
        }
        return [
          padTop,
          Math.max(right, 0) + COMBO_FIT_MARGIN,
          padBottom,
          Math.max(left, 0) + COMBO_FIT_MARGIN,
        ]
      }
    }

    if (!Array.isArray(origin) || origin.length !== 2) {
      return [padTop, padRight, padBottom, padLeft]
    }
    const originX = Number(origin[0])
    const originY = Number(origin[1])
    const span = union.bottom + padBottom - originY
    if (!(span > 0.0001)) return [padTop, padRight, padBottom, padLeft]

    let right = padRight
    let left = padLeft
    for (const rect of rects) {
      for (const y of [rect.top, rect.bottom]) {
        const t = (y - originY) / span
        if (!(t > 0.0001)) continue
        // 面板左边界：originX + (union.left - padLeft - originX) * t <= rect.left
        left = Math.max(left, union.left - originX - (rect.left - originX) / t)
        // 面板右边界：originX + (union.right + padRight - originX) * t >= rect.right
        right = Math.max(right, (rect.right - originX) / t - (union.right - originX))
      }
    }

    return [
      padTop,
      Math.max(right, 0) + COMBO_FIT_MARGIN,
      padBottom,
      Math.max(left, 0) + COMBO_FIT_MARGIN,
    ]
  }

  /**
   * 根据当前节点位置重新拟合所有层的 padding。
   *
   * 拖动结束后节点位置已固定，此时统一重算一次，可以修正：
   * - 拖动过程中按「旧灭点」算出的 padding；
   * - 碰撞修正平移层后，节点相对层的位置变化。
   *
   * 只扩大面板、不移动子元素，因此不会破坏用户摆好的节点。
   */
  async _fitComboPaddings() {
    if (!this.graph || !this._isComboMode() || this.destroying) return
    const data = this.graph.getData()
    const combos = data.combos || []
    const origin = this._perspectiveOrigin
    const options = this._layoutOptions()
    const baseLayerPad = normalizePadding(
      options.layerPadding ?? COMBO_LAYER_DEFAULTS.layerPadding,
    )

    const nodesByLayer = new Map()
    for (const node of data.nodes || []) {
      const layerId = node.combo || node.data?.combo
      if (!layerId) continue
      let list = nodesByLayer.get(layerId)
      if (!list) nodesByLayer.set(layerId, (list = []))
      list.push(node.id)
    }

    const updates = []
    for (const combo of combos) {
      if (combo.data?.kind !== 'layer') continue
      const rects = []
      for (const nodeId of nodesByLayer.get(combo.id) || []) {
        const rect = this._renderRectOf(nodeId)
        if (rect) rects.push(this._rectBox(rect))
      }
      if (!rects.length) continue
      const slopes = this._slopesForLayer(combo.id)
      const pad = this._requiredSidePadding({
        rects,
        padding: baseLayerPad,
        origin,
        slopes,
      })
      if (!paddingEquals(pad, normalizePadding(combo.style?.padding ?? baseLayerPad))) {
        updates.push({ id: combo.id, style: { padding: pad } })
      }
    }

    if (!updates.length) return
    this.graph.updateComboData(updates)
    for (const update of updates) {
      this.graph.context?.model?.refreshComboData?.(update.id)
    }
    await this._drawCombos(400)
  }

  _endDrag(event) {
    if (!this._dragging) return
    this._dragging = false

    // 松手时先按节点最终位置再做一次扩展，确保最后一帧不会漏掉
    this._growCombosForDraggedNode()
    this._dragNodeId = null
    this._dragConstraint = null
    this._growPending = false

    // dropEffect: 'none' 不会在拖动中刷新 Combo，这里在松手时补一次包围盒更新
    const id = event?.target?.id ? String(event.target.id) : null
    if (id) this._refreshComboFor(id)

    // 层会随子节点变大，松手后统一修正 Combo 之间的重叠
    this._scheduleDragOverlapResolve()

    // Group 分层：拟合面板尺寸、推开重叠面板、恢复层级
    this._group()?.endDrag()
    if (this._isGroupMode()) this._releaseDragAnimation()

    // drag-element 在 dragstart 时调用了 frontElement()，会把被拖元素永久提到最前，
    // 松手后立刻恢复「层 → 边 → 节点」的分层层级，避免连线骑到面板上。
    this._applyStackZOrder().catch(() => {})

    this._resumeMinimap()

    // 拖拽开始时清掉了 hover，松手后鼠标通常仍停在节点上，这里按元素当前坐标补回悬停高亮
    if (id && this.elements.has(id)) {
      const client = this._clientPointOf(id)
      if (client) this._handleHover({ target: { id }, clientX: client.x, clientY: client.y }, true)
    }
  }

  /** 元素中心点在浏览器视口中的坐标（用于恢复悬停卡片定位） */
  _clientPointOf(id) {
    try {
      const graph = this.graph
      const rect = this.container?.getBoundingClientRect?.()
      if (!graph || !rect) return null
      const viewport = graph.getViewportByCanvas(graph.getElementPosition(id))
      if (!viewport) return null
      return { x: rect.left + viewport[0], y: rect.top + viewport[1] }
    } catch {
      return null
    }
  }

  _refreshComboFor(id) {
    if (!this.graph || this.destroying) return
    const model = this.graph.context?.model
    if (!model?.refreshComboData) return
    try {
      const data = this.graph.getData()
      const combos = data.combos || []
      const comboIds = new Set()

      // 拖动节点时刷新它所属的层；拖动 Combo 时刷新 Combo 本身
      const node = (data.nodes || []).find((item) => item.id === id)
      const parentId = node?.combo || node?.data?.combo
      if (parentId) comboIds.add(String(parentId))
      if (combos.some((combo) => combo.id === id)) comboIds.add(String(id))

      // 预留嵌套 Combo 的逐级刷新能力；当前只有一层，循环不会命中
      for (const comboId of [...comboIds]) {
        let current = combos.find((combo) => combo.id === comboId)
        while (current?.combo) {
          const parent = String(current.combo)
          if (comboIds.has(parent)) break
          comboIds.add(parent)
          current = combos.find((combo) => combo.id === parent)
        }
      }

      for (const comboId of comboIds) model.refreshComboData(comboId)
    } catch {
      // 元素可能已被删除，忽略
    }
  }

  _minimap() {
    if (!this.graph || this.destroying) return null
    try {
      return this.graph.getPluginInstance?.('minimap') || null
    } catch {
      return null
    }
  }

  _pauseMinimap() {
    const minimap = this._minimap()
    if (!minimap || this._minimapPaused) return
    this._minimapPaused = true
    minimap.__renderMinimap = minimap.renderMinimap
    minimap.__renderMask = minimap.renderMask
    minimap.renderMinimap = () => {}
    minimap.renderMask = () => {}
  }

  _resumeMinimap() {
    const minimap = this._minimap()
    if (!minimap || !this._minimapPaused) return
    this._minimapPaused = false
    if (minimap.__renderMinimap) minimap.renderMinimap = minimap.__renderMinimap
    if (minimap.__renderMask) minimap.renderMask = minimap.__renderMask
    try {
      minimap.renderMinimap?.()
      minimap.renderMask?.()
    } catch {
      // Minimap 可能已被销毁，忽略
    }
  }

  _handleHover(event, entering) {
    if (this._dragging) return
    const rawId = event.target?.id
    if (!rawId) return
    const id = String(rawId)
    if (entering === Boolean(this.hoverId === id)) return

    const previous = this.hoverId
    this.hoverId = entering ? id : null
    this._applyInteractionStates(previous, this.hoverId)

    if (!entering) {
      this.callbacks.onHover?.(null)
      this._emitCustom(TOPOLOGY_EVENTS.HOVER_CHANGE, null)
      return
    }

    const data = this.elements.get(id)
    const info = {
      kind: data?.kind === 'rack' ? 'rack' : 'node',
      id,
      data,
      x: event.clientX,
      y: event.clientY,
    }
    this.callbacks.onHover?.(info)
    this._emitCustom(TOPOLOGY_EVENTS.HOVER_CHANGE, info)
  }

  _emitSelection() {
    const id = this.selectedId
    const data = id ? this.elements.get(id) : null
    const info = data
      ? { kind: data.kind === 'rack' ? 'rack' : 'node', id, data }
      : null
    this.callbacks.onSelect?.(info)
    this._emitCustom(TOPOLOGY_EVENTS.SELECTION_CHANGE, info)
  }

  select(id, { focus = true } = {}) {
    const next = id == null || id === '' ? null : String(id)
    if (next === this.selectedId) {
      if (next && focus) this.graph?.focusElement(next)
      return
    }
    const previous = this.selectedId
    this.selectedId = next
    this._applyInteractionStates(previous, next)
    this._emitSelection()
    if (next && focus) this.graph?.focusElement(next)
  }

  clearSelection() {
    const previous = this.selectedId
    if (!previous) return
    this.selectedId = null
    this._applyInteractionStates(previous, null)
    this._emitSelection()
  }

  focus(id) {
    if (id) this.graph?.focusElement(String(id))
  }

  async fitView() {
    if (!this.graph) return
    await this.graph.fitView(undefined, { duration: 280 })
    this._emitCustom(TOPOLOGY_EVENTS.VIEW_FIT, {})
  }

  async resize(width, height) {
    if (!this.graph) return
    if (width && height) this.graph.setSize(width, height)
    else this.graph.resize()
  }

  /* ------------------------------ 导出 / 销毁 ------------------------------ */

  async toDataURL() {
    if (!this.graph) return ''
    // 画布在屏幕上保持透明（背景由 CSS 提供），导出时再临时写入主题背景色
    const canvasConfig = this.graph.context?.canvas?.getConfig?.()
    const previous = canvasConfig?.background
    if (canvasConfig) canvasConfig.background = this._background()
    try {
      return await this.graph.toDataURL({
        mode: 'viewport',
        type: 'image/png',
      })
    } finally {
      if (canvasConfig) canvasConfig.background = previous
    }
  }

  /** 导出当前视图的静态 SVG（节点位置来自 G6 画布） */
  toSVG() {
    if (!this.graph || !this.data.nodes.length) return ''
    const theme = this.theme
    const padding = 48
    const positions = new Map()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of this.data.nodes) {
      let point = null
      try {
        point = this.graph.getElementPosition(node.id)
      } catch {
        point = null
      }
      if (!point) continue
      const x = Number(point[0]) || 0
      const y = Number(point[1]) || 0
      positions.set(node.id, [x, y])
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (!positions.size) return ''

    const width = Math.max(1, maxX - minX + padding * 2)
    const height = Math.max(1, maxY - minY + padding * 2)
    const offsetX = -minX + padding
    const offsetY = -minY + padding
    const parts = []
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">`,
    )
    parts.push(`<rect width="100%" height="100%" fill="${escapeXml(this._background())}"/>`)

    for (const edge of this.data.edges) {
      const source = positions.get(edge.source)
      const target = positions.get(edge.target)
      if (!source || !target) continue
      const data = edge.data || {}
      const alerting = data.status === 'warn' || data.status === 'error'
      const stroke = alerting ? theme.status[data.status] : theme.edge
      const dash = data.type === 'stack' || data.type === 'dependency' ? ' stroke-dasharray="5 4"' : ''
      parts.push(
        `<line x1="${source[0] + offsetX}" y1="${source[1] + offsetY}" x2="${target[0] + offsetX}" y2="${target[1] + offsetY}" stroke="${escapeXml(stroke)}" stroke-width="${alerting ? 1.9 : 1.2}" opacity="0.82"${dash}/>`,
      )
    }

    for (const node of this.data.nodes) {
      const position = positions.get(node.id)
      if (!position) continue
      const data = node.data || {}
      const x = position[0] + offsetX
      const y = position[1] + offsetY
      const accent = g6NodeAccent(data, theme, this.colorMode)
      const shape = g6NodeShape(data)
      const size = g6NodeSize(data)
      const [w, h] = Array.isArray(size) ? size : [size, size]
      parts.push(`<g data-id="${escapeXml(node.id)}">`)
      if (shape === 'rect' || shape === 'ellipse') {
        parts.push(
          `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${shape === 'ellipse' ? Math.min(w, h) / 2 : 9}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      } else if (shape === 'diamond') {
        parts.push(
          `<polygon points="${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      } else if (shape === 'triangle') {
        parts.push(
          `<polygon points="${x},${y - h / 2} ${x + w / 2},${y + h / 2} ${x - w / 2},${y + h / 2}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      } else if (shape === 'hexagon') {
        const rx = w / 2
        const ry = h / 2
        parts.push(
          `<polygon points="${x - rx * 0.5},${y - ry} ${x + rx * 0.5},${y - ry} ${x + rx},${y} ${x + rx * 0.5},${y + ry} ${x - rx * 0.5},${y + ry} ${x - rx},${y}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      } else if (shape === 'star') {
        const points = []
        for (let i = 0; i < 10; i += 1) {
          const radius = i % 2 === 0 ? w / 2 : w / 4
          const angle = (Math.PI / 5) * i - Math.PI / 2
          points.push(`${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`)
        }
        parts.push(
          `<polygon points="${points.join(' ')}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      } else {
        parts.push(
          `<circle cx="${x}" cy="${y}" r="${w / 2}" fill="${escapeXml(theme.nodeFill)}" stroke="${escapeXml(accent)}" stroke-width="${theme.nodeStrokeWidth}"/>`,
        )
      }

      if (this.showLabels && data.hideLabel !== true) {
        const label = String(data.name || data.id || '')
        const labelY = y + (data.kind === 'rack' ? h / 2 + 14 : w / 2 + 12)
        parts.push(
          `<text x="${x}" y="${labelY}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="10.5" fill="${escapeXml(theme.nodeLabel)}">${escapeXml(label)}</text>`,
        )
      }
      parts.push('</g>')
    }

    parts.push('</svg>')
    return parts.join('')
  }

  /** 导出当前显示数据（普通拓扑 / 聚合 / 下钻均可） */
  toJSON() {
    if (!this.payload) return null
    return JSON.parse(
      JSON.stringify({
        meta: this.payload.meta || {},
        nodes: this.payload.nodes || [],
        links: this.payload.links || [],
        racks: this.payload.racks,
      }),
    )
  }

  getState() {
    return {
      layout: this.layoutId,
      theme: this.themeName,
      showLabels: this.showLabels,
      statusFilter: this.statusFilter ? [...this.statusFilter] : null,
      plugins: { ...this.pluginFlags },
    }
  }

  destroy() {
    this.destroying = true
    this._dragging = false
    this._minimapPaused = false
    if (this._settleTimer) {
      clearTimeout(this._settleTimer)
      this._settleTimer = null
    }
    if (this._dragResolveTimer) {
      clearTimeout(this._dragResolveTimer)
      this._dragResolveTimer = null
    }
    if (this._perspectiveTimer) {
      clearTimeout(this._perspectiveTimer)
      this._perspectiveTimer = null
    }
    this._resolvingOverlaps = false
    this._resolveStartedAt = 0
    this._emitCustom(TOPOLOGY_EVENTS.VIEW_DESTROY, {})
    if (this.graph) {
      // Minimap 的 debounce 定时器无法取消，销毁后仍会触发 renderMinimap；
      // 先把它替换成空实现，避免控制台出现 getData of undefined。
      try {
        const minimap = this.graph.getPluginInstance?.('minimap')
        if (minimap) {
          minimap.renderMinimap = () => {}
          minimap.renderMask = () => {}
        }
      } catch {
        // 插件可能已被释放，忽略
      }
      this.graph.destroy()
      this.graph = null
    }
    this.mounted = false
    this.container.innerHTML = ''
  }
}

export { G6_DEFAULT_LAYOUT, getG6LayoutPreset, worstStatus }
