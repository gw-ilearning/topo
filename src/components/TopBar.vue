<template>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M16 2.8 27.2 9.4v13.2L16 29.2 4.8 22.6V9.4Z" opacity=".55" />
          <circle cx="16" cy="16" r="4.6" />
          <circle cx="16" cy="7" r="1.7" />
          <circle cx="24" cy="21" r="1.7" />
          <circle cx="8" cy="21" r="1.7" />
          <path d="M16 11.4V8.6M19.7 18.3l2.5 1.5M12.3 18.3l-2.5 1.5" opacity=".8" />
        </svg>
      </div>
      <div class="brand-text">
        <h1>TOPOLOGY <span>NEXUS</span></h1>
        <p>{{ renderer === 'g6' ? t('app.subtitleG6') : t('app.subtitle3d') }}</p>
      </div>
    </div>

    <div class="engine-switch" role="group" :aria-label="t('engine.group')">
      <button
        type="button"
        class="engine-btn"
        :class="{ active: renderer === 'three' }"
        :title="t('engine.3dTitle')"
        @click="emit('update:renderer', 'three')"
      >
        <Icon name="grid3d" :size="14" />
        <span>{{ t('engine.3d') }}</span>
      </button>
      <button
        type="button"
        class="engine-btn"
        :class="{ active: renderer === 'g6' }"
        :title="t('engine.g6Title')"
        @click="emit('update:renderer', 'g6')"
      >
        <Icon name="graph" :size="14" />
        <span>{{ t('engine.g6') }}</span>
      </button>
    </div>

    <nav class="scene-tabs" :aria-label="t('scene.switch')">
      <button
        v-for="item in scenes"
        :key="item.key"
        type="button"
        class="scene-tab"
        :class="{ active: item.key === scene }"
        @click="emit('update:scene', item.key)"
      >
        <Icon :name="item.icon" :size="16" />
        <span>{{ t(`scene.${item.key}`) }}</span>
      </button>
    </nav>

    <div class="search-wrap" :class="{ focused }">
      <Icon name="search" :size="16" class="search-icon" />
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        class="search-input"
        :placeholder="t('topbar.search')"
        spellcheck="false"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter.prevent="pickFirst"
        @keydown.esc="clearSearch"
      />
      <kbd v-if="!query">/</kbd>
      <button v-else type="button" class="search-clear" @click="clearSearch">
        <Icon name="close" :size="13" />
      </button>

      <div v-if="query" class="search-results">
        <button
          v-for="item in results"
          :key="item.id"
          type="button"
          class="search-result"
          @mousedown.prevent="pick(item.id)"
        >
          <span class="dot" :style="{ background: statusColor(item.status) }" />
          <span class="name">{{ item.name }}</span>
          <span class="meta">{{ item.type }}</span>
        </button>
        <div v-if="!results.length" class="search-empty">{{ t('topbar.searchEmpty') }}</div>
      </div>
    </div>

    <div class="top-actions">
      <button
        v-if="renderer === 'three'"
        type="button"
        class="tool-btn"
        :class="{ active: autoRotate }"
        :title="t('topbar.autoRotate')"
        @click="emit('update:autoRotate', !autoRotate)"
      >
        <Icon name="rotate" :size="17" />
      </button>

      <template v-if="renderer === 'g6'">
        <button
          type="button"
          class="tool-btn"
          title="Undo (Ctrl+Z)"
          :disabled="!canUndo"
          @click="emit('undo')"
        >
          <Icon name="undo" :size="17" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="Redo (Ctrl+Shift+Z)"
          :disabled="!canRedo"
          @click="emit('redo')"
        >
          <Icon name="redo" :size="17" />
        </button>

        <div class="menu-wrap">
          <button
            type="button"
            class="tool-btn"
            :class="{ active: aggregation !== 'none' }"
            :title="t('topbar.aggregate')"
            @click="toggleMenu('aggregate')"
          >
            <Icon name="layers" :size="17" />
            <span v-if="aggregation !== 'none'" class="tool-badge">
              {{ aggregationLabel(aggregation) }}
            </span>
          </button>
          <div v-if="aggOpen" class="menu-backdrop" @click="openMenu = ''" />
          <div v-if="aggOpen" class="dropdown-menu">
            <button
              v-for="option in aggregationOptions"
              :key="option.value"
              type="button"
              class="menu-item"
              :class="{ active: aggregation === option.value }"
              @click="setAggregation(option.value)"
            >
              <Icon :name="option.icon" :size="14" />
              <span>{{ option.label }}</span>
              <Icon v-if="aggregation === option.value" name="check" :size="13" class="menu-check" />
            </button>
          </div>
        </div>
      </template>

      <button
        type="button"
        class="tool-btn"
        :class="{ active: showLabels }"
        :title="t('topbar.labels')"
        @click="emit('update:showLabels', !showLabels)"
      >
        <Icon name="tag" :size="17" />
      </button>
      <button
        type="button"
        class="tool-btn"
        :title="t('topbar.refresh')"
        @click="emit('refresh')"
      >
        <Icon name="pulse" :size="17" />
      </button>
      <button
        type="button"
        class="tool-btn theme-toggle"
        :class="{ active: theme === 'light' }"
        :title="theme === 'light' ? t('topbar.themeDark') : t('topbar.themeLight')"
        @click="emit('update:theme', theme === 'light' ? 'dark' : 'light')"
      >
        <Icon :name="theme === 'light' ? 'sun' : 'moon'" :size="17" />
      </button>

      <span class="tool-sep" />
      <button type="button" class="tool-btn" :title="t('topbar.fit')" @click="emit('fit')">
        <Icon name="fit" :size="17" />
      </button>
      <button type="button" class="tool-btn" :title="t('topbar.screenshot')" @click="emit('screenshot')">
        <Icon name="camera" :size="17" />
      </button>

      <div class="menu-wrap">
        <button
          type="button"
          class="tool-btn"
          :class="{ active: moreOpen }"
          :title="t('topbar.more')"
          @click="toggleMenu('more')"
        >
          <Icon name="more" :size="17" />
        </button>
        <div v-if="moreOpen" class="menu-backdrop" @click="openMenu = ''" />
        <div v-if="moreOpen" class="dropdown-menu dropdown-right">
          <div class="menu-group-title">{{ t('menu.export') }}</div>
          <button v-if="renderer === 'g6'" type="button" class="menu-item" @click="run('export-svg')">
            <Icon name="code" :size="14" />
            <span>{{ t('topbar.exportSvg') }}</span>
          </button>
          <button type="button" class="menu-item" @click="run('export-json')">
            <Icon name="download" :size="14" />
            <span>{{ t('topbar.exportJson') }}</span>
          </button>

          <div v-if="renderer === 'g6'" class="menu-group-title">{{ t('menu.display') }}</div>
          <button
            v-if="renderer === 'g6'"
            type="button"
            class="menu-item"
            :class="{ active: minimap }"
            @click="run('toggle-minimap')"
          >
            <Icon name="map" :size="14" />
            <span>{{ t('topbar.minimap') }}</span>
            <Icon v-if="minimap" name="check" :size="13" class="menu-check" />
          </button>
          <button
            v-if="renderer === 'g6'"
            type="button"
            class="menu-item"
            :class="{ active: watermark }"
            @click="run('toggle-watermark')"
          >
            <Icon name="watermark" :size="14" />
            <span>{{ t('topbar.watermark') }}</span>
            <Icon v-if="watermark" name="check" :size="13" class="menu-check" />
          </button>
          <button v-if="renderer === 'g6'" type="button" class="menu-item" @click="run('fullscreen')">
            <Icon name="fullscreen" :size="14" />
            <span>{{ t('topbar.fullscreen') }}</span>
          </button>

          <div class="menu-group-title">{{ t('menu.help') }}</div>
          <button type="button" class="menu-item" @click="run('show-guide')">
            <Icon name="help" :size="14" />
            <span>{{ t('detail.guide') }}</span>
          </button>
          <button type="button" class="menu-item" @click="run('show-shortcuts')">
            <Icon name="activity" :size="14" />
            <span>{{ t('topbar.shortcuts') }}</span>
          </button>
          <button type="button" class="menu-item" @click="run('toggle-language')">
            <Icon name="language" :size="14" />
            <span>{{ locale === 'zh' ? 'English' : '中文' }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="top-loading-bar" />
  </header>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { statusColor } from '../topology/palette.js'
import { t, locale } from '../i18n.js'
import { aggregationLabel } from '../topology/transform.js'

const props = defineProps({
  scenes: { type: Array, default: () => [] },
  scene: { type: String, default: 'network' },
  renderer: { type: String, default: 'three' },
  autoRotate: Boolean,
  showLabels: Boolean,
  loading: Boolean,
  theme: { type: String, default: 'dark' },
  searchItems: { type: Array, default: () => [] },
  aggregation: { type: String, default: 'none' },
  canUndo: Boolean,
  canRedo: Boolean,
  minimap: { type: Boolean, default: true },
  watermark: Boolean,
})

const emit = defineEmits([
  'update:scene',
  'update:renderer',
  'update:autoRotate',
  'update:showLabels',
  'update:theme',
  'refresh',
  'select-node',
  'search',
  'fit',
  'screenshot',
  'aggregate',
  'undo',
  'redo',
  'fullscreen',
  'export-svg',
  'export-json',
  'toggle-minimap',
  'toggle-watermark',
  'toggle-language',
  'show-shortcuts',
  'show-guide',
])

const query = ref('')
const focused = ref(false)
const searchInput = ref(null)
const openMenu = ref('')
const aggOpen = computed(() => openMenu.value === 'aggregate')
const moreOpen = computed(() => openMenu.value === 'more')

const aggregationOptions = computed(() => [
  { value: 'none', label: t('aggregate.none'), icon: 'close' },
  { value: 'group', label: t('aggregate.group'), icon: 'layers' },
  { value: 'type', label: t('aggregate.type'), icon: 'server' },
  { value: 'status', label: t('aggregate.status'), icon: 'activity' },
])

const results = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return []
  return props.searchItems
    .filter((item) => {
      const haystack = `${item.name} ${item.id} ${item.type} ${item.subtitle || ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
    .slice(0, 7)
})

watch(query, (value) => emit('search', value.trim()))

function pick(id) {
  emit('select-node', id)
  query.value = ''
  emit('search', '')
}

function pickFirst() {
  if (results.value.length) pick(results.value[0].id)
}

function clearSearch() {
  query.value = ''
  emit('search', '')
}

function focusSearch() {
  searchInput.value?.focus()
  searchInput.value?.select?.()
}

function toggleMenu(name) {
  openMenu.value = openMenu.value === name ? '' : name
}

function run(action) {
  openMenu.value = ''
  emit(action)
}

function setAggregation(value) {
  openMenu.value = ''
  emit('aggregate', value)
}

defineExpose({ focusSearch, clearSearch })
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
