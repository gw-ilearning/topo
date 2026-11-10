import { ref } from 'vue'

/**
 * 轻量国际化：只覆盖 UI 框架文案，业务数据（节点名、IP 等）保持原样。
 *
 * 使用：
 *   const { t, locale, setLocale, toggleLocale } = useI18n()
 *   <span>{{ t('topbar.fit') }}</span>
 */

const LOCALE_KEY = 'topology-locale'

function detectLocale() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  }
  return typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '') ? 'en' : 'zh'
}

export const locale = ref(detectLocale())

export const LOCALES = [
  { id: 'zh', name: '中文' },
  { id: 'en', name: 'English' },
]

const messages = {
  zh: {
    'locale.name': '中文',
    'locale.toggle': '切换语言',

    'app.title': 'TOPOLOGY',
    'app.subtitle3d': 'Three.js · 3D 拓扑中心',
    'app.subtitleG6': 'G6 · 2D 拓扑中心',
    'app.loading': '正在接入 {name}',
    'app.loadingSub3d': '连接 REST API · 构建三维场景',
    'app.loadingSubG6': '连接 REST API · 构建 G6 图场景',
    'app.error': '数据加载失败',
    'app.retry': '重新加载',
    'app.empty': '暂无拓扑数据',
    'app.emptyHint': '检查接口或筛选条件后重试',
    'app.shortcuts': '快捷键',
    'app.shortcutSearch': '聚焦搜索',
    'app.shortcutFit': '适配视图',
    'app.shortcutEsc': '取消选中 / 关闭弹层',
    'app.shortcutLayout': '切换下一个布局',
    'app.shortcutEngine': '切换渲染引擎',
    'app.ready': '就绪',

    'engine.group': '渲染引擎切换',
    'engine.3d': '3D',
    'engine.g6': 'G6',
    'engine.3dTitle': '切换 Three.js 3D 页面',
    'engine.g6Title': '切换 G6 5 二维页面',

    'scene.network': '网络拓扑',
    'scene.datacenter': '3D 机房',
    'scene.graph': '知识图谱',
    'scene.iot': '物联网',
    'scene.switch': '场景切换',

    'topbar.search': '搜索节点 / IP / 类型',
    'topbar.searchEmpty': '未找到匹配节点',
    'topbar.autoRotate': '自动旋转',
    'topbar.labels': '显示标签',
    'topbar.refresh': '刷新数据',
    'topbar.themeLight': '切换到浅色模式',
    'topbar.themeDark': '切换到深色模式',
    'topbar.fit': '适配视图',
    'topbar.relayout': '重新整理分层',
    'topbar.relayoutDone': '分层已重新整理',
    'topbar.screenshot': '导出 PNG',
    'topbar.undo': '撤销',
    'topbar.redo': '重做',
    'topbar.aggregate': '聚合',
    'topbar.aggregateNone': '取消聚合',
    'topbar.aggregateGroup': '按分组聚合',
    'topbar.aggregateType': '按类型聚合',
    'topbar.aggregateStatus': '按状态聚合',
    'topbar.fullscreen': '全屏',
    'topbar.more': '更多',
    'topbar.exportSvg': '导出 SVG',
    'topbar.exportJson': '导出 JSON',
    'topbar.minimap': '小地图',
    'topbar.watermark': '水印',
    'topbar.bigScreen': '大屏模式',
    'topbar.language': 'English',
    'topbar.shortcuts': '快捷键',

    'rail.title': '布局类型',
    'rail.collapse': '收起布局菜单',
    'rail.expand': '展开布局菜单',
    'rail.depth25d': '2.5D 视图',
    'rail.depth25dOn': '已开启 2.5D 透视',
    'rail.depth25dOff': '已关闭 2.5D 透视',
    'rail.trapezoidAngle': '侧边角度',
    'rail.trapezoidAngleHint': '梯形侧边相对竖直方向的倾角，左右两侧对称；0° 为矩形',

    'status.all': '全部',
    'status.ok': '正常',
    'status.warn': '告警',
    'status.error': '严重',
    'status.maintenance': '维护',
    'status.offline': '离线',
    'status.unknown': '未知',

    'type.router': '路由器',
    'type.switch': '交换机',
    'type.server': '服务器',
    'type.database': '数据库',
    'type.storage': '存储',
    'type.firewall': '防火墙',
    'type.cloud': '云节点',
    'type.pc': '办公终端',
    'type.gateway': '网关',
    'type.edge': '边缘节点',
    'type.sensor': '传感器',
    'type.camera': '摄像头',
    'type.meter': '智能表计',
    'type.controller': '控制器',
    'type.concept': '概念',
    'type.group': '聚合组',
    'type.rack': '机柜',

    'panel.overview': 'OVERVIEW',
    'panel.statusOverview': '状态概览',
    'panel.statusDistribution': '状态分布',
    'panel.typeDistribution': '类型分布',
    'panel.running': 'SYSTEM',
    'panel.runningOverview': '运行概览',
    'panel.nodes': '节点',
    'panel.links': '链路',
    'panel.alerts': '告警',
    'panel.racks': '机柜',
    'panel.devices': '设备',
    'panel.avgCpu': '平均 CPU',
    'panel.alertNodes': '告警节点',
    'panel.noAlerts': '暂无告警节点',
    'panel.echarts': 'ECharts 统计',
    'panel.engine3d': 'Three.js 三维渲染',
    'panel.engineG6': 'G6 二维渲染',
    'panel.liveOn': '开启侧栏「实时」后，每 10 秒同步一次状态与指标。',

    'detail.nodeTitle': 'NODE DETAIL',
    'detail.rackTitle': 'RACK DETAIL',
    'detail.group': '所属分组',
    'detail.layer': '网络层级',
    'detail.zone': '所属区域',
    'detail.rackId': '机柜编号',
    'detail.uUsage': 'U 位使用',
    'detail.devices': '设备数量',
    'detail.temperature': '温度',
    'detail.power': '功率',
    'detail.cpu': 'CPU',
    'detail.memory': '内存',
    'detail.traffic': '流量',
    'detail.latency': '时延',
    'detail.uptime': '运行时长',
    'detail.ip': 'IP 地址',
    'detail.location': '位置',
    'detail.model': '型号',
    'detail.os': '系统',
    'detail.owner': '负责人',
    'detail.tags': '标签',
    'detail.focus': '聚焦视图',
    'detail.clearSelection': '取消选中',
    'detail.noDescription': '暂无节点描述信息。',
    'detail.rackLoad': '机柜负载',
    'detail.deviceList': '设备清单',
    'detail.neighbors': '邻接节点',
    'detail.metrics': '运行指标',
    'detail.analysis': '拓扑分析',
    'detail.upstream': '上游',
    'detail.downstream': '下游',
    'detail.hops': '{n} 跳',
    'detail.clearHighlight': '清除高亮',
    'detail.pathStart': '设为路径起点',
    'detail.pathEnd': '设为路径终点',
    'detail.findPath': '查找路径',
    'detail.pathFrom': '起点：{name}',
    'detail.pathTo': '终点：{name}',
    'detail.pathFound': '路径长度 {n} 跳',
    'detail.pathMissing': '两点之间没有可达路径',
    'detail.impact': '影响面',
    'detail.impactSummary': '下游 {count} 个节点 · 告警 {alerts} 个',
    'detail.drill': '下钻子拓扑',
    'detail.noSubgraph': '该节点没有可下钻的子拓扑',
    'detail.aggregate': '聚合成员',
    'detail.guide': '操作指南',
    'detail.hintDrag': '平移画布',
    'detail.hintZoom': '缩放画布',
    'detail.hintClick': '选中节点 / 机柜',
    'detail.hintDblclick': '聚焦到目标',
    'detail.hintEsc': '取消选中',
    'detail.hintRotate': '左键旋转视角',
    'detail.hintPan': '右键平移视图',
    'detail.connected': '已连接',
    'detail.close': '关闭详情',

    'analysis.highlight': '已高亮 {nodes} 个节点 / {edges} 条链路',
    'analysis.path': '路径：{nodes} 个节点 / {edges} 条链路',
    'analysis.search': '匹配 {count} 个节点',
    'analysis.clear': '高亮已清除',
    'analysis.onlyG6': '该能力需要 G6 二维引擎',
    'analysis.switchG6': '已切换到 G6 引擎以展示分析高亮',

    'aggregate.none': '未聚合',
    'aggregate.group': '按分组聚合',
    'aggregate.type': '按类型聚合',
    'aggregate.status': '按状态聚合',

    'drill.root': '根视图',
    'drill.back': '返回上级',
    'drill.level': '下钻层级',

    'statusbar.rest': 'REST API',
    'statusbar.mock': 'Mock 数据',
    'statusbar.sse': 'SSE 实时',
    'statusbar.ws': 'WebSocket',
    'statusbar.realtime': '实时通道',
    'statusbar.updated': '更新于 {time}',
    'statusbar.g6': 'G6 · 2D',
    'statusbar.fps': '{fps} FPS',
    'statusbar.paused': '已暂停',

    'context.detail': '查看详情',
    'context.focus': '聚焦节点',
    'context.neighbors': '高亮上下游',
    'context.copy': '复制 ID',
    'context.drill': '下钻子拓扑',
    'context.aggregate': '展开聚合组',
    'context.hide': '隐藏节点',
    'context.copied': 'ID 已复制',

    'onboarding.title': '欢迎使用 Topology Nexus',
    'onboarding.subtitle': '双引擎拓扑可视化平台',
    'onboarding.step1Title': '拖拽与缩放',
    'onboarding.step1Desc': '拖拽空白处平移，滚轮缩放；3D 模式左键旋转、右键平移。',
    'onboarding.step2Title': '选中与聚焦',
    'onboarding.step2Desc': '单击节点查看详情，双击聚焦；Esc 取消当前选中。',
    'onboarding.step3Title': '分析与下钻',
    'onboarding.step3Desc': '右键节点可高亮上下游、查找路径、下钻子拓扑。',
    'onboarding.next': '下一步',
    'onboarding.prev': '上一步',
    'onboarding.done': '开始使用',
    'onboarding.skip': '跳过',

    'menu.language': '语言',
    'menu.display': '显示',
    'menu.export': '导出',
    'menu.help': '帮助',
  },
  en: {
    'locale.name': 'English',
    'locale.toggle': 'Switch language',

    'app.title': 'TOPOLOGY',
    'app.subtitle3d': 'Three.js · 3D Topology Studio',
    'app.subtitleG6': 'G6 · 2D Topology Studio',
    'app.loading': 'Connecting to {name}',
    'app.loadingSub3d': 'REST API · building 3D scene',
    'app.loadingSubG6': 'REST API · building G6 graph',
    'app.error': 'Failed to load data',
    'app.retry': 'Reload',
    'app.empty': 'No topology data',
    'app.emptyHint': 'Check the API or filters and try again',
    'app.shortcuts': 'Shortcuts',
    'app.shortcutSearch': 'Focus search',
    'app.shortcutFit': 'Fit view',
    'app.shortcutEsc': 'Clear selection / close overlay',
    'app.shortcutLayout': 'Next layout',
    'app.shortcutEngine': 'Switch renderer',
    'app.ready': 'Ready',

    'engine.group': 'Renderer switch',
    'engine.3d': '3D',
    'engine.g6': 'G6',
    'engine.3dTitle': 'Switch to Three.js 3D',
    'engine.g6Title': 'Switch to G6 5 2D',

    'scene.network': 'Network',
    'scene.datacenter': 'Data Center',
    'scene.graph': 'Knowledge Graph',
    'scene.iot': 'IoT',
    'scene.switch': 'Switch scene',

    'topbar.search': 'Search node / IP / type',
    'topbar.searchEmpty': 'No matching nodes',
    'topbar.autoRotate': 'Auto rotate',
    'topbar.labels': 'Show labels',
    'topbar.refresh': 'Refresh data',
    'topbar.themeLight': 'Switch to light mode',
    'topbar.themeDark': 'Switch to dark mode',
    'topbar.fit': 'Fit view',
    'topbar.relayout': 'Re-layout layers',
    'topbar.relayoutDone': 'Layers re-organized',
    'topbar.screenshot': 'Export PNG',
    'topbar.undo': 'Undo',
    'topbar.redo': 'Redo',
    'topbar.aggregate': 'Aggregate',
    'topbar.aggregateNone': 'Clear aggregation',
    'topbar.aggregateGroup': 'Aggregate by group',
    'topbar.aggregateType': 'Aggregate by type',
    'topbar.aggregateStatus': 'Aggregate by status',
    'topbar.fullscreen': 'Fullscreen',
    'topbar.more': 'More',
    'topbar.exportSvg': 'Export SVG',
    'topbar.exportJson': 'Export JSON',
    'topbar.minimap': 'Minimap',
    'topbar.watermark': 'Watermark',
    'topbar.bigScreen': 'Big screen',
    'topbar.language': '中文',
    'topbar.shortcuts': 'Shortcuts',

    'rail.title': 'Layouts',
    'rail.collapse': 'Collapse layout menu',
    'rail.expand': 'Expand layout menu',
    'rail.depth25d': '2.5D view',
    'rail.depth25dOn': '2.5D perspective enabled',
    'rail.depth25dOff': '2.5D perspective disabled',
    'rail.trapezoidAngle': 'Side angle',
    'rail.trapezoidAngleHint': 'Trapezoid side angle from vertical; both sides are symmetric, 0° is a rectangle',

    'status.all': 'All',
    'status.ok': 'Healthy',
    'status.warn': 'Warning',
    'status.error': 'Critical',
    'status.maintenance': 'Maintenance',
    'status.offline': 'Offline',
    'status.unknown': 'Unknown',

    'type.router': 'Router',
    'type.switch': 'Switch',
    'type.server': 'Server',
    'type.database': 'Database',
    'type.storage': 'Storage',
    'type.firewall': 'Firewall',
    'type.cloud': 'Cloud',
    'type.pc': 'PC',
    'type.gateway': 'Gateway',
    'type.edge': 'Edge',
    'type.sensor': 'Sensor',
    'type.camera': 'Camera',
    'type.meter': 'Meter',
    'type.controller': 'Controller',
    'type.concept': 'Concept',
    'type.group': 'Group',
    'type.rack': 'Rack',

    'panel.overview': 'OVERVIEW',
    'panel.statusOverview': 'Status overview',
    'panel.statusDistribution': 'Status distribution',
    'panel.typeDistribution': 'Type distribution',
    'panel.running': 'SYSTEM',
    'panel.runningOverview': 'Runtime overview',
    'panel.nodes': 'Nodes',
    'panel.links': 'Links',
    'panel.alerts': 'Alerts',
    'panel.racks': 'Racks',
    'panel.devices': 'Devices',
    'panel.avgCpu': 'Avg. CPU',
    'panel.alertNodes': 'Alert nodes',
    'panel.noAlerts': 'No alert nodes',
    'panel.echarts': 'ECharts',
    'panel.engine3d': 'Three.js 3D',
    'panel.engineG6': 'G6 2D',
    'panel.liveOn': 'Enable Live in the sidebar to sync status and metrics every 10s.',

    'detail.nodeTitle': 'NODE DETAIL',
    'detail.rackTitle': 'RACK DETAIL',
    'detail.group': 'Group',
    'detail.layer': 'Layer',
    'detail.zone': 'Zone',
    'detail.rackId': 'Rack ID',
    'detail.uUsage': 'U usage',
    'detail.devices': 'Devices',
    'detail.temperature': 'Temperature',
    'detail.power': 'Power',
    'detail.cpu': 'CPU',
    'detail.memory': 'Memory',
    'detail.traffic': 'Traffic',
    'detail.latency': 'Latency',
    'detail.uptime': 'Uptime',
    'detail.ip': 'IP',
    'detail.location': 'Location',
    'detail.model': 'Model',
    'detail.os': 'OS',
    'detail.owner': 'Owner',
    'detail.tags': 'Tags',
    'detail.focus': 'Focus view',
    'detail.clearSelection': 'Clear selection',
    'detail.noDescription': 'No description available.',
    'detail.rackLoad': 'Rack load',
    'detail.deviceList': 'Devices',
    'detail.neighbors': 'Neighbors',
    'detail.metrics': 'Metrics',
    'detail.analysis': 'Topology analysis',
    'detail.upstream': 'Upstream',
    'detail.downstream': 'Downstream',
    'detail.hops': '{n} hops',
    'detail.clearHighlight': 'Clear highlight',
    'detail.pathStart': 'Set as start',
    'detail.pathEnd': 'Set as target',
    'detail.findPath': 'Find path',
    'detail.pathFrom': 'From: {name}',
    'detail.pathTo': 'To: {name}',
    'detail.pathFound': 'Path length {n} hops',
    'detail.pathMissing': 'No reachable path',
    'detail.impact': 'Impact',
    'detail.impactSummary': '{count} downstream nodes · {alerts} alerts',
    'detail.drill': 'Drill down',
    'detail.noSubgraph': 'This node has no subgraph to drill into',
    'detail.aggregate': 'Aggregate members',
    'detail.guide': 'Controls',
    'detail.hintDrag': 'Pan canvas',
    'detail.hintZoom': 'Zoom canvas',
    'detail.hintClick': 'Select node / rack',
    'detail.hintDblclick': 'Focus target',
    'detail.hintEsc': 'Clear selection',
    'detail.hintRotate': 'Rotate view (drag)',
    'detail.hintPan': 'Pan view (right drag)',
    'detail.connected': 'Connected',
    'detail.close': 'Close details',

    'analysis.highlight': 'Highlighted {nodes} nodes / {edges} links',
    'analysis.path': 'Path: {nodes} nodes / {edges} links',
    'analysis.search': '{count} nodes matched',
    'analysis.clear': 'Highlight cleared',
    'analysis.onlyG6': 'This feature requires the G6 2D engine',
    'analysis.switchG6': 'Switched to G6 to show analysis highlight',

    'aggregate.none': 'No aggregation',
    'aggregate.group': 'By group',
    'aggregate.type': 'By type',
    'aggregate.status': 'By status',

    'drill.root': 'Root',
    'drill.back': 'Back',
    'drill.level': 'Drill level',

    'statusbar.rest': 'REST API',
    'statusbar.mock': 'Mock data',
    'statusbar.sse': 'SSE live',
    'statusbar.ws': 'WebSocket',
    'statusbar.realtime': 'Realtime',
    'statusbar.updated': 'Updated {time}',
    'statusbar.g6': 'G6 · 2D',
    'statusbar.fps': '{fps} FPS',
    'statusbar.paused': 'Paused',

    'context.detail': 'View details',
    'context.focus': 'Focus node',
    'context.neighbors': 'Highlight neighbors',
    'context.copy': 'Copy ID',
    'context.drill': 'Drill down',
    'context.aggregate': 'Expand group',
    'context.hide': 'Hide node',
    'context.copied': 'ID copied',

    'onboarding.title': 'Welcome to Topology Nexus',
    'onboarding.subtitle': 'Dual-engine topology studio',
    'onboarding.step1Title': 'Drag & zoom',
    'onboarding.step1Desc': 'Drag empty space to pan, scroll to zoom. In 3D, drag to rotate and right-drag to pan.',
    'onboarding.step2Title': 'Select & focus',
    'onboarding.step2Desc': 'Click a node for details, double-click to focus, Esc to clear.',
    'onboarding.step3Title': 'Analyze & drill',
    'onboarding.step3Desc': 'Right-click a node to highlight neighbors, find paths, or drill into its subgraph.',
    'onboarding.next': 'Next',
    'onboarding.prev': 'Back',
    'onboarding.done': 'Get started',
    'onboarding.skip': 'Skip',

    'menu.language': 'Language',
    'menu.display': 'Display',
    'menu.export': 'Export',
    'menu.help': 'Help',
  },
}

export function translate(key, params, targetLocale = locale.value) {
  const dict = messages[targetLocale] || messages.zh
  let text = dict[key] ?? messages.zh[key] ?? key
  if (params && typeof params === 'object') {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export function t(key, params) {
  return translate(key, params)
}

export function statusLabel(status) {
  return t(`status.${status || 'unknown'}`)
}

export function typeLabelI18n(type) {
  const key = `type.${type || 'server'}`
  const value = t(key)
  return value === key ? String(type || 'server') : value
}

export function sceneLabel(key) {
  const translated = t(`scene.${key}`)
  return translated === `scene.${key}` ? key : translated
}

export function setLocale(next) {
  const value = next === 'en' ? 'en' : 'zh'
  locale.value = value
  if (typeof document !== 'undefined') document.documentElement.lang = value === 'en' ? 'en' : 'zh-CN'
  if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, value)
}

export function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh')
}

export function useI18n() {
  return { locale, t, translate, setLocale, toggleLocale, statusLabel, typeLabelI18n, sceneLabel }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale.value === 'en' ? 'en' : 'zh-CN'
}
