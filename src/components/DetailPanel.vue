<template>
  <aside v-if="data" class="panel detail-panel">
    <template v-if="data">
      <div class="panel-head">
        <span class="eyebrow">{{ isRack ? t('detail.rackTitle') : t('detail.nodeTitle') }}</span>
        <button type="button" class="icon-btn" :title="t('detail.close')" @click="emit('close')">
          <Icon name="close" :size="14" />
        </button>
      </div>

      <div class="detail-title">
        <span class="status-orb" :style="{ background: status.color, boxShadow: `0 0 18px ${status.color}` }" />
        <div class="title-text">
          <h2>{{ data.name }}</h2>
          <span class="sub">{{ typeText }} · {{ data.id }}</span>
        </div>
        <span class="badge" :style="badgeStyle">{{ statusText(data.status) }}</span>
      </div>

      <p class="detail-desc">
        {{ data.description || t('detail.noDescription') }}
      </p>

      <div class="detail-actions">
        <button type="button" class="btn" @click="emit('focus', data.id)">
          <Icon name="focus" :size="14" />
          {{ t('detail.focus') }}
        </button>
        <button v-if="canDrill" type="button" class="btn" @click="emit('drill-down', data.id)">
          <Icon name="layers" :size="14" />
          {{ t('detail.drill') }}
        </button>
        <button type="button" class="btn ghost" @click="emit('close')">{{ t('detail.clearSelection') }}</button>
      </div>

      <div class="kv-grid">
        <div v-for="field in fields" :key="field.label" class="kv">
          <span>{{ field.label }}</span>
          <strong>{{ field.value }}</strong>
        </div>
      </div>

      <div v-if="!isRack" class="section-title">
        <span>{{ t('detail.analysis') }}</span>
        <span class="count-chip">{{ degree.total }}</span>
      </div>

      <div v-if="!isRack" class="analysis-block">
        <div class="analysis-actions">
          <button
            type="button"
            class="analysis-btn"
            :class="{ active: analysisInfo.type === 'neighbors' && analysisInfo.direction === 'in' }"
            @click="emit('highlight-neighbors', { id: data.id, direction: 'in', depth: 2 })"
          >
            <Icon name="undo" :size="13" />
            {{ t('detail.upstream') }} · {{ degree.upstream }}
          </button>
          <button
            type="button"
            class="analysis-btn"
            :class="{ active: analysisInfo.type === 'neighbors' && analysisInfo.direction === 'out' }"
            @click="emit('highlight-neighbors', { id: data.id, direction: 'out', depth: 2 })"
          >
            <Icon name="redo" :size="13" />
            {{ t('detail.downstream') }} · {{ degree.downstream }}
          </button>
          <button
            type="button"
            class="analysis-btn"
            :class="{ active: analysisInfo.type === 'impact' }"
            @click="emit('analyze-impact', { id: data.id })"
          >
            <Icon name="activity" :size="13" />
            {{ t('detail.impact') }}
          </button>
          <button type="button" class="analysis-btn ghost" @click="emit('clear-highlight')">
            <Icon name="close" :size="13" />
            {{ t('detail.clearHighlight') }}
          </button>
        </div>

        <div v-if="impactText" class="analysis-result">{{ impactText }}</div>

        <div class="path-block">
          <div class="path-row">
            <button
              type="button"
              class="path-btn"
              :class="{ active: pathStart === data.id }"
              @click="emit('set-path-start', data.id)"
            >
              <Icon name="focus" :size="12" />
              {{ t('detail.pathStart') }}
            </button>
            <button
              type="button"
              class="path-btn"
              :class="{ active: pathEnd === data.id }"
              @click="emit('set-path-end', data.id)"
            >
              <Icon name="fit" :size="12" />
              {{ t('detail.pathEnd') }}
            </button>
            <button
              type="button"
              class="path-btn primary"
              :disabled="!canFindPath"
              @click="emit('find-path')"
            >
              <Icon name="link" :size="12" />
              {{ t('detail.findPath') }}
            </button>
            <button
              v-if="pathStart || pathEnd"
              type="button"
              class="path-btn ghost"
              :title="t('detail.clearHighlight')"
              @click="emit('clear-path')"
            >
              <Icon name="close" :size="12" />
            </button>
          </div>
          <div v-if="pathStart || pathEnd" class="path-hint">
            <span v-if="pathStart">{{ t('detail.pathFrom', { name: pathStart }) }}</span>
            <span v-if="pathEnd">{{ t('detail.pathTo', { name: pathEnd }) }}</span>
          </div>
          <div v-if="pathText" class="analysis-result" :class="{ warn: pathResult && !pathResult.found }">
            {{ pathText }}
          </div>
        </div>
      </div>

      <template v-if="!isRack">
        <div class="section-title">
          <span>{{ t('detail.metrics') }}</span>
          <Icon name="cpu" :size="13" />
        </div>
        <div class="metric-list">
          <div v-for="row in metricRows" :key="row.key" class="metric-row">
            <div class="metric-head">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
            <div class="metric-track">
              <i :style="{ width: `${row.percent}%` }" />
            </div>
          </div>
          <div v-if="extraMetrics.length" class="extra-metrics">
            <span v-for="item in extraMetrics" :key="item.label">
              {{ item.label }} <strong>{{ item.value }}</strong>
            </span>
          </div>
        </div>

        <div v-if="data.tags?.length" class="tag-row">
          <span v-for="tag in data.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </template>

      <template v-else>
        <div class="section-title">
          <span>{{ t('detail.rackLoad') }}</span>
          <Icon name="server" :size="13" />
        </div>
        <div class="rack-metrics">
          <div class="rack-metric">
            <span>{{ t('detail.temperature') }}</span>
            <strong>{{ Number(data.temperature).toFixed(1) }}<em>°C</em></strong>
            <div class="metric-track">
              <i :style="{ width: `${clamp((data.temperature / 40) * 100)}%` }" />
            </div>
          </div>
          <div class="rack-metric">
            <span>{{ t('detail.power') }}</span>
            <strong>{{ Number(data.power).toFixed(1) }}<em>kW</em></strong>
            <div class="metric-track">
              <i :style="{ width: `${clamp((data.power / 10) * 100)}%` }" />
            </div>
          </div>
        </div>

        <div class="section-title">
          <span>{{ t('detail.deviceList') }}</span>
          <span class="count-chip">{{ devices.length }}</span>
        </div>
        <ul class="device-list">
          <li v-for="device in devices" :key="device.id">
            <span class="dot" :style="{ background: statusMeta(device.status).color }" />
            <div class="device-main">
              <strong>{{ device.name }}</strong>
              <span>{{ typeLabelI18n(device.type) }} · {{ device.model || '—' }}</span>
            </div>
            <span class="device-u">U{{ device.u }}</span>
          </li>
        </ul>
      </template>

      <template v-if="neighbors.length">
        <div class="section-title">
          <span>{{ t('detail.neighbors') }}</span>
          <span class="count-chip">{{ neighbors.length }}</span>
        </div>
        <ul class="neighbor-list">
          <li v-for="node in neighbors" :key="node.id" @click="emit('select-node', node.id)">
            <span class="dot" :style="{ background: statusMeta(node.status).color }" />
            <span class="neighbor-name">{{ node.name }}</span>
            <span class="neighbor-type">{{ typeLabelI18n(node.type) }}</span>
            <Icon name="link" :size="12" />
          </li>
        </ul>
      </template>
    </template>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { statusMeta, typeLabel } from '../topology/palette.js'
