/**
 * 「分层 Group」运行时
 *
 * Group 版没有 Combo 的父子关系，面板的位置 / 尺寸 / 拖拽联动
 * 必须由运行时显式维护。本类只做四件事：
 *
 * 1. 拖面板：把同一逻辑层的所有节点按相同位移一起移动；
 * 2. 拖节点：按节点渲染包围盒重新拟合面板尺寸，保证节点不探出梯形；
 * 3. 松手：把重叠的面板按纵向顺序推开，并恢复均匀层距；
 * 4. 层级：让跨层连线「源层在下、目标层在上」，与 Combo 版一致。
 *
 * 梯形内角、内边距、斜率全部在本文件内独立计算，
 * 不引用 Combo 布局或 Combo 配置。
 */

import {
  GROUP_LAYER_DEFAULTS,
  groupTrapezoidSlope,
  isGroupPanelData,
} from './groupConfig.js'
import { findRectOverlaps, rectFromTopLeft, separateRectRows } from './collision.js'

/** 面板拟合时预留的视觉余量，避免斜边刚好切在节点包围盒角上 */
const GROUP_FIT_MARGIN = 4

const Z_LAYER_STEP = 100
const Z_LAYER_BASE = 100
const Z_EDGE_OFFSET = 40
const Z_NODE_OFFSET = 60

function parsePadding(padding) {
  if (Array.isArray(padding)) {
    const [top = 0, right = top, bottom = top, left = right] = padding.map(
      (item) => Number(item) || 0,
    )
    return [top, right, bottom, left]
  }
  const value = Number(padding) || 0
  return [value, value, value, value]
}

