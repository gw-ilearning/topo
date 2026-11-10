<template>
  <div class="app-shell">
    <TopBar
      ref="topBarRef"
      :scenes="SCENES"
      :scene="scene"
      :renderer="renderer"
      :auto-rotate="autoRotate"
      :show-labels="showLabels"
      :loading="loading"
      :theme="theme"
      :search-items="searchItems"
      :aggregation="aggregation"
      :can-undo="history.canUndo"
      :can-redo="history.canRedo"
      :minimap="minimap"
      :watermark="watermark"
      @update:scene="scene = $event"
      @update:renderer="renderer = $event"
      @update:auto-rotate="autoRotate = $event"
      @update:show-labels="showLabels = $event"
      @refresh="refreshData"
      @update:theme="applyTheme"
      @select-node="selectNode"
      @search="handleSearch"
      @fit="fitView"
      @screenshot="takeScreenshot"
      @aggregate="setAggregation"
      @undo="undo"
      @redo="redo"
      @fullscreen="toggleFullscreen"
      @export-svg="exportSVG"
      @export-json="exportJSON"
      @toggle-minimap="minimap = !minimap"
      @toggle-watermark="watermark = !watermark"
      @toggle-language="toggleLanguage"
      @show-shortcuts="shortcutsOpen = true"
      @show-guide="guideOpen = true"
    />

    <main class="workspace">
      <!-- 下半部分：左右布局；左侧为可收起的布局类型菜单 -->
      <aside
        class="layout-rail"
        :class="{ collapsed: workspace.collapsed }"
        :style="workspace.railStyle"
      >
        <div class="rail-head">
          <span v-if="!workspace.collapsed" class="rail-title">{{ t('rail.title') }}</span>
          <button
            type="button"
            class="rail-toggle"
            :title="workspace.collapsed ? t('rail.expand') : t('rail.collapse')"
            :aria-label="workspace.collapsed ? t('rail.expand') : t('rail.collapse')"
            @click="toggleLayoutRail"
          >
            <Icon :name="workspace.collapsed ? 'chevron-right' : 'chevron-left'" :size="15" />
          </button>
        </div>

        <div class="rail-list">
          <button
            v-for="item in layouts"
            :key="item.id"
            type="button"
            class="rail-btn"
            :class="{ active: layout === item.id }"
            :title="item.description || item.name"
            @click="setLayout(item.id)"
          >
            <Icon :name="item.icon" :size="16" />
            <span v-if="!workspace.collapsed" class="rail-label">{{ item.name }}</span>
          </button>

          <button
            v-if="renderer === 'g6' && g6LayoutActive === 'g6-combo-layer'"
            type="button"
            class="rail-btn rail-action"
            :title="t('topbar.relayout')"
            @click="relayoutGraph"
          >
            <Icon name="reset" :size="16" />
            <span v-if="!workspace.collapsed" class="rail-label">{{ t('topbar.relayout') }}</span>
          </button>

          <button
            v-if="renderer === 'g6' && g6LayoutActive === 'g6-combo-layer'"
            type="button"
            class="rail-btn rail-action rail-depth"
            :class="{ active: depth25d }"
            :title="depth25d ? t('rail.depth25dOn') : t('rail.depth25dOff')"
            :aria-pressed="depth25d"
            @click="toggleDepth25d"
          >
            <Icon name="grid3d" :size="16" />
            <span v-if="!workspace.collapsed" class="rail-label">{{ t('rail.depth25d') }}</span>
          </button>
        </div>

        <div v-if="!workspace.collapsed" class="rail-foot">
          <span>{{ renderer === 'g6' ? 'G6' : '3D' }}</span>
          <span class="rail-count">{{ layouts.length }}</span>
        </div>
      </aside>

      <!-- 右侧：G6 / 3D 画布及浮层面板 -->
      <section class="canvas-area">
        <div v-if="renderer === 'three'" ref="canvasHost" class="canvas-host" />
        <G6View
          v-else
          ref="g6Ref"
          class="g6-host"
          :data="displayPayload"
          :layout="g6LayoutActive"
          :layout-options="g6LayoutOptions"
          :theme="theme"
          :active-statuses="activeStatuses"
          :show-labels="showLabels"
          :style-config="null"
          :plugins="g6Plugins"
          @hover="handleG6Hover"
          @select="handleG6Select"
          @ready="handleG6Ready"
          @event="handleG6Event"
          @history="handleHistory"
        />

        <template v-if="renderer === 'three'">
          <div class="vignette" />
          <div class="scanlines" />
        </template>

        <Breadcrumb
          v-if="drillStack.length || aggregation !== 'none'"
          :items="breadcrumbItems"
          :aggregation="aggregation"
          :loading="loading"
          @up="drillUp"
          @navigate="navigateCrumb"
        />

        <DetailPanel
          :selection="selection"
          :payload="displayPayload"
          :analysis="analysisInfo"
          @close="clearSelection"
          @focus="focusNode"
          @select-node="selectNode"
          @highlight-neighbors="highlightNeighbors"
          @analyze-impact="analyzeImpact"
          @set-path-start="setPathStart"
          @set-path-end="setPathEnd"
          @find-path="findPath"
          @clear-highlight="clearHighlight"
          @clear-path="clearPath"
          @drill-down="drillDown"
        />

        <div v-if="loading" class="loading-mask skeleton-mask">
          <div class="skeleton-grid">
            <span class="skeleton-card tall" />
            <span class="skeleton-card" />
            <span class="skeleton-card" />
          </div>
          <div class="loader">
            <span class="loader-ring" />
            <span class="loader-ring delay" />
            <span class="loader-core" />
          </div>
          <p>{{ t('app.loading', { name: sceneMeta.name }) }}</p>
          <span class="loading-sub">
            {{ renderer === 'g6' ? t('app.loadingSubG6') : t('app.loadingSub3d') }}
          </span>
        </div>

        <div v-else-if="!hasData" class="empty-state">
          <div class="empty-icon">
            <Icon name="network" :size="30" />
          </div>
          <h2>{{ status.error ? t('app.error') : t('app.empty') }}</h2>
          <p>{{ status.error || t('app.emptyHint') }}</p>
          <button type="button" class="btn" @click="loadScene(scene)">
            <Icon name="reset" :size="14" />
            {{ t('app.retry') }}
          </button>
        </div>

        <div v-if="hover && hover.data" class="hover-card" :style="hoverStyle">
          <div class="hover-head">
            <span class="dot" :style="{ background: hoverStatus.color }" />
            <strong>{{ hover.data.name }}</strong>
          </div>
          <div class="hover-meta">
            {{ hover.kind === 'rack' ? t('type.rack') : typeLabelI18n(hover.data.type) }}
            <span>·</span>
            {{ hoverStatus.label }}
          </div>
          <div v-if="hover.kind === 'node' && hover.data.meta?.ip" class="hover-line">
            IP {{ hover.data.meta.ip }}
          </div>
          <div v-if="hover.kind === 'node' && hover.data.metrics" class="hover-line">
            CPU {{ hover.data.metrics.cpu ?? '—' }}% · {{ t('detail.memory') }} {{ hover.data.metrics.memory ?? '—' }}%
          </div>
          <div v-if="hover.kind === 'rack'" class="hover-line">
            {{ hover.data.row || t('type.rack') }} · {{ Number(hover.data.temperature).toFixed(1) }}°C ·
            {{ hover.data.devices?.length || 0 }}
          </div>
          <div class="hover-tip">{{ t('detail.hintClick') }} · {{ t('detail.hintDblclick') }}</div>
        </div>

        <StatusBar
          :source="status.source"
          :error="status.error"
          :renderer="renderer"
          :fps="status.fps"
          :updated-at="status.updatedAt"
          :stats="statusStats"
          :scene-name="sceneMeta.name"
        />
      </section>
    </main>

    <Onboarding :open="guideOpen" @close="closeGuide" />
    <Shortcuts :open="shortcutsOpen" @close="shortcutsOpen = false" />

    <transition name="toast">
      <div v-if="toast.msg" class="toast" :class="toast.tone">{{ toast.msg }}</div>
    </transition>
  </div>