import { t, typeLabelI18n, statusLabel } from '../i18n.js'

const props = defineProps({
  selection: { type: Object, default: null },
  payload: { type: Object, default: null },
  analysis: { type: Object, default: null },
})

const emit = defineEmits([
  'close',
  'focus',
  'select-node',
  'highlight-neighbors',
  'analyze-impact',
  'set-path-start',
  'set-path-end',
  'find-path',
  'clear-highlight',
  'clear-path',
  'drill-down',
])

const isRack = computed(() => props.selection?.kind === 'rack')
const data = computed(() => props.selection?.data || null)
const status = computed(() => statusMeta(data.value?.status))

const badgeStyle = computed(() => ({
  color: status.value.color,
  borderColor: `${status.value.color}55`,
  background: `${status.value.color}14`,
}))

const typeText = computed(() => {
  if (!data.value) return ''
  return isRack.value ? t('type.rack') : typeLabelI18n(data.value.type) || typeLabel(data.value.type)
})

const fields = computed(() => {
  if (!data.value) return []
  if (isRack.value) {
    const rack = data.value
    return [
      { label: t('detail.zone'), value: rack.row || '—' },
      { label: t('detail.rackId'), value: rack.id },
      { label: t('detail.uUsage'), value: `${rack.usedU || 0} / ${rack.capacity || 42} U` },
      { label: t('detail.devices'), value: `${rack.devices?.length || 0}` },
    ]
  }
  const node = data.value
  const meta = node.meta || {}
  return [
    { label: 'ID', value: node.id },
    { label: t('detail.group'), value: node.group || '—' },
    { label: t('detail.layer'), value: `L${node.layer ?? 0}` },
    { label: t('detail.ip'), value: meta.ip || '—' },
    { label: t('detail.location'), value: meta.location || '—' },
    { label: t('detail.model'), value: meta.model || '—' },
    { label: t('detail.os'), value: meta.os || meta.firmware || '—' },
  ].filter((field) => field.value !== '—')
})

