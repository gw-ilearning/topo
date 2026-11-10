/**
 * G6 数据层分析工具：邻接索引、N 跳邻居、最短路径、影响面统计。
 *
 * 只处理 `{ nodes, edges }`（G6 GraphData），不依赖 G6 运行时，因此可单测、可复用。
 */

const BOTH = 'both'
const OUT = 'out'
const IN = 'in'

export function createGraphIndex(data = { nodes: [], edges: [] }) {
  const nodes = new Map()
  const out = new Map()
  const inn = new Map()
  const edgesById = new Map()

  for (const node of data.nodes || []) nodes.set(String(node.id), node)
  for (const edge of data.edges || []) {
    const id = String(edge.id)
    const source = String(edge.source)
    const target = String(edge.target)
    edgesById.set(id, edge)
    if (!out.has(source)) out.set(source, [])
    if (!inn.has(target)) inn.set(target, [])
    out.get(source).push({ edge, other: target, direction: OUT })
    inn.get(target).push({ edge, other: source, direction: IN })
  }

  return {
    nodes,
    edgesById,
    edgesByNode(id) {
      const key = String(id)
      return [...(out.get(key) || []), ...(inn.get(key) || [])]
    },
    outgoing(id) {
      return out.get(String(id)) || []
    },
    incoming(id) {
      return inn.get(String(id)) || []
    },
  }
}

function neighborList(index, id, direction) {
  if (direction === OUT) return index.outgoing(id)
  if (direction === IN) return index.incoming(id)
  return index.edgesByNode(id)
}

/**
 * 收集 N 跳邻居及其之间的链路。
 *
 * @param {object} index createGraphIndex 的返回值
 * @param {string} startId 起点
 * @param {{ depth?: number, direction?: 'both'|'out'|'in' }} options
 * @returns {{ nodes: Set<string>, edges: Set<string>, distance: Map<string, number> }}
 */
export function collectNeighborhood(index, startId, options = {}) {
  const depth = Math.max(1, Number(options.depth) || 1)
  const direction = options.direction === OUT || options.direction === IN ? options.direction : BOTH
  const start = String(startId)
  const nodes = new Set([start])
  const edges = new Set()
  const distance = new Map([[start, 0]])
  let frontier = [start]

  for (let level = 1; level <= depth && frontier.length; level += 1) {
    const next = []
    for (const id of frontier) {
      for (const item of neighborList(index, id, direction)) {
        edges.add(String(item.edge.id))
        const other = String(item.other)
        if (!nodes.has(other)) {
          nodes.add(other)
          distance.set(other, level)
          next.push(other)
        }
      }
    }
    frontier = next
  }

  // 补充已访问节点之间的链路，让高亮子图更完整
  for (const id of nodes) {
    for (const item of index.edgesByNode(id)) {
      const other = String(item.other)
      if (nodes.has(other)) edges.add(String(item.edge.id))
    }
  }

  return { nodes, edges, distance }
}

function edgeWeight(edge, weight) {
  if (typeof weight === 'function') {
    const value = Number(weight(edge))
    return Number.isFinite(value) && value > 0 ? value : 1
  }
  const direct = Number(edge?.data?.latency ?? edge?.data?.weight)
  return Number.isFinite(direct) && direct > 0 ? direct : 1
}

/**
 * 最短路径。
 *
 * - directed 默认 true：只沿 source -> target
 * - weight 可传函数，默认使用链路 latency / weight，缺省为 1
 * - 使用 Dijkstra；未传 weight 时退化为 BFS，复杂度 O(V+E)
 */
export function shortestPath(index, source, target, options = {}) {
  const start = String(source)
  const end = String(target)
  if (!index.nodes.has(start) || !index.nodes.has(end)) {
    return { found: false, nodes: [], edges: [], distance: Infinity }
  }
  if (start === end) return { found: true, nodes: [start], edges: [], distance: 0 }

  const directed = options.directed !== false
  const weighted = typeof options.weight === 'function'
  const distance = new Map([[start, 0]])
  const previous = new Map()
  const previousEdge = new Map()
  const visited = new Set()
  const queue = [start]

  while (queue.length) {
    // 小规模图使用线性取最小即可；大图可替换为二叉堆
    let bestIndex = 0
    for (let i = 1; i < queue.length; i += 1) {
      if ((distance.get(queue[i]) ?? Infinity) < (distance.get(queue[bestIndex]) ?? Infinity)) {
        bestIndex = i
      }
    }
    const current = queue.splice(bestIndex, 1)[0]
    if (current === end) break
    if (visited.has(current)) continue
    visited.add(current)

    const links = directed ? index.outgoing(current) : index.edgesByNode(current)
    for (const item of links) {
      const other = String(item.other)
      if (visited.has(other)) continue
      const weight = weighted ? edgeWeight(item.edge, options.weight) : 1
      const nextDistance = (distance.get(current) ?? Infinity) + weight
      if (nextDistance < (distance.get(other) ?? Infinity)) {
        distance.set(other, nextDistance)
        previous.set(other, current)
        previousEdge.set(other, String(item.edge.id))
        queue.push(other)
      }
    }
  }

  if (start !== end && !distance.has(end)) {
    return { found: false, nodes: [], edges: [], distance: Infinity }
  }

  const nodePath = [end]
  const edgePath = []
  let cursor = end
  while (cursor !== start) {
    const prev = previous.get(cursor)
    if (prev == null) return { found: false, nodes: [], edges: [], distance: Infinity }
    edgePath.unshift(previousEdge.get(cursor))
    nodePath.unshift(prev)
    cursor = prev
  }

  return {
    found: true,
    nodes: nodePath,
    edges: edgePath,
    distance: distance.get(end) ?? 0,
  }
}

const STATUS_SEVERITY = { error: 5, warn: 4, maintenance: 3, offline: 2, unknown: 1, ok: 0 }

export function worstStatus(list) {
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

/** 统计方向性影响面（默认下游） */
export function impactSummary(index, id, options = {}) {
  const direction = options.direction === IN || options.direction === 'upstream' ? IN : OUT
  const depth = Number.isFinite(Number(options.depth)) ? Math.max(1, Number(options.depth)) : Infinity
  const result = collectNeighborhood(index, id, {
    depth: depth === Infinity ? Math.max(1, index.nodes.size) : depth,
    direction,
  })
  const byStatus = { ok: 0, warn: 0, error: 0, maintenance: 0, offline: 0, unknown: 0 }
  for (const nodeId of result.nodes) {
    if (String(nodeId) === String(id)) continue
    const status = index.nodes.get(nodeId)?.data?.status || 'unknown'
    byStatus[status] = (byStatus[status] || 0) + 1
  }
  return {
    root: String(id),
    direction: direction === IN ? 'upstream' : 'downstream',
    depth: depth === Infinity ? null : depth,
    nodes: result.nodes,
    edges: result.edges,
    distance: result.distance,
    count: Math.max(0, result.nodes.size - 1),
    byStatus,
  }
}

/** 关键字搜索：匹配 name / id / type / group / meta.ip */
export function searchGraphNodes(data, query) {
  const keyword = String(query || '').trim().toLowerCase()
  if (!keyword) return []
  const matched = []
  for (const node of data.nodes || []) {
    const datum = node.data || node
    const haystack = [
      node.id,
      datum.name,
      datum.label,
      datum.type,
      datum.group,
      datum.meta?.ip,
      datum.meta?.location,
      datum.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (haystack.includes(keyword)) matched.push(String(node.id))
  }
  return matched
}

export { BOTH as BOTH_DIRECTION, IN as IN_DIRECTION, OUT as OUT_DIRECTION }
