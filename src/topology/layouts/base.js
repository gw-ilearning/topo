/**
 * 布局基础协议
 *
 * 一个布局定义（LayoutDefinition）：
 * {
 *   id: string,
 *   name: string,
 *   icon?: string,
 *   description?: string,
 *   mode: 'iterative' | 'targets',
 *   create(nodes, links, options, context): LayoutInstance
 * }
 *
 * LayoutInstance：
 * {
 *   mode: 'iterative' | 'targets',
 *   tick?(dt): void,                 // iterative：每帧推进
 *   getTargets?(): Map<id, {x,y,z}>  // targets：目标坐标
 *   dispose?(): void
 * }
 *
 * context：
 * {
 *   onUpdate(): void   // 异步布局（如 G6 Dagre）算完后通知引擎取新 targets
 * }
 */

function assertDefinition(definition) {
  if (!definition || !definition.id) throw new Error('[layout] 布局定义必须包含 id')
  if (definition.mode !== 'iterative' && definition.mode !== 'targets') {
    throw new Error(`[layout] ${definition.id} 的 mode 必须为 iterative 或 targets`)
  }
  if (typeof definition.create !== 'function') {
    throw new Error(`[layout] ${definition.id} 必须实现 create()`)
  }
}

export { assertDefinition as assertLayoutDefinition }

/**
 * 快速定义一个「目标坐标型」布局。
 * compute 可同步或异步返回 Map<id, {x,y,z}>。
 *
 * @example
 * defineTargetLayout(
 *   { id: 'helix', name: '螺旋', mode: 'targets' },
 *   (nodes) => new Map(nodes.map((n, i) => [n.id, {
 *     x: Math.cos(i * 0.6) * 50,
 *     y: (i - nodes.length / 2) * 4,
 *     z: Math.sin(i * 0.6) * 50,
 *   }])),
 * )
 */
export function defineTargetLayout(definition, compute) {
  const def = {
    icon: 'graph',
    description: '',
    ...definition,
    mode: 'targets',
    create(nodes, links, options = {}, context = {}) {
      let targets = new Map()
      let disposed = false

      const run = () => {
        let output
        try {
          output = compute(nodes, links, options)
        } catch (error) {
          console.error(`[layout] ${def.id} 计算出错`, error)
          return Promise.resolve()
        }
        if (output && typeof output.then === 'function') {
          return output.then((result) => {
            if (disposed) return
            targets = result instanceof Map ? result : new Map()
            context.onUpdate?.()
          })
        }
        targets = output instanceof Map ? output : new Map()
        context.onUpdate?.()
        return Promise.resolve()
      }

      run()

      return {
        mode: 'targets',
        getTargets: () => targets,
        recompute: run,
        dispose() {
          disposed = true
          targets = new Map()
        },
      }
    },
  }
  assertDefinition(def)
  return def
}

/** 将目标坐标立即写入节点（用于 instant 切换） */
export function snapNodes(nodes, targets) {
  if (!targets?.size) return false
  for (const node of nodes) {
    const target = targets.get(node.id)
    if (!target) continue
    node.x = target.x
    node.y = target.y
    node.z = target.z
    node.vx = 0
    node.vy = 0
    node.vz = 0
  }
  return true
}
