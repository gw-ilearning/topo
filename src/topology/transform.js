/**
 * 数据层拓扑变换：聚合、下钻子图、变更对比。
 *
 * 这些函数只操作平台标准数据的 `nodes / links`（或 `racks`），
 * 与具体渲染引擎无关，因此 G6 / Three.js / SDK 都可以复用。
 */

import { typeLabel } from './palette.js'

const STATUS_SEVERITY = { error: 5, warn: 4, maintenance: 3, offline: 2, unknown: 1, ok: 0 }

function worstStatus(list) {
  let worst = 'ok'
  let score = -1
  for (const status of list) {
    const next = STATUS_SEVERITY[status] ?? 0
    if (next > score) {
      score = next
      worst = status || 'ok'
    }
  }
  return worst
}

function groupKeyOf(node, field) {
  if (field === 'status') return node.status || 'unknown'
  if (field === 'type') return node.type || 'unknown'
  if (typeof field === 'function') return String(field(node) ?? 'other')
  return node.group || '未分组'
}

const FIELD_LABEL = { group: '分组', type: '类型', status: '状态' }

export function aggregationLabel(field) {
  return FIELD_LABEL[field] || String(field)
}

/**
 * 按字段聚合节点。
 *
 * 聚合节点 id 形如 `agg:group:核心层`，并携带 `subgraph`，
 * 因此点击聚合节点即可下钻查看成员。
 *
 * @param {object} payload 归一化后的拓扑数据
 * @param {'group'|'type'|'status'|Function} field 聚合字段
 */
export function aggregateTopology(payload, field = 'group') {
  if (!payload) return payload
  if (Array.isArray(payload.racks)) {
    return {
      ...payload,
      meta: { ...(payload.meta || {}), aggregated: { field, unsupported: true } },
    }
  }

  const nodes = Array.isArray(payload.nodes) ? payload.nodes : []
  const links = Array.isArray(payload.links) ? payload.links : []
  if (!nodes.length) return payload

  const members = new Map()
  const groupOf = new Map()
  for (const node of nodes) {
    const key = groupKeyOf(node, field)
    if (!members.has(key)) members.set(key, [])
    members.get(key).push(node)
    groupOf.set(String(node.id), key)
  }

  const groupNodes = []
  const subgraphs = new Map()
  for (const [key, list] of members) {
    const id = `agg:${field}:${key}`
    const statuses = list.map((node) => node.status)
    const label = field === 'type' ? typeLabel(key) : String(key)
    const metrics = { cpu: 0, memory: 0, traffic: 0 }
    for (const node of list) {
      metrics.cpu += Number(node.metrics?.cpu) || 0
      metrics.memory += Number(node.metrics?.memory) || 0
      metrics.traffic += Number(node.metrics?.traffic) || 0
    }
    const size = Math.max(1, list.length)
    metrics.cpu = Math.round(metrics.cpu / size)
    metrics.memory = Math.round(metrics.memory / size)

    const memberIds = new Set(list.map((node) => String(node.id)))
    const innerLinks = links.filter(
      (link) => memberIds.has(String(link.source)) && memberIds.has(String(link.target)),
    )
    const subgraph = {
      meta: {
        ...(payload.meta || {}),
        name: `${label} · ${list.length} 个节点`,
        subtitle: `聚合下钻 · ${aggregationLabel(field)}=${label}`,
        aggregatedFrom: payload.meta?.name || '',
      },
      nodes: list,
      links: innerLinks,
    }
    subgraphs.set(id, subgraph)

    groupNodes.push({
      id,
      name: `${label} (${list.length})`,
      label,
      type: 'group',
      kind: 'group',
      status: worstStatus(statuses),
      group: label,
      color: list[0]?.color,
      description: `按${aggregationLabel(field)}聚合，共 ${list.length} 个节点`,
      tags: ['聚合'],
      metrics,
      meta: {
        aggregated: true,
        field,
        value: key,
        members: list.map((node) => String(node.id)),
        memberCount: list.length,
      },
      subgraph,
    })
  }

  const edgeMap = new Map()
  for (const link of links) {
    const sourceGroup = groupOf.get(String(link.source))
    const targetGroup = groupOf.get(String(link.target))
    if (sourceGroup == null || targetGroup == null || sourceGroup === targetGroup) continue
    const sourceId = `agg:${field}:${sourceGroup}`
    const targetId = `agg:${field}:${targetGroup}`
    const key = `${sourceId}->${targetId}`
    const current = edgeMap.get(key)
    if (current) {
      current.count += 1
      current.bandwidth += Number(link.bandwidth) || 0
      current.traffic += Number(link.traffic) || 0
      current.statuses.push(link.status)
      current.status = worstStatus(current.statuses)
    } else {
      edgeMap.set(key, {
        id: `agg-edge:${key}`,
        source: sourceId,
        target: targetId,
        type: 'aggregate',
        status: link.status || 'ok',
        statuses: [link.status || 'ok'],
        count: 1,
        bandwidth: Number(link.bandwidth) || 0,
        traffic: Number(link.traffic) || 0,
        description: '聚合链路',
      })
    }
  }

  const aggregatedEdges = [...edgeMap.values()].map(({ statuses, ...edge }) => edge)

  return {
    meta: {
      ...(payload.meta || {}),
      name: `${payload.meta?.name || '拓扑'} · 按${aggregationLabel(field)}聚合`,
      subtitle: `${nodes.length} 个节点 → ${groupNodes.length} 个聚合节点`,
      aggregated: {
        field,
        groups: groupNodes.map((node) => ({
          id: node.id,
          label: node.label,
          count: node.meta.memberCount,
        })),
      },
    },
    nodes: groupNodes,
    links: aggregatedEdges,
    summary: {
      ...(payload.summary || {}),
      nodes: groupNodes.length,
      links: aggregatedEdges.length,
      aggregated: true,
    },
  }
}

