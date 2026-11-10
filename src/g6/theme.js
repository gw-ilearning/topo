/**
 * G6 页面独立主题与元素样式
 *
 * 该文件只服务 src/g6 下的 G6 渲染体系，不依赖 Three.js 场景、材质或调色板，
 * 保证 G6 页面与 Three.js 页面在技术上完全独立。
 */

import { COMBO_LAYER_DEFAULTS, TRAPEZOID_COMBO_TYPE, comboLayerDepth } from './comboConfig.js'

export const G6_THEMES = {
  dark: {
    background: '#060a13',
    grid: 'rgba(80, 150, 200, 0.08)',
    gridBorder: 'rgba(80, 150, 200, 0.14)',
    nodeFill: '#0b1728',
    nodeStrokeWidth: 1.7,
    nodeLabel: '#cfe6f7',
    nodeLabelBg: 'rgba(6, 12, 22, 0.78)',
    edge: 'rgba(96, 158, 202, 0.5)',
    edgeActive: '#5fd4ff',
    dimOpacity: 0.16,
    shadowBlur: 14,
    comboFill: 'rgba(20, 44, 72, 0.34)',
    comboStroke: 'rgba(120, 190, 240, 0.26)',
    layerFill: 'rgba(10, 26, 46, 0.52)',
    layerStroke: 'rgba(95, 212, 255, 0.3)',
    status: {
      ok: '#22e0a1',
      warn: '#ffb020',
      error: '#ff4d6d',
      maintenance: '#a78bfa',
      offline: '#64748b',
      unknown: '#94a3b8',
    },
  },
  light: {
    background: '#eef4fa',
    grid: 'rgba(40, 100, 150, 0.1)',
    gridBorder: 'rgba(40, 100, 150, 0.16)',
    nodeFill: '#ffffff',
    nodeStrokeWidth: 1.7,
    nodeLabel: '#22405a',
    nodeLabelBg: 'rgba(255, 255, 255, 0.9)',
    edge: 'rgba(60, 120, 170, 0.52)',
    edgeActive: '#0a8fc4',
    dimOpacity: 0.2,
    shadowBlur: 10,
    comboFill: 'rgba(255, 255, 255, 0.64)',
    comboStroke: 'rgba(40, 110, 160, 0.24)',
    layerFill: 'rgba(224, 238, 249, 0.68)',
    layerStroke: 'rgba(10, 143, 196, 0.32)',
    status: {
      ok: '#0f9f74',
      warn: '#b45309',
      error: '#d81b47',
      maintenance: '#7c3aed',
      offline: '#64748b',
      unknown: '#94a3b8',
    },
  },
}

export const G6_GROUP_COLORS = [
  '#38bdf8',
  '#8b5cf6',
  '#22d3a6',
  '#f59e0b',
  '#f472b6',
  '#60a5fa',
  '#34d399',
  '#fb7185',
]

const SHAPE_BY_TYPE = {
  cloud: 'star',
  firewall: 'diamond',
  router: 'hexagon',
  switch: 'rect',
  server: 'rect',
  database: 'rect',
  storage: 'rect',
  pc: 'circle',
  gateway: 'circle',
  edge: 'hexagon',
  sensor: 'triangle',
  camera: 'diamond',
  meter: 'rect',
  controller: 'hexagon',
  concept: 'circle',
  group: 'ellipse',
}

export function resolveG6Theme(name) {
  return name === 'light' ? G6_THEMES.light : G6_THEMES.dark
}

export function hashG6Color(value = '') {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return G6_GROUP_COLORS[Math.abs(hash) % G6_GROUP_COLORS.length]
}

export function g6NodeShape(data = {}) {
  if (data.kind === 'rack') return 'rect'
  return SHAPE_BY_TYPE[data.type] || 'circle'
}

export function g6NodeSize(data = {}) {
  if (data.kind === 'rack') return [72, 92]
  const degree = Number(data.degree) || 0
  switch (data.type) {
    case 'cloud':
      return 46
    case 'firewall':
    case 'router':
      return 34
    case 'database':
    case 'storage':
      return 32
    case 'sensor':
    case 'camera':
      return 22
    case 'pc':
      return 20
    default:
      return Math.min(40, 24 + Math.min(degree, 8) * 1.7)
  }
}

