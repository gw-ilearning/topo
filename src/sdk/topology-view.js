import { G6_DEFAULT_LAYOUT } from '../g6/layouts.js'
import { STATUS_ORDER } from '../topology/palette.js'
import { normalizeTopology } from '../api/client.js'
import { createRealtimeClient } from '../api/realtime.js'
import { aggregateTopology, extractSubgraph } from '../topology/transform.js'
import { TOPOLOGY_EVENTS } from './events.js'

const DEFAULT_CONFIG = {
  engine: 'g6',
  theme: 'dark',
  layout: null,
  showLabels: true,
  autoRotate: false,
  autoFit: true,
  statusFilter: STATUS_ORDER,
  aggregation: 'none',
  plugins: undefined,
}

const views = new Map()

/* 引擎按需加载：G6 用户不下载 Three.js，反之亦然 */
let g6ModulePromise = null
let threeModulePromise = null

function loadG6Module() {
  if (!g6ModulePromise) g6ModulePromise = import('../g6/graph.js')
  return g6ModulePromise
}

function loadThreeModule() {
  if (!threeModulePromise) threeModulePromise = import('../topology/engine.js')
  return threeModulePromise
}

function resolveContainer(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) {
    throw new Error(
      '[TopologySDK] 找不到渲染容器，请通过 config.container 指定，例如 { container: "#topo" }',
    )
  }
  return el
}

function defaultContainer() {
  return (
    document.querySelector('[data-topology-view]') ||
    document.querySelector('#topology-root')
  )
}

function normalizeData(data, sceneKey) {
  if (!data) throw new Error('[TopologySDK] loadGraph(data, config) 的 data 不能为空')
  return normalizeTopology(data, sceneKey || data?.meta?.scene || 'custom')
}

function buildStyleConfig(config = {}) {
  const style = { ...(config.style || {}) }
  if (config.node && style.node == null) style.node = config.node
  if (config.edge && style.edge == null) style.edge = config.edge
  if (config.background && style.background == null) style.background = config.background
  if (config.grid && style.grid == null) style.grid = config.grid
  if (config.layoutStyles && style.layouts == null) style.layouts = config.layoutStyles
  return style
}

function normalizeStatuses(value) {
  if (!Array.isArray(value) || !value.length) return [...STATUS_ORDER]
  return value.map((item) => String(item))
}

function normalizeAggregation(value) {
  if (value === 'group' || value === 'type' || value === 'status') return value
  return 'none'
}

/**
 * 可嵌入业务页面的拓扑视图。
 *
 * - engine: 'g6'（默认，G6 5 原生 2D）或 'three'（Three.js 3D）
 * - 两种引擎互不共享渲染代码，只在数据契约层统一
 * - 聚合 / 下钻在数据层完成，两种引擎都能使用
 */
export class TopologyView {
  constructor(container, config = {}) {
    this.container = resolveContainer(container)
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.engine = null
    this.g6 = null
    this.three = null
    this.rootPayload = null
    this.payload = null
    this.drillStack = []
    this.aggregation = normalizeAggregation(this.config.aggregation)
    this.callbacks = {
      onHover: config.onHover,
      onSelect: config.onSelect,
      onStats: config.onStats,
      onContextAction: config.onContextAction,
      onHistory: config.onHistory,
    }
    this.statuses = normalizeStatuses(this.config.statusFilter)
    this.destroyed = false
    this.selectedId = null
    this._listeners = new Map()
    this._realtime = null

    if (config.events && typeof config.events === 'object') {
      for (const [name, handler] of Object.entries(config.events)) this.on(name, handler)
    }

    this.ready = Promise.resolve(this)
  }

  /* ------------------------------ 事件订阅 ------------------------------ */

  on(event, handler) {
    if (typeof handler !== 'function') return this
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(handler)
    return this
  }

  once(event, handler) {
    if (typeof handler !== 'function') return this
    const wrapper = (payload) => {
      this.off(event, wrapper)
      handler(payload)
    }
    wrapper.__origin = handler
    return this.on(event, wrapper)
  }

  off(event, handler) {
    const set = this._listeners.get(event)
    if (!set) return this
    if (!handler) {
      this._listeners.delete(event)
      return this
    }
    for (const item of set) {
      if (item === handler || item.__origin === handler) set.delete(item)
    }
    if (!set.size) this._listeners.delete(event)
    return this
  }

  emit(event, payload) {
    const set = this._listeners.get(event)
    if (!set) return this
    for (const handler of [...set]) {
      try {
        handler(payload, event)
      } catch (error) {
        console.error(`[TopologySDK] 事件 ${event} 处理失败`, error)
      }
    }
    return this
  }

