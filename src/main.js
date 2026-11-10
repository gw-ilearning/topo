import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles.css'
import * as TopologySDK from './sdk/index.js'
import { locale, setLocale, toggleLocale, t } from './i18n.js'

createApp(App).mount('#app')

/**
 * 业务侧可直接通过 window.TopologySDK 调用渲染 API：
 *
 * ```js
 * const view = await TopologySDK.loadGraph(data, { container: '#topo', engine: 'g6', layout: 'g6-dagre' })
 * view.on(TopologySDK.TOPOLOGY_EVENTS.NODE_CLICK, (evt) => console.log(evt.data))
 * view.graph.on('selection:change', (evt) => console.log(evt))
 * ```
 */
if (typeof window !== 'undefined') {
  window.TopologySDK = {
    ...TopologySDK,
    i18n: { locale, setLocale, toggleLocale, t },
  }
}
