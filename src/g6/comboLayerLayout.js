/**
 * G6 5 自研「分层 Combo」布局（2.5D 透视 + 两级防重叠）
 *
 * 目标：
 * - 一级 Combo：层，按节点 `layer` 字段从上到下堆叠；
 * - 节点直接挂在层上，不再渲染二级分组 Combo；`group` 仅作为层内聚类的排布依据；
 * - 2.5D 透视：越靠上的层越远，节点、间距、标题按比例缩小，
 *   同时向斜上方错位，形成「一叠悬浮面板」的纵深效果；
 * - 两级碰撞：节点（含标签块）与层面板都不会相互重叠。
 *
 * 数据契约（由 src/g6/data.js 生成）：
 *   nodes:  [{ id, combo: 'layer:L2', data: { __comboScale: 1, group: '核心层' } }]
 *   combos: [
 *     { id: 'layer:L2', data: { kind: 'layer', name: 'L2 · 核心层', scale: 1 } },
 *   ]
 *
 * 注意：Combo 的最终坐标与尺寸由 G6 根据子元素 bbox + padding 自动推导。
 * 布局只写节点坐标，并保证计算出来的层矩形与 G6 的推导结果一致。
 */

import { BaseLayout, register } from '@antv/g6'
import {
  COMBO_LAYER_DEFAULTS,
  COMBO_LAYER_LAYOUT_ID,
  comboLayerScale,
} from './comboConfig.js'
import {
  findRectOverlaps,
  rectFromTopLeft,
  separateRectRows,
  separateRects,
} from './collision.js'
import { g6NodeSize } from './theme.js'

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/

function normalizeSize(size) {
  if (Array.isArray(size)) {
    const width = Number(size[0])
    const height = Number(size[1] ?? size[0])
    return [Number.isFinite(width) ? width : 32, Number.isFinite(height) ? height : 32]
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

function orderOf(combo, fallback = 0) {
  const candidates = [combo?.data?.order, combo?.data?.layer, fallback]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) return value
  }
  return fallback
}

/**
 * 层内聚类键：仅用于把语义相关的节点排在一起，不会生成分组面板。
 * 与数据层的分组规则保持一致：机柜按行，普通节点按 group，再回退到 type。
 */
function clusterKeyOf(node) {
  const data = node.data || {}
  if (data.kind === 'rack') return String(data.row || '机柜')
  return String(data.group || data.type || '__cluster__')
}

/** 粗略估算文字宽度：中文按 1em，英文数字按 0.55em，避免长标签互相压住 */
function measureTextWidth(text, fontSize) {
  let units = 0
  for (const char of String(text || '')) {
    if (CJK_RE.test(char)) units += 1
    else if (char === ' ') units += 0.32
    else units += 0.56
  }
  return units * fontSize
}

export class ComboLayerLayout extends BaseLayout {
  constructor(context, options) {
    super(context, options)
    this.id = COMBO_LAYER_LAYOUT_ID
  }

  /** 节点尺寸优先使用业务传入的 nodeSize，其次复用 G6 主题的尺寸规则 */
  _baseNodeSize(node, options) {
    const custom = options.nodeSize
    if (typeof custom === 'function') {
      try {
        return normalizeSize(custom(node, node.data || {}))
      } catch {
        // 业务函数异常时回退到主题尺寸
      }
    } else if (custom != null) {
      return normalizeSize(custom)
    }
    return normalizeSize(g6NodeSize(node.data || {}))
  }