</template>

<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import TopBar from './components/TopBar.vue'
import DetailPanel from './components/DetailPanel.vue'
import StatusBar from './components/StatusBar.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import Onboarding from './components/Onboarding.vue'
import Shortcuts from './components/Shortcuts.vue'
import Icon from './components/Icon.vue'
import { fetchTopology, normalizeTopology } from './api/client.js'
import { SCENES, getSceneMeta } from './mock/data.js'
import { STATUS_ORDER, statusMeta, typeLabel } from './topology/palette.js'
import { getLayouts, subscribeLayouts } from './topology/layouts/index.js'
import { G6_LAYOUTS, G6_DEFAULT_LAYOUT } from './g6/layouts.js'
import { WorkspaceLayout, WORKSPACE_RAIL_STORAGE_KEY } from './layout/workspaceLayout.js'
import { aggregateTopology, extractSubgraph } from './topology/transform.js'
import {
  loadInitialState,
  saveStoredState,
  writeUrlState,
  createStateSaver,
} from './sdk/state.js'
import { t, locale, setLocale, toggleLocale, typeLabelI18n } from './i18n.js'

/* G6 页面按需加载：切到 Three.js 时不下载 G6 代码，反之亦然 */
const G6View = defineAsyncComponent(() => import('./g6/G6View.vue'))