export function g6NodeAccent(data, theme, colorMode = 'status') {
  if (colorMode === 'group') {
    return data.color || hashG6Color(data.group || data.type || data.id)
  }
  return theme.status[data.status] || theme.status.unknown
}

function applyOverrides(style, datum, overrides = []) {
  let next = style
  for (const override of overrides) {
    if (!override) continue
    const patch = typeof override === 'function' ? override(datum, next) : override
    if (patch && typeof patch === 'object') next = { ...next, ...patch }
  }
  return next
}

/** G6 节点配置：形状、尺寸、状态、标签全部由 G6 自身样式系统渲染 */
export function buildNodeOptions(theme, { showLabels = true, colorMode = 'status', overrides = [] } = {}) {
  return {
    type: (datum) => g6NodeShape(datum.data || {}),
    style: (datum) => {
      const data = datum.data || {}
      const shape = g6NodeShape(data)
      const isRect = shape === 'rect' || shape === 'ellipse'
      const accent = g6NodeAccent(data, theme, colorMode)
      const show = showLabels && data.hideLabel !== true
      // 2.5D 透视：远层节点整体缩小，文字、投影同步缩放，避免视觉突兀
      const scale = Number(data.__comboScale) || 1
      const baseSize = g6NodeSize(data)
      const size = scale === 1
        ? baseSize
        : Array.isArray(baseSize)
          ? [baseSize[0] * scale, baseSize[1] * scale]
          : baseSize * scale
      const labelFontSize = (data.kind === 'rack' ? 11 : 10.5) * scale
      const labelOffsetY = (data.kind === 'rack' ? 10 : 7) * scale

      const style = {
        size,
        radius: isRect ? Math.max(4, 9 * scale) : undefined,
        fill: theme.nodeFill,
        stroke: accent,
        lineWidth: Math.max(0.8, theme.nodeStrokeWidth * scale),
        // 远层节点轻微降低不透明度，配合缩放形成空气透视
        opacity: scale >= 1 ? 1 : Math.max(0.72, 0.68 + 0.32 * scale),
        shadowColor: accent,
        shadowBlur: Math.max(4, theme.shadowBlur * scale),
        shadowOffsetY: Math.max(0.5, 1 * scale),
        cursor: 'pointer',
        label: show,
        labelText: show ? data.name || data.id : '',
        labelPlacement: 'bottom',
        labelOffsetY,
        labelFill: theme.nodeLabel,
        labelFontSize,
        labelFontWeight: data.kind === 'rack' ? 600 : 400,
        labelBackground: true,
        labelBackgroundFill: theme.nodeLabelBg,
        labelBackgroundRadius: 4,
        labelBackgroundPadding: [1, 5],
      }

      return applyOverrides(style, datum, overrides)
    },
    state: {
      active: {
        lineWidth: theme.nodeStrokeWidth + 1.8,
        shadowBlur: theme.shadowBlur + 14,
      },
      highlight: {
        lineWidth: theme.nodeStrokeWidth + 2.4,
        shadowBlur: theme.shadowBlur + 18,
        shadowColor: theme.edgeActive,
      },
      dimmed: {
        opacity: theme.dimOpacity,
      },
    },
  }
}

/** G6 边配置：状态颜色、告警加粗、方向箭头全部由 G6 自身渲染 */
export function buildEdgeOptions(theme, { directed = false, overrides = [] } = {}) {
  return {
    type: 'line',
    style: (datum) => {
      const data = datum.data || {}
      const status = data.status
      const accent = theme.status[status]
      const alerting = status === 'warn' || status === 'error'

      const style = {
        stroke: alerting ? accent : theme.edge,
        lineWidth: alerting ? 1.9 : 1.2,
        opacity: 0.82,
        lineDash: data.type === 'stack' || data.type === 'dependency' ? [5, 4] : undefined,
        endArrow: directed,
        endArrowFill: theme.edge,
        endArrowSize: 7,
        lineAppendWidth: 8,
        cursor: 'pointer',
      }

      return applyOverrides(style, datum, overrides)
    },
    state: {
      active: {
        stroke: theme.edgeActive,
        lineWidth: 2.4,
        opacity: 1,
      },
      highlight: {
        stroke: theme.edgeActive,
        lineWidth: 2.8,
        opacity: 1,
      },
      dimmed: {
        opacity: 0.08,
      },
    },
  }
}

