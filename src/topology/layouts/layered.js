import { defineTargetLayout } from './base.js'

/** 分层布局：按 node.layer 自上而下排列，每层环形铺开 */
function computeLayered(nodes, links, options = {}) {
  const spacingY = options.spacingY ?? 46
  const layerValues = Array.from(new Set(nodes.map((node) => Number(node.layer) || 0))).sort(
    (a, b) => a - b,
  )
  const groups = new Map(layerValues.map((layer) => [layer, []]))
  for (const node of nodes) {
    const layer = Number(node.layer) || 0
    if (!groups.has(layer)) groups.set(layer, [])
    groups.get(layer).push(node)
  }

  const maxRadius = Math.max(34, Math.sqrt(nodes.length) * 13)
  const targets = new Map()

  layerValues.forEach((layer, layerIndex) => {
    const group = groups.get(layer)
    const y = ((layerValues.length - 1) / 2 - layerIndex) * spacingY
    const radius = Math.max(26, Math.min(maxRadius, group.length * 10))
    group.forEach((node, index) => {
      const angle = (index / Math.max(1, group.length)) * Math.PI * 2 + layerIndex * 0.7
      targets.set(node.id, {
        x: Math.cos(angle) * radius,
        y,
        z: Math.sin(angle) * radius,
      })
    })
  })
  return targets
}

export const layeredLayout = defineTargetLayout(
  {
    id: 'layered',
    name: '分层',
    icon: 'layers',
    order: 20,
    description: '按 layer 自上而下分层，适合网络层级、组织架构',
  },
  computeLayered,
)
