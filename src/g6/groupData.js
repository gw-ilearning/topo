/**
 * 平台拓扑数据 -> 「分层 Group」G6 数据
 *
 * 这里完全不使用 Combo：
 * - 节点 / 边在本文件内独立归一化，不调用 `toG6Data()`；
 * - 分组按节点自身的 `layer` / 归并规则计算，结果写进 `data.__groupId`；
 * - 每个分组对应一个**普通节点**（`data.kind = 'layer-panel'`）作为梯形面板；
 * - 节点与面板之间只有 `__groupPanelId` 的逻辑指向，没有父子容器。
 */

import { groupLayerScale, groupPanelId } from './groupConfig.js'

const UNLAYERED = 'unlayered'
const RACK_LAYER = 'rack'

/** 原始 layer -> 归并层。与网络场景「核心 / 汇聚 / 接入」三层保持一致 */
function createBuckets(buckets) {
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

/** 把平台数据归一化成「普通节点 + 边」，不生成任何 Combo */
function normalizePayload(payload = {}) {
  if (!payload) return { nodes: [], edges: [] }

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
    return { nodes, edges }
  }

  const degree = new Map()
  for (const link of payload.links || []) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1)
    degree.set(link.target, (degree.get(link.target) || 0) + 1)
  }

  const nodes = (payload.nodes || []).map((node) => ({
    id: String(node.id),
    data: {
      ...node,
      kind: node.kind || 'node',
      degree: degree.get(node.id) || 0,
    },
  }))

  const edges = (payload.links || []).map((link) => ({
    id: String(link.id),
    source: String(link.source),
    target: String(link.target),
    data: link,
  }))

  return { nodes, edges }
}

/** 节点所属的分组键 */
function groupKeyOf(node, buckets) {
  if (node.kind === 'rack') return RACK_LAYER
  const bucket = buckets?.byRaw.get(String(node.layer))
  if (bucket) return String(bucket.layer)
  if (node.layer !== undefined && node.layer !== null && node.layer !== '') {
    return String(node.layer)
  }
  return UNLAYERED
}

/** 分组标题：归并层用配置名，原始层用「L2 · 核心」形式 */
function groupLabel(key, members, buckets) {
  if (key === UNLAYERED) return '未分层'
  if (key === RACK_LAYER) return '机柜分区'
  const bucket = buckets?.byKey.get(String(key))
  if (bucket?.name) return bucket.name
  const numeric = Number(key)
  if (!Number.isFinite(numeric)) return String(key)
  const groups = [...new Set(members.map((node) => node.group).filter(Boolean))]
  return groups.length === 1 ? `L${key} · ${groups[0]}` : `L${key}`
}

/** 数字层号按大小排序，其余按字典序，保证层序稳定 */
function sortKeys(keys) {
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

export function toGroupData(payload, options = {}) {
  const base = normalizePayload(payload)
  const nodes = base.nodes || []
  if (!nodes.length) return base

  const buckets = createBuckets(options.layerBuckets)

  const byGroup = new Map()
  for (const node of nodes) {
    const key = groupKeyOf(node.data || {}, buckets)
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key).push(node)
  }

  const keys = sortKeys([...byGroup.keys()])
  if (!keys.length) return base

  const groupIdOf = (key) => `group:${key}`
  const panelOf = (key) => groupPanelId(groupIdOf(key))
  const scaleOf = new Map()
  keys.forEach((key, index) => {
    scaleOf.set(key, groupLayerScale(index, keys.length, options))
  })

  const memberNodes = nodes.map((node) => {
    const key = groupKeyOf(node.data || {}, buckets)
    const groupId = groupIdOf(key)
    return {
      ...node,
      data: {
        ...node.data,
        __groupId: groupId,
        __groupPanelId: panelOf(key),
        __groupScale: scaleOf.get(key) || 1,
      },
    }
  })

  // 面板节点：只承载几何与标题，尺寸 / 坐标由布局写入
  const panelNodes = keys.map((key, index) => ({
    id: panelOf(key),
    data: {
      kind: 'layer-panel',
      groupId: groupIdOf(key),
      groupKey: key,
      layer: key,
      name: groupLabel(key, byGroup.get(key).map((node) => node.data), buckets),
      order: index,
      count: byGroup.get(key).length,
      scale: scaleOf.get(key) || 1,
    },
    style: {
      // 布局执行前给一个占位尺寸，避免首帧出现 0 尺寸节点
      size: [320, 120],
    },
  }))

  return {
    nodes: [...memberNodes, ...panelNodes],
    edges: base.edges || [],
  }
}

export default toGroupData
