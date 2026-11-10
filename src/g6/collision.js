/**
 * 纯数学的矩形碰撞检测 / 分离工具
 *
 * 不依赖 G6，可用于：
 * - Combo 分层布局的节点、层两级防重叠
 * - 单元测试
 * - 运行期调试（controller.checkOverlaps()）
 *
 * 矩形统一使用「中心点 + 宽高」描述：
 *   { id, x, y, width, height }
 */

/** 由中心点和宽高生成 AABB */
export function rectFromCenter(id, x, y, width, height) {
  const halfW = Math.max(0, Number(width) || 0) / 2
  const halfH = Math.max(0, Number(height) || 0) / 2
  return {
    id,
    x,
    y,
    width: halfW * 2,
    height: halfH * 2,
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  }
}

/** 由左上角 + 宽高生成 AABB */
export function rectFromTopLeft(id, left, top, width, height) {
  const w = Math.max(0, Number(width) || 0)
  const h = Math.max(0, Number(height) || 0)
  return rectFromCenter(id, left + w / 2, top + h / 2, w, h)
}

/** 两个矩形是否重叠（gap > 0 时要求至少留出该间距） */
export function rectsOverlap(a, b, gap = 0) {
  const g = Math.max(0, Number(gap) || 0)
  return (
    a.left < b.right + g &&
    b.left < a.right + g &&
    a.top < b.bottom + g &&
    b.top < a.bottom + g
  )
}

/**
 * 查找所有重叠的矩形对。
 * 先按 left 排序，再用「右边超过对方左边」做扫描剪枝，常规数据接近 O(n log n)。
 *
 * @returns {Array<[object, object]>}
 */
export function findRectOverlaps(rects = [], gap = 0) {
  const list = rects.filter(Boolean)
  if (list.length < 2) return []
  const sorted = [...list].sort((a, b) => a.left - b.left)
  const overlaps = []
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]
      if (b.left >= a.right + gap) break
      if (rectsOverlap(a, b, gap)) overlaps.push([a, b])
    }
  }
  return overlaps
}

/** 判断一组矩形里是否存在重叠 */
export function hasOverlap(rects = [], gap = 0) {
  return findRectOverlaps(rects, gap).length > 0
}

/**
 * 仅沿纵向分离矩形。
 *
 * 用于「层与层」：无论横向是否相交，都保证后一个层在前一个层下方，
 * 且间距不小于 gap。
 *
 * @returns {Map<string, number>} id -> 向下偏移量
 */
export function separateRectRows(rects = [], gap = 0, maxIterations = 24) {
  const shifts = new Map()
  const list = rects.filter(Boolean)
  for (const rect of list) shifts.set(rect.id, 0)
  if (list.length < 2) return shifts

  const order = [...list].sort((a, b) => a.top - b.top || a.left - b.left)
  const g = Math.max(0, Number(gap) || 0)

  for (let i = 1; i < order.length; i += 1) {
    const prev = order[i - 1]
    const current = order[i]
    const prevBottom = prev.top + shifts.get(prev.id) + prev.height
    const currentTop = current.top + shifts.get(current.id)
    const delta = prevBottom + g - currentTop
    if (delta > 0.01) shifts.set(current.id, shifts.get(current.id) + delta)
  }

  // 级联推动后可能出现新的重叠，最多再迭代几次
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false
    for (let i = 1; i < order.length; i += 1) {
      const prev = order[i - 1]
      const current = order[i]
      const prevBottom = prev.top + shifts.get(prev.id) + prev.height
      const currentTop = current.top + shifts.get(current.id)
      const delta = prevBottom + g - currentTop
      if (delta > 0.01) {
        shifts.set(current.id, shifts.get(current.id) + delta)
        moved = true
      }
    }
    if (!moved) break
  }

  return shifts
}

/**
 * 二维分离矩形，优先沿指定轴推开。
 *
 * - Combo 面板：优先横向推开（`axis: 'x'`），避免破坏行结构
 * - 节点块：优先横向推开，其次纵向
 *
 * @returns {Map<string, { dx: number, dy: number }>}
 */
export function separateRects(rects = [], { gap = 0, axis = 'x', maxIterations = 24 } = {}) {
  const list = rects.filter(Boolean)
  const shifts = new Map()
  for (const rect of list) shifts.set(rect.id, { dx: 0, dy: 0 })
  if (list.length < 2) return shifts

  const g = Math.max(0, Number(gap) || 0)
  const order = [...list].sort((a, b) => a.top - b.top || a.left - b.left)

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false

    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const a = order[i]
        const b = order[j]
        const shiftA = shifts.get(a.id)
        const shiftB = shifts.get(b.id)

        const aLeft = a.left + shiftA.dx
        const aTop = a.top + shiftA.dy
        const aRight = aLeft + a.width
        const aBottom = aTop + a.height
        const bLeft = b.left + shiftB.dx
        const bTop = b.top + shiftB.dy
        const bRight = bLeft + b.width
        const bBottom = bTop + b.height

        const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft) + g
        const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop) + g
        if (overlapX <= 0 || overlapY <= 0) continue

        let dx = 0
        let dy = 0
        if (axis === 'x') {
          dx = aLeft <= bLeft ? overlapX : -overlapX
        } else if (axis === 'y') {
          dy = aTop <= bTop ? overlapY : -overlapY
        } else if (overlapX <= overlapY) {
          dx = aLeft <= bLeft ? overlapX : -overlapX
        } else {
          dy = aTop <= bTop ? overlapY : -overlapY
        }

        // 只移动后一个矩形，保持前序元素稳定
        shiftB.dx += dx
        shiftB.dy += dy
        moved = true
      }
    }

    if (!moved) break
  }

  return shifts
}