  /** 节点标签块尺寸：节点本体 + 下方标签，用于防止标签与相邻节点重叠 */
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
   * 按层构建「层 -> 聚类 -> 节点」结构。
   * 节点直接挂在层 Combo 上；聚类只存在于布局内存中，不生成 Combo。
   * 即使数据没有 Combo，也会退化成单层，保证布局可用。
   */
  _buildStructure(data) {
    const nodes = data.nodes || []
    const combos = data.combos || []
    const comboById = new Map(combos.map((combo) => [String(combo.id), combo]))

    const layerMap = new Map()
    const ensureLayer = (layerId) => {
      if (!layerMap.has(layerId)) {
        const combo = comboById.get(layerId)
        layerMap.set(layerId, {
          id: layerId,
          combo,
          order: orderOf(combo, layerMap.size),
          clusters: [],
          clusterById: new Map(),
        })
      }
      return layerMap.get(layerId)
    }

    for (const node of nodes) {
      const combo = node.combo ? comboById.get(String(node.combo)) : null
      // 节点应直接指向层；兼容旧数据里仍指向分组的情况，向上取到层
      let layerId =
        combo && combo.data?.kind !== 'group' ? String(combo.id) : null
      if (!layerId && combo?.combo) layerId = String(combo.combo)
      if (!layerId) {
        // 兼容扁平数据：没有 Combo 时按节点的 layer 字段分一层
        const rawLayer = node.data?.layer
        layerId = rawLayer != null && rawLayer !== '' ? `layer:${rawLayer}` : '__layer_all__'
      }

      const layer = ensureLayer(layerId)
      const clusterKey = clusterKeyOf(node)
      let cluster = layer.clusterById.get(clusterKey)
      if (!cluster) {
        cluster = {
          id: `${layerId}::${clusterKey}`,
          key: clusterKey,
          nodes: [],
          order: layer.clusterById.size,
        }
        layer.clusterById.set(clusterKey, cluster)
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

    return { layers, comboById }
  }

  /**
   * 计算一层内所有聚类的尺寸、节点本地坐标，并做节点 / 聚类两级防重叠。
   *
   * 聚类只是内存中的排布单元，不会生成 Combo；因此尺寸完全由节点块决定，
   * 不再预留分组标题与内边距。
   */
  _layoutLayer(layer, index, count, options) {
    const scale = comboLayerScale(index, count, options)
    // 深度：0 = 最远（最上层），1 = 最近（最下层）。关闭透视时不产生任何位移。
    const depth =
      options.perspective === false || !(count > 1) ? 0 : 1 - index / (count - 1)
    const nodeGap = Math.max(8, Number(options.nodeGap) || COMBO_LAYER_DEFAULTS.nodeGap)
    const clusterGap = Math.max(
      Number(options.minClusterGap ?? options.minGroupGap) ||
        COMBO_LAYER_DEFAULTS.minClusterGap,
      (Number(options.clusterGap ?? options.groupGap) ||
        COMBO_LAYER_DEFAULTS.clusterGap) * scale,
    ) + Math.max(0, Number(options.safetyGap) || 0)
    const maxCols = Math.max(
      1,
      Math.floor(Number(options.nodeCols) || COMBO_LAYER_DEFAULTS.nodeCols),
    )
    const maxLayerWidth = Math.max(
      240 * scale,
      (Number(options.maxLayerWidth) || COMBO_LAYER_DEFAULTS.maxLayerWidth) * scale,
    )
    const scaledNodeGap = nodeGap * scale
    // 该层梯形顶部的几何压缩比（由灭点决定）。水平间距要按这个比例补偿：
    // 顶部行被透视压缩后，节点块之间仍要留出足够间隙，才能既保持梯形分布又不重叠。
    const taperTopScale = Math.max(
      0.25,
      Math.min(1, Number(layer.taperTopScale) || 1),
    )

    for (const cluster of layer.clusters) {
      const blocks = cluster.nodes.map((node) => this._nodeBlock(node, scale, options))
      const countNodes = Math.max(1, blocks.length)
      const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(countNodes))))
      const rows = Math.ceil(countNodes / cols)
      const maxBlockWidth = Math.max(1, ...blocks.map((block) => block.blockWidth))
      const maxBlockHeight = Math.max(1, ...blocks.map((block) => block.blockHeight))
      // 水平方向按透视补偿后的最小单元宽度排布：
      // 未压缩时多留出的间距，正好被顶部行的梯形压缩抵消。
      const requiredCellWidth = (maxBlockWidth + 2) / taperTopScale
      const horizontalGap = Math.max(scaledNodeGap, requiredCellWidth - maxBlockWidth)
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
      cluster.gridHeight = rows * cellHeight - scaledNodeGap
      cluster.maxBlockWidth = maxBlockWidth

      // 1) 节点网格坐标（节点本体在单元格顶部，标签在下）
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

      // 2) 节点块碰撞检测：正常情况下网格已保证不重叠，这里做最终兜底
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
        const shifts = separateRects(nodeRects, { gap: 0, axis: 'auto' })
        for (let i = 0; i < entries.length; i += 1) {
          const shift = shifts.get(nodeRects[i].id)
          if (!shift) continue
          entries[i].x += shift.dx
          entries[i].y += shift.dy
        }
      }

