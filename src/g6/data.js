/**
 * 平台标准拓扑数据 -> G6 5 GraphData
 *
 * G6 页面消费与 REST 接口一致的数据契约，但渲染数据、节点尺寸、度数等
 * 全部在 G6 自己的模块内计算，不依赖 Three.js 图层。
 *
 * 当 `options.combos === true` 时，会生成一层 Combo：
 * - `layer:*` 层，按节点 `layer` 字段从下到上分层
 * - 节点直接挂在层上，不再生成二级分组 Combo；`group` 只作为层内排布的聚类依据
 *
 * 同时会按 2.5D 透视规则给每一层写入缩放比例：
 * - Combo 的 `data.scale`
 * - 节点的 `data.__comboScale`
 * 主题层据此缩放节点尺寸与文字，布局层据此缩放间距，二者保持一致。
 */

import { COMBO_LAYER_DEFAULTS, comboLayerScale } from './comboConfig.js'

const UNLAYERED = 'unlayered'
const RACK_LAYER = 'rack'

function layerKeyOf(node) {
  if (node.kind === 'rack') return RACK_LAYER
  const { layer } = node
  if (layer !== undefined && layer !== null && layer !== '') return String(layer)
  return UNLAYERED
}

function layerLabel(key, members, bucketNames) {
  if (key === UNLAYERED) return '未分层'
  if (key === RACK_LAYER) return '机柜分区'
  const bucket = bucketNames?.get(String(key))
  if (bucket?.name) return bucket.name
  const numeric = Number(key)
  if (!Number.isFinite(numeric)) return String(key)
  const groups = [...new Set(members.map((node) => node.group).filter(Boolean))]
  return groups.length === 1 ? `L${key} · ${groups[0]}` : `L${key}`
}

/**
 * 把原始 layer 归并成更少的层（例如网络场景归并为「核心 / 汇聚 / 接入」三层）。
 * @param {Array<{layer:number|string, name:string, layers:Array<number|string>}>} buckets
 */
function createLayerBuckets(buckets) {
  if (!Array.isArray(buckets) || !buckets.length) return null
  const byRaw = new Map()
  const byKey = new Map()
  for (const bucket of buckets) {
    const key = String(bucket.layer)
    byKey.set(key, bucket)
    for (const raw of bucket.layers || []) byRaw.set(String(raw), bucket)
  }
  return { byRaw, byKey }
}

function sortLayerKeys(keys) {
  return [...keys].sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    const fa = Number.isFinite(na)
    const fb = Number.isFinite(nb)
    if (fa && fb) return na - nb
    if (fa) return -1
    if (fb) return 1
    return String(a).localeCompare(String(b))
  })
}

/**
 * 根据节点数据生成层 Combo，节点直接挂在层上。
 * @param {Array} nodeDataList 已归一化的 G6 节点 data 列表（含 id）
 * @param {object} options 布局参数（影响 2.5D 透视缩放）
 * @returns {{ combos: Array, comboOf: Map<string, string>, comboScale: Map<string, number> }}
 */
export function buildLayerCombos(nodeDataList = [], options = {}) {
  const byLayer = new Map()
  const buckets = createLayerBuckets(options.layerBuckets)

  for (const node of nodeDataList) {
    const bucket = buckets?.byRaw.get(String(node.layer))
    const layerKey = bucket ? String(bucket.layer) : layerKeyOf(node)
    if (!byLayer.has(layerKey)) byLayer.set(layerKey, [])
    byLayer.get(layerKey).push(node)
  }

  const combos = []
  const comboOf = new Map()
  const comboScale = new Map()
  const layerKeys = sortLayerKeys([...byLayer.keys()])
  const merged = { ...COMBO_LAYER_DEFAULTS, ...(options || {}) }

  layerKeys.forEach((layerKey, layerOrder) => {
    const layerId = `layer:${layerKey}`
    const members = byLayer.get(layerKey)
    const scale = comboLayerScale(layerOrder, layerKeys.length, merged)
    comboScale.set(layerId, scale)

    combos.push({
      id: layerId,
      data: {
        kind: 'layer',
        layer: layerKey,
        name: layerLabel(layerKey, members, buckets?.byKey),
        order: layerOrder,
        count: members.length,
        scale,
      },
      // padding 放在数据里，拖动节点时才能通过 updateComboData 动态调整
      style: { padding: merged.layerPadding },
    })

    // 节点直接挂在层上；`group` 只由布局层用于层内聚类排布
    for (const node of members) comboOf.set(String(node.id), layerId)
  })

  return { combos, comboOf, comboScale }
}

export function toG6Data(payload, options = {}) {
  if (!payload) return { nodes: [], edges: [] }

  const withCombos = options.combos === true

  if (Array.isArray(payload.racks)) {
    const racks = payload.racks
    const nodes = racks.map((rack) => ({
      id: String(rack.id),
      data: {
        ...rack,
        kind: 'rack',
        degree: rack.devices?.length || 0,
        name: rack.name || rack.id,
      },
    }))

    const byRow = new Map()
    for (const rack of racks) {
      const row = rack.row || '默认区域'
      if (!byRow.has(row)) byRow.set(row, [])
      byRow.get(row).push(rack)
    }

    const edges = []
    let index = 0
    for (const [row, rowRacks] of byRow) {
      for (let i = 1; i < rowRacks.length; i += 1) {
        edges.push({
          id: `rack-row-${index++}`,
          source: String(rowRacks[i - 1].id),
          target: String(rowRacks[i].id),
          data: { status: 'ok', type: 'rack-row', row },
        })
      }
    }

    if (!withCombos) return { nodes, edges }
    return attachCombos(nodes, edges, options)
  }

  const degree = new Map()
  for (const link of payload.links || []) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1)
    degree.set(link.target, (degree.get(link.target) || 0) + 1)
  }

  const nodes = (payload.nodes || []).map((node) => ({
    id: String(node.id),
    data: { ...node, kind: node.kind || 'node', degree: degree.get(node.id) || 0 },
  }))

  const edges = (payload.links || []).map((link) => ({
    id: String(link.id),
    source: String(link.source),
    target: String(link.target),
    data: link,
  }))

  if (!withCombos) return { nodes, edges }
  return attachCombos(nodes, edges, options)
}

function attachCombos(nodes, edges, options = {}) {
  const comboOptions = options.comboOptions || options
  const { combos, comboOf, comboScale } = buildLayerCombos(
    nodes.map((node) => node.data),
    comboOptions,
  )
  const withCombo = nodes.map((node) => {
    const combo = comboOf.get(node.id)
    if (!combo) return node
    const scale = comboScale.get(combo) || 1
    return {
      ...node,
      combo,
      data: { ...node.data, __comboScale: scale },
    }
  })
  return { nodes: withCombo, edges, combos }
}

export function g6DataSignature(data) {
  if (!data) return ''
  const nodeIds = data.nodes
    .map((node) => `${node.id}@${node.combo || ''}`)
    .sort()
  const edgeIds = data.edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}`).sort()
  const comboIds = (data.combos || [])
    .map((combo) => `${combo.id}@${combo.combo || ''}`)
    .sort()
  return `${nodeIds.join('|')}::${edgeIds.join('|')}::${comboIds.join('|')}`
}
