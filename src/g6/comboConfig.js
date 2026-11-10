/**
 * Combo 分层布局的公共配置
 *
 * 该文件不依赖 @antv/g6，因此可以被布局预设、主题、控制器共同引用，
 * 而不会把 G6 运行时代码带进 Three.js 页面的懒加载边界。
 */

/** 自研分层 Combo 布局在 G6 中的注册名 */
export const COMBO_LAYER_LAYOUT_ID = 'g6-combo-layer'

/** 2.5D 梯形 Combo 在 G6 中的注册名（层 Combo 使用） */
export const TRAPEZOID_COMBO_TYPE = 'combo-trapezoid'

/**
 * 布局默认参数：
 * - layerGap      层与层之间的固定间距
 * - clusterGap    同层内布局聚类之间的间距（聚类不渲染分组面板）
 * - nodeGap       聚类内节点之间的间距
 * - nodeCols      聚类内节点网格的最大列数
 * - maxLayerWidth 单层内容的最大宽度，超过后聚类自动换行
 * - nodeLabelGap  节点文字占用的额外高度
 * - layerPadding  层面板内边距 [top, right, bottom, left]，顶部留给层标题
 * - perspective   是否启用 2.5D 透视（远层缩小、近层放大、层间斜向错位）
 * - farScale      最远层（最上层）的缩放比例
 * - nearScale     最近层（最下层）的缩放比例
 * - depthShiftX   每一级深度向右偏移的像素，形成斜向堆叠
 * - depthShiftY   每一级深度向上偏移的像素，形成抬升感
 * - topInsetSlope 梯形侧边斜率（每 1px 高度向内收窄的像素数）。
 *                 仅在未计算出灭点时兜底；正常 2.5D 视图会按灭点计算收窄量。
 * - trapezoidAngle 梯形侧边相对竖直方向的倾角（度），左右两侧完全对称。
 *                 0° 为矩形，数值越大斜边越斜；设置后所有层共用同一角度，
 *                 侧边彼此平行，不再依赖灭点。传 `null` 可回退为统一灭点模式。
 * - vanishingDistance 灭点距离系数：灭点在整体上方「总高度 × 系数」处，
 *                 仅在未设置 trapezoidAngle 时生效。
 * - trapezoidNodes 是否让节点阵列也按梯形分布（越靠上的行横向越窄）
 * - trapezoidMinScale 梯形压缩的保底比例，仅在灭点非常近时避免无限拉大间距
 * - layerTopInset 层面板顶边收窄比例（0 ~ 0.5），旧参数，仅在未设置 topInsetSlope 时兜底
 * - topInsetLimit 顶边收窄上限（相对面板高度），旧参数兜底，避免收得太窄压到内容
 * - minLayerGap   层间最小间距，保证层标题不会压到上一层
 * - minClusterGap 聚类间最小间距，保证相邻聚类不会压到一起
 * - safetyGap     额外的防重叠安全间距
 */
export const COMBO_LAYER_DEFAULTS = Object.freeze({
  layerGap: 92,
  clusterGap: 44,
  nodeGap: 30,
  nodeCols: 4,
  maxLayerWidth: 1280,
  nodeLabelGap: 18,
  // 左右内边距略大于节点半宽：底边锚定的梯形向上收窄后，
  // 顶部节点仍能完整落在斜边内侧，不会溢出层梯形。
  layerPadding: Object.freeze([56, 60, 32, 60]),
  perspective: true,
  farScale: 0.62,
  nearScale: 1.08,
  depthShiftX: 118,
  depthShiftY: 34,
  // 所有层统一使用该斜率，梯形侧边互相平行
  topInsetSlope: 0.12,
  // 自定义梯形倾角（侧边相对竖直方向，单位度）：
  // 左右两侧对称、所有层共用同一角度，层高变化时只改变底边长度，内角恒定
  trapezoidAngle: 15,
  // 2.5D 灭点距离：灭点位于整体上方，距离 = 总高度 × vanishingDistance；
  // 仅在 trapezoidAngle 为 null 时作为侧边收窄的兜底
  vanishingDistance: 0.6,
  // 节点阵列也按一点透视分布：上窄下宽，与层面板同向收拢
  trapezoidNodes: true,
  // 梯形压缩的保底比例，仅在灭点非常近时避免无限拉大水平间距
  trapezoidMinScale: 0.5,
  layerTopInset: 0.2,
  topInsetLimit: 0.24,
  minLayerGap: 64,
  minClusterGap: 44,
  safetyGap: 12,
})