      // 3) 根据节点块实际范围反推聚类尺寸，保证排布时不会互相压住
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const entry of entries) {
        const left = entry.x - entry.block.blockWidth / 2
        const right = entry.x + entry.block.blockWidth / 2
        const top = entry.y - entry.block.height / 2
        const bottom = entry.y + entry.block.height / 2
        minX = Math.min(minX, left)
        maxX = Math.max(maxX, right)
        minY = Math.min(minY, top)
        maxY = Math.max(maxY, bottom)
      }
      const contentWidth = Math.max(0, maxX - minX)
      const contentHeight = Math.max(0, maxY - minY)

      cluster.width = contentWidth
      cluster.height = contentHeight
      cluster.entries = entries.map((entry) => ({
        node: entry.node,
        x: entry.x - minX,
        y: entry.y - minY,
      }))
    }

    // 4) 聚类在层内按行排列（先横向，超过 maxLayerWidth 后换行）
    const rows = []
    let row = null
    for (const cluster of layer.clusters) {
      const needNewRow =
        !row || (row.cursorX > 0 && row.cursorX + cluster.width > maxLayerWidth)
      if (needNewRow) {
        row = { clusters: [], cursorX: 0, width: 0, height: 0, y: 0, gap: clusterGap }
        rows.push(row)
      }
      cluster.x = row.cursorX
      cluster.y = 0
      cluster.row = row
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

    // 4.1) 每一行的聚类在层内容宽度内水平居中，
    // 这样上下行才能围绕同一条中轴线收拢，形成对称的梯形节点阵列。
    const rowContentWidth = Math.max(0, ...rows.map((item) => item.width))
    for (const item of rows) {
      const offset = Math.max(0, (rowContentWidth - item.width) / 2)
      if (offset <= 0) continue
      for (const cluster of item.clusters) cluster.x += offset
    }

    // 5) 聚类碰撞兜底：横向优先推开，避免破坏行结构
    const clusterRects = layer.clusters.map((cluster) =>
      rectFromTopLeft(cluster.id, cluster.x, cluster.y, cluster.width, cluster.height),
    )
    if (findRectOverlaps(clusterRects, 0).length) {
      const shifts = separateRects(clusterRects, { gap: 0, axis: 'x' })
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
    const options = { ...COMBO_LAYER_DEFAULTS, ...(this.options || {}) }
    const layerPad = parsePadding(options.layerPadding ?? COMBO_LAYER_DEFAULTS.layerPadding)
    const layerGap = Math.max(8, Number(options.layerGap) || COMBO_LAYER_DEFAULTS.layerGap)
    const minLayerGap =
      Math.max(Number(options.minLayerGap) || COMBO_LAYER_DEFAULTS.minLayerGap, 8) +
      Math.max(0, Number(options.safetyGap) || 0)
    // 2.5D 斜向错位：远层向右上方偏移，近层保持居中，形成堆叠纵深
    const depthShiftX = Math.max(0, Number(options.depthShiftX) || 0)
    const depthShiftY = Math.max(0, Number(options.depthShiftY) || 0)

    const { layers } = this._buildStructure(data)
    if (!layers.length) return { nodes: [], edges: [], combos: [] }

    const vanishingDistance = Math.max(
      0,
      Number(options.vanishingDistance ?? COMBO_LAYER_DEFAULTS.vanishingDistance),
    )

    // 布局、纵向堆叠、灭点计算封装成可复用步骤：
    // 第一遍先得到层高与灭点，第二遍再按梯形压缩比补偿水平间距。
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

      // 层间碰撞兜底：按纵向顺序强制分离
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

    // 与 graph._syncPerspectiveOrigin() 使用同一公式：
    // 灭点 = 整体水平中心、最上层上方「总高度 × vanishingDistance」。
    // 节点压缩与层面板共用这个点，才能保证节点严格落在层梯形内部。
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

    /* ---------------------- 1. 第一遍：矩形布局 + 堆叠 + 灭点 ---------------------- */
    layoutLayers()
    stackLayers()
    const provisionalOrigin = computeOrigin()

    /* ---------------------- 2. 第二遍：按梯形压缩比补偿水平间距 ---------------------- */
    // 顶部行的水平间距先按 1 / taperTopScale 放大，透视压缩后正好回落到
    // 正常间距；这样节点可以严格沿灭点射线收拢，又不会互相重叠。
    for (const layer of layers) {
      const layerTop = layer.top - layer.depth * depthShiftY
      const contentTop = layerTop + layerPad.top
      // 与层面板一致：底边锚点是面板底边，而不是内容区底边
      const panelBottom = layerTop + layer.height
      const span = panelBottom - provisionalOrigin.y
      layer.taperTopScale =
        span > 0.0001 ? (contentTop - provisionalOrigin.y) / span : 1
    }
    layoutLayers()
    stackLayers()
    const origin = computeOrigin()

    const taperNodes =
      options.trapezoidNodes !== false && options.perspective !== false
    const globalMinTaper = Math.max(
      0.25,
      Math.min(1, Number(options.trapezoidMinScale) || 0.5),
    )

    const center = Array.isArray(options.center) ? options.center : [0, 0]
    const offsetX = Number(center[0]) || 0
    const offsetY = Number(center[1]) || 0
    const result = []

    for (const layer of layers) {
      // 远层向右上方错位：depth 越大（越远）偏移越多
      const layerLeft = -layer.width / 2 + layer.depth * depthShiftX
      const layerTop = layer.top - layer.depth * depthShiftY
      const contentLeft = layerLeft + layerPad.left
      // 与 _layerPoints 完全一致的透视基准：
      // 中心用全局灭点 x，纵向跨度用「面板底边 - 灭点 y」。
      const taperCenterX = origin.x
      const taperSpan = layerTop + layer.height - origin.y
      const layerMinTaper = globalMinTaper

      for (const cluster of layer.clusters) {
        const clusterLeft = cluster.x
        const clusterTop = layerTop + layerPad.top + cluster.y

        for (const entry of cluster.entries) {
          const absY = clusterTop + entry.y
          let taper = 1
          if (taperNodes && taperSpan > 0.0001) {
            taper = (absY - origin.y) / taperSpan
            taper = Math.min(1, Math.max(layerMinTaper, taper))
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
    }

    // Combo 的坐标与尺寸由 G6 根据子元素包围盒和 padding 自动推导
    return { nodes: result, edges: [], combos: [] }
  }
}

let registered = false

/** 注册自研布局，重复导入时保持幂等 */
export function registerComboLayerLayout() {
  if (registered) return
  register('layout', COMBO_LAYER_LAYOUT_ID, ComboLayerLayout)
  registered = true
}

registerComboLayerLayout()

export default ComboLayerLayout