const THEME_KEY = 'topology-theme'
const RENDERER_KEY = 'topology-renderer'
const ONBOARD_KEY = 'topology-onboarded'
const DEPTH_25D_KEY = 'topology-combo-depth-25d'

function resolveInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveInitialRenderer() {
  return localStorage.getItem(RENDERER_KEY) === 'g6' ? 'g6' : 'three'
}

const initialState = loadInitialState({})
if (initialState.locale) setLocale(initialState.locale)

const validScene = (key) => SCENES.some((item) => item.key === key)
const validG6Layout = (key) => G6_LAYOUTS.some((item) => item.id === key)
const validThreeLayout = (key) => getLayouts().some((item) => item.id === key)

const threeLayouts = ref(getLayouts())
const topBarRef = ref(null)
const canvasHost = ref(null)
const g6Ref = ref(null)
const threeEngine = shallowRef(null)
const workspace = reactive(
  new WorkspaceLayout({
    collapsed: localStorage.getItem(WORKSPACE_RAIL_STORAGE_KEY) === '1',
  }),
)

const scene = ref(validScene(initialState.scene) ? initialState.scene : 'network')
const renderer = ref(
  initialState.engine === 'g6' || initialState.engine === 'three'
    ? initialState.engine
    : resolveInitialRenderer(),
)
const threeLayout = ref(
  validThreeLayout(initialState.threeLayout) ? initialState.threeLayout : 'force',
)
const g6Layout = ref(
  validG6Layout(initialState.g6Layout) ? initialState.g6Layout : G6_DEFAULT_LAYOUT,
)
const theme = ref(initialState.theme || resolveInitialTheme())
const aggregation = ref(
  ['group', 'type', 'status'].includes(initialState.aggregation)
    ? initialState.aggregation
    : 'none',
)
const showLabels = ref(initialState.showLabels !== false)
const minimap = ref(initialState.minimap !== false)
const watermark = ref(initialState.watermark === true)
// 分层 Combo 的 2.5D 透视开关：默认开启，用户手动关闭后记住选择
const depth25d = ref(localStorage.getItem(DEPTH_25D_KEY) !== '0')
const activeStatuses = ref(
  Array.isArray(initialState.activeStatuses) && initialState.activeStatuses.length
    ? initialState.activeStatuses
    : [...STATUS_ORDER],
)

const rootPayload = ref(null)
const drillStack = ref([])
const selection = ref(null)
const hover = ref(null)
const loading = ref(true)
const autoRotate = ref(false)
const status = reactive({ source: '', error: '', fps: 0, updatedAt: null })
const mouse = reactive({ x: 0, y: 0 })
const history = reactive({ canUndo: false, canRedo: false })
const guideOpen = ref(false)
const shortcutsOpen = ref(false)
const toast = reactive({ msg: '', tone: 'info' })

const analysis = reactive({
  type: null,
  direction: null,
  count: 0,
  pathStart: null,
  pathEnd: null,
  pathResult: null,
  impact: null,
})

document.documentElement.dataset.theme = theme.value

let controller = null
let unsubscribeLayouts = null
let toastTimer = null
let guideTimer = null

/* ------------------------------ 计算属性 ------------------------------ */

function fieldValue(node, field) {
  if (field === 'status') return node.status || 'unknown'
  if (field === 'type') return node.type || 'unknown'
  return node.group || '未分组'
}

/** 根数据 -> 下钻 -> 聚合，得到当前真正渲染的 payload */
const displayPayload = computed(() => {
  let payload = rootPayload.value
  if (!payload) return null

  for (const entry of drillStack.value) {
    if (entry.agg) {
      const { field, value } = entry.agg
      const nodes = (payload.nodes || []).filter(
        (node) => String(fieldValue(node, field)) === String(value),
      )
      const ids = new Set(nodes.map((node) => node.id))
      const links = (payload.links || []).filter(
        (link) => ids.has(link.source) && ids.has(link.target),
      )
      payload = {
        meta: {
          ...(payload.meta || {}),
          name: `${value} · ${t('detail.drill')}`,
          subtitle: `${nodes.length} ${t('panel.nodes')} / ${links.length} ${t('panel.links')}`,
        },
        nodes,
        links,
        summary: { ...(payload.summary || {}), nodes: nodes.length, links: links.length },
      }
      continue
    }

    const sub = extractSubgraph(payload, entry.id)
    if (!sub) break
    payload = sub
  }

  if (aggregation.value !== 'none') payload = aggregateTopology(payload, aggregation.value)
  return payload
})