function unionBox(rects) {
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
 * 计算把内容矩形包进梯形面板所需的左右内边距。
 *
 * - 有斜率：顶边收窄量 = 斜率 × 高度，内角只由斜率决定；
 * - 无斜率：按统一灭点射线计算。
 */
function requiredSidePadding({ rects, padding, origin, slopes }) {
  const [padTop, padRight, padBottom, padLeft] = padding
  if (!Array.isArray(rects) || !rects.length) {
    return [padTop, padRight, padBottom, padLeft]
  }
  const union = unionBox(rects)
  if (!union) return [padTop, padRight, padBottom, padLeft]

  if (Array.isArray(slopes) && slopes.length === 2) {
    const slopeLeft = Number(slopes[0])
    const slopeRight = Number(slopes[1])
    if (Number.isFinite(slopeLeft) && Number.isFinite(slopeRight)) {
      const panelBottom = union.bottom + padBottom
      let left = padLeft
      let right = padRight
      for (const rect of rects) {
        const drop = panelBottom - rect.top
        if (!(drop > 0)) continue
        left = Math.max(left, union.left - rect.left + slopeLeft * drop)
        right = Math.max(right, rect.right - union.right + slopeRight * drop)
      }
      return [
        padTop,
        Math.max(right, 0) + GROUP_FIT_MARGIN,
        padBottom,
        Math.max(left, 0) + GROUP_FIT_MARGIN,
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
      left = Math.max(left, union.left - originX - (rect.left - originX) / t)
      right = Math.max(right, (rect.right - originX) / t - (union.right - originX))
    }
  }

  return [
    padTop,
    Math.max(right, 0) + GROUP_FIT_MARGIN,
    padBottom,
    Math.max(left, 0) + GROUP_FIT_MARGIN,
  ]
}

export class GroupLayerRuntime {
  constructor(controller) {
    this.controller = controller
    this._drag = null
    this._pendingGrow = null
    this._resolving = false
  }

  get graph() {
    return this.controller.graph
  }

  get options() {
    return this.controller._layoutOptions()
  }

  /* ------------------------------ 查询 ------------------------------ */

  panels() {
    const nodes = this.graph?.getData()?.nodes || []
    return nodes.filter((node) => isGroupPanelData(node.data))
  }

  panelById(panelId) {
    return (
      this.panels().find((panel) => String(panel.id) === String(panelId)) || null
    )
  }

  membersOf(panelId) {
    const nodes = this.graph?.getData()?.nodes || []
    return nodes.filter(
      (node) =>
        !isGroupPanelData(node.data) &&
        String(node.data?.__groupPanelId || '') === String(panelId),
    )
  }

  /** 面板几何矩形（世界坐标） */
  panelRect(panel) {
    if (!panel || !this.graph) return null
    const size = panel.style?.size || panel.data?.size || [0, 0]
    const width = Number(size[0]) || 0
    const height = Number(size[1]) || 0
    let position = null
    try {
      position = this.graph.getElementPosition(panel.id)
    } catch {
      position = null
    }
    const x = Number(position?.[0] ?? panel.style?.x) || 0
    const y = Number(position?.[1] ?? panel.style?.y) || 0
    return rectFromTopLeft(panel.id, x - width / 2, y - height / 2, width, height)
  }

  _minLayerGap() {
    const options = this.options || {}
    return (
      Math.max(
        Number(options.minLayerGap) || GROUP_LAYER_DEFAULTS.minLayerGap,
        8,
      ) + Math.max(0, Number(options.safetyGap) || 0)
    )
  }

  _basePadding() {
    const options = this.options || {}
    return parsePadding(
      options.layerPadding ?? GROUP_LAYER_DEFAULTS.layerPadding,
    )
  }

  /**
   * 面板当前应使用的左右斜率。
   *
   * - 自定义倾角：直接返回 [slope, slope]，拖动、变宽、变高都不变；
   * - 灭点模式：按面板矩形与灭点算一次并冻结，避免拖动时内角跟着变。
   */
  _slopesForPanel(panel) {
    const slope = groupTrapezoidSlope(this.options)
    if (slope != null) return [slope, slope]

    const frozen = panel?.data?.__groupSlopes
    if (Array.isArray(frozen) && frozen.length === 2) return frozen

    const origin = this.controller._perspectiveOrigin
    const rect = this.panelRect(panel)
    if (!Array.isArray(origin) || !rect) return null
    const originX = Number(origin[0])
    const originY = Number(origin[1])
    const distance = rect.bottom - originY
    if (!(distance > 1)) return null
    return [(originX - rect.left) / distance, (rect.right - originX) / distance]
  }

  /* ------------------------------ 层级 ------------------------------ */

  /**
   * 越靠上的层 zIndex 越高；节点浮在自己面板之上；
   * 跨层边取「较近层」的区间，从而“源层遮线、目标层露线”。
   */
  async applyZOrder() {
    if (!this.graph || this.controller.destroying) return
    const data = this.graph.getData()
    const panels = (data.nodes || []).filter((node) =>
      isGroupPanelData(node.data),
    )
    if (!panels.length) return

    const ordered = panels
      .map((panel, index) => {
        const rect = this.panelRect(panel)
        return {
          id: String(panel.id),
          groupId: String(panel.data?.groupId || ''),
          top: Number.isFinite(rect?.top) ? rect.top : null,
          order: Number(panel.data?.order ?? index),
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
      depthIndex.set(item.groupId, index)
      depthZ.push(Z_LAYER_BASE + (ordered.length - index) * Z_LAYER_STEP)
    })

    const zIndexes = {}
    ordered.forEach((item, index) => {
      zIndexes[item.id] = depthZ[index]
    })

    const groupOfNode = new Map()
    for (const node of data.nodes || []) {
      if (isGroupPanelData(node.data)) continue
      const groupId = String(node.data?.__groupId || '')
      if (!groupId) continue
      groupOfNode.set(String(node.id), groupId)
      const index = depthIndex.get(groupId)
      if (index == null) continue
      zIndexes[String(node.id)] = depthZ[index] + Z_NODE_OFFSET
    }

    for (const edge of data.edges || []) {
      const sourceIndex = depthIndex.get(groupOfNode.get(String(edge.source)))
      const targetIndex = depthIndex.get(groupOfNode.get(String(edge.target)))
      if (sourceIndex == null && targetIndex == null) continue
      const near = Math.max(sourceIndex ?? -1, targetIndex ?? -1)
      if (near < 0) continue
      zIndexes[String(edge.id)] = depthZ[near] + Z_EDGE_OFFSET
    }

    const changes = {}
    let count = 0
    const elementRegistry = this.graph.context?.element
    for (const [id, value] of Object.entries(zIndexes)) {
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

  /* ------------------------------ 拖拽 ------------------------------ */

  beginDrag(event) {
    const id = event?.target?.id ? String(event.target.id) : null
    if (!id || !this.graph) return

    const panel = this.panelById(id)
    if (panel) {
      // 灭点模式下先把当前斜率冻结到数据里，拖动过程中形状不再变化
      const slopes = this._slopesForPanel(panel)
      if (Array.isArray(slopes)) {
        panel.data = { ...(panel.data || {}), __groupSlopes: slopes }
        this.graph.updateNodeData([{ id: panel.id, data: { __groupSlopes: slopes } }])
      }
      let position = [0, 0]
      try {
        position = this.graph.getElementPosition(id) || [0, 0]
      } catch {
        position = [Number(panel.style?.x) || 0, Number(panel.style?.y) || 0]
      }
      this._drag = {
        type: 'panel',
        panelId: id,
        last: [Number(position[0]) || 0, Number(position[1]) || 0],
      }
      return
    }

    const node = (this.graph.getData().nodes || []).find(
      (item) => String(item.id) === id,
    )
    const panelId = node?.data?.__groupPanelId
    if (panelId) {
      this._drag = {
        type: 'node',
        nodeId: id,
        panelId: String(panelId),
      }
    }
  }

  drag() {
    const drag = this._drag
    if (!drag || !this.graph) return

    if (drag.type === 'panel') {
      const position = this.graph.getElementPosition(drag.panelId) || drag.last
      const dx = Number(position[0]) - drag.last[0]
      const dy = Number(position[1]) - drag.last[1]
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return
      drag.last = [Number(position[0]), Number(position[1])]

      const members = this.membersOf(drag.panelId)
      if (!members.length) return
      const offsets = {}
      for (const member of members) offsets[String(member.id)] = [dx, dy]
      // 关掉动画，避免节点滞后于面板
      this.graph.translateElementBy(offsets, false).catch(() => {})
      return
    }

    if (drag.type === 'node') this._queueGrow(drag.panelId)
  }

  endDrag() {
    const drag = this._drag
    this._drag = null
    this._pendingGrow = null
    if (!drag) return

    // 面板 / 层内节点被手动拖过：通知控制器，折叠时不要再还原展开前的快照
    this.controller._notePanelEdited?.(drag.panelId)

    if (drag.type === 'node') this.syncPanel(drag.panelId, { draw: false })
    this.syncAllPanels({ draw: false })
    this.resolvePanels()
    this.applyZOrder().catch(() => {})
    // 通知控制器归一化保存被拖节点位置（面板拖动不写，相对关系未变）
    this.controller._onGroupDragEnd?.(drag)
  }

  /** 每帧最多拟合一次面板，避免 pointermove 高频重绘 */
  _queueGrow(panelId) {
    if (this._pendingGrow === panelId) return
    this._pendingGrow = panelId
    const run = () => {
      this._pendingGrow = null
      this.syncPanel(panelId)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  /* ------------------------------ 面板拟合 ------------------------------ */

  /**
   * 按面板内节点的真实渲染包围盒重新拟合面板。
   *
   * 水平内边距使用本地 `requiredSidePadding()`：顶边越窄的位置需要更大的
   * 左右 padding，从而保证节点永远落在梯形内部；斜率同时写回面板，
   * 保证拖动过程中内角完全不变。
   */
  syncPanel(panelId, { draw = true } = {}) {
    if (!this.graph || this.controller.destroying) return false
    const panel = this.panelById(panelId)
    if (!panel) return false

    const rects = []
    for (const member of this.membersOf(panelId)) {
      const rect = this.controller._renderRectOf(member.id)
      if (!rect) continue
      rects.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }
    if (!rects.length) return false

    const union = unionBox(rects)
    if (!union) return false

    const padding = this._basePadding()
    const slopes = this._slopesForPanel(panel)
    const fitted = requiredSidePadding({
      rects,
      padding,
      origin: this.controller._perspectiveOrigin,
      slopes,
    })
    const [padTop, padRight, padBottom, padLeft] = fitted

    const left = union.left - padLeft
    const right = union.right + padRight
    const top = union.top - padTop
    const bottom = union.bottom + padBottom
    const width = Math.max(40, right - left)
    const height = Math.max(32, bottom - top)
    const x = (left + right) / 2
    const y = (top + bottom) / 2

    const currentSize = panel.style?.size || [0, 0]
    let currentPos = [x, y]
    try {
      currentPos = this.graph.getElementPosition(panel.id) || currentPos
    } catch {
      // 元素可能已被删除
    }
    const sameSlopes =
      !Array.isArray(slopes) ||
      (Array.isArray(panel.style?.sideSlopes) &&
        Math.abs(Number(panel.style.sideSlopes[0]) - slopes[0]) < 0.0005 &&
        Math.abs(Number(panel.style.sideSlopes[1]) - slopes[1]) < 0.0005)
    const same =
      sameSlopes &&
      Math.abs(Number(currentSize[0]) - width) < 0.5 &&
      Math.abs(Number(currentSize[1]) - height) < 0.5 &&
      Math.abs(Number(currentPos[0]) - x) < 0.5 &&
      Math.abs(Number(currentPos[1]) - y) < 0.5
    if (same) return false

    const stylePatch = { x, y, size: [width, height] }
    if (Array.isArray(slopes)) {
      stylePatch.sideSlopes = slopes
      panel.data = { ...(panel.data || {}), __groupSlopes: slopes }
    }
    panel.style = { ...(panel.style || {}), ...stylePatch }
    this.graph.updateNodeData([{ id: panel.id, style: stylePatch }])
    if (draw) this.graph.draw({ animation: false }).catch(() => {})
    return true
  }

  syncAllPanels({ draw = true } = {}) {
    let changed = false
    for (const panel of this.panels()) {
      if (this.syncPanel(panel.id, { draw: false })) changed = true
    }
    if (changed && draw) this.graph.draw({ animation: false }).catch(() => {})
    return changed
  }

  /* ------------------------------ 防重叠 ------------------------------ */

  /**
   * 松手后把相互重叠的面板按纵向顺序推开。
   *
   * 平移面板时同步平移它的成员，保持层内相对布局不变；
   * 只调整纵向位置，不改变层序。
   */
  async resolvePanels() {
    if (!this.graph || this.controller.destroying) return
    if (this._resolving) return
    this._resolving = true
    try {
      const panels = this.panels()
      if (panels.length < 2) return

      // 先确保每个面板都包住自己的节点，再测面板之间的重叠
      this.syncAllPanels({ draw: true })

      const rects = panels.map((panel) => this.panelRect(panel)).filter(Boolean)
      if (!findRectOverlaps(rects, 4).length) return

      const shifts = separateRectRows(rects, this._minLayerGap())
      const offsets = {}
      for (const panel of panels) {
        const dy = Number(shifts.get(panel.id) || 0)
        if (Math.abs(dy) < 0.5) continue
        offsets[String(panel.id)] = [0, dy]
        for (const member of this.membersOf(panel.id)) {
          offsets[String(member.id)] = [0, dy]
        }
      }
      if (!Object.keys(offsets).length) return
      await this.graph.translateElementBy(offsets, false)
      await this.controller._waitFrames?.(1, 80)
      this.applyZOrder().catch(() => {})
    } finally {
      this._resolving = false
    }
  }

  /** 调试用：检查面板之间、节点之间是否存在重叠 */
  checkOverlaps({ gap = 0 } = {}) {
    if (!this.graph) return { ok: false, reason: 'no-graph' }
    const data = this.graph.getData()
    const panels = this.panels()
      .map((panel) => this.panelRect(panel))
      .filter(Boolean)
    const panelOverlaps = findRectOverlaps(panels, gap)

    const nodes = []
    for (const node of data.nodes || []) {
      if (isGroupPanelData(node.data)) continue
      const rect = this.controller._renderRectOf(node.id)
      if (rect) nodes.push(rect)
    }
    const nodeOverlaps = findRectOverlaps(nodes, gap)

    return {
      ok: panelOverlaps.length === 0 && nodeOverlaps.length === 0,
      panels: panelOverlaps.map(([a, b]) => [a.id, b.id]),
      nodes: nodeOverlaps.slice(0, 20).map(([a, b]) => [a.id, b.id]),
      panelCount: panels.length,
      nodeCount: nodes.length,
    }
  }
}

export default GroupLayerRuntime
