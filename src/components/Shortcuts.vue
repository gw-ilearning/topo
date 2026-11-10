<template>
  <transition name="fade">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <section class="shortcuts-modal" role="dialog" aria-modal="true">
        <div class="panel-head">
          <span class="eyebrow">SHORTCUTS</span>
          <button type="button" class="icon-btn" :title="t('detail.close')" @click="emit('close')">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <h2>{{ t('app.shortcuts') }}</h2>
        <ul class="shortcut-list">
          <li v-for="row in rows" :key="row.label">
            <span>{{ row.label }}</span>
            <span class="keys">
              <kbd v-for="key in row.keys" :key="key">{{ key }}</kbd>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { t } from '../i18n.js'

defineProps({
  open: Boolean,
})

const emit = defineEmits(['close'])

const rows = computed(() => [
  { keys: ['/'], label: t('app.shortcutSearch') },
  { keys: ['F'], label: t('app.shortcutFit') },
  { keys: ['L'], label: t('app.shortcutLayout') },
  { keys: ['E'], label: t('app.shortcutEngine') },
  { keys: ['Esc'], label: t('app.shortcutEsc') },
])
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