const payload = displayPayload
const layouts = computed(() => (renderer.value === 'g6' ? G6_LAYOUTS : threeLayouts.value))
const layout = computed(() => (renderer.value === 'g6' ? g6Layout.value : threeLayout.value))
const sceneMeta = computed(() => getSceneMeta(scene.value))
const isDataCenter = computed(() => Array.isArray(displayPayload.value?.racks))
const g6LayoutActive = computed(() => (isDataCenter.value ? 'g6-grid' : g6Layout.value))
const hasData = computed(() => {
  const current = displayPayload.value
  if (!current) return false
  return Boolean(current.nodes?.length || current.racks?.length)
})
const breadcrumbItems = computed(() => [
  { id: null, name: rootPayload.value?.meta?.name || t('drill.root') },
  ...drillStack.value.map((entry) => ({ id: entry.id, name: entry.name })),
])
const analysisInfo = computed(() => ({
  type: analysis.type,
  direction: analysis.direction,
  count: analysis.count,
  pathStart: analysis.pathStart,
  pathEnd: analysis.pathEnd,
  pathResult: analysis.pathResult,
  impact: analysis.impact,
}))
const g6Plugins = computed(() => ({
  minimap: minimap.value,
  watermark: watermark.value,
  history: true,
  contextmenu: true,
  fullscreen: true,
  hull: true,
}))
// 只有分层 Combo 会消费 perspective；其它布局收到该参数也会忽略。
// 这里只依赖 depth25d，避免切换布局时额外触发一次整图重渲染。
const g6LayoutOptions = computed(() => ({ perspective: depth25d.value }))

const searchItems = computed(() => {
  if (!displayPayload.value) return []
  if (isDataCenter.value) {
    return displayPayload.value.racks.map((rack) => ({
      id: rack.id,
      name: rack.name,
      type: t('type.rack'),
      status: rack.status,
      subtitle: `${rack.row || ''} ${rack.id} ${rack.devices?.length || 0}`,
    }))
  }
  return displayPayload.value.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: typeLabelI18n(node.type) || typeLabel(node.type),
    status: node.status,
    subtitle: `${node.meta?.ip || ''} ${node.group || ''} ${node.meta?.location || ''}`,
  }))
})

const statusStats = computed(() => {
  if (!displayPayload.value) return []
  if (isDataCenter.value) {
    const racks = displayPayload.value.racks
    const devices = racks.flatMap((rack) => rack.devices || [])
    return [
      { label: t('panel.racks'), value: racks.length },
      { label: t('panel.devices'), value: devices.length },
      { label: t('panel.alerts'), value: racks.filter((rack) => rack.status !== 'ok').length },
    ]
  }
  const nodes = displayPayload.value.nodes || []
  return [
    { label: t('panel.nodes'), value: nodes.length },
    { label: t('panel.links'), value: (displayPayload.value.links || []).length },
    { label: t('panel.alerts'), value: nodes.filter((node) => node.status !== 'ok').length },
  ]
})

const hoverStatus = computed(() => statusMeta(hover.value?.data?.status))
const hoverStyle = computed(() => {
  const width = 280
  const height = 150
  const x = Math.max(12, Math.min(mouse.x + 18, window.innerWidth - width))
  const y = Math.max(12, Math.min(mouse.y + 18, window.innerHeight - height))
  return { left: `${x}px`, top: `${y}px` }
})

/* ------------------------------ 提示 / 状态保存 ------------------------------ */

function showToast(message, tone = 'info') {
  if (!message) return
  toast.msg = message
  toast.tone = tone
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.msg = ''
    toastTimer = null
  }, 2600)
}

function currentState() {
  return {
    engine: renderer.value,
    scene: scene.value,
    theme: theme.value,
    g6Layout: g6Layout.value,
    threeLayout: threeLayout.value,
    aggregation: aggregation.value,
    showLabels: showLabels.value,
    locale: locale.value,
    minimap: minimap.value,
    watermark: watermark.value,
    activeStatuses: activeStatuses.value,
  }
}

