import { defineTargetLayout } from './base.js'

const DEFAULT_SIZE = { width: 1200, height: 900 }

function readNodePositions(nodes) {
  const map = new Map()
  for (const node of nodes) {
    const x = Number(node.x ?? node.style?.x ?? node.data?.x)
    const y = Number(node.y ?? node.style?.y ?? node.data?.y)
    if (Number.isFinite(x) && Number.isFinite(y)) map.set(String(node.id), { x, y })
  }
  return map
}

function normalizeEntries(entries) {
  const map = new Map()
  for (const [key, value] of entries) {
    if (!value) continue
    const x = Number(
      value.x ?? value.style?.x ?? value.data?.x ?? (Array.isArray(value) ? value[0] : NaN),
    )
    const y = Number(
      value.y ?? value.style?.y ?? value.data?.y ?? (Array.isArray(value) ? value[1] : NaN),
    )
    if (Number.isFinite(x) && Number.isFinite(y)) map.set(String(value.id ?? key), { x, y })
  }
  return map
}

/** 兼容 Map / 数组 / { nodes } / 以 id 为键的对象 等布局输出 */
export function toPositionMap(result, fallbackNodes = []) {
  if (!result) return readNodePositions(fallbackNodes)
  if (result instanceof Map) return normalizeEntries([...result.entries()])
  if (Array.isArray(result)) {
    if (result.length && Array.isArray(result[0])) return normalizeEntries(result)
    return normalizeEntries(result.map((node) => [node.id, node]))
  }
  if (Array.isArray(result.nodes)) return toPositionMap(result.nodes, fallbackNodes)
  if (result.positions) return toPositionMap(result.positions, fallbackNodes)
  if (typeof result === 'object') return normalizeEntries(Object.entries(result))
  return new Map()
}

/**
 * 执行 G6 / @antv/layout 布局，支持三种形态：
 * 1. function(nodes, edges, options) => positions | Promise<positions>
 * 2. 实例对象 { execute(data, options) } 或 { layout(data) }（@antv/layout / G6 5）
 * 3. G6 4.x registerLayout 对象 { init(data), execute(), tick() }
 */
export async function runG6Layout(layout, nodes, edges, options = {}, depth = 0) {
  if (depth > 3) throw new Error('[layout] 布局 create() 递归层级过深')
  const size = { ...DEFAULT_SIZE, ...options }

  if (typeof layout === 'function') {
    return layout(nodes, edges, options)
  }
  if (!layout || typeof layout !== 'object') {
    throw new Error('[layout] layout 必须是函数、布局实例或 G6 registerLayout 对象')
  }

  if (typeof layout.create === 'function') {
    const instance = await layout.create({ nodes, edges, ...size })
    if (!instance || instance === layout) {
      throw new Error('[layout] 布局 create() 必须返回可执行实例')
    }
    return runG6Layout(instance, nodes, edges, options, depth + 1)
  }

  if (typeof layout.layout === 'function') {
    const output = await layout.layout({ nodes, edges, ...size })
    return output ?? readNodePositions(nodes)
  }

  if (typeof layout.execute === 'function') {
    const data = { nodes, edges, ...size }
    layout.init?.(data)
    Object.assign(layout, data)

    const output = await layout.execute({ nodes, edges }, options)

    const iterations = Number(options.iterations ?? 0)
    if (iterations > 0 && typeof layout.tick === 'function') {
      for (let i = 0; i < iterations; i += 1) layout.tick()
    }

    const fromOutput = toPositionMap(output, nodes)
    const mutated = readNodePositions(nodes)
    for (const [id, position] of mutated) fromOutput.set(id, position)

    try {
      layout.stop?.()
    } catch (error) {
      console.warn('[layout] G6 布局 stop 失败', error)
    }
    return fromOutput
  }

  throw new Error('[layout] 无法识别的布局对象：需要 create / layout / execute 方法')
}

/**
 * 把 2D 坐标投影到 3D：
 * - plane='xz'（默认）：布局的 x/y 映射到三维 X/Z，node.layer 决定高度
 * - plane='xy'：布局的 x/y 映射到三维 X/Y，layer 决定 Z
 * - plane='yz'：布局的 x/y 映射到三维 Z/Y，layer 决定 X
 */
export function projectPositions(positions, nodes, config = {}) {
  const { plane = 'xz', scale = 1, layerHeight = 46, center = true } = config
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const entries = [...positions.entries()].filter(([id]) => nodeMap.has(id))
  if (!entries.length) {
    return new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y, z: node.z }]))
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [, position] of entries) {
    minX = Math.min(minX, position.x)
    maxX = Math.max(maxX, position.x)
    minY = Math.min(minY, position.y)
    maxY = Math.max(maxY, position.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const layers = nodes.map((node) => Number(node.layer) || 0)
  const midLayer = (Math.min(...layers) + Math.max(...layers)) / 2

  const result = new Map()
  for (const [id, position] of entries) {
    const node = nodeMap.get(id)
    const px = (position.x - (center ? cx : 0)) * scale
    const py = (position.y - (center ? cy : 0)) * scale
    const height = (midLayer - (Number(node.layer) || 0)) * layerHeight

    if (plane === 'xy') result.set(id, { x: px, y: py, z: height })
    else if (plane === 'yz') result.set(id, { x: height, y: py, z: px })
    else result.set(id, { x: px, y: height, z: py })
  }

  for (const node of nodes) {
    if (!result.has(node.id)) result.set(node.id, { x: node.x, y: node.y, z: node.z })
  }
  return result
}

/**
 * 把一个 G6 / @antv/layout 布局包装成平台可注册的 3D 布局定义。
 *
 * @example 使用 @antv/layout
 * registerLayout(defineG6Layout({
 *   id: 'g6-circular',
 *   name: 'G6 环形',
 *   layout: async (nodes, edges) => {
 *     const { CircularLayout } = await import('@antv/layout')
 *     return new CircularLayout({ width: 1000, height: 1000 }).execute({ nodes, edges })
 *   },
 * }))
 *
 * @example 使用 G6 4.x registerLayout 对象
 * registerLayout(defineG6Layout({
 *   id: 'g6-ring',
 *   name: 'G6 环形',
 *   layout: {
 *     init(data) { this.nodes = data.nodes },
 *     execute() {
 *       this.nodes.forEach((node, index) => {
 *         const angle = (index / this.nodes.length) * Math.PI * 2
 *         node.x = Math.cos(angle) * 300
 *         node.y = Math.sin(angle) * 300
 *       })
 *     },
 *   },
 *   plane: 'xz',
 * }))
 */
export function defineG6Layout(config) {
  const {
    id,
    name,
    icon = 'graph',
    order = 100,
    description = '',
    layout,
    plane = 'xz',
    scale = 1,
    layerHeight = 46,
    center = true,
    options = {},
  } = config || {}

  return defineTargetLayout(
    { id, name, icon, order, description },
    async (nodes, links) => {
      // 以当前 X/Z 作为 2D 初始坐标，兼容需要初始位置的力导向类布局
      const seeds = nodes.map((node) => ({
        id: node.id,
        x: node.x,
        y: node.z,
        layer: node.layer,
        degree: node.degree,
        data: {},
      }))
      const edges = links.map((link) => ({
        id: link.id,
        source: link.sourceId,
        target: link.targetId,
        ...link,
      }))

      const raw = await runG6Layout(layout, seeds, edges, options)
      const positions = raw instanceof Map ? raw : toPositionMap(raw, seeds)
      return projectPositions(positions, nodes, { plane, scale, layerHeight, center })
    },
  )
}
