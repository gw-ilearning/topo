import { forceLayout } from './force.js'
import { layeredLayout } from './layered.js'
import { sphereLayout } from './sphere.js'
import { gridLayout } from './grid.js'
import { assertLayoutDefinition } from './base.js'

/**
 * 布局注册中心
 * - 内置布局：force / layered / sphere / grid
 * - 通过 registerLayout() 注册任意自定义布局或 G6 适配布局
 * - subscribeLayouts() 让 UI 自动感知新布局
 */
const registry = new Map()
const listeners = new Set()

function normalize(definition, fallbackOrder = 100) {
  assertLayoutDefinition(definition)
  return {
    icon: 'graph',
    description: '',
    order: fallbackOrder,
    ...definition,
  }
}

export function registerLayout(definition) {
  const def = normalize(definition)
  registry.set(def.id, def)
  notify()
  return def
}

export function unregisterLayout(id) {
  const removed = registry.delete(id)
  if (removed) notify()
  return removed
}

export function getLayout(id) {
  return registry.get(id) || null
}

export function getLayouts() {
  return [...registry.values()].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name),
  )
}

export function subscribeLayouts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[layout] 订阅回调执行失败', error)
    }
  }
}

// 内置布局注册
for (const [definition, order] of [
  [forceLayout, 10],
  [layeredLayout, 20],
  [sphereLayout, 30],
  [gridLayout, 40],
]) {
  registry.set(definition.id, normalize(definition, order))
}

export { defineTargetLayout, snapNodes } from './base.js'
export { defineG6Layout, runG6Layout, projectPositions, toPositionMap } from './g6.js'
export { ForceSimulation } from './force.js'