const stateSaver = createStateSaver((state) => {
  saveStoredState(state)
  try {
    writeUrlState(state)
  } catch {
    // 忽略 history / URL 异常
  }
}, 400)

watch(
  [scene, renderer, theme, g6Layout, threeLayout, aggregation, showLabels, minimap, watermark, activeStatuses, locale],
  () => stateSaver.push(currentState()),
)

/* ------------------------------ Three.js 引擎 ------------------------------ */

async function setupEngine() {
  const host = canvasHost.value
  if (!host || threeEngine.value) return
  host.addEventListener('pointermove', handlePointerMove, { passive: true })
  const { TopologyEngine } = await import('./topology/engine.js')
  if (!canvasHost.value) return
  threeEngine.value = new TopologyEngine(host, {
    onHover: (info) => {
      hover.value = info
    },
    onSelect: (info) => {
      selection.value = info
    },
    onStats: ({ fps }) => {
      status.fps = fps
    },
  })
  threeEngine.value.setTheme(theme.value)
}

function teardownEngine() {
  canvasHost.value?.removeEventListener?.('pointermove', handlePointerMove)
  if (threeEngine.value) {
    threeEngine.value.dispose()
    threeEngine.value = null
  }
  status.fps = 0
}

function applyThreeData() {
  if (!threeEngine.value || !displayPayload.value) return
  threeEngine.value.setData(displayPayload.value)
  threeEngine.value.setLayout(threeLayout.value, { instant: true })
  threeEngine.value.setStatusFilter(activeStatuses.value)
  threeEngine.value.setShowLabels(showLabels.value)
  threeEngine.value.setAutoRotate(autoRotate.value)
}

/* ------------------------------ 场景数据 ------------------------------ */

async function loadScene(key, { silent = false } = {}) {
  controller?.abort()
  const current = new AbortController()
  controller = current

  if (!silent) {
    loading.value = true
    selection.value = null
    hover.value = null
  }
  resetAnalysis()
  drillStack.value = []
  if (aggregation.value !== 'none' && renderer.value === 'g6' && isDataCenter.value) {
    aggregation.value = 'none'
  }

  try {
    const data = await fetchTopology(key, { signal: current.signal })
    if (current.signal.aborted) return

    rootPayload.value = normalizeTopology(data, key)
    status.source = data.source
    status.error = data.error || ''
    status.updatedAt = new Date()
    activeStatuses.value = [...STATUS_ORDER]

    await nextTick()
    if (current.signal.aborted) return

    if (renderer.value === 'three') {
      await new Promise((resolve) => setTimeout(resolve, 16))
      if (current.signal.aborted) return
      applyThreeData()
    } else {
      await waitForG6()
      g6Ref.value?.fitView?.()
    }
  } catch (error) {
    if (error?.name === 'AbortError') return
    status.error = error.message || String(error)
    console.error('[topology] 场景加载失败', error)
  } finally {
    if (!current.signal.aborted) {
      loading.value = false
    }
  }
}

function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 16))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForG6(timeout = 2500) {
  const started = Date.now()
  while (!g6Ref.value && Date.now() - started < timeout) await wait(60)
  return Boolean(g6Ref.value)
}

/* ------------------------------ 数据刷新策略 ------------------------------ */

// 只在加载场景 / 手动刷新时请求一次，不做定时轮询，也不自动建立实时连接。
// 如后续需要恢复实时能力，可在此处接入 SSE / WebSocket，而不是 setInterval 轮询。

async function refreshData() {
  if (loading.value) return
  controller?.abort()
  const current = new AbortController()
  controller = current

  try {
    const data = await fetchTopology(scene.value, { signal: current.signal })
    if (current.signal.aborted) return

    rootPayload.value = normalizeTopology(data, scene.value)
    status.source = data.source
    status.error = data.error || ''
    status.updatedAt = new Date()

    if (renderer.value === 'three') {
      applyThreeData()
    } else {
      await waitForG6()
      g6Ref.value?.fitView?.()
    }
    showToast(t('topbar.refresh'))
  } catch (error) {
    if (error?.name === 'AbortError') return
    status.error = error.message || String(error)
    console.error('[topology] 刷新数据失败', error)
  }
}

/* ------------------------------ 聚合 / 下钻 ------------------------------ */

function setAggregation(field) {
  const next = ['group', 'type', 'status'].includes(field) ? field : 'none'
  if (next === aggregation.value) return
  aggregation.value = next
  drillStack.value = []
  selection.value = null
  resetAnalysis()
  showToast(
    next === 'none'
      ? t('aggregate.none')
      : `${t('topbar.aggregate')} · ${next === 'group' ? t('aggregate.group') : next === 'type' ? t('aggregate.type') : t('aggregate.status')}`,
  )
  nextTick(() => g6Ref.value?.fitView?.())
}