  /** G6 模式下可直接访问原生 Graph 实例，用于 graph.on(...) / graph.emit(...) */
  get graph() {
    return this.g6?.graph || null
  }

  /* ------------------------------ 对外主入口 ------------------------------ */

  async loadGraph(data, config = {}) {
    if (this.destroyed) throw new Error('[TopologySDK] 视图已销毁，请重新创建')

    const next = { ...this.config, ...config }
    this.config = next
    if (config.onHover !== undefined) this.callbacks.onHover = config.onHover
    if (config.onSelect !== undefined) this.callbacks.onSelect = config.onSelect
    if (config.onStats !== undefined) this.callbacks.onStats = config.onStats
    if (config.onContextAction !== undefined) this.callbacks.onContextAction = config.onContextAction
    if (config.onHistory !== undefined) this.callbacks.onHistory = config.onHistory

    this.statuses = normalizeStatuses(next.statusFilter)
    this.rootPayload = normalizeData(data, next.scene)
    this.aggregation = normalizeAggregation(next.aggregation)
    this.drillStack = []

    if (config.events && typeof config.events === 'object') {
      for (const [name, handler] of Object.entries(config.events)) this.on(name, handler)
    }

    const engine = next.engine === 'three' ? 'three' : 'g6'
    if (engine !== this.engine) {
      this._disposeRenderer()
      this.engine = engine
    }

    this.payload = this._computeDisplayPayload()
    if (engine === 'g6') await this._renderG6(next)
    else await this._renderThree(next)

    return this
  }

  updateData(data, config = {}) {
    const next = { ...this.config, ...config }
    this.config = next
    this.rootPayload = normalizeData(data, next.scene)
    if (config.aggregation !== undefined) this.aggregation = normalizeAggregation(config.aggregation)
    this.payload = this._computeDisplayPayload()
    return this._syncData({ relayout: false })
  }

  /* ------------------------------ 显示数据（聚合 / 下钻） ------------------------------ */

  _computeDisplayPayload() {
    let payload = this.rootPayload
    if (!payload) return null

    // 下钻链：逐级从子图节点中提取
    if (this.drillStack.length) {
      const valid = []
      for (const entry of this.drillStack) {
        const sub = extractSubgraph(payload, entry.id)
        if (!sub) break
        valid.push(entry)
        payload = sub
      }
      if (valid.length !== this.drillStack.length) this.drillStack = valid
    }

    if (this.aggregation !== 'none') payload = aggregateTopology(payload, this.aggregation)
    return payload
  }

  _syncData({ relayout = false } = {}) {
    if (this.engine === 'g6' && this.g6) return this.g6.setData(this.payload, { relayout })
    if (this.engine === 'three' && this.three) {
      this.three.setData(this.payload)
      if (relayout) this.three.setLayout(this.config.layout || 'force', { instant: false })
    }
    return Promise.resolve()
  }

  async _refreshDisplay({ relayout = true } = {}) {
    this.payload = this._computeDisplayPayload()
    await this._syncData({ relayout })
    return this
  }

  /** 设置聚合方式：'none' | 'group' | 'type' | 'status' */
  async setAggregation(field) {
    const next = normalizeAggregation(field)
    if (next === this.aggregation) return this
    this.aggregation = next
    this.config.aggregation = next
    this.drillStack = []
    await this._refreshDisplay({ relayout: true })
    await this.g6?.fitView?.()
    this._emitView(TOPOLOGY_EVENTS.AGGREGATION_CHANGE, {
      aggregation: next,
      name: this.payload?.meta?.name,
    })
    return this
  }

  getAggregation() {
    return this.aggregation
  }

  /** 下钻到节点子图 */
  async drillDown(id) {
    if (!id) return false
    const current = this.payload
    const sub = extractSubgraph(current, id)
    if (!sub) return false
    const node = (current.nodes || []).find((item) => String(item.id) === String(id))
    this.drillStack.push({ id: String(id), name: node?.name || String(id) })
    this.searchMatches = null
    await this._refreshDisplay({ relayout: true })
    await this.g6?.fitView?.()
    this._emitView(TOPOLOGY_EVENTS.DRILL_CHANGE, {
      action: 'down',
      id: String(id),
      breadcrumb: this.getBreadcrumb(),
      name: sub.meta?.name,
    })
    return true
  }

