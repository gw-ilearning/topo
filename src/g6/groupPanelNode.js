/**
 * 「分层 Group」的梯形分组面板（普通 Node，而非 Combo）
 *
 * 面板本质是一个自定义节点：
 * - keyShape 用 Polygon 画梯形，几何算法与 `TrapezoidCombo` 完全一致；
 * - 标题自己画在左上角，避免依赖 BaseNode 的 label placement（它会把
 *   文字锚在节点外侧，不适合做面板标题）；
 * - 不含子元素概念，节点归属完全由 `data.__groupId` 在布局 / 运行时维护。
 */

import { BaseNode, register } from '@antv/g6'
import { Polygon, Text } from '@antv/g'
import { GROUP_PANEL_TYPE } from './groupConfig.js'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 计算梯形顶点（相对节点中心）。
 *
 * 优先使用左右斜率：顶边收窄量 = 斜率 × 高度，
 * 因此左下 / 右下内角只与角度有关，面板被拖动、变宽、变高都不会改变。
 * 没有斜率时回退到统一灭点射线。
 */
export function groupPanelPoints(attributes, width, height) {
  const halfWidth = Math.max(1, width) / 2
  const halfHeight = Math.max(1, height) / 2
  const slopes = attributes.sideSlopes

  if (Array.isArray(slopes) && slopes.length === 2) {
    let slopeLeft = Number(slopes[0])
    let slopeRight = Number(slopes[1])
    if (Number.isFinite(slopeLeft) && Number.isFinite(slopeRight)) {
      slopeLeft = clamp(slopeLeft, 0, 2)
      slopeRight = clamp(slopeRight, 0, 2)
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
  if (Array.isArray(origin) && origin.length === 2) {
    const originX = Number(origin[0])
    const originY = Number(origin[1])
    const cx = Number(attributes.x) || 0
    const cy = Number(attributes.y) || 0
    const bottomY = cy + halfHeight
    const dy = bottomY - originY
    if (Number.isFinite(originX) && dy > 1) {
      const topY = cy - halfHeight
      const xAt = (x) => originX + ((x - originX) * (topY - originY)) / dy
      const left = cx - halfWidth
      const right = cx + halfWidth
      return [
        [xAt(left) - cx, -halfHeight],
        [xAt(right) - cx, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight],
      ]
    }
  }

  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ]
}

export class GroupLayerPanel extends BaseNode {
  getKeyStyle(attributes) {
    const keyStyle = super.getKeyStyle(attributes)
    const [width, height] = this.getSize(attributes)
    const {
      sideSlopes: _sideSlopes,
      perspectiveOrigin: _perspectiveOrigin,
      groupPanel: _groupPanel,
      panelLabelHeight: _panelLabelHeight,
      panelLabelInset: _panelLabelInset,
      ...graphicStyle
    } = keyStyle

    return {
      ...graphicStyle,
      points: groupPanelPoints(attributes, width, height),
    }
  }

  drawKeyShape(attributes, container) {
    return this.upsert('key', Polygon, this.getKeyStyle(attributes), container)
  }

  /** 标题画在面板左上角（斜边内侧），不跟随 BaseNode 的 label placement */
  drawLabelShape(attributes, container) {
    const show = attributes.label !== false && attributes.labelText
    if (!show) {
      this.upsert('label', Text, false, container)
      return
    }
    const [width, height] = this.getSize(attributes)
    const inset = Number(attributes.panelLabelInset) || 16
    const lineHeight = Number(attributes.panelLabelHeight) || 26
    const fontSize = Number(attributes.labelFontSize) || 12.5

    // 面板上窄下宽，左上角要沿着斜边向右让位，避免标题压到梯形外
    const slopeLeft = Array.isArray(attributes.sideSlopes)
      ? Number(attributes.sideSlopes[0]) || 0
      : 0
    const x = -width / 2 + inset + slopeLeft * height

    this.upsert(
      'label',
      Text,
      {
        x,
        y: -height / 2 + lineHeight * 0.5 + 4,
        text: String(attributes.labelText),
        fill: attributes.labelFill,
        fontSize,
        fontWeight: attributes.labelFontWeight ?? 700,
        fontFamily: attributes.labelFontFamily,
        letterSpacing: attributes.labelLetterSpacing,
        textAlign: 'left',
        textBaseline: 'middle',
        opacity: attributes.labelOpacity ?? 1,
      },
      container,
    )
  }
}

let registered = false

/** 注册分组面板节点，重复导入时保持幂等 */
export function registerGroupPanelNode() {
  if (registered) return
  register('node', GROUP_PANEL_TYPE, GroupLayerPanel)
  registered = true
}

registerGroupPanelNode()

export default GroupLayerPanel
