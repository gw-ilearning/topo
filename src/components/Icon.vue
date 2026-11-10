<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="svg"
  />
</template>

<script setup>
const props = defineProps({
  name: { type: String, default: 'dot' },
  size: { type: [Number, String], default: 18 },
})

const paths = {
  network:
    '<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><path d="M10.5 7.1 6.4 15.9M13.5 7.1l4.1 8.8M7.4 18h9.2"/>',
  datacenter:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M8 6h1M8 12h1M8 18h1"/>',
  graph:
    '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="6" cy="19" r="1.8"/><circle cx="18" cy="18" r="1.8"/><path d="M9.7 10.2 6.5 6.6M14.4 11.3l3-3.8M9.6 13.9l-2.3 3.4M14.3 13.9l2.4 2.8"/>',
  iot:
    '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10V4h6M20 14v6h-6M14 4h6v6M4 14v6h6M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  rotate:
    '<path d="M20 11a8 8 0 1 0-2.4 6.4"/><path d="M20 5v6h-6"/>',
  tag:
    '<path d="M20.5 12.3 12.3 20.5a1.6 1.6 0 0 1-2.3 0l-6.5-6.5V4.5h9.5l7.5 7.5a1.6 1.6 0 0 1 0 .3z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  pulse: '<path d="M3 12h4l2.2-6.2L13.4 18l2.2-6h5.4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  camera:
    '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  focus:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  alert: '<path d="M12 3 21 20H3z"/><path d="M12 9v5M12 17.2v.6"/>',
  cpu:
    '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  server:
    '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.6M8 16.5h.6"/>',
  layers:
    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  grid3d:
    '<path d="m4 8 8-4 8 4-8 4-8-4Z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
  force:
    '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/><circle cx="19.5" cy="18" r="1.5"/><path d="M12 9.4V5.5M9.9 13.5l-4.2 3M14.1 13.5l4.2 3"/>',
  link:
    '<path d="M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1"/><path d="M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1"/>',
  activity:
    '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  sun:
    '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  reset: '<path d="M4 4v6h6"/><path d="M5.6 17a8 8 0 1 0-1.3-8.4L4 10"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6v1"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 17v3h16v-3"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
  watermark: '<path d="M12 3c2.4 3 5.5 5.2 5.5 9a5.5 5.5 0 0 1-11 0c0-3.8 3.1-6 5.5-9Z"/><path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4A2.5 2.5 0 0 1 14.5 10c0 1.6-2.5 2-2.5 3.6M12 17.2v.4"/>',
  language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
}

const svg = paths[props.name] || paths.dot
</script>

<style scoped>
/* 组件专属样式；公共样式见 src/assets/styles.css */
</style>
