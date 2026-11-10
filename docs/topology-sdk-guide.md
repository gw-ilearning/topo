# Topology SDK 用户指南

> 适用版本：`@antv/g6@5.1.1`、`@antv/layout@2.0.0`、Topology SDK `1.1.0`
>
> 本指南面向需要在业务页面中嵌入拓扑图的前端开发者，覆盖数据格式、配置项、布局参数、样式覆盖、事件订阅与性能建议。

---

## 1. 能力概览

平台内置两套**完全独立**的渲染引擎：

| 引擎 | 技术栈 | 渲染方式 | 适用场景 |
| --- | --- | --- | --- |
| `g6`（默认） | G6 5 原生 `Graph` + `@antv/layout` | Canvas 2D | 大规模关系图、网络拓扑、依赖图、机柜平面图 |
| `three` | Three.js + 后处理 + CSS2D | WebGL 3D | 3D 机房、沉浸式场景、需要空间层次感的拓扑 |

两套引擎的渲染、布局、交互代码互不引用：

- G6 页面代码集中在 `src/g6/`
- Three.js 页面代码集中在 `src/topology/`
- 两者只共享数据契约、REST API、Mock 数据与 UI 外壳组件
- 对外 SDK 位于 `src/sdk/`，默认使用 `g6` 引擎

主应用顶栏提供 **3D / G6** 切换按钮，切换时会销毁另一个引擎实例，避免 WebGL 空转或画布并存。选择会写入 `localStorage['topology-renderer']`。

---

## 2. 快速开始

### 2.1 在主应用内体验

```bash
cd D:\study\code\project3D
npm install
npm run dev
```

打开 `http://localhost:5173`：

1. 点击顶栏 `G6` 进入二维页面，点击 `3D` 回到三维页面。
2. 左侧「布局类型」菜单可切换 8 种 G6 布局，并支持收起 / 展开；「分层 Combo」下方的「2.5D 视图」可一键开关梯形透视。
3. 顶栏支持主题、标签、刷新数据、适配视图、导出截图；页面不会定时轮询接口。
4. 顶部搜索、详情面板与状态过滤在两套引擎下均可用。

### 2.2 在业务页面中调用

页面加载后，SDK 会挂载到 `window.TopologySDK`。最小调用：

```html
<div id="topo" style="width: 100%; height: 560px"></div>

<script type="module">
  const data = {
    meta: { scene: 'network', name: '业务拓扑' },
    nodes: [
      { id: 'core', name: '核心交换机', type: 'switch', status: 'ok' },
      { id: 'db', name: '数据库', type: 'database', status: 'warn' },
    ],
    links: [{ id: 'l1', source: 'core', target: 'db' }],
  }

  const view = await window.TopologySDK.loadGraph(data, {
    container: '#topo',
    engine: 'g6',
    layout: 'g6-dagre',
    theme: 'dark',
  })

  view.on('node:highlight-click', (event) => {
    console.log('点击节点', event.id, event.data)
  })
</script>
```

> **容器必须有明确高度**。SDK 只负责在容器内创建画布，不会自动给容器设置尺寸。推荐 `height: 100%`（父级有高度）或固定像素高度。

### 2.3 模块化引入

业务工程与该项目同仓时，可以直接导入：

```js
import { loadGraph, updateGraph, destroyGraph, getGraphView, getGraph } from '@/sdk'
```

也可只引入视图类自行管理：

```js
import { TopologyView } from '@/sdk'

const view = new TopologyView(document.querySelector('#topo'), {
  engine: 'g6',
  theme: 'light',
})
await view.loadGraph(data, { layout: 'g6-force' })
```

---

## 3. 核心 API

SDK 顶层导出：

| API | 签名 | 说明 |
| --- | --- | --- |
| `loadGraph` | `(data, config?) => Promise<TopologyView>` | 创建或复用视图并渲染拓扑；同一容器重复调用会复用实例 |
| `updateGraph` | `(data, config?) => Promise<TopologyView \| void>` | 增量更新数据；容器没有视图时会自动降级为 `loadGraph` |
| `destroyGraph` | `(container) => boolean` | 销毁指定容器上的视图，返回是否销毁成功 |
| `getGraphView` | `(container) => TopologyView \| null` | 获取容器上已存在的视图实例 |
| `getGraph` | `(container) => Graph \| null` | 获取 G6 原生 `Graph` 实例；Three.js 模式返回 `null` |
| `TopologyView` | `class` | 视图类，可手动 `new` |
| `TOPOLOGY_SDK_INFO` | `object` | 版本、引擎、布局、事件清单 |

### 3.1 `loadGraph(data, config)`

```js
const view = await loadGraph(data, {
  container: '#topo',
  engine: 'g6',
  layout: 'g6-concentric',
  theme: 'dark',
  style: {
    node: { fill: '#ffffff', lineWidth: 2 },
    edge: { stroke: '#8ab4cc' },
  },
})
```

行为说明：

1. 优先使用 `config.container`，其次是 `config.el`，再是 `[data-topology-view]`、`#topology-root`。
2. 容器的视图已存在且引擎一致时复用；引擎变化时销毁旧引擎并重建。
3. 数据会经过 `normalizeTopology()` 归一化，允许直接传后端原始响应。
4. 返回的 `view` 可用于后续事件订阅与运行时控制。

### 3.2 `updateGraph(data, config?)`

适合业务层按需刷新，或自行接入 WebSocket / SSE 后推送：

```js
// 用户点击「刷新数据」、路由重新进入、或收到推送消息时调用
const data = await fetch('/api/topology?scene=network').then((r) => r.json())
await updateGraph(data, { container: '#topo' })
```

内部按元素做差异比较：

- 节点 / 链路的 ID 集合变化或显式重排时，才触发完整渲染与布局。
- 仅指标（`metrics`）等非视觉字段变化时，只更新数据模型，不重绘画布。
- 状态、名称、类型、分组、颜色等视觉字段变化时，只更新变化的元素并重绘一次。

### 3.3 `destroyGraph(container)`

```js
destroyGraph('#topo')
```

组件卸载、路由切换时必须调用，否则 G6 实例、事件监听和 Canvas 会常驻内存。

### 3.4 `TopologyView` 实例方法

| 方法 | 说明 |
| --- | --- |
| `loadGraph(data, config?)` | 重新加载数据 / 配置 |
| `updateData(data, config?)` | 增量更新数据 |
| `setTheme(theme)` | `'dark'` / `'light'` / 自定义主题对象 |
| `setLayout(layout, layoutOptions?)` | 切换布局并可覆盖参数 |
| `setLayoutOptions(layoutOptions)` | 只更新当前布局参数（如运行时开关 2.5D 透视），不切换布局 |
| `setStatusFilter(statuses)` | 状态过滤，如 `['ok', 'warn']` |
| `setShowLabels(show)` | 显示 / 隐藏节点标签 |
| `setStyle(style)` | 重新设置样式配置 |
| `select(id, options?)` | 选中节点；`options.focus` 默认 `true`，会聚焦到目标 |
| `focus(id)` | 聚焦节点 |
| `clearSelection()` | 取消选中 |
| `fitView()` | 适配视图 |
| `relayout()` | 重新执行当前布局；拖动 Combo / 节点后用它恢复默认位置 |
| `checkOverlaps(options?)` | 检查 Combo 分层是否存在节点 / 层重叠，返回 `{ ok, nodes, groups, layers }`；`groups` 恒为空数组，仅用于兼容旧调用方 |
| `resize(width?, height?)` | 调整画布尺寸；不传参数时按容器自适应 |
| `toDataURL()` | 导出当前视口 PNG（`data:image/png;base64,...`） |
| `on(event, handler)` | 订阅自定义事件，返回 `this`，支持链式调用 |
| `once(event, handler)` | 订阅一次 |
| `off(event, handler?)` | 取消订阅；不传 handler 时清空该事件 |
| `emit(event, payload)` | 主动派发自定义事件 |
| `graph` | **只读属性**，G6 模式下返回原生 `Graph`，Three 模式为 `null` |
| `destroy()` | 销毁视图 |

