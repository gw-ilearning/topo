/**
 * 「分层 Group」布局的公共配置
 *
 * 这里的 Group 是**逻辑分组**，不是 G6 的 Combo：
 * - 层是一块普通节点（自定义梯形面板），不是 Combo 容器；
 * - 节点与层之间只有 `data.__groupId` 的归属关系；
 * - 面板的坐标 / 尺寸由布局和运行时显式维护，G6 不会自动推导。
 *
 * 本文件刻意不引用 `comboConfig.js`，参数、缩放、深度全部独立实现，
 * 保证 Group 版在数据、布局、运行时三个层面都不走 Combo 路径。
 */

/** 「分层 Group」布局在 G6 中的注册名 */
export const GROUP_LAYER_LAYOUT_ID = 'g6-group-layer'

/** 梯形分组面板节点在 G6 中的注册名 */
export const GROUP_PANEL_TYPE = 'group-layer-panel'

/** 面板节点 id 前缀，避免与真实业务节点冲突 */
export const GROUP_PANEL_PREFIX = 'group-panel:'

/**
 * 布局默认参数。
 *
 * 数值与「分层 Combo」保持同一套视觉标尺，方便两种实现并排对比；
 * 但这里是 Group 自己的常量，不依赖 Combo 模块。
 */
export const GROUP_LAYER_DEFAULTS = Object.freeze({
  // 层间距 / 层内间距
  layerGap: 92,
  clusterGap: 44,
  nodeGap: 30,
  nodeCols: 4,
  maxLayerWidth: 1280,
  nodeLabelGap: 18,
  layerPadding: Object.freeze([56, 60, 32, 60]),
  // 2.5D 透视
  perspective: true,
  farScale: 0.62,
  nearScale: 1.08,
  depthShiftX: 118,
  depthShiftY: 34,
  topInsetSlope: 0.12,
  // 梯形侧边相对竖直方向的倾角（度），左右对称、所有层一致
  trapezoidAngle: 15,
  // 未设置 trapezoidAngle 时的统一灭点距离系数
  vanishingDistance: 0.6,
  trapezoidNodes: true,
  trapezoidMinScale: 0.5,
  layerTopInset: 0.2,
  topInsetLimit: 0.24,
  // 防重叠
  minLayerGap: 64,
  minClusterGap: 44,
  safetyGap: 12,
  // 面板标题
  panelLabelHeight: 26,
  panelLabelInset: 16,
})

/** 注册到 G6_LAYOUTS 的预设参数（preLayout 让首帧就落在分层位置） */
export const GROUP_LAYER_PRESET_OPTIONS = Object.freeze({
  preLayout: true,
  ...GROUP_LAYER_DEFAULTS,
})

/** 由逻辑层 id 得到面板节点 id */
export function groupPanelId(groupId) {
  return `${GROUP_PANEL_PREFIX}${groupId}`
}

/** 判断布局 id 是否启用 Group 分层 */
export function isGroupLayerLayout(id) {
  return id === GROUP_LAYER_LAYOUT_ID
}

/** 判断节点 data 是否为分组面板 */
export function isGroupPanelData(data) {
  return data?.kind === 'layer-panel'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 计算某一层的 2.5D 缩放比例（Group 独立实现）。
 *
 * 索引 0 表示最上层（最远），索引 count - 1 表示最下层（最近）。
 */
export function groupLayerScale(index, count, options = {}) {
  if (options.perspective === false) return 1
  if (!Number.isFinite(count) || count <= 1) return 1
  const farScale = clamp(
    Number(options.farScale ?? GROUP_LAYER_DEFAULTS.farScale),
    0.45,
    1,
  )
  const nearScale = clamp(
    Number(options.nearScale ?? GROUP_LAYER_DEFAULTS.nearScale),
    0.6,
    1.6,
  )
  const t = clamp(index / (count - 1), 0, 1)
  return farScale + (nearScale - farScale) * t
}

/**
 * 根据层缩放比例反推深度：0 = 最远，1 = 最近。
 * 主题层用它调整面板填充、描边与投影。
 */
export function groupLayerDepth(scale, options = {}) {
  if (options.perspective === false) return 0
  const farScale = clamp(
    Number(options.farScale ?? GROUP_LAYER_DEFAULTS.farScale),
    0.45,
    1,
  )
  const nearScale = clamp(
    Number(options.nearScale ?? GROUP_LAYER_DEFAULTS.nearScale),
    0.6,
    1.6,
  )
  const span = nearScale - farScale
  if (!(span > 0.0001)) return 0
  return clamp((Number(scale) - farScale) / span, 0, 1)
}

/**
 * 把自定义梯形倾角换算成「收窄量 / 层高」斜率。
 *
 * - 0° 时斜率为 0，梯形退化为矩形；
 * - 角度越大，侧边越斜；
 * - 左右两侧共用同一个斜率，因此左下 / 右下内角完全一致；
 * - `null` 表示回退到统一灭点模式，返回 null。
 */
export function groupTrapezoidSlope(
  options = {},
  fallback = GROUP_LAYER_DEFAULTS.trapezoidAngle,
) {
  if (options.perspective === false) return 0
  const raw = options.trapezoidAngle
  if (raw === null || raw === false) return null
  const angle = Number(raw ?? fallback)
  if (!Number.isFinite(angle)) return null
  const clamped = Math.min(44.9, Math.max(0, angle))
  return Math.tan((clamped * Math.PI) / 180)
}