export function buildGridPlugin(theme) {
  return {
    type: 'grid-line',
    size: 28,
    stroke: theme.grid,
    border: true,
    borderStroke: theme.gridBorder,
    borderLineWidth: 1,
    follow: { translate: false, zoom: false },
  }
}

/**
 * Combo 2.5D 分层面板样式
 *
 * 现在只有一层 Combo（层），节点直接挂在层上：
 * - 大圆角、较深填充、较大的投影，形成「浮起的一层」；
 * - padding 由 Combo 数据提供（见 `buildLayerCombos`），而不是写死在主题里。
 *   G6 的 `getElementComputedStyle` 会先合并主题样式、再合并数据样式，
 *   但「默认样式」优先级最高；如果把 padding 放在主题函数里，
 *   运行时通过 `updateComboData` 调整 padding 会被覆盖，层就无法随节点自动扩展。
 */
export function buildComboOptions(theme, { showLabels = true, layoutOptions = {} } = {}) {
  const perspective = layoutOptions.perspective !== false

  return {
    // 2.5D 开启时使用自定义梯形 Combo；关闭时回退到原生矩形
    type: () => (perspective ? TRAPEZOID_COMBO_TYPE : 'rect'),
    style: (datum) => {
      const data = datum.data || {}
      const show = showLabels && data.hideLabel !== true
      const label = data.name || String(datum.id || '')
      // 2.5D 深度：0 = 最远，1 = 最近；关闭透视时按「最近层」处理，保持面板厚实
      const scale = Number(data.scale) || 1
      const depth =
        layoutOptions.perspective === false ? 1 : comboLayerDepth(scale, layoutOptions)
      const labelScale = Math.max(0.86, scale)
      // 近层更实、投影更大；远层更淡、更薄，形成空气透视
      const fillOpacity = 0.4 + 0.4 * depth
      const strokeOpacity = 0.5 + 0.5 * depth
      // 层的投影只做很轻的「浮起」暗示：大范围青色光晕会把背景压得很重。
      const shadowBlur = 9 * (0.5 + 0.6 * depth)
      const shadowOffsetY = 4 * (0.5 + depth)
      const topInsetSlope = perspective
        ? Number(layoutOptions.topInsetSlope ?? COMBO_LAYER_DEFAULTS.topInsetSlope)
        : 0
      // 旧参数：未设置 topInsetSlope 时按宽度比例兜底
      const topInsetRatio = perspective
        ? Number(layoutOptions.layerTopInset ?? 0.2)
        : 0
      const topInsetLimit = Number(layoutOptions.topInsetLimit ?? 0.24)
      // 2.5D 灭点：所有梯形侧边的延长线都汇聚到该点
      const perspectiveOrigin =
        perspective && Array.isArray(layoutOptions.perspectiveOrigin)
          ? layoutOptions.perspectiveOrigin
          : undefined
      // 布局稳定后冻结的每层左右斜率：拖动时优先使用，
      // 保证梯形左下 / 右下内角与透视角度不随拖动变化
      const sideSlopes =
        perspective && layoutOptions.layerSlopes
          ? layoutOptions.layerSlopes[datum.id]
          : undefined

      return {
        radius: 20,
        // 自定义梯形 Combo 优先按冻结斜率计算顶边收窄量，其次按灭点
        sideSlopes,
        perspectiveOrigin,
        topInsetSlope,
        topInsetRatio,
        topInsetLimit,
        comboKind: 'layer',
        fill: theme.layerFill,
        fillOpacity,
        stroke: theme.layerStroke,
        strokeOpacity,
        lineWidth: 1 + 0.5 * depth,
        opacity: 1,
        shadowColor: theme.edgeActive,
        shadowBlur,
        shadowOffsetY,
        shadowOpacity: 0.08 + 0.08 * depth,
        cursor: 'grab',
        label: show,
        labelText: show ? label : '',
        labelPlacement: 'top',
        labelOffsetY: 27 * labelScale,
        labelFill: theme.nodeLabel,
        labelFontSize: 12.5 * labelScale,
        labelFontWeight: 700,
        labelLetterSpacing: 0.6,
        labelBackground: true,
        labelBackgroundFill: theme.nodeLabelBg,
        labelBackgroundRadius: 4,
        labelBackgroundPadding: [1, 6],
      }
    },
    state: {
      active: {
        lineWidth: 2,
        shadowBlur: 16,
      },
      highlight: {
        lineWidth: 2.4,
        stroke: theme.edgeActive,
      },
    },
  }
}