---

## 4. 数据结构

SDK 同时支持两种数据形态：

1. **普通图拓扑**：`nodes` + `links`（或 `edges`）
2. **机房拓扑**：`racks`（+ 可选 `rows`）

响应也可以包一层 `{ data: {...} }`，SDK 会自动解包。

### 4.1 普通图数据

```json
{
  "meta": {
    "scene": "network",
    "name": "企业网络拓扑",
    "subtitle": "园区网 · 41 节点 / 49 链路",
    "colorMode": "status",
    "generatedAt": "2026-11-06T01:30:00.000Z"
  },
  "nodes": [
    {
      "id": "core-01",
      "name": "核心交换机 CORE-01",
      "type": "router",
      "status": "ok",
      "layer": 2,
      "group": "核心层",
      "color": "#38bdf8",
      "size": 4.2,
      "description": "核心交换机，双上行至出口。",
      "tags": ["核心"],
      "hideLabel": false,
      "metrics": {
        "cpu": 34,
        "memory": 48,
        "traffic": 2600,
        "latency": 3,
        "uptime": 210
      },
      "meta": {
        "ip": "10.10.1.1",
        "location": "A 栋 3F 机房",
        "model": "Cisco Catalyst 9600",
        "os": "IOS-XE 17.12"
      }
    }
  ],
  "links": [
    {
      "id": "l-1",
      "source": "core-01",
      "target": "agg-01",
      "type": "fiber",
      "status": "ok",
      "bandwidth": 25000,
      "traffic": 1200,
      "latency": 2
    }
  ]
}
```

#### 节点字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string \| number` | 是 | 节点唯一标识，最终转为字符串 |
| `name` | `string` | 否 | 显示名，缺省回退到 `label` 或 `id` |
| `type` | `string` | 否 | 节点类型，影响 G6 形状与详情图标，默认 `server` |
| `status` | `string` | 否 | 状态，影响节点描边、告警色、过滤，默认 `ok` |
| `layer` | `number` | 否 | 分层布局层级，数值越小越靠上 |
| `group` | `string` | 否 | 分组名；`colorMode: 'group'` 时用于着色 |
| `color` | `string` | 否 | 自定义颜色，优先于分组哈希色 |
| `size` | `number` | 否 | 预留尺寸字段（Three.js 使用） |
| `description` | `string` | 否 | 详情面板描述 |
| `tags` | `string[]` | 否 | 详情面板标签 |
| `hideLabel` | `boolean` | 否 | G6 扩展字段，`true` 时隐藏该节点标签 |
| `metrics` | `object` | 否 | `cpu` / `memory` / `traffic` / `latency` / `uptime`，用于悬停卡与详情面板 |
| `meta` | `object` | 否 | `ip` / `location` / `model` / `os` / `firmware` / `owner` 等 |
| `position` | `[x,y,z] \| {x,y,z}` | 否 | 固定坐标（Three.js 使用） |

`status` 兼容写法：

| 标准值 | 可识别别名 |
| --- | --- |
| `ok` | `up`、`normal`、`healthy`、`success`、`online` |
| `warn` | `warning`、`alert`、`minor` |
| `error` | `down`、`critical`、`fatal`、`major`、`offline` |
| `maintenance` | `maint`、`maintaining` |
| `offline` | `off`、`disabled`、`unknown` 之外的离线语义 |

#### 链路字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string \| number` | 否 | 链路 ID，缺省自动生成 `link-{index}` |
| `source` | `string` | 是 | 起点节点 ID |
| `target` | `string` | 是 | 终点节点 ID |
| `type` | `string` | 否 | 链路类型，如 `fiber`、`stack`、`dependency`；影响虚线样式 |
| `status` | `string` | 否 | 状态；`warn` / `error` 会加粗并显示告警色 |
| `bandwidth` | `number` | 否 | 带宽（Mbps），详情使用 |
| `traffic` | `number` | 否 | 流量，详情使用 |
| `latency` | `number` | 否 | 时延（ms），详情使用 |

> 起点或终点不存在的链路会被自动丢弃，避免脏数据导致渲染异常。

#### `meta` 字段

| 字段 | 说明 |
| --- | --- |
| `scene` | 场景标识：`network` / `datacenter` / `graph` / `iot` / `custom` |
| `name` | 场景标题 |
| `subtitle` | 副标题 |
| `colorMode` | `status`（按状态着色）或 `group`（按分组着色） |
| `directed` | G6 扩展字段，`true` 时链路显示箭头 |
| `generatedAt` | 数据生成时间 |

### 4.2 机房数据

响应中存在 `racks` 数组时进入机房模式：

```json
{
  "meta": { "name": "3D 数据中心机房" },
  "rows": [{ "id": "row-a", "name": "A 区", "z": -16 }],
  "racks": [
    {
      "id": "rack-a1",
      "name": "A 区-第 1 列",
      "row": "A 区",
      "x": -12,
      "z": -16,
      "status": "ok",
      "temperature": 24.3,
      "power": 6.2,
      "capacity": 42,
      "usedU": 30,
      "devices": [
        {
          "id": "rack-a1-d1",
          "name": "应用节点-01",
          "type": "server",
          "status": "ok",
          "u": 2,
          "height": 2,
          "power": 320,
          "temperature": 26.1,
          "model": "RH2288 V6"
        }
      ]
    }
  ]
}
```

| 机柜字段 | 说明 |
| --- | --- |
| `id` | 机柜 ID（必填） |
| `name` | 机柜名称 |
| `row` / `zone` | 所属区域；G6 会按区域自动生成同区域连线 |
| `x` / `z` | Three.js 平面坐标 |
| `status` | 机柜状态 |
| `temperature` | 温度（°C） |
| `power` | 功率（kW） |
| `capacity` | 容量（U） |
| `usedU` | 已用 U 数 |
| `devices` | 设备数组（详情面板展示） |

G6 机房模式说明：

- 每个机柜作为一个节点，形状为矩形，尺寸 `72 × 92`。
- 同一 `row` 内相邻机柜自动生成连线，链路 `type: 'rack-row'`。
- 设备作为机柜详情数据，不单独渲染为节点。
- 未显式指定布局时，机房数据自动使用 `g6-grid`。

### 4.3 节点类型与 G6 形状

| 节点 `type` | G6 形状 | 默认尺寸 |
| --- | --- | --- |
| `cloud` | `star` | 46 |
| `firewall` | `diamond` | 34 |
| `router` / `edge` / `controller` | `hexagon` | 34 / 34 / 34 |
| `switch` | `rect` | 24 ~ 40（按度数） |
| `server` | `rect` | 24 ~ 40（按度数） |
| `database` / `storage` | `rect` | 32 |
| `sensor` | `triangle` | 22 |
| `camera` | `diamond` | 22 |
| `meter` | `rect` | 24 ~ 40 |
| `pc` / `gateway` / `concept` | `circle` | 20 / 24~40 |
| `group` | `ellipse` | 24 ~ 40 |
| 机柜（`racks`） | `rect` | `72 × 92` |

默认尺寸规则：`min(40, 24 + min(degree, 8) * 1.7)`，度数由链路数量自动计算。

---

## 5. 配置项（config）

