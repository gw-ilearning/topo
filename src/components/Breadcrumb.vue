<template>
  <div v-if="levels.length || aggText" class="breadcrumb">
    <button
      v-if="canGoUp"
      type="button"
      class="crumb-back"
      :title="t('drill.back')"
      @click="emit('up')"
    >
      <Icon name="reset" :size="13" />
      <span>{{ t('drill.back') }}</span>
    </button>

    <div class="crumb-trail">
      <template v-for="(item, index) in levels" :key="`${item.id || 'root'}-${index}`">
        <span v-if="index > 0" class="crumb-sep">/</span>
        <button
          type="button"
          class="crumb"
          :class="{ current: index === levels.length - 1 }"
          :disabled="index === levels.length - 1 || loading"
          @click="emit('navigate', index)"
        >
          {{ item.name }}
        </button>
      </template>
    </div>

    <span v-if="aggText" class="crumb-agg">
      <Icon name="layers" :size="12" />
      {{ aggText }}
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { t } from '../i18n.js'
import { aggregationLabel } from '../topology/transform.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  aggregation: { type: String, default: 'none' },
  loading: Boolean,
})

const emit = defineEmits(['navigate', 'up'])

const levels = computed(() => props.items || [])
const canGoUp = computed(() => levels.value.length > 1)
const aggText = computed(() =>
  props.aggregation === 'none' ? '' : `${t('topbar.aggregate')} · ${aggregationLabel(props.aggregation)}`,
)
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