  /** 返回指定层级；不传参数返回上一级 */
  async drillUp(index) {
    if (!this.drillStack.length) return false
    const target = Number.isInteger(index) ? Math.max(0, index) : this.drillStack.length - 1
    const removed = this.drillStack.splice(target)
    if (!removed.length) return false
    await this._refreshDisplay({ relayout: true })
    await this.g6?.fitView?.()
    this._emitView(TOPOLOGY_EVENTS.DRILL_CHANGE, {
      action: 'up',
      breadcrumb: this.getBreadcrumb(),
    })
    return true
  }

  getBreadcrumb() {
    const rootName = this.rootPayload?.meta?.name || '根视图'
    return [
      { id: null, name: rootName },
      ...this.drillStack.map((entry) => ({ id: entry.id, name: entry.name })),
    ]
  }

  resetDrill() {
    if (!this.drillStack.length) return this
    this.drillStack = []
    return this._refreshDisplay({ relayout: true })
  }

  /* ------------------------------ G6 引擎 ------------------------------ */

  _g6Config(config) {
    return {
      theme: config.theme,
      layout: config.layout || (this.payload?.racks ? 'g6-grid' : G6_DEFAULT_LAYOUT),
      showLabels: config.showLabels !== false,
      autoFit: config.autoFit !== false,
      animation: config.animation !== false,
      behaviors: config.behaviors,
      layoutOptions: config.layoutOptions || {},
      resolveOverlaps: config.resolveOverlaps !== false,
      style: buildStyleConfig(config),
      plugins: config.plugins,
      watermarkText: config.watermarkText,
    }
  }

  async _renderG6(config) {
    const { G6TopologyGraph } = await loadG6Module()
    const g6Config = this._g6Config(config)

    if (!this.g6) {
      this.g6 = new G6TopologyGraph(this.container, {
        ...g6Config,
        onHover: (info) => this._emitHover(info),
        onSelect: (info) => this._emitSelect(info),
        onEvent: (name, payload) => this.emit(name, payload),
        onContextAction: (payload) => this.callbacks.onContextAction?.(payload),
        onHistory: (payload) => this.callbacks.onHistory?.(payload),
      })
      await this.g6.mount(this.payload, g6Config)
      await this.g6.setStatusFilter(this.statuses)
      return
    }

    await this.g6.setData(this.payload, { relayout: true })
    await this.g6.setTheme(g6Config.theme)
    await this.g6.setLayout(g6Config.layout, g6Config.layoutOptions)
    await this.g6.setShowLabels(g6Config.showLabels)
    await this.g6.setStyle(g6Config.style)
    if (config.plugins) this.g6.setPluginFlags(config.plugins)
    await this.g6.setStatusFilter(this.statuses)
    if (g6Config.autoFit) await this.g6.fitView()
  }

  /* ------------------------------ Three.js 引擎 ------------------------------ */

  async _renderThree(config) {
    if (!this.three) {
      const { TopologyEngine } = await loadThreeModule()
      this.three = new TopologyEngine(this.container, {
        onHover: (info) => this._emitHover(info),
        onSelect: (info) => this._emitSelect(info),
        onStats: (info) => this.callbacks.onStats?.(info),
      })
    }

    this.three.setTheme(config.theme === 'light' ? 'light' : 'dark')
    this.three.setData(this.payload)
    this.three.setLayout(config.layout || 'force', { instant: true })
    this.three.setStatusFilter(this.statuses)
    this.three.setShowLabels(config.showLabels !== false)
    this.three.setAutoRotate(Boolean(config.autoRotate))
  }

  /* ------------------------------ 运行时控制 ------------------------------ */

  async setTheme(theme) {
    this.config.theme = theme
    if (this.g6) await this.g6.setTheme(theme)
    if (this.three) this.three.setTheme(theme === 'light' ? 'light' : 'dark')
    return this
  }

  async setLayout(layout, layoutOptions) {
    this.config.layout = layout
    if (layoutOptions) this.config.layoutOptions = layoutOptions
    if (this.g6) await this.g6.setLayout(layout, layoutOptions)
    if (this.three) this.three.setLayout(layout, { instant: false })
    return this
  }

  /**
   * 只更新当前布局参数，不切换布局。
   *
   * 典型场景：运行时开关 2.5D 透视（`{ perspective: false }`）。
   * 会与已有 `layoutOptions` 合并，并触发一次重新布局与渲染。
   */
  async setLayoutOptions(layoutOptions) {
    this.config.layoutOptions = {
      ...(this.config.layoutOptions || {}),
      ...(layoutOptions || {}),
    }
    if (this.g6) await this.g6.setLayoutOptions?.(this.config.layoutOptions)
    return this
  }