### 5.1 完整配置表

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | — | 渲染容器选择器或元素，建议显式传入 |
| `el` | `string \| HTMLElement` | — | `container` 的别名 |
| `engine` | `'g6' \| 'three'` | `'g6'` | 渲染引擎 |
| `scene` | `string` | 数据 `meta.scene` 或 `custom` | 数据归一化时使用的场景标识 |
| `layout` | `string` | `g6-force`，机房自动 `g6-grid` | 布局 ID |
| `layoutOptions` | `object` | `{}` | 布局参数，覆盖布局预设 |
| `theme` | `'dark' \| 'light' \| object` | `'dark'` | 主题名或自定义主题对象 |
| `showLabels` | `boolean` | `true` | 是否显示节点标签 |
| `autoFit` | `boolean` | `true` | 渲染 / 布局后是否自动适配视图 |
| `animation` | `boolean` | `true` | G6 是否启用动画；大数据量建议 `false` |
| `behaviors` | `string[]` | `['drag-canvas','zoom-canvas','drag-element']` | G6 交互行为 |
| `statusFilter` | `string[]` | 全部状态 | 初始状态过滤 |
| `style` | `object` | `{}` | 全局样式与按布局样式 |
| `node` / `edge` / `background` / `grid` / `layoutStyles` | `object` | — | `style.node` 等字段的顶层快捷写法 |
| `events` | `Record<string, Function>` | — | 初始事件订阅 |
| `onHover` | `(info \| null) => void` | — | 悬停回调 |
| `onSelect` | `(info \| null) => void` | — | 选中回调 |
| `onStats` | `(stats) => void` | — | 统计回调（Three.js FPS） |

### 5.2 容器解析顺序

1. `config.container`
2. `config.el`
3. `document.querySelector('[data-topology-view]')`
4. `document.querySelector('#topology-root')`

找不到容器会抛出：

```
[TopologySDK] 找不到渲染容器，请通过 config.container 指定
```

### 5.3 引擎切换

```js
// 同一容器从 G6 切到 Three.js
await loadGraph(data, { container: '#topo', engine: 'three', layout: 'force' })

// 再切回 G6
await loadGraph(data, { container: '#topo', engine: 'g6', layout: 'g6-dagre' })
```

切换时会：

1. 销毁旧引擎实例；
2. 释放画布、事件监听、布局与后处理资源；
3. 用新引擎重新渲染当前数据。

---

## 6. 布局

### 6.1 G6 布局（8 种）

| 布局 ID | G6 布局类型 | 名称 | 默认参数 | 适用场景 |
| --- | --- | --- | --- | --- |
| `g6-force` | `d3-force` | 力导向 | `link.distance=105`、`manyBody.strength=-320`、`collide.radius=34`、`iterations=320` | 通用关系图 |
| `g6-force-atlas2` | `force-atlas2` | FA2 | `kr=12`、`kg=1.6`、`ks=0.12`、`maxIteration=320` | 社区结构明显的图 |
| `g6-dagre` | `dagre` | 层次 | `rankdir=TB`、`nodesep=34`、`ranksep=76` | 网络层级、依赖关系 |
| `g6-circular` | `circular` | 环形 | `radius=250`、`ordering=degree` | 环形对等结构 |
| `g6-concentric` | `concentric` | 同心 | `sortBy=degree`、`nodeSpacing=12` | 核心节点居中 |
| `g6-grid` | `grid` | 网格 | `cols=6`、`nodeSize=[72,92]` | 机柜、设备清单 |
| `g6-radial` | `radial` | 径向 | `unitRadius=105`、`linkDistance=105` | 以核心节点辐射 |
| `g6-combo-layer` | 自研 `ComboLayerLayout` | 分层 Combo | `layerGap=92`、`clusterGap=44`、`nodeGap=30`、`vanishingDistance=0.6` | 2.5D 分层、网络分层视图 |

### 6.2 常用布局参数

#### `d3-force`（`g6-force`）

```js
layoutOptions: {
  link: { distance: 120, strength: 0.6 },
  manyBody: { strength: -400 },
  collide: { radius: 36, strength: 0.9 },
  centerStrength: 0.03,
  iterations: 300,
}
```

| 参数 | 说明 |
| --- | --- |
| `link.distance` | 链路理想长度 |
| `link.strength` | 链路引力强度 |
| `manyBody.strength` | 节点斥力，负值越大越分散 |
| `collide.radius` | 碰撞半径 |
| `centerStrength` | 向心引力 |
| `iterations` | 迭代次数，大数据量可降低 |

#### `dagre`（`g6-dagre`）

```js
layoutOptions: {
  rankdir: 'LR',   // TB / BT / LR / RL
  align: 'UL',     // U / D / L / R / UL / UR / DL / DR
  nodesep: 40,
  ranksep: 100,
  nodeSize: [60, 34],
}
```

#### `force-atlas2`（`g6-force-atlas2`）

```js
layoutOptions: {
  kr: 14,
  kg: 1.8,
  ks: 0.12,
  mode: 'linlog',
  preventOverlap: true,
  nodeSize: 44,
  barnesHut: true,
  maxIteration: 300,
}
```

#### `circular`（`g6-circular`）

| 参数 | 说明 |
| --- | --- |
| `radius` | 半径 |
| `ordering` | `topology` / `degree` / `null` |
| `clockwise` | 是否顺时针 |
| `startAngle` | 起始角（弧度） |

#### `concentric`（`g6-concentric`）

| 参数 | 说明 |
| --- | --- |
| `sortBy` | `'degree'` 或自定义函数 |
| `nodeSize` | 节点尺寸，用于防重叠 |
| `nodeSpacing` | 同层间距 |
| `maxLevelDiff` | 每层同心值差 |
| `startAngle` / `clockwise` | 起始角与方向 |

#### `grid`（`g6-grid`）

| 参数 | 说明 |
| --- | --- |
| `cols` | 每行列数 |
| `nodeSize` | `[宽, 高]` |
| `preventOverlap` | 是否防重叠 |
| `condense` | 是否压缩空白 |

#### `radial`（`g6-radial`）

| 参数 | 说明 |
| --- | --- |
| `focusNode` | 中心节点 ID；不传使用第一个节点 |
| `unitRadius` | 每层半径 |
| `linkDistance` | 链路长度 |
| `preventOverlap` / `nodeSize` | 防重叠配置 |
| `strictRadial` | 是否严格沿径向排列 |

### 6.3 Three.js 布局

| 布局 ID | 名称 | 说明 |
| --- | --- | --- |
| `force` | 力导向 | 三维迭代力导向 |
| `layered` | 分层 | 按 `layer` 分层 |
| `sphere` | 球面 | 均匀分布在球面 |
| `grid` | 网格 | 三维网格 |

Three.js 布局支持通过 `src/topology/layouts/index.js` 注册自定义布局，详见项目 README 的“布局插件化”章节。

### 6.4 切换布局

```js
await view.setLayout('g6-dagre', { rankdir: 'LR', ranksep: 120 })
```

或在配置中：

```js
await loadGraph(data, {
  container: '#topo',
  layout: 'g6-concentric',
  layoutOptions: { sortBy: 'degree', nodeSpacing: 18 },
})
```

### 6.5 分层 Combo 布局（`g6-combo-layer`）

`g6-combo-layer` 是本项目基于 G6 5 `BaseLayout` 自研的布局，用于把拓扑渲染成
**2.5D 分层 Combo 面板**：

- Combo 表示「层」，按节点的 `layer` 字段从上到下依次堆叠；
- 节点直接挂在层 Combo 上；节点的 `group`（缺省回退到 `type`）只作为层内布局聚类键，
  不生成二级分组面板；
- 每一层的 Combo 是一块可拖拽的浮起面板，层与层之间保持固定 `layerGap`；
- **2.5D 梯形透视**：开启后每个层都绘制成「顶窄底宽」的梯形（自定义 `combo-trapezoid`），
  远层向右上方斜向错位、缩小，近层放大，形成一叠悬浮面板的纵深效果；
- **统一灭点**：所有梯形的斜边延长线都汇聚到同一个灭点（整体水平中心上方，
  距离由 `vanishingDistance` 控制），不会出现各层斜率不一致；
- **网络场景三层归并**：原始 7 个 `layer` 会归并为「核心层 / 汇聚层 / 接入层」，
  层内的 `group` 仅参与聚类排布；
- **两级防重叠**：节点（含标签）与层面板在布局阶段与渲染后都会做碰撞检查，
  正常分层下 `checkOverlaps()` 始终返回 `ok: true`；
- Combo 的坐标与尺寸由 G6 根据子元素包围盒 + padding 自动推导，布局只写节点坐标，
  因此拖拽、折叠、缩放后依然正确。