const metricRows = computed(() => {
  if (!data.value || isRack.value) return []
  const metrics = data.value.metrics || {}
  const rows = []
  if (metrics.cpu != null) {
    rows.push({ key: 'cpu', label: t('detail.cpu'), value: `${metrics.cpu}%`, percent: clamp(metrics.cpu) })
  }
  if (metrics.memory != null) {
    rows.push({ key: 'memory', label: t('detail.memory'), value: `${metrics.memory}%`, percent: clamp(metrics.memory) })
  }
  if (metrics.traffic != null) {
    rows.push({
      key: 'traffic',
      label: t('detail.traffic'),
      value: `${formatNumber(metrics.traffic)} Mbps`,
      percent: clamp((metrics.traffic / 1000) * 100),
    })
  }
  return rows
})

const extraMetrics = computed(() => {
  if (!data.value || isRack.value) return []
  const metrics = data.value.metrics || {}
  const rows = []
  if (metrics.latency != null) rows.push({ label: t('detail.latency'), value: `${metrics.latency} ms` })
  if (metrics.uptime != null) rows.push({ label: t('detail.uptime'), value: `${metrics.uptime} d` })
  return rows
})

const degree = computed(() => {
  if (!data.value || isRack.value || !props.payload) return { upstream: 0, downstream: 0, total: 0 }
  const id = data.value.id
  const links = props.payload.links || []
  let upstream = 0
  let downstream = 0
  for (const link of links) {
    if (link.source === id) downstream += 1
    else if (link.target === id) upstream += 1
  }
  return { upstream, downstream, total: upstream + downstream }
})

const neighbors = computed(() => {
  if (!data.value || isRack.value || !props.payload) return []
  const id = data.value.id
  const links = props.payload.links || []
  const nodes = props.payload.nodes || []
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const related = []
  for (const link of links) {
    const otherId = link.source === id ? link.target : link.target === id ? link.source : null
    if (!otherId) continue
    const other = nodeMap.get(otherId)
    if (other) related.push({ ...other, linkStatus: link.status })
  }
  return related
    .sort((a, b) => (a.status === 'ok' ? 1 : 0) - (b.status === 'ok' ? 1 : 0))
    .slice(0, 12)
})

const devices = computed(() => {
  if (!isRack.value || !data.value?.devices) return []
  return [...data.value.devices].sort((a, b) => b.u - a.u)
})

const canDrill = computed(() => {
  if (!data.value) return false
  return Boolean(
    data.value.subgraph?.nodes?.length ||
      data.value.children?.length ||
      data.value.kind === 'group',
  )
})

const analysisInfo = computed(() => props.analysis || {})
const pathStart = computed(() => analysisInfo.value.pathStart || null)
const pathEnd = computed(() => analysisInfo.value.pathEnd || null)
const pathResult = computed(() => analysisInfo.value.pathResult || null)
const canFindPath = computed(
  () => Boolean(pathStart.value && pathEnd.value && pathStart.value !== pathEnd.value),
)
const pathText = computed(() => {
  if (!pathResult.value) return ''
  if (pathResult.value.found) {
    return t('detail.pathFound', { n: pathResult.value.distance ?? pathResult.value.nodes.length - 1 })
  }
  return t('detail.pathMissing')
})

const impactText = computed(() => {
  const impact = analysisInfo.value.impact
  if (!impact) return ''
  const alerts = (impact.byStatus?.warn || 0) + (impact.byStatus?.error || 0)
  return t('detail.impactSummary', { count: impact.count, alerts })
})

function clamp(value) {
  return Math.max(4, Math.min(100, Number(value) || 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(Number(value) || 0))
}

function statusText(value) {
  return statusLabel(value)
}
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