function drillDown(id) {
  const current = displayPayload.value
  if (!current || !id) return false
  const list = current.nodes || current.racks || []
  const node = list.find((item) => String(item.id) === String(id))
  if (!node) return false

  if (node.meta?.aggregated) {
    // 展开聚合组：关闭聚合，只保留下钻过滤条件
    aggregation.value = 'none'
    drillStack.value = [
      ...drillStack.value,
      {
        id: String(id),
        name: node.label || node.name || String(id),
        agg: { field: node.meta.field, value: node.meta.value },
      },
    ]
  } else if (extractSubgraph(current, id)) {
    drillStack.value = [
      ...drillStack.value,
      { id: String(id), name: node.name || String(id) },
    ]
  } else {
    showToast(t('detail.noSubgraph'), 'warn')
    return false
  }

  selection.value = null
  resetAnalysis()
  showToast(t('detail.drill'), 'info')
  nextTick(() => g6Ref.value?.fitView?.())
  return true
}

function drillUp() {
  if (!drillStack.value.length) return
  drillStack.value = drillStack.value.slice(0, -1)
  selection.value = null
  resetAnalysis()
  nextTick(() => g6Ref.value?.fitView?.())
}

function navigateCrumb(index) {
  const next = Math.max(0, Math.min(index, drillStack.value.length))
  drillStack.value = drillStack.value.slice(0, next)
  selection.value = null
  resetAnalysis()
  nextTick(() => g6Ref.value?.fitView?.())
}

/* ------------------------------ 分析与高亮 ------------------------------ */

function resetAnalysis({ keepPath = false } = {}) {
  analysis.type = null
  analysis.direction = null
  analysis.count = 0
  analysis.impact = null
  analysis.pathResult = null
  if (!keepPath) {
    analysis.pathStart = null
    analysis.pathEnd = null
  }
  g6Ref.value?.clearHighlight?.()
  updateHistoryFlags()
}

async function ensureG6ForAnalysis() {
  if (renderer.value === 'g6' && g6Ref.value) return true
  if (renderer.value !== 'g6') {
    renderer.value = 'g6'
    showToast(t('analysis.switchG6'))
    await nextTick()
  }
  return waitForG6()
}

async function highlightNeighbors(payload) {
  const ok = await ensureG6ForAnalysis()
  if (!ok) return
  const result = g6Ref.value.highlightNeighbors(payload.id, {
    depth: payload.depth || 2,
    direction: payload.direction || 'both',
  })
  if (!result) return
  analysis.type = 'neighbors'
  analysis.direction = payload.direction || 'both'
  analysis.impact = null
  analysis.count = result.count
  showToast(t('analysis.highlight', { nodes: result.count, edges: result.edges.length }))
}

async function analyzeImpact(payload) {
  const ok = await ensureG6ForAnalysis()
  if (!ok) return
  const result = g6Ref.value.analyzeImpact(payload.id)
  if (!result) return
  analysis.type = 'impact'
  analysis.direction = 'out'
  analysis.impact = {
    count: result.count,
    byStatus: result.byStatus,
  }
  analysis.count = result.count
  const alerts = (result.byStatus?.warn || 0) + (result.byStatus?.error || 0)
  showToast(t('detail.impactSummary', { count: result.count, alerts }))
}

function setPathStart(id) {
  analysis.pathStart = id
  analysis.pathResult = null
}

function setPathEnd(id) {
  analysis.pathEnd = id
  analysis.pathResult = null
}

async function findPath() {
  if (!analysis.pathStart || !analysis.pathEnd) return
  const ok = await ensureG6ForAnalysis()
  if (!ok) return
  const result = g6Ref.value.findPath(analysis.pathStart, analysis.pathEnd)
  analysis.type = 'path'
  analysis.pathResult = result
  analysis.impact = null
  showToast(
    result.found
      ? t('detail.pathFound', { n: result.distance ?? result.nodes.length - 1 })
      : t('detail.pathMissing'),
    result.found ? 'info' : 'warn',
  )
}

function clearPath() {
  analysis.pathStart = null
  analysis.pathEnd = null
  analysis.pathResult = null
  g6Ref.value?.clearHighlight?.()
}

function clearHighlight() {
  resetAnalysis()
  showToast(t('analysis.clear'))
}

