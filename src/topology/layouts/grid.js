import { defineTargetLayout } from './base.js'

/** 立方网格布局 */
export function gridTargets(nodes, links, options = {}) {
  const side = Math.max(1, Math.ceil(Math.cbrt(nodes.length)))
  const spacing = options.spacing ?? Math.max(22, 120 / side)
  const offset = ((side - 1) * spacing) / 2
  const targets = new Map()
  nodes.forEach((node, index) => {
    const x = index % side
    const y = Math.floor(index / side) % side
    const z = Math.floor(index / (side * side))
    targets.set(node.id, {
      x: x * spacing - offset,
      y: y * spacing - offset,
      z: z * spacing - offset,
    })
  })
  return targets
}

export const gridLayout = defineTargetLayout(
  {
    id: 'grid',
    name: '网格',
    icon: 'grid3d',
    order: 40,
    description: '三维立方网格，便于逐个排查节点',
  },
  gridTargets,
)