#### 数据契约

使用该布局时，G6 页面会自动根据节点字段生成层 Combo，业务侧**不需要手写 combos**：

```json
{
  "nodes": [
    { "id": "core-01", "name": "核心交换机", "layer": 2, "group": "核心层", "type": "router" },
    { "id": "agg-03",  "name": "汇聚交换机", "layer": 3, "group": "汇聚层", "type": "switch" }
  ],
  "links": [
    { "id": "l1", "source": "agg-03", "target": "core-01" }
  ]
}
```

生成的 G6 数据结构等价于：

```js
{
  nodes: [
    { id: 'core-01', combo: 'layer:2', data: { /* ... */, __comboScale: 0.9 } },
    { id: 'agg-03',  combo: 'layer:3', data: { /* ... */, __comboScale: 0.95 } },
  ],
  edges: [/* ... */],
  combos: [
    { id: 'layer:2', data: { kind: 'layer', name: 'L2 · 核心层', order: 0, scale: 0.9 } },
    { id: 'layer:3', data: { kind: 'layer', name: 'L3 · 汇聚层', order: 1, scale: 0.95 } },
  ],
}
```

> `data.scale` / `data.__comboScale` 是布局内部写入的 2.5D 透视比例：
> Combo 用它缩放标题与投影，节点用它缩放本体、标签与描边。业务侧无需手动维护，
> 但可以在自定义主题中读取它做进一步适配。

字段约定：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `layer` | 节点 | 层号或层名；数字按大小排序，非数字按字符串排序 |
| `group` | 节点 | 层内布局聚类键；缺省使用 `type`，再缺省为「未分组」，不渲染分组面板 |
| `kind` | Combo `data` | `layer` 表示层，驱动 2.5D 样式 |
| `order` | Combo `data` | 同层级排序权重，数字越小越靠上 / 靠左 |
| `name` | Combo `data` | 面板标题 |

机柜数据（`racks`）没有 `layer` 字段，会整体归入「机柜分区」层，并按 `row` 作为布局聚类。

#### 布局参数

```js
await loadGraph(data, {
  container: '#topo',
  engine: 'g6',
  layout: 'g6-combo-layer',
  layoutOptions: {
    layerGap: 92,      // 层与层之间的间距
    clusterGap: 44,    // 同层布局聚类之间的间距（聚类不渲染面板）
    nodeGap: 30,       // 聚类内节点之间的间距
    nodeCols: 4,       // 聚类内节点网格最大列数
    maxLayerWidth: 1280,
    nodeLabelGap: 18,  // 节点文字预留高度
    layerPadding: [56, 60, 32, 60],
    perspective: true, // 2.5D 透视开关
    farScale: 0.62,    // 最远层（最上方）缩放
    nearScale: 1.08,   // 最近层（最下方）缩放
    depthShiftX: 118,  // 远层向右偏移
    depthShiftY: 34,   // 远层向上偏移
    vanishingDistance: 0.6, // 灭点距离系数；所有梯形斜边汇聚到同一灭点
    topInsetSlope: 0.12, // 无灭点时的梯形斜率兜底
    minLayerGap: 64,   // 层间最小间距
    minClusterGap: 44, // 聚类间最小间距
    safetyGap: 12,     // 额外防重叠安全间距
  },
})
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `layerGap` | `92` | 层与层的固定间距；阴影和标题会占用一部分视觉空间 |
| `clusterGap` | `44` | 同层内布局聚类之间的间距 |
| `nodeGap` | `30` | 聚类内节点的横纵间距 |
| `nodeCols` | `4` | 每个聚类内节点网格的最大列数，实际列数取 `ceil(sqrt(n))` 与它的较小值 |
| `maxLayerWidth` | `1280` | 单层内容最大宽度，超过后聚类自动换行 |
| `nodeLabelGap` | `18` | 节点标签额外占用的高度，避免标签压到下一行节点 |
| `layerPadding` | `[56,60,32,60]` | 层面板内边距 `[上,右,下,左]`，顶部留给层标题；左右需略大于节点半宽，避免透视压缩后顶部节点被斜边切到 |
| `nodeSize` | 主题尺寸 | 可选，数字、`[宽,高]` 或 `(node) => [宽,高]` 函数 |
| `center` | `[0,0]` | 整体布局中心偏移 |
| `perspective` | `true` | 是否启用 2.5D 透视；关闭后所有层都按 `1:1` 渲染，Combo 回退为矩形 |
| `farScale` | `0.62` | 最远层（索引 0，最上方）的缩放比例，范围 `0.45 ~ 1` |
| `nearScale` | `1.08` | 最近层（索引 `n-1`，最下方）的缩放比例，范围 `0.6 ~ 1.6` |
| `depthShiftX` | `118` | 远层向右偏移的像素数，形成斜向堆叠 |
| `depthShiftY` | `34` | 远层向上偏移的像素数，形成抬升感 |
| `topInsetSlope` | `0.12` | 无灭点时的梯形斜率兜底：每 1px 高度向内收窄的像素数 |
| `vanishingDistance` | `0.6` | 灭点距离系数：灭点在整体上方「总高度 × 系数」处；越大透视越弱 |
| `layerTopInset` | `0.2` | 旧参数：层面板顶边收窄比例，仅在未设置 `topInsetSlope` 时兜底 |
| `topInsetLimit` | `0.24` | 旧参数：顶边收窄上限（相对面板高度），避免收得太窄压到内容 |
| `minLayerGap` | `64` | 层间最小间距，会叠加 `safetyGap` |
| `minClusterGap` | `44` | 聚类间最小间距，会叠加 `safetyGap` |
| `safetyGap` | `12` | 额外安全间距，用于吸收阴影、标题背景等像素误差 |

> `layerPadding` 是 Combo 的**基础内边距**，由 `buildLayerCombos()` 写入
> Combo 数据（`style.padding`）；拖动节点时会在此基础上按需扩大，保证面板包住所有子节点。
> 不要把这个 padding 写进 `buildComboOptions()` 的 `style`：G6 的默认样式优先级高于数据样式，
> 会把运行时调整覆盖掉，面板就再也撑不大了。

#### 拖拽与重新整理

- 分层 Combo 模式默认启用 G6 `drag-element` 行为，可拖动**整个层面板**（子节点会一起移动），也可以单独拖动节点微调；
- 拖动**节点**时所在层宽高会**自动扩展**，始终把节点（本体 + 标签）完整包在面板内：
  - 在 `dragstart` 缓存节点块（本体 + 标签）相对节点中心的四边偏移，`drag` 时只做纯数学推导，不重复测量；
  - 每帧最多扩展一次（`requestAnimationFrame`），按「子节点并集 + 所需 padding」重算层的 `padding`，
    G6 的 Combo 尺寸 = 子元素包围盒 + padding，因此面板会自动变宽变高；
  - 所需左右 padding 由梯形斜边的闭式解逐块求出：所有斜边都是从同一个灭点出发的射线，
    逐个内容块检查上、下两条边并取最大值，不会因为包围盒的空白角把面板过度撑大；
  - 测量使用不含投影 / hover halo 的稳定包围盒（`_stableBoundsOf()`），
    否则鼠标悬停会让 `shadowBlur` 变大、面板随 hover 忽大忽小；
  - 布局稳定后会冻结每层左右斜率（`_layerSlopes`），拖拽期间按 `inset = 斜率 × 当前层高` 绘制；
    层高变化只改变底边长度，底边左右内角与透视角度全程不变；
  - 松手后立即按最终位置统一拟合一次（`_fitComboPaddings()`）；
    若层之间发生重叠，按拖动前快照的标准层距一次重排，保证整组层距均匀；
    若层被拖到其它层下方、上下顺序改变，无法按 `{id, prev}` 匹配时按层序索引复用快照层距；
    修正期间临时关闭过渡动画，不会出现「等一会才推开」；
  - 关闭 2.5D 后层面板回退为矩形，同一套扩展逻辑继续生效；
- 没有发生重叠时，拖动后面板不会自动回弹，方便业务做局部手工排版；
- 节点之间被拖到互相重叠时不做自动挪位（保留用户刚摆好的位置），调用 `relayout()` 可恢复；
- 调用 `view.relayout()` 或点击左侧菜单的「重新整理分层」可恢复默认分层位置。

```js
// 恢复分层布局（拖动后使用）
await view.relayout()