function handleSearch(query) {
  if (!query) {
    if (analysis.type === 'search') resetAnalysis()
    return
  }
  if (renderer.value !== 'g6') return
  const matches = g6Ref.value?.highlightSearch(query) || []
  if (!matches.length) return
  analysis.type = 'search'
  analysis.direction = null
  analysis.impact = null
  analysis.count = matches.length
}

/* ------------------------------ 视图与外观 ------------------------------ */

function setLayout(key) {
  if (renderer.value === 'g6') g6Layout.value = key
  else threeLayout.value = key
}

/** 收起 / 展开左侧「布局类型」菜单 */
function toggleLayoutRail() {
  const collapsed = workspace.toggle()
  localStorage.setItem(WORKSPACE_RAIL_STORAGE_KEY, collapsed ? '1' : '0')
}

function nextLayout() {
  const list = layouts.value
  if (!list.length) return
  const index = list.findIndex((item) => item.id === layout.value)
  setLayout(list[(index + 1) % list.length].id)
}

async function relayoutGraph() {
  if (renderer.value !== 'g6' || !g6Ref.value) return
  await g6Ref.value.relayout?.()
  showToast(t('topbar.relayoutDone'))
}

/** 切换分层 Combo 的 2.5D 透视（远层缩小 + 斜向错位 + 空气透视） */
function toggleDepth25d() {
  depth25d.value = !depth25d.value
  localStorage.setItem(DEPTH_25D_KEY, depth25d.value ? '1' : '0')
  showToast(depth25d.value ? t('rail.depth25dOn') : t('rail.depth25dOff'))
}

function applyTheme(mode) {
  const next = mode === 'light' ? 'light' : 'dark'
  theme.value = next
  document.documentElement.dataset.theme = next
  localStorage.setItem(THEME_KEY, next)
  threeEngine.value?.setTheme(next)
}

function toggleStatus(key) {
  const current = activeStatuses.value
  let next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  if (!next.length) next = [...STATUS_ORDER]
  activeStatuses.value = next
  threeEngine.value?.setStatusFilter(next)
}

function resetFilter() {
  activeStatuses.value = [...STATUS_ORDER]
  threeEngine.value?.setStatusFilter(activeStatuses.value)
}

function selectNode(id) {
  if (!id) return
  if (renderer.value === 'g6') g6Ref.value?.select(id)
  else threeEngine.value?.select(id, { fly: true })
}

function focusNode(id) {
  if (renderer.value === 'g6') g6Ref.value?.focus(id)
  else threeEngine.value?.focusNode(id)
}

function clearSelection() {
  if (renderer.value === 'g6') g6Ref.value?.clearSelection()
  else threeEngine.value?.select(null)
  selection.value = null
}

function fitView() {
  if (renderer.value === 'g6') g6Ref.value?.fitView()
  else threeEngine.value?.fitView(true)
}

function toggleRenderer() {
  renderer.value = renderer.value === 'g6' ? 'three' : 'g6'
}

function toggleLanguage() {
  toggleLocale()
}

/* ------------------------------ 导出 ------------------------------ */

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

async function takeScreenshot() {
  const dataUrl =
    renderer.value === 'g6'
      ? await g6Ref.value?.toDataURL?.()
      : threeEngine.value?.capture?.()
  if (!dataUrl) return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `topology-${scene.value}-${stamp()}.png`
  link.click()
}

function exportSVG() {
  const svg = g6Ref.value?.toSVG?.()
  if (!svg) {
    showToast(t('analysis.onlyG6'), 'warn')
    return
  }
  download(`topology-${scene.value}-${stamp()}.svg`, svg, 'image/svg+xml;charset=utf-8')
  showToast(t('topbar.exportSvg'))
}

function exportJSON() {
  const data =
    (renderer.value === 'g6' ? g6Ref.value?.toJSON?.() : null) ||
    (displayPayload.value ? JSON.parse(JSON.stringify(displayPayload.value)) : null)
  if (!data) return
  download(
    `topology-${scene.value}-${stamp()}.json`,
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8',
  )
  showToast(t('topbar.exportJson'))
}

/* ------------------------------ G6 事件 ------------------------------ */

function handleG6Hover(info) {
  if (info) {
    if (Number.isFinite(info.x)) mouse.x = info.x
    if (Number.isFinite(info.y)) mouse.y = info.y
  }
  hover.value = info
}

function handleG6Select(info) {
  selection.value = info
}

