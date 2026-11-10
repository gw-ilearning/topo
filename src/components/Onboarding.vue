<template>
  <transition name="fade">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <section class="onboarding" role="dialog" aria-modal="true">
        <button type="button" class="icon-btn onboarding-close" :title="t('onboarding.skip')" @click="emit('close')">
          <Icon name="close" :size="14" />
        </button>

        <div class="onboarding-badge">
          <Icon name="globe" :size="14" />
          {{ t('onboarding.subtitle') }}
        </div>
        <h2>{{ t('onboarding.title') }}</h2>

        <div class="onboarding-step">
          <div class="onboarding-icon">
            <Icon :name="current.icon" :size="26" />
          </div>
          <div>
            <h3>{{ current.title }}</h3>
            <p>{{ current.desc }}</p>
          </div>
        </div>

        <div class="onboarding-dots">
          <span
            v-for="(item, index) in steps"
            :key="item.title"
            class="dot-btn"
            :class="{ active: index === step }"
            @click="step = index"
          />
        </div>

        <div class="onboarding-actions">
          <button type="button" class="btn ghost" @click="emit('close')">
            {{ t('onboarding.skip') }}
          </button>
          <div class="spacer" />
          <button v-if="step > 0" type="button" class="btn ghost" @click="prev">
            {{ t('onboarding.prev') }}
          </button>
          <button type="button" class="btn" @click="next">
            {{ isLast ? t('onboarding.done') : t('onboarding.next') }}
          </button>
        </div>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { t } from '../i18n.js'

const props = defineProps({
  open: Boolean,
  initialStep: { type: Number, default: 0 },
})

const emit = defineEmits(['close'])

const step = ref(0)

const steps = computed(() => [
  {
    icon: 'fit',
    title: t('onboarding.step1Title'),
    desc: t('onboarding.step1Desc'),
  },
  {
    icon: 'focus',
    title: t('onboarding.step2Title'),
    desc: t('onboarding.step2Desc'),
  },
  {
    icon: 'graph',
    title: t('onboarding.step3Title'),
    desc: t('onboarding.step3Desc'),
  },
])

watch(
  () => props.open,
  (value) => {
    if (value) step.value = Math.max(0, Math.min(steps.value.length - 1, props.initialStep || 0))
  },
)

const current = computed(() => steps.value[step.value] || steps.value[0])
const isLast = computed(() => step.value >= steps.value.length - 1)

function next() {
  if (isLast.value) emit('close')
  else step.value += 1
}

function prev() {
  step.value = Math.max(0, step.value - 1)
}
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
