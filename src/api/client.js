import { getMockTopology, jitterTopology } from '../mock/data.js'
import { normalizeStatus, statusMeta } from '../topology/palette.js'

export const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '')
const FORCE_MOCK = String(import.meta.env.VITE_USE_MOCK || '').toLowerCase() === 'true'

export const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL) || 10000

const MAX_SUBGRAPH_DEPTH = 4

function normalizeSubgraph(item, sceneKey, depth) {
  if (!item || depth > MAX_SUBGRAPH_DEPTH) return null
  const source = item.subgraph && typeof item.subgraph === 'object' ? item.subgraph : item
  const nodesRaw = Array.isArray(source.nodes)
    ? source.nodes
    : Array.isArray(item.children)
      ? item.children
      : null
  if (!nodesRaw || !nodesRaw.length) return null
  const linksRaw = Array.isArray(source.links)
    ? source.links
    : Array.isArray(source.edges)
      ? source.edges
      : Array.isArray(item.childLinks)
        ? item.childLinks
        : []
  const normalized = normalizeGraph(
    {
      meta: {
        ...(source.meta || {}),
        ...(item.subgraph?.meta || {}),
        name: source.meta?.name || item.subgraph?.meta?.name || `${item.name || item.id} · 子拓扑`,
        scene: source.meta?.scene || sceneKey,
      },
      nodes: nodesRaw,
      links: linksRaw,
    },
    sceneKey,
    depth + 1,
  )
  return {
    meta: normalized.meta,
    nodes: normalized.nodes,
    links: normalized.links,
    summary: normalized.summary,
  }
}

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function unwrap(raw) {
  if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') {
    if (Array.isArray(raw.data.nodes) || Array.isArray(raw.data.racks)) return raw.data
  }
  return raw
}

