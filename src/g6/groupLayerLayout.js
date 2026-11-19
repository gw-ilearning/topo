/**
 * G6 5 自研「分层 Group」布局（2.5D 透视 + 梯形分组面板）
 *
 * 这是一套**完全独立**的布局实现，不继承 `ComboLayerLayout`，也不读取愿意
 * 任何 Combo 结构：
 *
 * 1. 数据层：节点按 `data.__groupId` 归属到逻辑层，`data.group` 只用于层内聚类；
 * 2. 布局层：自己计算层内网格、聚类排布、层堆叠与 2.5D 缩放；
 * 3. 输出层：同时写节点坐标和**面板节点**的坐标 / 尺寸 / 梯形斜率。
 *
 * 面板是普通节点，因此这里不返回 `combos`，G6 也不会替我们推导包围盒。
 */

import { BaseLayout, register } from '@antv/g6'
import { findRectOverlaps, rectFromTopLeft, separateRectRows } from './collision.js'
import {
  GROUP_LAYER_DEFAULTS,
  GROUP_LAYER_LAYOUT_ID,
  groupLayerScale,
  groupPanelId,
  groupTrapezoidSlope,
} from './groupConfig.js'
import { g6NodeSize } from './theme.js'

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeSize(size) {
  if (Array.isArray(size)) {
    const width = Number(size[0])
    const height = Number(size[1] ?? size[0])
    return [
      Number.isFinite(width) ? width : 32,
      Number.isFinite(height) ? height : 32,
    ]
  }
  const value = Number(size)
  return Number.isFinite(value) ? [value, value] : [32, 32]
}

function parsePadding(padding) {
  if (Array.isArray(padding)) {
    const [top = 0, right = top, bottom = top, left = right] = padding.map(
      (item) => Number(item) || 0,
    )
    return { top, right, bottom, left }
  }
  const value = Number(padding) || 0
  return { top: value, right: value, bottom: value, left: value }
}

/** 层顺序：优先面板节点的 order，其次 layer，最后按创建顺序 */
function orderOf(panel, fallback = 0) {
  const candidates = [panel?.data?.order, panel?.data?.layer, fallback]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) return value
  }
  return fallback
}

/** 层内聚类键：只用于把语义相关的节点排在一起，不生成子面板 */
function clusterKeyOf(node) {
  const data = node.data || {}
  if (data.kind === 'rack') return String(data.row || '机柜')
  return String(data.group || data.type || '__cluster__')
}

/** 粗略估算文字宽度：中文按 1em，英文数字按 0.56em */
function measureTextWidth(text, fontSize) {
  let units = 0
  for (const char of String(text || '')) {
    if (CJK_RE.test(char)) units += 1
    else if (char === ' ') units += 0.32
    else units += 0.56
  }
  return units * fontSize
}

export class GroupLayerLayout extends BaseLayout {
  constructor(context, options) {
    super(context, options)
    this.id = GROUP_LAYER_LAYOUT_ID
  }

  /** 节点基础尺寸：优先业务 nodeSize，其次 G6 主题规则 */
  _baseNodeSize(node, options) {
    const custom = options.nodeSize
    if (typeof custom === 'function') {
      try {
        return normalizeSize(custom(node, node.data || {}))
      } catch {
        // 业务函数异常时回退主题尺寸
      }
    } else if (custom != null) {
      return normalizeSize(custom)
    }
    return normalizeSize(g6NodeSize(node.data || {}))
  }

  /** 节点块尺寸：本体 + 下方标签，用于防止标签压住相邻节点 */
  _nodeBlock(node, scale, options) {
    const data = node.data || {}
    const [baseWidth, baseHeight] = this._baseNodeSize(node, options)
    const width = baseWidth * scale
    const height = baseHeight * scale
    const show = data.hideLabel !== true
    const font = (data.kind === 'rack' ? 11 : 10.5) * scale
    const offsetY = (data.kind === 'rack' ? 10 : 7) * scale
    const labelWidth = show
      ? Math.min(280, measureTextWidth(data.name || data.id || '', font) + 14)
      : 0
    const labelHeight = show ? font * 1.25 + 2 + offsetY : 0
    const reserve = Math.max(Number(options.nodeLabelGap) * scale || 0, labelHeight)

    return {
      width,
      height,
      labelWidth,
      labelHeight,
      blockWidth: Math.max(width, labelWidth),
      blockHeight: height + reserve,
      reserve,
    }
  }

