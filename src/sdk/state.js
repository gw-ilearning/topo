/**
 * 视图状态持久化：URL 深链接 + localStorage 记忆。
 *
 * 支持分享的场景：
 *   /?engine=g6&scene=network&theme=dark&g6=g6-dagre&agg=group&filter=ok,warn
 */

export const VIEW_STATE_KEY = 'topology-view-state'
export const VIEW_QUERY_KEYS = [
  'engine',
  'scene',
  'theme',
  'g6',
  'three',
  'agg',
  'labels',
  'live',
  'lang',
  'mini',
  'wm',
  'filter',
]

const BOOLEAN_TRUE = new Set(['1', 'true', 'on', 'yes'])
const BOOLEAN_FALSE = new Set(['0', 'false', 'off', 'no'])

export function parseStoredState() {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function serializeState(state = {}) {
  const out = {}
  if (state.engine) out.engine = state.engine
  if (state.scene) out.scene = state.scene
  if (state.theme) out.theme = state.theme
  if (state.g6Layout) out.g6 = state.g6Layout
  if (state.threeLayout) out.three = state.threeLayout
  if (state.aggregation && state.aggregation !== 'none') out.agg = state.aggregation
  if (state.showLabels != null) out.labels = state.showLabels ? '1' : '0'
  if (state.live != null) out.live = state.live ? '1' : '0'
  if (state.locale) out.lang = state.locale
  if (state.minimap != null) out.mini = state.minimap ? '1' : '0'
  if (state.watermark != null) out.wm = state.watermark ? '1' : '0'
  if (Array.isArray(state.activeStatuses)) out.filter = state.activeStatuses.join(',')
  return out
}

function parseBoolean(value, fallback) {
  const text = String(value).toLowerCase()
  if (BOOLEAN_TRUE.has(text)) return true
  if (BOOLEAN_FALSE.has(text)) return false
  return fallback
}

export function deserializeState(raw = {}) {
  const state = {}
  if (raw.engine === 'g6' || raw.engine === 'three') state.engine = raw.engine
  if (raw.scene) state.scene = String(raw.scene)
  if (raw.theme === 'dark' || raw.theme === 'light') state.theme = raw.theme
  if (raw.g6) state.g6Layout = String(raw.g6)
  if (raw.three) state.threeLayout = String(raw.three)
  if (raw.agg) state.aggregation = String(raw.agg)
  if (raw.labels != null) state.showLabels = parseBoolean(raw.labels, true)
  if (raw.live != null) state.live = parseBoolean(raw.live, true)
  if (raw.lang) state.locale = raw.lang === 'en' ? 'en' : 'zh'
  if (raw.mini != null) state.minimap = parseBoolean(raw.mini, true)
  if (raw.wm != null) state.watermark = parseBoolean(raw.wm, false)
  if (raw.filter) {
    const list = String(raw.filter)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (list.length) state.activeStatuses = list
  }
  return state
}

export function readUrlState() {
  if (typeof location === 'undefined') return {}
  const params = new URLSearchParams(location.search)
  const raw = {}
  for (const key of VIEW_QUERY_KEYS) {
    if (params.has(key)) raw[key] = params.get(key)
  }
  return deserializeState(raw)
}

export function writeUrlState(state, { replace = true } = {}) {
  if (typeof location === 'undefined') return
  const url = new URL(location.href)
  const serialized = serializeState(state)
  for (const key of VIEW_QUERY_KEYS) url.searchParams.delete(key)
  for (const [key, value] of Object.entries(serialized)) url.searchParams.set(key, value)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (replace) history.replaceState(history.state, '', next)
  else history.pushState(history.state, '', next)
}

export function loadInitialState(fallback = {}) {
  return { ...fallback, ...parseStoredState(), ...readUrlState() }
}

export function saveStoredState(state) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(serializeState(state)))
  } catch {
    // 忽略隐私模式 / 配额异常
  }
}

/** 简单的节流保存，避免拖拽、缩放时频繁写 localStorage */
export function createStateSaver(save, delay = 300) {
  let timer = null
  let latest = null
  const flush = () => {
    timer = null
    if (latest) {
      save(latest)
      latest = null
    }
  }
  return {
    push(state) {
      latest = state
      if (timer) return
      timer = setTimeout(flush, delay)
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      latest = null
    },
  }
}
