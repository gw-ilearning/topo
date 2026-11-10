<template>
  <footer class="status-bar">
    <div class="status-group">
      <span class="source-chip" :class="[source, { error }]">
        <span class="pulse-dot" />
        {{ sourceText }}
      </span>
      <span class="status-scene">{{ sceneName }}</span>
      <span v-if="error" class="status-error" :title="error">
        <Icon name="alert" :size="12" />
        {{ t('app.error') }}
      </span>
    </div>

    <div class="status-group status-center">
      <span v-for="item in stats" :key="item.label" class="status-stat">
        <em>{{ item.label }}</em>
        <strong>{{ item.value }}</strong>
      </span>
    </div>

    <div class="status-group status-right">
      <span class="status-fps">
        {{ renderer === 'g6' ? t('statusbar.g6') : t('statusbar.fps', { fps }) }}
      </span>
      <span class="status-time">{{ t('statusbar.updated', { time: timeText }) }}</span>
    </div>
  </footer>
</template>

<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { t } from '../i18n.js'

const props = defineProps({
  source: { type: String, default: '' },
  error: { type: String, default: '' },
  renderer: { type: String, default: 'three' },
  fps: { type: Number, default: 0 },
  updatedAt: { type: [Date, Number, String, null], default: null },
  stats: { type: Array, default: () => [] },
  sceneName: { type: String, default: '' },
})

const timeText = computed(() => {
  if (!props.updatedAt) return '—'
  const date = new Date(props.updatedAt)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
})

const sourceText = computed(() => (props.source === 'api' ? t('statusbar.rest') : t('statusbar.mock')))
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