function updateHistoryFlags() {
  nextTick(() => {
    history.canUndo = g6Ref.value?.canUndo?.() || false
    history.canRedo = g6Ref.value?.canRedo?.() || false
  })
}

function undo() {
  if (g6Ref.value?.undo?.()) {
    updateHistoryFlags()
    showToast(t('topbar.undo'))
  }
}

function redo() {
  if (g6Ref.value?.redo?.()) {
    updateHistoryFlags()
    showToast(t('topbar.redo'))
  }
}

function handleHistory(payload) {
  if (payload) {
    if (payload.canUndo != null) history.canUndo = Boolean(payload.canUndo)
    if (payload.canRedo != null) history.canRedo = Boolean(payload.canRedo)
  }
  updateHistoryFlags()
}

function handleG6Event({ name, payload }) {
  if (name === 'node:contextmenu-action') {
    if (payload?.action === 'drill') drillDown(payload.id)
    else if (payload?.action === 'detail') selectNode(payload.id)
    return
  }
  if (name === 'history:change') {
    handleHistory(payload)
    return
  }
  if (name === 'render:complete') updateHistoryFlags()
}

function handleG6Ready() {
  updateHistoryFlags()
  nextTick(() => g6Ref.value?.fitView?.())
}

function toggleFullscreen() {
  g6Ref.value?.toggleFullscreen?.()
}

/* ------------------------------ 鼠标 / 键盘 ------------------------------ */

function handlePointerMove(event) {
  mouse.x = event.clientX
  mouse.y = event.clientY
}

function handleKeydown(event) {
  const tag = document.activeElement?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable

  if (event.key === 'Escape') {
    guideOpen.value = false
    shortcutsOpen.value = false
    clearSelection()
    if (typing) document.activeElement.blur()
    return
  }

  if (typing) return

  const mod = event.ctrlKey || event.metaKey
  if (mod && (event.key === 'z' || event.key === 'Z')) {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }

  if (event.key === '/') {
    event.preventDefault()
    topBarRef.value?.focusSearch?.()
    return
  }
  if (event.key === 'f' || event.key === 'F') {
    fitView()
    return
  }
  if (event.key === 'l' || event.key === 'L') {
    nextLayout()
    return
  }
  if (event.key === 'e' || event.key === 'E') {
    toggleRenderer()
    return
  }
  if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
    shortcutsOpen.value = true
  }
}

/* ------------------------------ 侦听 ------------------------------ */

watch(scene, (value) => {
  loadScene(value)
})

watch(renderer, async (value) => {
  localStorage.setItem(RENDERER_KEY, value)
  selection.value = null
  hover.value = null
  resetAnalysis()

  if (value === 'three') {
    await nextTick()
    await setupEngine()
    applyThreeData()
  } else {
    // 在 DOM 更新前销毁 Three.js 实例，避免 WebGL 空转与 G6 画布并存
    teardownEngine()
    await nextTick()
    await waitForG6()
    g6Ref.value?.setPluginFlags?.(g6Plugins.value)
    g6Ref.value?.fitView?.()
  }
  updateHistoryFlags()
})

watch(displayPayload, (value) => {
  if (!value) return
  if (renderer.value === 'three') threeEngine.value?.updateData(value)
  if (selection.value && !(value.nodes || value.racks || []).some((node) => node.id === selection.value.id)) {
    selection.value = null
  }
})

watch(autoRotate, (value) => threeEngine.value?.setAutoRotate(value))
watch(showLabels, (value) => {
  threeEngine.value?.setShowLabels(value)
})
watch(activeStatuses, (value) => {
  threeEngine.value?.setStatusFilter(value)
}, { deep: true })
watch(theme, (value) => {
  document.documentElement.dataset.theme = value
})

onMounted(async () => {
  unsubscribeLayouts = subscribeLayouts(() => {
    threeLayouts.value = getLayouts()
  })
  window.addEventListener('keydown', handleKeydown)
  if (renderer.value === 'three') await setupEngine()
  await loadScene(scene.value)

  if (!localStorage.getItem(ONBOARD_KEY)) {
    guideTimer = window.setTimeout(() => {
      guideOpen.value = true
    }, 900)
  }
})

onBeforeUnmount(() => {
  controller?.abort()
  unsubscribeLayouts?.()
  window.removeEventListener('keydown', handleKeydown)
  if (toastTimer) clearTimeout(toastTimer)
  if (guideTimer) clearTimeout(guideTimer)
  stateSaver.flush()
  teardownEngine()
})

function closeGuide() {
  guideOpen.value = false
  localStorage.setItem(ONBOARD_KEY, '1')
}
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