// 也可以只调用底层 G6 控制器
await view.g6?.relayout()
```

`relayout()` 会先调用 `graph.stopLayout()`，避免与正在运行的布局动画冲突，然后重新执行当前布局并适配视图。

#### 2.5D 透视

`g6-combo-layer` 的 2.5D 效果由「缩放 + 斜向错位 + 梯形面板」组合而成，
完全在二维平面内计算，不使用 CSS 3D 变换：

- 索引 0（最上方）按 `farScale` 缩小，索引 `n-1`（最下方）按 `nearScale` 放大，中间层线性插值：
  `scale = farScale + (nearScale - farScale) * index / (n - 1)`；
- 缩放会同时作用于节点本体尺寸、标签字号与偏移、描边、阴影，以及层内节点 / 聚类间距，
  保证布局计算尺寸与最终渲染尺寸一致；
- 远层通过 `depthShiftX` / `depthShiftY` 向右上方错位，形成一叠悬浮面板的纵深；
- 层 Combo 使用自定义 `combo-trapezoid` 绘制顶窄底宽的梯形，
  所有梯形的斜边延长线都汇聚到同一个灭点（整体水平中心上方，
  距离由 `vanishingDistance` 控制）；
- 首次布局 / `relayout()` / 布局参数变化后，会把各层左右斜率冻结到 `_layerSlopes`；
  拖拽节点或层时按冻结斜率绘制，层高变化不会改变底边左右内角与透视角度；
- 缩放比例写入 Combo 的 `data.scale` 与节点的 `data.__comboScale`，主题层直接读取；
- 因为完全在二维平面内完成，G6 的命中检测、拖拽、缩放、导出都不受影响；
- 其他布局即使生成 Combo 也会强制 `perspective: false`，不会被误缩放。

页面左侧「分层 Combo」下方的「2.5D 视图」按钮可一键开关，等价于：

```js
// 关闭 2.5D：Combo 回退为矩形，节点缩放恢复 1:1
await view.setLayoutOptions({ perspective: false })

// 重新开启
await view.setLayoutOptions({ perspective: true })
```

> 切换 2.5D 必须使用 `setLayoutOptions()`，而不是 `setLayout()`。
> 后者在 Combo 模式不变时只重新执行布局，不会重新计算 `__comboScale` 与 Combo 样式。

想调整透视强度时，可以改 `farScale` / `nearScale` / `depthShiftX` / `depthShiftY` /
`vanishingDistance`：

```js
await loadGraph(data, {
  container: '#topo',
  layout: 'g6-combo-layer',
  layoutOptions: {
    perspective: true,
    farScale: 0.58,      // 顶部更远、更小
    nearScale: 1.12,     // 底部更近、更大
    depthShiftX: 140,    // 斜向堆叠更明显
    depthShiftY: 44,
    vanishingDistance: 0.9, // 灭点更远，梯形更接近矩形
  },
})
```

#### 碰撞检测与两级防重叠

布局与运行期共用 `src/g6/collision.js` 的纯数学工具（AABB 检测、二维分离、纵向分离），
分两级保证不重叠：

| 级别 | 检查对象 | 布局阶段 | 渲染后兜底 |
| --- | --- | --- | --- |
| 节点 | 节点本体 + 标签块 | 网格排列 + 标签宽度预留 + `separateRects` | G6 真实包围盒，含阴影 / 标签背景 |
| 层 | 层面板 | 纵向堆叠 + `separateRectRows` | 真实包围盒，只向下推开，保持层序 |

渲染后兜底由控制器 `_resolveRenderedOverlaps()` 执行：读取 `graph.getElementRenderBounds()`，
等待 Combo 包围盒按最新子元素重算后再分离，并在 `mount` / `setData` / `setLayout` / `relayout` /
`setTheme` 之后自动运行；G6 元素过渡动画落定后还会延迟补一次检查，修复动画期间测量造成的残留重叠。
如果业务需要自己接管像素级排版，可以关闭：

```js
await loadGraph(data, {
  container: '#topo',
  layout: 'g6-combo-layer',
  resolveOverlaps: false,
})
```

检查当前是否存在重叠：

```js
const report = view.checkOverlaps()
// 正常：{ ok: true, nodes: [], groups: [], layers: [] }
// 异常：{ ok: false, nodes: [{ a, b }], groups: [...], layers: [...] }
```

`checkOverlaps({ gap: 4 })` 可以要求元素之间至少留出 4px。底层控制器同样可用：
`view.g6?.checkOverlaps?.()`。

> 手动拖动层 / 节点后出现重叠是预期行为；调用 `relayout()` 或点击「重新整理分层」即可恢复。

#### Combo 样式

Combo 样式由 `src/g6/theme.js` 的 `buildComboOptions()` 生成：

- 层：大圆角（`radius=20`）、半透明填充、很轻的投影
  （`shadowBlur ≈ 9 * (0.5 + 0.6 * depth)`、`shadowOffsetY ≈ 4 * (0.5 + depth)`、`shadowOpacity ≈ 0.08 + 0.08 * depth`），
  避免大面积青色光晕把背景压重；
- 标题使用带背景的标签，显示在面板顶部；
- 标题字号、偏移会随 `data.scale` 轻微缩放，远层不会显得过重。

> Combo 之间的碰撞检测使用「元素位置 + keyShape 尺寸」的几何矩形（`_comboRectOf()`），
> 不含阴影、标签和梯形顶边的渲染外扩；节点使用不含投影的稳定包围盒（`_stableBoundsOf()`）。
> 这样 2.5D 梯形不会被误判重叠而平移，节点的梯形分布得以保留。

可通过 `style.layouts['g6-combo-layer']` 覆盖节点 / Combo 样式：

```js
style: {
  layouts: {
    'g6-combo-layer': {
      combos: true,                  // 显式启用 Combo 数据生成
      node: { labelPlacement: 'bottom' },
      // 主题级别的 Combo 颜色请通过 theme 覆盖：
    },
  },
}
```

自定义主题色：

```js
await loadGraph(data, {
  container: '#topo',
  layout: 'g6-combo-layer',
  theme: {
    comboFill: 'rgba(20, 44, 72, 0.34)',
    comboStroke: 'rgba(120, 190, 240, 0.26)',
    layerFill: 'rgba(10, 26, 46, 0.52)',
    layerStroke: 'rgba(95, 212, 255, 0.3)',
  },
})
```

#### 性能建议

- Combo 数量的量级是层数，通常远小于节点数；
- 布局只写节点坐标，Combo 由 G6 推导，复杂度近似 `O(节点数)`；
- 碰撞检测先按 `left` 排序再做扫描剪枝，常规数据接近 `O(n log n)`；
- 渲染后兜底只在 `mount` / `setData` / `setLayout` / `relayout` 后运行，无重叠时只测量一轮就结束；
- 节点数超过 300 时，建议降低 `nodeCols` 或增大 `maxLayerWidth` 让层更宽，避免层高过大；
- 切换布局进出 Combo 模式会重新生成数据并 `setData`，属于全量重绘，避免高频调用；
- 状态过滤、指标轮询不会重建 Combo，只更新对应节点与相邻边；
- 如果业务自己实现了像素级排版，可用 `resolveOverlaps: false` 关闭渲染后兜底。

---

## 7. 样式配置

样式通过 `config.style` 传入，支持**全局样式**与**按布局覆盖**：

```js
style: {
  // 全局节点 / 链路 / 背景 / 网格
  node: { ... },
  edge: { ... },
  background: '#0a1220',
  grid: { ... },

  // 按布局覆盖
  layouts: {
    'g6-dagre': {
      node: { ... },
      edge: { ... },
      background: '#f5f9ff',
      grid: { ... },
      layoutOptions: { rankdir: 'LR' },
    },
  },
}
```

样式合并优先级（从低到高）：

```
主题默认值 → style.node / style.edge / style.background / style.grid
          → style.layouts[当前布局].node / edge / background / grid
