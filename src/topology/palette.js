export const STATUS_META = {
  ok: { label: '正常', color: '#22e0a1' },
  warn: { label: '告警', color: '#ffb020' },
  error: { label: '严重', color: '#ff4d6d' },
  maintenance: { label: '维护', color: '#a78bfa' },
  offline: { label: '离线', color: '#64748b' },
  unknown: { label: '未知', color: '#94a3b8' },
}

export const STATUS_ORDER = ['ok', 'warn', 'error', 'maintenance', 'offline']

export const TYPE_META = {
  cloud: { label: '云节点', shape: 'sphere' },
  firewall: { label: '防火墙', shape: 'shield' },
  router: { label: '路由器', shape: 'octa' },
  switch: { label: '交换机', shape: 'cube' },
  server: { label: '服务器', shape: 'cube' },
  database: { label: '数据库', shape: 'cylinder' },
  pc: { label: '办公终端', shape: 'boxSmall' },
  gateway: { label: '物联网关', shape: 'cube' },
  edge: { label: '边缘节点', shape: 'icosa' },
  sensor: { label: '传感器', shape: 'tetra' },
  camera: { label: '摄像机', shape: 'cone' },
  meter: { label: '计量表', shape: 'cylinder' },
  controller: { label: '控制器', shape: 'octa' },
  concept: { label: '概念节点', shape: 'icosa' },
  storage: { label: '存储', shape: 'cylinder' },
  group: { label: '分组', shape: 'icosa' },
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown
}

export function statusColor(status) {
  return statusMeta(status).color
}

export function typeLabel(type) {
  return TYPE_META[type]?.label || type || '未知类型'
}

export function nodeShape(type) {
  return TYPE_META[type]?.shape || 'icosa'
}

/** 用于图表 / 图例的分组色 */
export const GROUP_COLORS = [
  '#38bdf8',
  '#8b5cf6',
  '#22d3a6',
  '#f59e0b',
  '#f472b6',
  '#60a5fa',
  '#34d399',
  '#fb7185',
]

export function hashColor(value = '') {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length]
}

export function normalizeStatus(status) {
  const value = String(status || '').toLowerCase()
  if (['ok', 'up', 'healthy', 'online', 'normal', 'running'].includes(value)) return 'ok'
  if (['warn', 'warning', 'degraded', 'busy'].includes(value)) return 'warn'
  if (['error', 'critical', 'down', 'failed', 'fault'].includes(value)) return 'error'
  if (['offline', 'unreachable', 'stopped'].includes(value)) return 'offline'
  if (['maintenance', 'maint', 'paused'].includes(value)) return 'maintenance'
  return STATUS_META[value] ? value : 'unknown'
}
