<template>
  <div ref="host" class="g6-host" />
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { G6TopologyGraph } from './graph.js'

const props = defineProps({
  data: { type: Object, default: null },
  layout: { type: String, default: 'g6-force' },
  layoutOptions: { type: Object, default: null },
  theme: { type: String, default: 'dark' },
  activeStatuses: { type: Array, default: () => [] },
  showLabels: { type: Boolean, default: true },
  autoFit: { type: Boolean, default: true },
  animation: { type: Boolean, default: true },
  behaviors: { type: Array, default: null },
  styleConfig: { type: Object, default: null },
  plugins: { type: Object, default: null },
  watermarkText: { type: String, default: '' },
})

const emit = defineEmits([
  'hover',
  'select',
  'ready',
  'event',
  'context-action',
  'history',
])

const host = ref(null)
// 必须用 shallowRef：G6 实例内部持有 Graph / Canvas / 事件对象等大量循环引用，
// 一旦被 Vue 的 ref 深度代理，事件派发路径上的对象会变成 Proxy，
// @antv/g 的 isNode / composedPath 身份比较会失效，导致 pointermove 事件进入死循环。
const controller = shallowRef(null)
const graph = computed(() => controller.value?.graph || null)

let queue = Promise.resolve()
let alive = false

function enqueue(task) {
  queue = queue
    .then(task)
    .catch((error) => {
      console.error('[g6] 渲染任务失败', error)
    })
  return queue
}

onMounted(async () => {
  controller.value = markRaw(new G6TopologyGraph(host.value, {
    theme: props.theme,
    layout: props.layout,
    layoutOptions: props.layoutOptions || undefined,
    showLabels: props.showLabels,
    autoFit: props.autoFit,
    animation: props.animation,
    behaviors: props.behaviors || undefined,
    style: props.styleConfig || {},
    plugins: props.plugins || undefined,
    watermarkText: props.watermarkText || undefined,
    onHover: (info) => emit('hover', info),
    onSelect: (info) => emit('select', info),
    onEvent: (name, payload) => emit('event', { name, payload }),
    onContextAction: (payload) => emit('context-action', payload),
    onHistory: (payload) => emit('history', payload),
  }))

  alive = true
  await nextTick()
  if (props.data) await enqueue(() => controller.value?.setData(props.data))
  emit('ready', graph.value)
})

watch(
  () => props.data,
  (value) => {
    if (!alive || !value) return
    enqueue(() => controller.value?.setData(value))
  },
)

watch(
  () => props.layout,
  (value) => {
    if (!alive || !value) return
    enqueue(() => controller.value?.setLayout(value, props.layoutOptions || undefined))
  },
)

watch(
  () => props.layoutOptions,
  (value) => {
    if (!alive || !value) return
    enqueue(() => controller.value?.setLayoutOptions(value))
  },
  { deep: true },
)

watch(
  () => props.theme,
  (value) => {
    if (!alive) return
    enqueue(() => controller.value?.setTheme(value))
  },
)

watch(
  () => props.showLabels,
  (value) => {
    if (!alive) return
    enqueue(() => controller.value?.setShowLabels(value))
  },
)

watch(
  () => props.activeStatuses,
  (value) => {
    if (!alive) return
    enqueue(() => controller.value?.setStatusFilter(value))
  },
  { deep: true },
)

watch(
  () => props.styleConfig,
  (value) => {
    if (!alive || !value) return
    enqueue(() => controller.value?.setStyle(value))
  },
  { deep: true },
)

watch(
  () => props.plugins,
  (value) => {
    if (!alive || !value) return
    enqueue(() => controller.value?.setPluginFlags(value))
  },
  { deep: true },
)

onBeforeUnmount(() => {
  alive = false
  queue = Promise.resolve()
  controller.value?.destroy()
  controller.value = null
})

function fitView() {
  return controller.value?.fitView()
}

function select(id, options) {
  controller.value?.select(id, options)
}

function focus(id) {
  controller.value?.focus(id)
}

function clearSelection() {
  controller.value?.clearSelection()
}

function highlightNeighbors(id, options) {
  return controller.value?.highlightNeighbors(id, options) || null
}

function analyzeImpact(id, options) {
  return controller.value?.analyzeImpact(id, options) || null
}

function findPath(source, target, options) {
  return (
    controller.value?.findPath(source, target, options) || {
      found: false,
      nodes: [],
      edges: [],
      distance: Infinity,
    }
  )
}

function highlightSearch(query) {
  return controller.value?.highlightSearch(query) || []
}

function clearHighlight() {
  controller.value?.clearHighlight()
}

function getEmphasis() {
  return controller.value?.getEmphasis?.() || null
}

function relayout() {
  return controller.value?.relayout?.() || Promise.resolve()
}

function setLayoutOptions(options) {
  return controller.value?.setLayoutOptions?.(options) || Promise.resolve()
}

function checkOverlaps(options) {
  return (
    controller.value?.checkOverlaps?.(options) || {
      ok: true,
      nodes: [],
      groups: [],
      layers: [],
    }
  )
}

function zoomBy(ratio) {
  return controller.value?.zoomBy(ratio)
}

function zoomTo(value) {
  return controller.value?.zoomTo(value)
}

function resetZoom() {
  return controller.value?.resetZoom()
}

function toggleFullscreen() {
  return controller.value?.toggleFullscreen()
}

function setPluginFlags(flags) {
  controller.value?.setPluginFlags(flags)
}

function getPluginFlags() {
  return controller.value?.getPluginFlags?.() || {}
}

function undo() {
  return controller.value?.undo() || false
}

function redo() {
  return controller.value?.redo() || false
}

function canUndo() {
  return controller.value?.canUndo() || false
}

function canRedo() {
  return controller.value?.canRedo() || false
}

function toDataURL() {
  return controller.value?.toDataURL() || Promise.resolve('')
}

function toSVG() {
  return controller.value?.toSVG?.() || ''
}

function toJSON() {
  return controller.value?.toJSON?.() || null
}

function resize(width, height) {
  return controller.value?.resize(width, height)
}

function getGraph() {
  return controller.value?.graph || null
}

function on(event, handler) {
  controller.value?.graph?.on(event, handler)
}

function off(event, handler) {
  controller.value?.graph?.off(event, handler)
}

defineExpose({
  fitView,
  select,
  focus,
  clearSelection,
  highlightNeighbors,
  analyzeImpact,
  findPath,
  highlightSearch,
  clearHighlight,
  getEmphasis,
  relayout,
  setLayoutOptions,
  checkOverlaps,
  zoomBy,
  zoomTo,
  resetZoom,
  toggleFullscreen,
  setPluginFlags,
  getPluginFlags,
  undo,
  redo,
  canUndo,
  canRedo,
  toDataURL,
  toSVG,
  toJSON,
  resize,
  getGraph,
  on,
  off,
  controller,
  graph,
})
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