  /**
   * 构建「层 -> 聚类 -> 节点」结构。
   *
   * 面板节点不参与聚类；成员节点按 `data.__groupId` 归层，
   * 没有分组信息时退化为按 `layer` 分一层，保证布局始终可用。
   */
  _buildStructure(data) {
    const allNodes = data.nodes || []
    const panelByGroup = new Map()
    for (const node of allNodes) {
      if (node.data?.kind !== 'layer-panel') continue
      panelByGroup.set(String(node.data.groupId), node)
    }

    const layerMap = new Map()
    const ensureLayer = (groupId) => {
      if (!layerMap.has(groupId)) {
        const panel = panelByGroup.get(groupId)
        layerMap.set(groupId, {
          id: groupId,
          panel,
          panelId: String(panel?.id || groupPanelId(groupId)),
          order: orderOf(panel, layerMap.size),
          clusters: [],
          clusterById: new Map(),
        })
      }
      return layerMap.get(groupId)
    }

    const nodes = allNodes.filter((node) => node.data?.kind !== 'layer-panel')
    for (const node of nodes) {
      let groupId = node.data?.__groupId ? String(node.data.__groupId) : null
      if (!groupId) {
        const raw = node.data?.layer
        groupId = raw != null && raw !== '' ? `group:${raw}` : 'group:__all__'
      }

      const layer = ensureLayer(groupId)
      const key = clusterKeyOf(node)
      let cluster = layer.clusterById.get(key)
      if (!cluster) {
        cluster = {
          id: `${groupId}::${key}`,
          key,
          nodes: [],
          order: layer.clusterById.size,
        }
        layer.clusterById.set(key, cluster)
        layer.clusters.push(cluster)
      }
      cluster.nodes.push(node)
    }

    const layers = [...layerMap.values()].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return String(a.id).localeCompare(String(b.id))
    })
    for (const layer of layers) {
      layer.clusters.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        return String(a.id).localeCompare(String(b.id))
      })
    }

    return { layers }
  }

  /**
   * 计算一层内所有聚类的尺寸、节点本地坐标，并做节点 / 聚类两级防重叠。
   */
  _layoutLayer(layer, index, count, options) {
    const scale = groupLayerScale(index, count, options)
    const depth =
      options.perspective === false || !(count > 1) ? 0 : 1 - index / (count - 1)
    const nodeGap = Math.max(
      8,
      Number(options.nodeGap) || GROUP_LAYER_DEFAULTS.nodeGap,
    )
    const clusterGap =
      Math.max(
        Number(options.minClusterGap ?? options.minGroupGap) ||
          GROUP_LAYER_DEFAULTS.minClusterGap,
        (Number(options.clusterGap ?? options.groupGap) ||
          GROUP_LAYER_DEFAULTS.clusterGap) * scale,
      ) + Math.max(0, Number(options.safetyGap) || 0)
    const maxCols = Math.max(
      1,
      Math.floor(Number(options.nodeCols) || GROUP_LAYER_DEFAULTS.nodeCols),
    )
    const maxLayerWidth = Math.max(
      240 * scale,
      (Number(options.maxLayerWidth) || GROUP_LAYER_DEFAULTS.maxLayerWidth) * scale,
    )
    const scaledNodeGap = nodeGap * scale
    const taperTopScale = clamp(Number(layer.taperTopScale) || 1, 0.25, 1)

    for (const cluster of layer.clusters) {
      const blocks = cluster.nodes.map((node) =>
        this._nodeBlock(node, scale, options),
      )
      const nodeCount = Math.max(1, blocks.length)
      const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(nodeCount))))
      const rows = Math.ceil(nodeCount / cols)
      const maxBlockWidth = Math.max(1, ...blocks.map((block) => block.blockWidth))
      const maxBlockHeight = Math.max(1, ...blocks.map((block) => block.blockHeight))
      // 水平间距按梯形顶部压缩比补偿：顶部被压缩后仍要留出足够间隙
      const requiredCellWidth = (maxBlockWidth + 2) / taperTopScale
      const horizontalGap = Math.max(
        scaledNodeGap,
        requiredCellWidth - maxBlockWidth,
      )
      const cellWidth = maxBlockWidth + horizontalGap
      const cellHeight = maxBlockHeight + scaledNodeGap
      const gridWidth = cols * cellWidth - horizontalGap

      cluster.scale = scale
      cluster.blocks = blocks
      cluster.cols = cols
      cluster.rows = rows
      cluster.cellWidth = cellWidth
      cluster.cellHeight = cellHeight
      cluster.gridWidth = gridWidth

      const entries = cluster.nodes.map((node, nodeIndex) => {
        const block = blocks[nodeIndex]
        const col = nodeIndex % cols
        const row = Math.floor(nodeIndex / cols)
        return {
          node,
          block,
          x: col * cellWidth + cellWidth / 2,
          y: row * cellHeight + block.height / 2,
        }
      })

      // 节点块兜底碰撞
      const nodeRects = entries.map((entry) =>
        rectFromTopLeft(
          `${cluster.id}::${entry.node.id}`,
          entry.x - entry.block.blockWidth / 2,
          entry.y - entry.block.height / 2,
          entry.block.blockWidth,
          entry.block.blockHeight,
        ),
      )
      if (findRectOverlaps(nodeRects, 0).length) {
        const shifts = separateRectsLocal(nodeRects, 'auto')
        for (let i = 0; i < entries.length; i += 1) {
          const shift = shifts.get(nodeRects[i].id)
          if (!shift) continue
          entries[i].x += shift.dx
          entries[i].y += shift.dy
        }
      }

      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const entry of entries) {
        minX = Math.min(minX, entry.x - entry.block.blockWidth / 2)
        maxX = Math.max(maxX, entry.x + entry.block.blockWidth / 2)
        minY = Math.min(minY, entry.y - entry.block.height / 2)
        maxY = Math.max(maxY, entry.y + entry.block.height / 2)
      }

      cluster.width = Math.max(0, maxX - minX)
      cluster.height = Math.max(0, maxY - minY)
      cluster.entries = entries.map((entry) => ({
        node: entry.node,
        x: entry.x - minX,
        y: entry.y - minY,
      }))
    }

    // 聚类按行排布，超过最大宽度换行
    const rows = []
    let row = null
    for (const cluster of layer.clusters) {
      const needNewRow =
        !row || (row.cursorX > 0 && row.cursorX + cluster.width > maxLayerWidth)
      if (needNewRow) {
        row = {
          clusters: [],
          cursorX: 0,
          width: 0,
          height: 0,
          y: 0,
          gap: clusterGap,
        }
        rows.push(row)
      }
      cluster.x = row.cursorX
      cluster.y = 0
      row.clusters.push(cluster)
      row.cursorX += cluster.width + clusterGap
      row.height = Math.max(row.height, cluster.height)
    }

    let rowY = 0
    for (const item of rows) {
      item.width = Math.max(0, item.cursorX - clusterGap)
      item.y = rowY
      rowY += item.height + clusterGap
      for (const cluster of item.clusters) cluster.y = item.y
    }

    // 每行在内容宽度内居中，上下行围绕同一中轴收拢
    const rowContentWidth = Math.max(0, ...rows.map((item) => item.width))
    for (const item of rows) {
      const offset = Math.max(0, (rowContentWidth - item.width) / 2)
      if (offset <= 0) continue
      for (const cluster of item.clusters) cluster.x += offset
    }

    // 聚类兜底碰撞：横向优先推开
    const clusterRects = layer.clusters.map((cluster) =>
      rectFromTopLeft(cluster.id, cluster.x, cluster.y, cluster.width, cluster.height),
    )
    if (findRectOverlaps(clusterRects, 0).length) {
      const shifts = separateRectsLocal(clusterRects, 'x')
      for (const cluster of layer.clusters) {
        const shift = shifts.get(cluster.id)
        if (!shift) continue
        cluster.x += shift.dx
        cluster.y += shift.dy
      }
    }

    const contentWidth = Math.max(
      0,
      ...layer.clusters.map((cluster) => cluster.x + cluster.width),
    )
    const contentHeight = Math.max(
      0,
      ...layer.clusters.map((cluster) => cluster.y + cluster.height),
    )

    layer.scale = scale
    layer.depth = depth
    layer.rows = rows
    layer.contentWidth = contentWidth
    layer.contentHeight = contentHeight
  }

  async execute(data) {
    const options = { ...GROUP_LAYER_DEFAULTS, ...(this.options || {}) }
    const layerPad = parsePadding(
      options.layerPadding ?? GROUP_LAYER_DEFAULTS.layerPadding,
    )
    const layerGap = Math.max(
      8,
      Number(options.layerGap) || GROUP_LAYER_DEFAULTS.layerGap,
    )
    const minLayerGap =
      Math.max(Number(options.minLayerGap) || GROUP_LAYER_DEFAULTS.minLayerGap, 8) +
      Math.max(0, Number(options.safetyGap) || 0)
    const depthShiftX = Math.max(0, Number(options.depthShiftX) || 0)
    const depthShiftY = Math.max(0, Number(options.depthShiftY) || 0)

    const { layers } = this._buildStructure(data)
    if (!layers.length) return { nodes: [], edges: [], combos: [] }

    const vanishingDistance = Math.max(
      0,
      Number(options.vanishingDistance ?? GROUP_LAYER_DEFAULTS.vanishingDistance),
    )

    const layoutLayers = () => {
      layers.forEach((layer, index) => {
        this._layoutLayer(layer, index, layers.length, options)
        layer.width = layer.contentWidth + layerPad.left + layerPad.right
        layer.height = layer.contentHeight + layerPad.top + layerPad.bottom
      })
    }

    const stackLayers = () => {
      const gaps = layers.map((layer, index) => {
        if (index === layers.length - 1) return 0
        const next = layers[index + 1]
        const midScale = (layer.scale + next.scale) / 2
        return Math.max(minLayerGap, layerGap * midScale)
      })

      const totalHeight =
        layers.reduce((sum, layer) => sum + layer.height, 0) +
        gaps.reduce((sum, gap) => sum + gap, 0)

      let cursorY = -totalHeight / 2
      layers.forEach((layer, index) => {
        layer.top = cursorY
        cursorY += layer.height + gaps[index]
      })

      const layerRects = layers.map((layer) =>
        rectFromTopLeft(layer.id, 0, layer.top, layer.width, layer.height),
      )
      if (findRectOverlaps(layerRects, 0).length) {
        const shifts = separateRectRows(layerRects, minLayerGap)
        for (const layer of layers) {
          layer.top += shifts.get(layer.id) || 0
        }
      }
    }

    const computeOrigin = () => {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const layer of layers) {
        const centerX = layer.depth * depthShiftX
        const top = layer.top - layer.depth * depthShiftY
        minX = Math.min(minX, centerX - layer.width / 2)
        maxX = Math.max(maxX, centerX + layer.width / 2)
        minY = Math.min(minY, top)
        maxY = Math.max(maxY, top + layer.height)
      }
      const height = Math.max(1, maxY - minY)
      return {
        x: (minX + maxX) / 2,
        y: minY - height * vanishingDistance,
      }
    }

    /* 第一遍：矩形布局 + 堆叠 + 灭点 */
    layoutLayers()
    stackLayers()
    const provisionalOrigin = computeOrigin()

    /* 第二遍：按梯形压缩比补偿水平间距 */
    for (const layer of layers) {
      const layerTop = layer.top - layer.depth * depthShiftY
      const contentTop = layerTop + layerPad.top
      const panelBottom = layerTop + layer.height
      const span = panelBottom - provisionalOrigin.y
      layer.taperTopScale = span > 0.0001 ? (contentTop - provisionalOrigin.y) / span : 1
    }
    layoutLayers()
    stackLayers()
    const origin = computeOrigin()

    const taperNodes = options.trapezoidNodes !== false && options.perspective !== false
    const globalMinTaper = clamp(
      Number(options.trapezoidMinScale) || 0.5,
      0.25,
      1,
    )
    const slope = groupTrapezoidSlope(options)
    const sideSlopes = slope == null ? undefined : [slope, slope]

    const center = Array.isArray(options.center) ? options.center : [0, 0]
    const offsetX = Number(center[0]) || 0
    const offsetY = Number(center[1]) || 0
    const result = []

    for (const layer of layers) {
      const layerLeft = -layer.width / 2 + layer.depth * depthShiftX
      const layerTop = layer.top - layer.depth * depthShiftY
      const contentLeft = layerLeft + layerPad.left
      const taperCenterX = origin.x
      const taperSpan = layerTop + layer.height - origin.y

      for (const cluster of layer.clusters) {
        const clusterLeft = cluster.x
        const clusterTop = layerTop + layerPad.top + cluster.y

        for (const entry of cluster.entries) {
          const absY = clusterTop + entry.y
          let taper = 1
          if (taperNodes && taperSpan > 0.0001) {
            taper = clamp((absY - origin.y) / taperSpan, globalMinTaper, 1)
          }
          const absX = contentLeft + clusterLeft + entry.x
          result.push({
            id: String(entry.node.id),
            style: {
              x: offsetX + taperCenterX + (absX - taperCenterX) * taper,
              y: offsetY + absY,
              z: 0,
            },
          })
        }
      }

      // 面板节点：普通节点，中心 = 层矩形中心，尺寸 = 层矩形
      result.push({
        id: layer.panelId,
        style: {
          x: offsetX + layerLeft + layer.width / 2,
          y: offsetY + layerTop + layer.height / 2,
          size: [layer.width, layer.height],
          sideSlopes,
          perspectiveOrigin: [origin.x, origin.y],
        },
      })
    }

    return { nodes: result, edges: [], combos: [] }
  }
}