```

布局参数的合并优先级（从低到高）：

```
布局预设 → config.layoutOptions → style.layouts[当前布局].layoutOptions
```

> 说明：按布局的 `layoutOptions` 优先级最高，便于在全局参数基础上为某个布局单独微调。若同时传入 `config.layoutOptions` 和 `style.layouts[id].layoutOptions`，以后者为准。

### 7.1 节点样式

`style.node` 可以是对象，也可以是函数：

```js
// 对象：所有节点统一覆盖
node: {
  fill: '#0b1728',
  stroke: '#5fd4ff',
  lineWidth: 2,
}

// 函数：按节点返回补丁
node: (datum, current) => ({
  fill: datum.data.status === 'warn' ? '#2a1a08' : current.fill,
})
```

函数参数：

- `datum`：G6 节点数据，业务字段在 `datum.data` 中；
- `current`：当前已计算好的完整样式；
- 返回一个样式补丁对象，会与 `current` 合并。

常用节点样式键：

| 键 | 说明 |
| --- | --- |
| `size` | 尺寸，数字或 `[宽, 高]` |
| `radius` | 矩形圆角 |
| `fill` | 填充色 |
| `stroke` | 描边色 |
| `lineWidth` | 描边宽度 |
| `shadowColor` | 阴影颜色 |
| `shadowBlur` | 阴影模糊 |
| `shadowOffsetY` | 阴影 Y 偏移 |
| `label` | 是否显示标签 |
| `labelText` | 标签文本 |
| `labelPlacement` | 标签位置，如 `bottom` / `top` / `left` / `right` |
| `labelOffsetY` | 标签 Y 偏移 |
| `labelFill` | 标签颜色 |
| `labelFontSize` | 标签字号 |
| `labelFontWeight` | 标签字重 |
| `labelBackground` | 是否显示标签背景 |
| `labelBackgroundFill` | 标签背景色 |
| `labelBackgroundRadius` | 标签背景圆角 |
| `labelBackgroundPadding` | 标签背景内边距，如 `[1, 5]` |

### 7.2 链路样式

```js
edge: {
  stroke: 'rgba(120, 180, 220, 0.6)',
  lineWidth: 1.4,
  opacity: 0.85,
  lineDash: [6, 4],
  endArrow: true,
  endArrowFill: '#78b4dc',
  endArrowSize: 8,
}
```

| 键 | 说明 |
| --- | --- |
| `stroke` | 线条颜色 |
| `lineWidth` | 线宽 |
| `opacity` | 透明度 |
| `lineDash` | 虚线模式，如 `[5, 4]` |
| `endArrow` | 是否显示终点箭头 |
| `endArrowFill` | 箭头颜色 |
| `endArrowSize` | 箭头大小 |
| `lineAppendWidth` | 扩大线段的点击热区 |
| `cursor` | 鼠标样式 |

边样式同样支持函数形式：`(datum, current) => patch`。

### 7.3 背景与网格

```js
style: {
  background: '#08111f',
  grid: {
    size: 28,                    // 网格大小（px）
    stroke: 'rgba(80, 150, 200, 0.08)',
    border: true,                // 是否绘制边框
    borderStroke: 'rgba(80, 150, 200, 0.14)',
    borderLineWidth: 1,
    follow: { translate: false, zoom: false },
  },
}
```

`grid` 对应 G6 的 `grid-line` 插件。关闭网格有两种方式：

```js
// 全局关闭
style: { grid: false }

// 仅在某个布局下关闭
style: {
  layouts: {
    'g6-circular': { grid: false },
  },
}
```

`grid` 为对象时会与主题默认网格合并；传入 `size`、`stroke`、`borderStroke` 等字段即可覆盖。

### 7.4 按布局覆盖示例

```js
await loadGraph(data, {
  container: '#topo',
  layout: 'g6-dagre',
  style: {
    node: {
      fill: '#0b1728',
      stroke: '#5fd4ff',
    },
    edge: {
      stroke: 'rgba(96, 158, 202, 0.5)',
    },
    layouts: {
      'g6-dagre': {
        node: {
          fill: '#ffffff',
          labelFill: '#0b3a55',
          lineWidth: 2.4,
        },
        edge: {
          stroke: '#22aa88',
          endArrow: true,
        },
        background: '#f0f8ff',
        grid: { size: 32, stroke: 'rgba(40, 100, 150, 0.1)' },
        layoutOptions: {
          rankdir: 'LR',
          ranksep: 110,
        },
      },
    },
  },
})
```

切换到其他布局时，`layouts['g6-dagre']` 不会生效，自动回退到全局样式。这样同一份配置可以在不同布局间保持一致的品牌风格，又允许针对布局做特殊处理。

### 7.5 自定义主题

```js
await loadGraph(data, {
  container: '#topo',
  theme: {
    mode: 'dark',
    background: '#050b16',
    grid: 'rgba(90, 160, 220, 0.08)',
    gridBorder: 'rgba(90, 160, 220, 0.16)',
    nodeFill: '#0a1626',
    nodeStrokeWidth: 2,
    nodeLabel: '#d7ecff',
    nodeLabelBg: 'rgba(5, 11, 22, 0.8)',
    edge: 'rgba(100, 170, 220, 0.5)',
    edgeActive: '#6fe0ff',
    dimOpacity: 0.14,
    shadowBlur: 16,
    status: {
      ok: '#22e0a1',
      warn: '#ffb020',
      error: '#ff4d6d',
      maintenance: '#a78bfa',
      offline: '#64748b',
      unknown: '#94a3b8',
    },
  },
})
```

主题字段与默认值：

| 字段 | 说明 |
| --- | --- |
| `mode` | `'dark'` / `'light'`，决定容器与基础色 |
| `background` | 画布背景 |
| `grid` | 网格线颜色 |
| `gridBorder` | 网格边框颜色 |
| `nodeFill` | 节点默认填充 |
| `nodeStrokeWidth` | 节点描边宽度 |
| `nodeLabel` | 标签颜色 |
| `nodeLabelBg` | 标签背景色 |
| `edge` | 普通链路颜色 |
| `edgeActive` | 激活链路颜色 |
| `dimOpacity` | 被过滤 / 弱化元素透明度 |
| `shadowBlur` | 节点发光强度 |
| `status` | 状态色映射 |

默认状态色：

| 状态 | 深色主题 | 浅色主题 |
| --- | --- | --- |
| `ok` | `#22e0a1` | `#0f9f74` |
| `warn` | `#ffb020` | `#b45309` |
| `error` | `#ff4d6d` | `#d81b47` |
| `maintenance` | `#a78bfa` | `#7c3aed` |
| `offline` | `#64748b` | `#64748b` |

### 7.6 CSS 定制

G6 画布由 SDK 创建，容器建议：

```css
#topo {
  position: relative;
  width: 100%;
  height: 560px;
  overflow: hidden;
  border-radius: 12px;
}
```

> 不建议通过 CSS 强行设置 `.g6-host canvas { width: 100% }`。G6 自己管理画布尺寸，强行覆盖可能触发布局抖动。需要自适应时调用 `view.resize()` 或依赖 G6 的 `autoResize`。

---

## 8. 事件系统

SDK 提供两套等价的事件订阅方式：

```js
// 1. 订阅二次封装视图的事件（推荐，引擎无关）
const view = await loadGraph(data, { container: '#topo' })
view.on('node:highlight-click', (event) => {
  console.log(event.id, event.data)
})

// 2. 订阅底层 G6 Graph 的事件
view.graph.on('node:highlight-click', (event) => {
  console.log(event.id)
})
```

