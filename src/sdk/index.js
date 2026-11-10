export {
  TopologyView,
  loadGraph,
  updateGraph,
  destroyGraph,
  getGraphView,
  getGraph,
} from './topology-view.js'

export {
  TOPOLOGY_EVENTS,
  TOPOLOGY_EVENT_LIST,
  EVENT_ALIASES,
} from './events.js'

export {
  VIEW_STATE_KEY,
  VIEW_QUERY_KEYS,
  readUrlState,
  writeUrlState,
  loadInitialState,
  parseStoredState,
  saveStoredState,
  serializeState,
  deserializeState,
  createStateSaver,
} from './state.js'

export {
  aggregateTopology,
  extractSubgraph,
  diffTopology,
  hasSubgraph,
  aggregationLabel,
} from '../topology/transform.js'

export {
  createGraphIndex,
  collectNeighborhood,
  shortestPath,
  impactSummary,
  searchGraphNodes,
} from '../g6/analysis.js'

export {
  createRealtimeClient,
  realtimeUrl,
  REALTIME_ENABLED,
  REALTIME_PROTOCOL,
} from '../api/realtime.js'

export {
  G6_LAYOUTS,
  G6_DEFAULT_LAYOUT,
  getG6LayoutPreset,
  resolveG6LayoutOptions,
} from '../g6/layouts.js'

export {
  COMBO_LAYER_LAYOUT_ID,
  COMBO_LAYER_DEFAULTS,
  COMBO_LAYER_PRESET_OPTIONS,
  isComboLayerLayout,
  comboLayerScale,
} from '../g6/comboConfig.js'

export {
  rectFromCenter,
  rectFromTopLeft,
  rectsOverlap,
  findRectOverlaps,
  hasOverlap,
  separateRectRows,
  separateRects,
} from '../g6/collision.js'

export const TOPOLOGY_SDK_VERSION = '1.3.0'

export const TOPOLOGY_SDK_INFO = {
  version: TOPOLOGY_SDK_VERSION,
  engines: ['g6', 'three'],
  defaultEngine: 'g6',
  features: [
    'lazy-engine-loading',
    'g6-plugins',
    'combo-layers',
    'analysis',
    'aggregation',
    'drilldown',
    'realtime',
    'diff',
    'state-persistence',
    'svg-export',
    'i18n',
  ],
  layouts: {
    g6: [
      'g6-force',
      'g6-force-atlas2',
      'g6-dagre',
      'g6-circular',
      'g6-concentric',
      'g6-grid',
      'g6-radial',
      'g6-combo-layer',
    ],
    three: ['force', 'layered', 'sphere', 'grid'],
  },
  events: [
    'node:highlight-click',
    'node:hight-light-click',
    'node:highlight-dblclick',
    'node:contextmenu-action',
    'canvas:highlight-click',
    'selection:change',
    'hover:change',
    'layout:change',
    'theme:change',
    'style:change',
    'labels:change',
    'filter:change',
    'data:update',
    'render:complete',
    'view:fit',
    'view:destroy',
    'analysis:highlight',
    'analysis:clear',
    'analysis:path',
    'search:highlight',
    'drill:change',
    'aggregation:change',
    'history:change',
    'realtime:status',
    'state:change',
    'export:complete',
  ],
}