/** 注册到 G6_LAYOUTS 的预设参数（preLayout 让首帧就落在分层位置） */
export const COMBO_LAYER_PRESET_OPTIONS = Object.freeze({
  preLayout: true,
  ...COMBO_LAYER_DEFAULTS,
})

/**
 * 网络场景的三层归并规则。
 *
 * 原始数据有 7 个 layer（边界出口 / 安全防护 / 核心 / 汇聚 / 接入 / 资源 / 终端），
 * G6 分层 Combo 视图把它们归并成「核心 / 汇聚 / 接入」三层；
 * 层内的 `group` 只作为布局聚类依据，不再渲染二级分组面板。
 */
export const NETWORK_LAYER_BUCKETS = Object.freeze([
  Object.freeze({ layer: 0, name: '核心层', layers: Object.freeze([0, 1, 2]) }),
  Object.freeze({ layer: 1, name: '汇聚层', layers: Object.freeze([3]) }),
  Object.freeze({ layer: 2, name: '接入层', layers: Object.freeze([4, 5, 6]) }),
])

/** 判断某个布局 id 是否启用 Combo 分层（允许业务通过 style.layouts 覆盖） */
export function isComboLayerLayout(id) {
  return id === COMBO_LAYER_LAYOUT_ID
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 计算某一层的 2.5D 缩放比例。
 *
 * 索引 0 表示最上层（最远），索引 count - 1 表示最下层（最近）。
 * 远层按 farScale 缩小，近层按 nearScale 放大，形成一点透视。
 *
 * @param {number} index 层索引，从 0 开始，0 在最上方
 * @param {number} count 总层数
 * @param {object} options 布局参数
 * @returns {number} 该层内节点、间距的缩放比例
 */
export function comboLayerScale(index, count, options = {}) {
  if (options.perspective === false) return 1
  if (!Number.isFinite(count) || count <= 1) return 1
  const farScale = clamp(
    Number(options.farScale ?? COMBO_LAYER_DEFAULTS.farScale),
    0.45,
    1,
  )
  const nearScale = clamp(
    Number(options.nearScale ?? COMBO_LAYER_DEFAULTS.nearScale),
    0.6,
    1.6,
  )
  const t = clamp(index / (count - 1), 0, 1)
  return farScale + (nearScale - farScale) * t
}

/**
 * 根据某一层的缩放比例反推「深度」：0 表示最远，1 表示最近。
 *
 * 主题层用它来调整层面板的填充透明度、投影大小和描边强度，
 * 让远层在视觉上更淡、更薄，近层更实、更重。
 *
 * @param {number} scale 该层的缩放比例
 * @param {object} options 布局参数
 * @returns {number} 0 ~ 1 的深度值
 */
export function comboLayerDepth(scale, options = {}) {
  if (options.perspective === false) return 0
  const farScale = clamp(
    Number(options.farScale ?? COMBO_LAYER_DEFAULTS.farScale),
    0.45,
    1,
  )
  const nearScale = clamp(
    Number(options.nearScale ?? COMBO_LAYER_DEFAULTS.nearScale),
    0.6,
    1.6,
  )
  const span = nearScale - farScale
  if (!(span > 0.0001)) return 0
  return clamp((Number(scale) - farScale) / span, 0, 1)
}