> `view.graph` 只在 G6 模式下存在。Three.js 模式下请使用 `view.on(...)` 或 `onHover` / `onSelect` 回调。

### 8.1 自定义事件列表

| 事件名 | 触发时机 | 事件对象 |
| --- | --- | --- |
| `node:highlight-click` | 单击节点 / 机柜 | `{ id, kind, data }` |
| `node:hight-light-click` | 同上，兼容别名 | `{ id, kind, data }` |
| `node:highlight-dblclick` | 双击节点 | `{ id, kind, data }` |
| `canvas:highlight-click` | 单击空白画布 | `{}` |
| `selection:change` | 选中变化 | `{ id, kind, data }` 或 `null` |
| `hover:change` | 悬停变化 | `{ id, kind, data, x, y }` 或 `null` |
| `layout:change` | 布局切换完成 | `{ layout, options }` |
| `theme:change` | 主题切换 | `{ theme }` |
| `style:change` | 样式更新 | `{ style }` |
| `labels:change` | 标签开关 | `{ showLabels }` |
| `filter:change` | 状态过滤变化 | `{ statuses }` |
| `data:update` | 数据更新 | `{ nodes, edges, signature }` |
| `render:complete` | 首次渲染完成 | `{ nodes, edges, layout }` |
| `view:fit` | 适配视图 | `{}` |
| `view:destroy` | 视图销毁 | `{}` |

`kind` 取值：`'node'` 或 `'rack'`。

### 8.2 点击高亮事件

```js
const view = await loadGraph(data, { container: '#topo' })

view.on('node:highlight-click', (event) => {
  const { id, kind, data } = event
  if (kind === 'rack') {
    console.log('点击机柜', id, data.devices)
  } else {
    console.log('点击节点', id, data.meta?.ip)
  }
})
```

使用底层 Graph：

```js
view.graph.on('node:highlight-click', (event) => {
  console.log(event)
})
```

### 8.3 选中与悬停

```js
view.on('selection:change', (event) => {
  if (!event) return console.log('已取消选中')
  console.log('选中', event.data)
})

view.on('hover:change', (event) => {
  if (!event) return
  console.log('悬停坐标', event.x, event.y)
})
```

### 8.4 布局 / 主题 / 数据事件

```js
view.on('layout:change', ({ layout, options }) => {
  console.log('布局已切换', layout, options)
})

view.on('theme:change', ({ theme }) => {
  console.log('主题已切换', theme)
})

view.on('data:update', ({ nodes, edges }) => {
  console.log('数据已更新', nodes, edges)
})
```

### 8.5 一次性订阅与取消

```js
view.once('render:complete', () => console.log('首次渲染完成'))

function onSelect(event) {
  console.log(event)
}
view.on('selection:change', onSelect)
view.off('selection:change', onSelect)

// 清空该事件的全部监听
view.off('selection:change')
```

### 8.6 业务自定义事件

业务可以借助底层 G6 事件总线发送自定义事件：

```js
view.graph.emit('business:refresh', { source: 'crm' })

view.graph.on('business:refresh', (payload) => {
  console.log(payload.source)
})
```

也可以用视图的 emitter：

```js
view.emit('business:refresh', { source: 'crm' })
view.on('business:refresh', (payload) => console.log(payload))
```

### 8.7 与 G6 原生事件的关系

`view.graph` 是 G6 5 原生 `Graph`，因此可以直接使用 G6 事件：

- `node:click` / `node:dblclick`
- `node:pointerenter` / `node:pointerleave`
- `canvas:click` / `canvas:pointerleave`
- `viewport:change`

自定义事件是在原生事件之上封装的语义事件，推荐业务优先使用 `node:highlight-click`、`selection:change` 等稳定事件，避免直接依赖 G6 内部事件细节。

### 8.8 引擎切换注意事项

```js
// 切换引擎后，底层 Graph 实例会变化
await loadGraph(data, { container: '#topo', engine: 'three' })
// view.graph === null

await loadGraph(data, { container: '#topo', engine: 'g6' })
// view.graph 是新的 Graph 实例
```

如果业务长期订阅 `view.graph.on(...)`，切换引擎后需要重新订阅；使用 `view.on(...)` 则不受影响（G6 事件仍然会转发到视图层）。

---

## 9. 运行时控制示例

### 9.1 主题切换

```js
await view.setTheme('light')
```

### 9.2 布局切换

```js
await view.setLayout('g6-dagre', { rankdir: 'LR', ranksep: 90 })
```

### 9.3 状态过滤

```js
await view.setStatusFilter(['ok', 'warn'])
// 恢复全部
await view.setStatusFilter(['ok', 'warn', 'error', 'maintenance', 'offline'])
```

### 9.4 选中 / 聚焦 / 取消

```js
view.select('core-01')                  // 选中并聚焦
view.select('core-01', { focus: false }) // 只选中
view.focus('core-01')
view.clearSelection()
```

### 9.5 适配与缩放

```js
await view.fitView()
view.resize()                 // 跟随容器尺寸
view.resize(800, 600)         // 显式尺寸
```

### 9.6 重新整理与重叠检测

```js
// 拖动 Combo / 节点后恢复默认分层
await view.relayout()

// 检查节点、层是否存在重叠（groups 恒为空数组，兼容旧调用方）
const report = view.checkOverlaps()
if (!report.ok) {
  console.warn('重叠：', report.nodes, report.groups, report.layers)
}
```

### 9.7 导出截图

```js
const dataUrl = await view.toDataURL()
const link = document.createElement('a')
link.href = dataUrl
link.download = 'topology.png'
link.click()
```

### 9.8 销毁

```js
view.destroy()
// 或
destroyGraph('#topo')
```

---

## 10. 性能最佳实践

G6 页面针对交互流畅性做了以下优化：

1. **轮询差异渲染**：`updateGraph()` 按节点 / 链路比较数据签名，数据未变化时直接跳过渲染。
2. **视觉字段判定**：仅 `metrics` 等不影响画面的字段变化时，只更新数据模型，不触发画布重绘。
3. **交互状态增量更新**：悬停、选中只更新相关节点与相邻边，不刷新整图。
4. **状态缓存**：状态过滤时仅提交真正变化的状态，避免全量 `setElementState`。
5. **取消自动标签避让**：默认不启用开销较大的 `auto-adapt-label`，需要时可通过 `behaviors` 开启。
6. **碰撞检测剪枝**：矩形先按 `left` 排序再扫描，常规数据接近 `O(n log n)`；渲染后兜底无重叠时只测量一轮，并额外延迟一次动画落定检查。

参考数据（200 节点 / 199 链路，本机开发环境，实际以业务环境为准）：

| 操作 | 耗时 |
| --- | --- |
| 首次渲染（dagre + 适配） | ~500 ms |
| 选中节点（增量） | ~2 ms |
| 仅指标更新（不重绘） | ~5 ms |
| 状态过滤（200 节点） | ~100 ms |
| 切换布局 | ~100 ms |

### 10.1 大数据量建议

```js
await loadGraph(data, {
  container: '#topo',
  engine: 'g6',
  layout: 'g6-dagre',
  animation: false,          // 关闭动画
  showLabels: false,         // 或仅少量节点显示
  behaviors: ['drag-canvas', 'zoom-canvas'],
  layoutOptions: { rankdir: 'LR', nodesep: 30, ranksep: 60 },
})
```

- 300 节点以内：默认配置即可流畅交互。
- 300 ~ 1000 节点：关闭动画，降低标签数量，优先使用 `dagre` / `circular` / `grid`。
- 1000 节点以上：建议关闭力导向或降低迭代次数，关闭 `drag-element`，分页 / 下钻展示。

### 10.2 轮询使用 `updateGraph`

```js
// ✅ 正确：增量更新
await updateGraph(nextData, { container: '#topo' })

// ❌ 不推荐：每秒重建视图
await loadGraph(nextData, { container: '#topo' })
```

### 10.3 避免重复创建视图