  /**
   * 重新整理当前布局。
   *
   * G6 的 Combo 分层布局支持拖拽 Combo 面板；拖动后调用本方法可恢复
   * 分层的默认位置。Three.js 模式仅重新适配视图。
   */
  async relayout() {
    if (this.g6) await this.g6.relayout()
    else this.three?.fitView(true)
    return this
  }

  /** 检查 Combo 分层是否存在重叠；非 G6 / 非 Combo 模式返回 ok */
  checkOverlaps(options) {
    return (
      this.g6?.checkOverlaps?.(options) || {
        ok: true,
        nodes: [],
        groups: [],
        layers: [],
      }
    )
  }

  async setStatusFilter(statuses) {
    this.statuses = normalizeStatuses(statuses)
    this.config.statusFilter = this.statuses
    await this.g6?.setStatusFilter(this.statuses)
    this.three?.setStatusFilter(this.statuses)
    return this
  }

  async setShowLabels(value) {
    this.config.showLabels = value !== false
    await this.g6?.setShowLabels(value)
    this.three?.setShowLabels(value)
    return this
  }

  async setStyle(style = {}) {
    this.config.style = style
    if (this.g6) {
      await this.g6.setStyle(buildStyleConfig({ ...this.config, style }))
    }
    return this
  }

  setPluginFlags(flags = {}) {
    this.config.plugins = { ...(this.config.plugins || {}), ...flags }
    this.g6?.setPluginFlags(flags)
    return this
  }

  getPluginFlags() {
    return this.g6?.getPluginFlags() || { ...(this.config.plugins || {}) }
  }

  select(id, options) {
    this.g6?.select(id, options)
    this.three?.select(id, { fly: true })
    return this
  }

  focus(id) {
    this.g6?.focus(id)
    this.three?.focusNode(id)
    return this
  }

  clearSelection() {
    this.g6?.clearSelection()
    this.three?.select(null)
    return this
  }

  async fitView() {
    if (this.g6) await this.g6.fitView()
    this.three?.fitView(true)
    return this
  }

  async zoomBy(ratio) {
    await this.g6?.zoomBy(ratio)
    return this
  }

  async zoomTo(value) {
    await this.g6?.zoomTo(value)
    return this
  }

  async resetZoom() {
    await this.g6?.resetZoom()
    return this
  }

  async toggleFullscreen() {
    await this.g6?.toggleFullscreen()
    return this
  }

  undo() {
    return this.g6?.undo?.() || false
  }

  redo() {
    return this.g6?.redo?.() || false
  }

  canUndo() {
    return this.g6?.canUndo?.() || false
  }

  canRedo() {
    return this.g6?.canRedo?.() || false
  }

  /* ------------------------------ 分析能力 ------------------------------ */

  highlightNeighbors(id, options) {
    return this.g6?.highlightNeighbors(id, options) || null
  }

  analyzeImpact(id, options) {
    return this.g6?.analyzeImpact(id, options) || null
  }

  findPath(source, target, options) {
    return (
      this.g6?.findPath(source, target, options) || {
        found: false,
        nodes: [],
        edges: [],
        distance: Infinity,
      }
    )
  }

  highlightSearch(query) {
    return this.g6?.highlightSearch(query) || []
  }

  clearHighlight() {
    this.g6?.clearHighlight()
    return this
  }

  getEmphasis() {
    return this.g6?.getEmphasis?.() || null
  }

  /* ------------------------------ 实时通道 ------------------------------ */

  connectRealtime(config = {}) {
    this.disconnectRealtime()
    this._realtime = createRealtimeClient({
      scene: this.config.scene || this.rootPayload?.meta?.scene || 'network',
      protocol: config.protocol,
      url: config.url,
      onData: (data) => {
        this.updateData(data).catch((error) => {
          console.error('[TopologySDK] 实时数据更新失败', error)
        })
      },
      onStatus: (status, detail) => {
        this.config.realtimeStatus = status
        this._emitView(TOPOLOGY_EVENTS.REALTIME_STATUS, { status, ...detail })
      },
      onError: (error) => {
        this._emitView(TOPOLOGY_EVENTS.REALTIME_STATUS, {
          status: 'error',
          message: error.message,
        })
      },
    })
    this._realtime.connect()
    return this
  }

  disconnectRealtime() {
    if (this._realtime) {
      this._realtime.close()
      this._realtime = null
    }
    return this
  }

  getRealtimeStatus() {
    return this._realtime?.status || 'off'
  }

