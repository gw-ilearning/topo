/** 力导向布局：三维斥力 + 弹簧迭代，实时模拟 */

export class ForceSimulation {
  constructor(nodes, links, options = {}) {
    this.mode = 'iterative'
    this.nodes = nodes
    this.links = links
    this.byId = new Map(nodes.map((node) => [node.id, node]))
    this.repulsion = options.repulsion ?? 9000
    this.spring = options.spring ?? 0.04
    this.springLength = options.springLength ?? 62
    this.gravity = options.gravity ?? 0.0022
    this.damping = options.damping ?? 0.86
    this.maxSpeed = options.maxSpeed ?? 7
    this.alphaDecay = options.alphaDecay ?? 0.988
    this.minAlpha = 0.012
    this.alpha = 1
  }

  reheat(value = 0.9) {
    this.alpha = Math.max(this.alpha, value)
  }

  reset() {
    this.reheat(1)
  }

  tick() {
    if (this.alpha <= this.minAlpha) return false
    const { nodes, links, alpha } = this
    if (!nodes.length) return false

    for (const node of nodes) {
      node.fx = 0
      node.fy = 0
      node.fz = 0
    }

    // 弹簧引力
    for (const link of links) {
      const a = this.byId.get(link.sourceId)
      const b = this.byId.get(link.targetId)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
      const force = (distance - this.springLength) * this.spring * alpha
      const ux = (dx / distance) * force
      const uy = (dy / distance) * force
      const uz = (dz / distance) * force
      a.fx += ux
      a.fy += uy
      a.fz += uz
      b.fx -= ux
      b.fy -= uy
      b.fz -= uz
    }

    // 两两斥力（500 节点内可用；更大规模请替换为空间网格 / Barnes-Hut）
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dz = a.z - b.z
        let distSq = dx * dx + dy * dy + dz * dz
        if (distSq < 0.01) {
          dx = (Math.random() - 0.5) * 0.6
          dy = (Math.random() - 0.5) * 0.6
          dz = (Math.random() - 0.5) * 0.6
          distSq = 0.36
        }
        if (distSq > 90000) continue
        const distance = Math.sqrt(distSq)
        const force = (this.repulsion * alpha) / distSq
        const ux = (dx / distance) * force
        const uy = (dy / distance) * force
        const uz = (dz / distance) * force
        a.fx += ux
        a.fy += uy
        a.fz += uz
        b.fx -= ux
        b.fy -= uy
        b.fz -= uz
      }
    }

    // 向心引力 + 速度积分
    for (const node of nodes) {
      node.fx -= node.x * this.gravity * alpha
      node.fy -= node.y * this.gravity * alpha
      node.fz -= node.z * this.gravity * alpha

      node.vx = (node.vx + node.fx) * this.damping
      node.vy = (node.vy + node.fy) * this.damping
      node.vz = (node.vz + node.fz) * this.damping

      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy + node.vz * node.vz)
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed
        node.vx *= scale
        node.vy *= scale
        node.vz *= scale
      }

      node.x += node.vx
      node.y += node.vy
      node.z += node.vz
    }

    this.alpha *= this.alphaDecay
    return true
  }

  dispose() {
    this.nodes = []
    this.links = []
    this.byId.clear()
  }
}

export const forceLayout = {
  id: 'force',
  name: '力导向',
  icon: 'force',
  description: '三维斥力 / 弹簧模拟，自适应成团；适合关系未知的网络',
  mode: 'iterative',
  create(nodes, links, options = {}) {
    return new ForceSimulation(nodes, links, options)
  },
}