`loadGraph()` 对同一容器会复用视图，但频繁切换引擎会反复创建 / 销毁实例。建议：

- 页面初始化时加载一次；
- 数据变化使用 `updateGraph`；
- 主题、布局、过滤使用对应的 setter；
- 离开页面时 `destroyGraph`。

### 10.4 组件卸载清理

```js
import { onBeforeUnmount } from 'vue'
import { destroyGraph } from '@/sdk'

onBeforeUnmount(() => {
  destroyGraph('#topo')
})
```

### 10.5 容器尺寸变化

G6 已开启 `autoResize`，常规响应式布局无需手动处理。容器尺寸由动画（展开 / 收起侧栏）改变时，可在过渡结束后调用：

```js
view.resize()
```

---

## 11. 在 Vue / React 中集成

### 11.1 Vue 3

```vue
<template>
  <div ref="host" class="topology-host" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { loadGraph, destroyGraph } from '@/sdk'

const host = ref(null)
let view = null

onMounted(async () => {
  view = await loadGraph(data, {
    container: host.value,
    engine: 'g6',
    layout: 'g6-dagre',
    theme: 'dark',
  })

  view.on('node:highlight-click', (event) => {
    console.log(event.id, event.data)
  })
})

onBeforeUnmount(() => {
  destroyGraph(host.value)
})
</script>

<style scoped>
.topology-host {
  width: 100%;
  height: 560px;
}
</style>
```

### 11.2 React

```jsx
import { useEffect, useRef } from 'react'
import { loadGraph, destroyGraph } from '@/sdk'

export default function Topology({ data }) {
  const hostRef = useRef(null)

  useEffect(() => {
    let view
    let alive = true

    loadGraph(data, {
      container: hostRef.current,
      engine: 'g6',
      layout: 'g6-force',
    }).then((instance) => {
      if (!alive) return
      view = instance
      view.on('node:highlight-click', (event) => console.log(event.id))
    })

    return () => {
      alive = false
      if (hostRef.current) destroyGraph(hostRef.current)
    }
  }, [data])

  return <div ref={hostRef} style={{ width: '100%', height: 560 }} />
}
```

---

## 12. 常见问题

### Q1：页面空白 / 画布高度为 0？

容器必须有明确高度：

```css
#topo { width: 100%; height: 560px; }
```

父级使用 `height: 100%` 时，需要保证祖先链上都有高度。

### Q2：提示找不到渲染容器？

```js
await loadGraph(data, { container: '#topo' })
```

确认：

- 选择器拼写正确；
- 调用时 DOM 已挂载（Vue 的 `onMounted`、React 的 `useEffect`）；
- 元素没有被 `v-if` 延迟渲染。

### Q3：`view.graph` 为 `null`？

- 当前是 `engine: 'three'`，Three.js 模式没有 G6 Graph；
- 或视图尚未完成 `loadGraph`。请在 `await loadGraph(...)` 之后再访问。

### Q4：事件没有触发？

1. 确认在 `await loadGraph(...)` 之后订阅；
2. 优先使用 `node:highlight-click`，而不是猜测的 G6 原生事件；
3. 切换引擎后，`view.graph` 上的监听会失效，改用 `view.on(...)`；
4. 检查事件名是否大小写、连字符一致。

### Q5：布局参数不生效？

- `layoutOptions` 会覆盖布局预设；
- 按布局覆盖请写在 `style.layouts[layoutId].layoutOptions`；
- 切换布局时使用 `view.setLayout(id, options)`；
- 部分布局参数依赖 `nodeSize`，防重叠场景必须同时设置节点尺寸。

### Q6：样式没有变化？

- 确认修改的是当前布局对应的 `style.layouts[id]`；
- G6 状态色与告警色由主题控制，节点自定义 `fill` 不会覆盖状态描边；
- 需要覆盖状态描边时，使用 `style.node.stroke` 或函数形式按状态返回。

### Q7：如何关闭网格？

```js
style: { grid: false }
```

### Q8：如何关闭动画？

```js
await loadGraph(data, { container: '#topo', animation: false })
```

### Q9：如何自定义交互行为？

```js
await loadGraph(data, {
  behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'auto-adapt-label'],
})
```

默认行为为 `drag-canvas`、`zoom-canvas`、`drag-element`。

---

## 13. 目录与实现说明

```
src/
├─ g6/                     # 独立 G6 5 页面实现
│  ├─ graph.js             # G6TopologyGraph：渲染、布局、交互、事件
│  ├─ G6View.vue           # Vue 封装
│  ├─ theme.js             # 主题、节点 / 边样式、样式覆盖合并
│  ├─ layouts.js           # 7 种 G6 原生布局预设
│  └─ data.js              # 平台数据 -> G6 GraphData
├─ sdk/
│  ├─ topology-view.js     # TopologyView、loadGraph 等对外 API
│  └─ index.js             # SDK 导出与版本信息
├─ topology/               # 独立 Three.js 页面实现
└─ api/client.js           # 数据契约与归一化
```

关键约定：

- G6 数据格式为 `{ id, data: 原节点对象 }`，样式函数从 `datum.data` 读取业务字段。
- G6 状态使用 `active` / `dimmed`。
- 网格插件类型为 `grid-line`（不是 `grid`）。
- 机房场景自动使用 `g6-grid` 布局。
- SDK 默认引擎为 `g6`，可通过 `engine: 'three'` 切换。

---

## 14. 版本与兼容

| 依赖 | 版本 |
| --- | --- |
| `@antv/g6` | `5.1.1` |
| `@antv/layout` | `2.0.0`（G6 内部依赖） |
| Topology SDK | `1.3.0` |

运行时可通过以下方式查看能力清单：

```js
console.log(window.TopologySDK.info)
```

返回：

```js
{
  version: '1.3.0',
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
    g6: ['g6-force', 'g6-force-atlas2', 'g6-dagre', 'g6-circular', 'g6-concentric', 'g6-grid', 'g6-radial', 'g6-combo-layer'],
    three: ['force', 'layered', 'sphere', 'grid'],
  },
  events: [
    'node:highlight-click',
    'node:highlight-dblclick',
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
  ],
}
```

---

## 15. 完整示例

```js
import { loadGraph, updateGraph, destroyGraph } from '@/sdk'

const container = document.querySelector('#topo')

const view = await loadGraph(initialData, {
  container,
  engine: 'g6',
  scene: 'network',
  layout: 'g6-dagre',
  layoutOptions: { rankdir: 'LR', ranksep: 100 },
  theme: 'dark',
  showLabels: true,
  animation: false,
  statusFilter: ['ok', 'warn', 'error'],
  style: {
    node: {
      fill: '#0b1728',
      lineWidth: 2,
      labelFill: '#d7ecff',
      labelFontSize: 11,
    },
    edge: {
      stroke: 'rgba(96, 158, 202, 0.55)',
      endArrow: true,
    },
    background: '#060a13',
    grid: { size: 28 },
    layouts: {
      'g6-dagre': {
        node: { labelFill: '#bfe3ff' },
        layoutOptions: { ranksep: 120 },
      },
    },
  },
  events: {
    'render:complete': ({ nodes, edges }) => console.log('渲染完成', nodes, edges),
    'selection:change': (event) => console.log('选中', event?.id),
  },
})

view.on('node:highlight-click', (event) => {
  console.log('点击节点', event.id, event.data)
})

view.on('layout:change', ({ layout }) => console.log('布局切换为', layout))

// 按需刷新（例如点击「刷新数据」或收到 WebSocket / SSE 消息）
async function refresh() {
  const data = await fetch('/api/topology?scene=network').then((r) => r.json())
  await updateGraph(data, { container })
}

// 页面卸载
function dispose() {
  destroyGraph(container)
}
```

---

如有新的业务字段或布局需求，建议优先通过 `loadGraph` 的 `style` / `layoutOptions` 扩展，避免直接修改 `src/g6/` 内部实现，以便后续跟随 SDK 升级。