/** 节点是否携带可下钻的子图 */
export function hasSubgraph(node) {
  const data = node?.data || node
  if (!data) return false
  if (data.subgraph && Array.isArray(data.subgraph.nodes) && data.subgraph.nodes.length) return true
  return Array.isArray(data.children) && data.children.length > 0
}

/** 从节点中取出子图；没有则返回 null */
export function extractSubgraph(payload, nodeId) {
  const node = (payload?.nodes || []).find((item) => String(item.id) === String(nodeId))
  if (!node) return null

  if (node.subgraph && Array.isArray(node.subgraph.nodes) && node.subgraph.nodes.length) {
    return {
      meta: {
        ...(payload.meta || {}),
        ...(node.subgraph.meta || {}),
        scene: node.subgraph.meta?.scene || payload.meta?.scene || 'custom',
      },
      nodes: node.subgraph.nodes,
      links: node.subgraph.links || node.subgraph.edges || [],
      summary: node.subgraph.summary,
    }
  }

  if (Array.isArray(node.children) && node.children.length) {
    const links = node.childLinks || node.links || node.subgraph?.links || []
    return {
      meta: {
        ...(payload.meta || {}),
        name: node.subgraph?.meta?.name || `${node.name || node.id} · 子拓扑`,
        subtitle: node.subgraph?.meta?.subtitle || '下钻视图',
      },
      nodes: node.children,
      links,
    }
  }

  return null
}

function comparableNodes(payload) {
  if (!payload) return []
  if (Array.isArray(payload.racks)) {
    return payload.racks.map((rack) => ({
      ...rack,
      type: 'rack',
      name: rack.name || rack.id,
      status: rack.status,
    }))
  }
  return payload.nodes || []
}

function comparableLinks(payload) {
  if (!payload) return []
  if (Array.isArray(payload.racks)) {
    const links = []
    const byRow = new Map()
    for (const rack of payload.racks) {
      const row = rack.row || ''
      if (!byRow.has(row)) byRow.set(row, [])
      byRow.get(row).push(rack)
    }
    for (const [row, racks] of byRow) {
      for (let i = 1; i < racks.length; i += 1) {
        links.push({
          id: `rack-row:${row}:${racks[i - 1].id}->${racks[i].id}`,
          source: String(racks[i - 1].id),
          target: String(racks[i].id),
          status: 'ok',
          type: 'rack-row',
        })
      }
    }
    return links
  }
  return payload.links || []
}

function nodeSignature(node) {
  return JSON.stringify([
    node.name,
    node.type,
    node.status,
    node.group,
    node.color,
    node.metrics?.cpu,
    node.metrics?.memory,
    node.metrics?.traffic,
  ])
}

function linkSignature(link) {
  return JSON.stringify([link.status, link.type, link.bandwidth, link.traffic])
}

/**
 * 对比两份拓扑数据，返回新增、删除、变化明细与汇总。
 *
 * @returns {{ added: object[], removed: object[], changed: object[], summary: object }}
 */
export function diffTopology(previous, next) {
  const prevNodes = new Map(comparableNodes(previous).map((node) => [String(node.id), node]))
  const nextNodes = new Map(comparableNodes(next).map((node) => [String(node.id), node]))
  const prevLinks = new Map(comparableLinks(previous).map((link) => [String(link.id), link]))
  const nextLinks = new Map(comparableLinks(next).map((link) => [String(link.id), link]))

  const nodesAdded = []
  const nodesRemoved = []
  const nodesChanged = []
  const linksAdded = []
  const linksRemoved = []
  const linksChanged = []

  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id)
    if (!before) {
      nodesAdded.push(node)
      continue
    }
    if (nodeSignature(before) !== nodeSignature(node)) {
      nodesChanged.push({ id, before, after: node })
    }
  }
  for (const [id, node] of prevNodes) {
    if (!nextNodes.has(id)) nodesRemoved.push(node)
  }

  for (const [id, link] of nextLinks) {
    const before = prevLinks.get(id)
    if (!before) {
      linksAdded.push(link)
      continue
    }
    if (linkSignature(before) !== linkSignature(link)) {
      linksChanged.push({ id, before, after: link })
    }
  }
  for (const [id, link] of prevLinks) {
    if (!nextLinks.has(id)) linksRemoved.push(link)
  }

  return {
    added: [...nodesAdded, ...linksAdded],
    removed: [...nodesRemoved, ...linksRemoved],
    changed: [...nodesChanged, ...linksChanged],
    nodes: { added: nodesAdded, removed: nodesRemoved, changed: nodesChanged },
    links: { added: linksAdded, removed: linksRemoved, changed: linksChanged },
    summary: {
      nodes: nextNodes.size,
      links: nextLinks.size,
      added: nodesAdded.length + linksAdded.length,
      removed: nodesRemoved.length + linksRemoved.length,
      changed: nodesChanged.length + linksChanged.length,
      nodeAdded: nodesAdded.length,
      nodeRemoved: nodesRemoved.length,
      nodeChanged: nodesChanged.length,
      linkAdded: linksAdded.length,
      linkRemoved: linksRemoved.length,
      linkChanged: linksChanged.length,
    },
  }
}

export { worstStatus }
