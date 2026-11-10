import { defineTargetLayout } from './base.js'

/** 斐波那契球面均匀撒点 */
export function spherePoints(count, radius) {
  const points = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    points.push({
      x: Math.cos(theta) * r * radius,
      y: y * radius,
      z: Math.sin(theta) * r * radius,
    })
  }
  return points
}

export function sphereTargets(nodes, links, options = {}) {
  const radius = options.radius ?? Math.max(58, Math.sqrt(nodes.length) * 15)
  const points = spherePoints(nodes.length, radius)
  return new Map(nodes.map((node, index) => [node.id, points[index]]))
}

export const sphereLayout = defineTargetLayout(
  {
    id: 'sphere',
    name: '球面',
    icon: 'globe',
    order: 30,
    description: '斐波那契球面均匀分布，突出整体规模与对称性',
  },
  sphereTargets,
)
