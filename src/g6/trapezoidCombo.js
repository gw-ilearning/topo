/**
 * G6 5 自定义 2.5D 梯形 Combo
 *
 * 原生 `rect` Combo 只能画圆角矩形，看起来像平面套框；
 * 这里继承 `BaseCombo`，把 keyShape 换成四边形。
 *
 * 画法：
 * - 自定义倾角（默认）：左右两侧使用同一个斜率，底边内角完全对称，
 *   所有层共用同一角度，侧边彼此平行；层高变化只改变底边长度，内角恒定；
 * - 统一灭点（`trapezoidAngle: null`）：以「内容区顶边」为锚点，
 *   斜边穿过内容区顶角并延长到灭点，底边自然落在下方；
 * - 两者都没有时：按 `topInsetSlope` 收窄顶边。
 *
 * 有灭点模式下所有斜边延长线汇聚到同一点；自定义倾角模式下侧边平行。
 */

import { BaseCombo, register } from '@antv/g6'
import { Polygon } from '@antv/g'
import { TRAPEZOID_COMBO_TYPE } from './comboConfig.js'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export class TrapezoidCombo extends BaseCombo {
  /**
   * 计算左右两侧的顶边收窄量（无灭点兜底）。
   *
   * 有灭点时：顶边两端都落在「底边端点 -> 灭点」的连线上；
   * 没有灭点时：使用统一斜率，所有斜边保持平行。
   */
  _insets(attributes, width, height) {
    const origin = attributes.perspectiveOrigin
    const halfWidth = width / 2
    const slope = clamp(Number(attributes.topInsetSlope) || 0, 0, 0.5)
    const ratio = clamp(Number(attributes.topInsetRatio) || 0, 0, 0.5)
    const limit = clamp(Number(attributes.topInsetLimit) || 0.24, 0, 0.5)

    if (Array.isArray(origin) && origin.length === 2) {
      const cx = Number(attributes.x) || 0
      const cy = Number(attributes.y) || 0
      const originX = Number(origin[0])
      const originY = Number(origin[1])
      const bottomY = cy + height / 2
      const distance = bottomY - originY
      // t：从底边走向灭点的比例，必须小于 1，否则顶边会翻转
      const t = distance > height ? clamp(height / distance, 0, 0.92) : 0
      if (t > 0) {
        const left = cx - halfWidth
        const right = cx + halfWidth
        return {
          insetLeft: t * (originX - left),
          insetRight: t * (right - originX),
        }
      }
    }

    const inset =
      slope > 0
        ? Math.min(height * slope, halfWidth)
        : Math.min((width * ratio) / 2, height * limit)
    return { insetLeft: inset, insetRight: inset }
  }

  /**
   * 层面板专用：让梯形把内容区完整包住。
   *
   * 优先使用布局稳定时冻结的左右斜率 `sideSlopes`：
   *   顶边收窄量 = 斜率 × 当前层高
   * 斜率只与「收窄量 / 高度」有关，因此层被拖动、变宽、变高时
   * 左下 / 右下内角始终保持不变，透视角度也不会变化。
   *
   * 没有冻结斜率时（布局阶段回退）仍按统一灭点计算：
   * 以面板底边为锚点，底边保持完整宽度，向上按灭点射线收窄。
   */
  _layerPoints(attributes, width, height) {
    const halfWidth = width / 2
    const halfHeight = height / 2

    // 冻结斜率：[左侧收窄比例, 右侧收窄比例]
    const slopes = attributes.sideSlopes
    if (Array.isArray(slopes) && slopes.length === 2) {
      const slopeLeft = Number(slopes[0])
      const slopeRight = Number(slopes[1])
      if (Number.isFinite(slopeLeft) && Number.isFinite(slopeRight)) {
        let insetLeft = slopeLeft * height
        let insetRight = slopeRight * height
        // 极端尺寸下避免顶边翻转（左右收窄总和不能超过面板宽度）
        const maxTotal = width * 0.98
        const total = insetLeft + insetRight
        if (total > maxTotal && total > 0) {
          const scale = maxTotal / total
          insetLeft *= scale
          insetRight *= scale
        }
        return [
          [-halfWidth + insetLeft, -halfHeight],
          [halfWidth - insetRight, -halfHeight],
          [halfWidth, halfHeight],
          [-halfWidth, halfHeight],
        ]
      }
    }

    const origin = attributes.perspectiveOrigin
    if (!Array.isArray(origin) || origin.length !== 2) return null

    const cx = Number(attributes.x) || 0
    const cy = Number(attributes.y) || 0
    const originX = Number(origin[0])
    const originY = Number(origin[1])
    const topY = cy - halfHeight
    const bottomY = cy + halfHeight
    const dy = bottomY - originY
    if (dy <= 1) return null

    // 底边使用完整面板宽度；顶边沿「底边端点 -> 灭点」的射线收窄
    const xAt = (x, y) => originX + ((x - originX) * (y - originY)) / dy
    const left = cx - halfWidth
    const right = cx + halfWidth
    const topLeft = xAt(left, topY)
    const topRight = xAt(right, topY)

    return [
      [topLeft - cx, -halfHeight],
      [topRight - cx, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ]
  }

  getKeyStyle(attributes) {
    const keyStyle = super.getKeyStyle(attributes)
    const [width, height] = this.getKeySize(attributes)
    const halfWidth = width / 2
    const halfHeight = height / 2
    const isLayer = attributes.comboKind === 'layer'

    let points = isLayer ? this._layerPoints(attributes, width, height) : null
    if (!points) {
      const { insetLeft, insetRight } = this._insets(attributes, width, height)
      points = [
        [-halfWidth + insetLeft, -halfHeight],
        [halfWidth - insetRight, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight],
      ]
    }

    const {
      perspectiveOrigin: _perspectiveOrigin,
      sideSlopes: _sideSlopes,
      topInsetSlope: _topInsetSlope,
      topInsetRatio: _topInsetRatio,
      topInsetLimit: _topInsetLimit,
      comboKind: _comboKind,
      ...graphicStyle
    } = keyStyle

    return { ...graphicStyle, points }
  }

  drawKeyShape(attributes, container) {
    return this.upsert('key', Polygon, this.getKeyStyle(attributes), container)
  }
}

let registered = false

/** 注册梯形 Combo，重复导入时保持幂等 */
export function registerTrapezoidCombo() {
  if (registered) return
  register('combo', TRAPEZOID_COMBO_TYPE, TrapezoidCombo)
  registered = true
}

registerTrapezoidCombo()

export default TrapezoidCombo