/**
 * 本地矩形分离：只沿指定轴推开，避免布局文件反向依赖 Combo 布局的导出。
 * 与 `collision.separateRects` 的行为一致，但保持 Group 模块自包含。
 */
function separateRectsLocal(rects, axis = 'auto') {
  const shifts = new Map()
  for (const rect of rects) shifts.set(rect.id, { dx: 0, dy: 0 })
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      if (
        a.left >= b.right ||
        b.left >= a.right ||
        a.top >= b.bottom ||
        b.top >= a.bottom
      ) {
        continue
      }
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      const alongX = axis === 'x' || (axis === 'auto' && overlapX <= overlapY)
      const amount = (alongX ? overlapX : overlapY) / 2 + 0.5
      const aShift = shifts.get(a.id)
      const bShift = shifts.get(b.id)
      if (alongX) {
        const dir = a.left + a.width / 2 <= b.left + b.width / 2 ? -1 : 1
        aShift.dx += amount * dir
        bShift.dx -= amount * dir
      } else {
        const dir = a.top + a.height / 2 <= b.top + b.height / 2 ? -1 : 1
        aShift.dy += amount * dir
        bShift.dy -= amount * dir
      }
    }
  }
  return shifts
}

let registered = false

/** 注册自研 Group 分层布局，重复导入时保持幂等 */
export function registerGroupLayerLayout() {
  if (registered) return
  register('layout', GROUP_LAYER_LAYOUT_ID, GroupLayerLayout)
  registered = true
}

registerGroupLayerLayout()

export default GroupLayerLayout