  /* ------------------------------ 导出 / 状态 ------------------------------ */

  resize(width, height) {
    if (this.g6) this.g6.resize(width, height)
    this.three?.resize()
    return this
  }

  async toDataURL() {
    if (this.g6) return this.g6.toDataURL()
    return this.three?.capture?.() || ''
  }

  toSVG() {
    return this.g6?.toSVG?.() || ''
  }

  toJSON() {
    if (this.g6) return this.g6.toJSON()
    return this.payload ? JSON.parse(JSON.stringify(this.payload)) : null
  }

  getState() {
    return {
      engine: this.engine,
      theme: this.config.theme,
      layout: this.config.layout,
      showLabels: this.config.showLabels !== false,
      statusFilter: [...this.statuses],
      aggregation: this.aggregation,
      drill: this.drillStack.map((entry) => entry.id),
      plugins: this.g6?.getPluginFlags?.() || { ...(this.config.plugins || {}) },
    }
  }

  async applyState(state = {}) {
    if (state.theme) await this.setTheme(state.theme)
    if (state.layout) await this.setLayout(state.layout)
    if (state.showLabels != null) await this.setShowLabels(state.showLabels)
    if (state.statusFilter) await this.setStatusFilter(state.statusFilter)
    if (state.plugins) this.setPluginFlags(state.plugins)
    if (state.aggregation !== undefined) await this.setAggregation(state.aggregation)
    if (Array.isArray(state.drill)) {
      this.drillStack = []
      for (const id of state.drill) {
        const ok = await this.drillDown(id)
        if (!ok) break
      }
    }
    return this
  }

  _emitView(event, payload) {
    this.emit(event, payload)
    if (this.g6?.graph) {
      try {
        this.g6.graph.emit(event, payload)
      } catch {
        // G6 实例可能已销毁
      }
    }
  }

  /* ------------------------------ 回调 / 销毁 ------------------------------ */

  _emitHover(info) {
    this.callbacks.onHover?.(info)
    // G6 控制器会通过 onEvent 统一抛出 hover:change，这里只处理 Three.js 引擎
    if (this.engine !== 'g6') this.emit(TOPOLOGY_EVENTS.HOVER_CHANGE, info)
  }

  _emitSelect(info) {
    this.selectedId = info?.id || null
    this.callbacks.onSelect?.(info)
    if (this.engine !== 'g6') this.emit(TOPOLOGY_EVENTS.SELECTION_CHANGE, info)
  }

  _disposeRenderer() {
    this.disconnectRealtime()
    if (this.g6) {
      this.g6.destroy()
      this.g6 = null
    }
    if (this.three) {
      this.three.dispose()
      this.three = null
    }
  }

  destroy() {
    this._disposeRenderer()
    this.destroyed = true
    this._listeners.clear()
    views.delete(this.container)
  }
}

/**
 * 业务页面主入口：
 *
 * ```js
 * await loadGraph(data, {
 *   container: '#topo',
 *   engine: 'g6',
 *   layout: 'g6-dagre',
 *   theme: 'light',
 *   style: { node: { fill: '#fff' }, edge: { stroke: '#9cc' } },
 * })
 * ```
 */
export async function loadGraph(data, config = {}) {
  const container = resolveContainer(config.container || config.el || defaultContainer())
  const engine = config.engine === 'three' ? 'three' : 'g6'

  let view = views.get(container)
  if (!view || view.destroyed || view.engine !== engine) {
    view?.destroy()
    view = new TopologyView(container, config)
    views.set(container, view)
  }

  await view.loadGraph(data, config)
  return view
}

export function getGraphView(container) {
  const el = typeof container === 'string' ? document.querySelector(container) : container
  return el ? views.get(el) || null : null
}

/** 快捷获取底层 G6 Graph 实例（Three.js 引擎返回 null） */
export function getGraph(container) {
  return getGraphView(container)?.graph || null
}

export async function updateGraph(data, config = {}) {
  const container = resolveContainer(config.container || config.el || defaultContainer())
  const view = views.get(container)
  if (!view) return loadGraph(data, config)
  if (config.onHover !== undefined) view.callbacks.onHover = config.onHover
  if (config.onSelect !== undefined) view.callbacks.onSelect = config.onSelect
  return view.updateData(data, config)
}

export function destroyGraph(container) {
  const el = typeof container === 'string' ? document.querySelector(container) : container
  const view = el ? views.get(el) : null
  if (!view) return false
  view.destroy()
  return true
}

export { resolveContainer, normalizeData, buildStyleConfig }