function normalizeGraph(raw, sceneKey, depth = 0) {
  const nodeList = Array.isArray(raw.nodes) ? raw.nodes : Array.isArray(raw.vertices) ? raw.vertices : []
  const linkList = Array.isArray(raw.links) ? raw.links : Array.isArray(raw.edges) ? raw.edges : []

  const nodes = nodeList.map((item, index) => {
    const id = String(item.id ?? item.key ?? `node-${index}`)
    const type = String(item.type || item.category || 'server').toLowerCase()
    const group = String(item.group || item.category || item.type || '其他')
    const meta = { ...(item.meta && typeof item.meta === 'object' ? item.meta : {}) }
    for (const key of ['ip', 'location', 'model', 'os', 'firmware', 'owner']) {
      if (item[key] != null) meta[key] = item[key]
    }
    return {
      ...item,
      id,
      name: String(item.name || item.label || id),
      type,
      status: normalizeStatus(item.status),
      layer: asNumber(item.layer ?? item.level, 0),
      group,
      color: item.color || undefined,
      size: item.size ? asNumber(item.size, undefined) : undefined,
      description: item.description || item.desc || '',
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      metrics: item.metrics && typeof item.metrics === 'object' ? item.metrics : {},
      meta,
      position: item.position || item.pos || null,
      subgraph: normalizeSubgraph(item, sceneKey, depth),
      raw: item,
    }
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const links = []
  for (let index = 0; index < linkList.length; index += 1) {
    const item = linkList[index]
    const source = typeof item.source === 'object' ? item.source?.id : item.source ?? item.from
    const target = typeof item.target === 'object' ? item.target?.id : item.target ?? item.to
    if (source == null || target == null) continue
    const sourceId = String(source)
    const targetId = String(target)
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue
    links.push({
      ...item,
      id: String(item.id ?? `link-${index}`),
      source: sourceId,
      target: targetId,
      type: String(item.type || 'fiber').toLowerCase(),
      status: normalizeStatus(item.status),
      bandwidth: asNumber(item.bandwidth),
      traffic: asNumber(item.traffic),
      latency: asNumber(item.latency),
    })
  }

  const counts = { ok: 0, warn: 0, error: 0, maintenance: 0, offline: 0 }
  for (const node of nodes) counts[node.status] = (counts[node.status] || 0) + 1

  return {
    meta: {
      scene: sceneKey,
      name: raw.meta?.name || raw.name || '拓扑视图',
      subtitle: raw.meta?.subtitle || raw.subtitle || '',
      colorMode: raw.meta?.colorMode === 'group' ? 'group' : 'status',
      generatedAt: raw.meta?.generatedAt || new Date().toISOString(),
      version: raw.meta?.version,
    },
    nodes,
    links,
    summary: { nodes: nodes.length, links: links.length, ...counts, ...(raw.summary || {}) },
  }
}

function normalizeDataCenter(raw, sceneKey) {
  const racks = (Array.isArray(raw.racks) ? raw.racks : []).map((rack, index) => {
    const devices = (Array.isArray(rack.devices) ? rack.devices : []).map((device, deviceIndex) => ({
      ...device,
      id: String(device.id ?? `${rack.id}-d${deviceIndex}`),
      name: String(device.name || device.label || `设备 ${deviceIndex + 1}`),
      type: String(device.type || 'server').toLowerCase(),
      status: normalizeStatus(device.status),
      u: Math.max(1, asNumber(device.u, 1)),
      height: Math.max(1, asNumber(device.height, 2)),
      power: asNumber(device.power),
      temperature: asNumber(device.temperature),
      model: device.model || '',
    }))
    const status = normalizeStatus(rack.status)
    return {
      ...rack,
      id: String(rack.id ?? `rack-${index}`),
      name: String(rack.name || rack.label || `机柜 ${index + 1}`),
      row: String(rack.row || rack.zone || ''),
      x: asNumber(rack.x),
      z: asNumber(rack.z),
      status,
      temperature: asNumber(rack.temperature, 24),
      power: asNumber(rack.power, 0),
      capacity: asNumber(rack.capacity, 42),
      usedU: asNumber(rack.usedU, devices.reduce((sum, device) => sum + device.height, 0)),
      devices,
    }
  })

  const rows =
    Array.isArray(raw.rows) && raw.rows.length
      ? raw.rows.map((row, index) => ({
          id: String(row.id ?? `row-${index}`),
          name: String(row.name || row.label || `区域 ${index + 1}`),
          z: asNumber(row.z),
        }))
      : Array.from(new Set(racks.map((rack) => rack.row)))
          .filter(Boolean)
          .map((name, index) => ({ id: `row-${index}`, name, z: index * 16 }))

  const counts = { ok: 0, warn: 0, error: 0, maintenance: 0, offline: 0 }
  for (const rack of racks) counts[rack.status] = (counts[rack.status] || 0) + 1
  const totalDevices = racks.reduce((sum, rack) => sum + rack.devices.length, 0)

  return {
    meta: {
      scene: sceneKey,
      name: raw.meta?.name || raw.name || '3D 数据中心',
      subtitle: raw.meta?.subtitle || raw.subtitle || '',
      colorMode: 'status',
      generatedAt: raw.meta?.generatedAt || new Date().toISOString(),
      version: raw.meta?.version,
    },
    rows,
    racks,
    summary: {
      racks: racks.length,
      devices: totalDevices,
      power: Math.round(racks.reduce((sum, rack) => sum + rack.power, 0) * 10) / 10,
      avgTemperature:
        Math.round(
          (racks.reduce((sum, rack) => sum + rack.temperature, 0) / Math.max(1, racks.length)) * 10,
        ) / 10,
      alerts: racks.filter((rack) => rack.status === 'warn' || rack.status === 'error').length,
      ...counts,
      ...(raw.summary || {}),
    },
  }
}

export function normalizeTopology(raw, sceneKey) {
  const data = unwrap(raw)
  if (!data || typeof data !== 'object') throw new Error('接口返回的数据格式不正确')
  if (Array.isArray(data.racks)) return normalizeDataCenter(data, sceneKey)
  return normalizeGraph(data, sceneKey)
}

async function request(sceneKey, { signal, live }) {
  const search = new URLSearchParams({ scene: sceneKey })
  if (live) search.set('live', '1')
  const response = await fetch(`${API_BASE}/topology?${search.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return normalizeTopology(await response.json(), sceneKey)
}

/**
 * 拉取拓扑数据：优先 REST API，失败时降级到内置 Mock。
 * 返回值中的 source 表示实际数据来源（api / mock）。
 */
export async function fetchTopology(sceneKey, { signal, live = false } = {}) {
  if (FORCE_MOCK) {
    const mock = getMockTopology(sceneKey)
    return { ...(live ? jitterTopology(mock) : mock), source: 'mock' }
  }

  try {
    const data = await request(sceneKey, { signal, live })
    return { ...data, source: 'api' }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    console.warn(`[topology] REST 接口不可用（${error.message}），使用内置 Mock 数据`)
    const mock = getMockTopology(sceneKey)
    return {
      ...(live ? jitterTopology(mock) : mock),
      source: 'mock',
      error: error.message,
    }
  }
}

export function describeSource(source) {
  return source === 'api' ? 'REST API' : '内置 Mock'
}

export { statusMeta }
