# 3D 拓扑中心 · Topology Nexus

基于 **Vue 3 + Vite + Three.js + G6 5** 的双引擎拓扑可视化平台：

- **Three.js 3D 页面**：WebGL 场景、后处理、CSS2D 标签、三维布局
- **G6 5 二维页面**：G6 原生 Graph、原生布局、Canvas 画布、独立交互
- 两套页面技术完全独立，可通过顶栏 **3D / G6** 按钮随时切换
- 对外提供 `loadGraph(data, config)` 渲染 API，业务页面可直接嵌入拓扑图

内置四种场景，对接 REST API：

- **网络拓扑**：核心 / 汇聚 / 接入 / 服务器分层，链路流光、状态高亮
- **3D 机房**：机房地面、A/B/C 三区机柜、设备面板、温度与功率
- **知识图谱**：技术栈关系网络，按分组着色
- **物联网**：云 / 边 / 网关 / 感知设备，边云协同拓扑

## 功能清单

- 双渲染引擎：Three.js 3D 场景与 G6 5 二维画布，渲染 / 布局代码互不共用
- 页面布局：上下结构（顶栏 + 工作区），工作区再分左右；左侧「布局类型」菜单可收起 / 展开，右侧为画布
- 布局类封装：`G6LayoutDefinition` 子类 + `G6LayoutRegistry` 注册中心，每个布局都是 class 实例；`WorkspaceLayout` 统一管理左侧菜单宽度与收起状态
- Three.js 场景：泛光后处理、星空、网格、CSS2D 标签、GPU 流光链路
- G6 页面：8 种 G6 原生布局（力导向 / FA2 / 层次 / 环形 / 同心 / 网格 / 径向 / 分层 Combo）
- G6 分层 Combo：2.5D 梯形透视、层 / 节点两级防重叠、节点直接放在层上、面板可拖拽、一键重新整理
- 2.5D 视图菜单：左侧「2.5D 视图」一键开关；开启后层面板变为顶窄底宽的梯形，层间向右上方斜向堆叠，远层缩小、近层放大
- 布局插件化：Three.js 内置力导向 / 分层 / 球面 / 网格，支持注册任意自定义布局
- 深浅主题：一键切换，Three.js 场景、G6 画布、面板同步换肤，本地记忆
- 交互：旋转 / 缩放 / 平移、悬停提示、单击选中、双击聚焦、搜索定位
- 状态过滤：按正常 / 告警 / 严重 / 维护 / 离线筛选，联动当前引擎
- 数据接入：REST API，加载场景或手动「刷新数据」时请求一次，接口失败自动降级 Mock
- 增量渲染：数据刷新只更新变化元素，指标变化不触发整图重绘
- 详情面板：节点指标、邻接节点、机柜设备清单
- 支持自动旋转（3D）、标签开关、视图适配、导出 PNG 截图
- 对外 SDK：`loadGraph` / `updateGraph` / `destroyGraph`，支持样式覆盖与自定义事件

## 快速开始

```bash
cd D:\study\code\project3D
npm install
npm run dev
```

打开 `http://localhost:5173`。顶栏点击 **G6** 切换到二维页面，点击 **3D** 返回三维页面；左侧「布局类型」菜单会随引擎切换布局列表，并支持收起 / 展开。

开发服务器内置了 Mock REST 接口，因此**开箱即用**：

```
GET /api/topology?scene=network|datacenter|graph|iot
```

页面不会定时轮询：切换场景或点击顶栏「刷新数据」时才会重新请求。

## 文档

- [用户指南](docs/user-guide.md)：界面操作、布局切换、分层 Combo、2.5D 视图、常见问题
- [Topology SDK 用户指南](docs/topology-sdk-guide.md)：API、数据契约、布局参数、样式覆盖

## 对外渲染 API

SDK 挂载在 `window.TopologySDK`，业务页面只需一个容器和一份数据：

```html
<div id="topo" style="width: 100%; height: 560px"></div>
<script type="module">
  const view = await window.TopologySDK.loadGraph(data, {
    container: '#topo',
    engine: 'g6',              // 'g6' | 'three'
    layout: 'g6-dagre',
    theme: 'light',
    style: {
      node: { fill: '#fff', lineWidth: 2 },
      edge: { stroke: '#9cc', endArrow: true },
      background: '#f5f9ff',
      grid: { size: 32 },
      layouts: {
        'g6-dagre': {
          node: { labelFill: '#123' },
          layoutOptions: { rankdir: 'LR' },
        },
      },
    },
  })

  // 订阅二次封装事件
  view.on('node:highlight-click', (event) => {
    console.log(event.id, event.data)
  })

  // 也可以直接订阅 G6 原生 Graph
  view.graph.on('selection:change', (event) => console.log(event))
</script>
```

API 一览：

| API | 说明 |
| --- | --- |
| `loadGraph(data, config)` | 创建 / 复用视图并渲染 |
| `updateGraph(data, config)` | 增量更新数据 |
| `destroyGraph(container)` | 销毁视图 |
| `getGraphView(container)` | 获取视图实例 |
| `getGraph(container)` | 获取 G6 原生 Graph |
| `TopologyView` | 视图类（主题 / 布局 / 过滤 / 选中 / 截图 / 事件） |
| `view.relayout()` | 重新整理布局（拖动 Combo / 节点后恢复） |
| `view.checkOverlaps()` | 检查节点 / 层是否重叠（`groups` 字段保留为空数组） |

> 完整的配置项、数据字段、布局参数、样式键、事件列表与性能建议见 **[Topology SDK 用户指南](docs/topology-sdk-guide.md)**。

## 对接真实后端

复制 `.env.example` 为 `.env` 并按需修改：

```dotenv
VITE_API_BASE=/api          # 或 https://topology.example.com/api
VITE_USE_MOCK=false         # true 时完全使用前端 Mock
```

前端会请求：

```
GET {VITE_API_BASE}/topology?scene=network
```

请求失败或超时（非 2xx / 网络错误）时自动使用内置数据，并在状态栏提示「接口降级」。

### 图拓扑数据契约

```json
{
  "meta": {
    "name": "企业网络拓扑",
    "subtitle": "园区网 · 41 节点 / 52 链路",
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
      "description": "核心交换机，双上行至出口。",
      "tags": ["核心"],
      "size": 4.2,
      "color": "#38bdf8",
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

字段说明：

| 字段 | 说明 |
| --- | --- |
| `status` | `ok` / `warn` / `error` / `maintenance` / `offline`，也兼容 `up`、`down`、`warning` 等写法 |
| `layer` | 分层布局使用的层级，数值越小越靠上 |
| `colorMode` | `status` 按状态着色；`group` 按分组 / 节点 `color` 着色 |
| `metrics` | 可选，详情面板与悬停卡展示 |
| `position` | 可选 `[x,y,z]` 或 `{x,y,z}`，用于固定节点坐标 |

### 3D 机房数据契约

响应中包含 `racks` 数组时自动进入机房模式：

```json
{
  "meta": { "name": "3D 数据中心机房" },
  "rows": [
    { "id": "row-a", "name": "A 区", "z": -16 }
  ],
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

坐标单位：`x` / `z` 为机柜平面位置，`u` 为机柜内自下而上的 U 位，`height` 为占用 U 数（1U = 0.314 场景单位）。

## 目录结构

```
project3D/
├─ server/
│  └─ mock-api.js          # 开发期 REST Mock（Vite 中间件）
├─ docs/
│  ├─ user-guide.md         # 页面用户指南（含 2.5D 视图）
│  └─ topology-sdk-guide.md # 对外 SDK 用户指南
├─ src/
│  ├─ api/client.js        # REST 适配、数据归一化、Mock 降级
│  ├─ assets/styles.css    # 深色科技风 UI
│  ├─ components/
│  │  ├─ TopBar.vue        # 场景切换、3D/G6 切换、搜索、工具栏
│  │  ├─ DetailPanel.vue   # 节点 / 机柜详情与操作提示
│  │  ├─ StatusBar.vue     # 数据源、FPS / 引擎、更新时间
│  │  └─ Icon.vue
│  ├─ mock/data.js         # 四套示例数据 + 实时抖动
│  ├─ layout/
│  │  └─ workspaceLayout.js # WorkspaceLayout：左侧菜单宽度 / 收起状态（class 封装）
│  ├─ g6/                  # 独立 G6 5 二维页面
│  │  ├─ graph.js          # G6TopologyGraph：渲染、布局、交互、事件、碰撞兜底
│  │  ├─ G6View.vue        # Vue 封装与生命周期管理
│  │  ├─ theme.js          # G6 主题、节点 / 边 / Combo 样式、样式覆盖合并
│  │  ├─ layouts.js        # G6LayoutDefinition 子类 + G6LayoutRegistry 布局注册中心
│  │  ├─ comboLayerLayout.js # 2.5D 分层 Combo 布局（BaseLayout 子类）
│  │  ├─ comboConfig.js    # 分层 Combo 默认参数、透视缩放、梯形斜率
│  │  ├─ trapezoidCombo.js # 自定义梯形 Combo（BaseCombo + Polygon）
│  │  ├─ collision.js      # 纯数学 AABB 碰撞检测 / 分离工具
│  │  └─ data.js           # 平台数据 -> G6 GraphData（含两级 Combo）
│  ├─ sdk/
│  │  ├─ topology-view.js  # TopologyView / loadGraph / updateGraph
│  │  └─ index.js          # SDK 导出与版本信息
│  ├─ topology/            # 独立 Three.js 三维页面
│  │  ├─ engine.js         # 渲染器、相机、后处理、拾取、相机动画
│  │  ├─ graph.js          # 节点 / 链路 / 布局调度 / 高亮
│  │  ├─ datacenter.js     # 3D 机房与机柜
│  │  ├─ themes.js         # 深色 / 浅色场景与图层调色板
│  │  ├─ layouts/
│  │  │  ├─ index.js       # 注册中心：registerLayout / getLayouts / subscribeLayouts
│  │  │  ├─ base.js        # Layout 契约、defineTargetLayout、snapNodes
│  │  │  ├─ force.js       # 力导向（iterative）
│  │  │  ├─ layered.js     # 分层（targets）
│  │  │  ├─ sphere.js      # 球面（targets）
│  │  │  ├─ grid.js        # 网格（targets）
│  │  │  └─ g6.js          # G6 / @antv/layout 适配器
│  │  └─ palette.js        # 状态、类型、配色
│  ├─ App.vue              # 引擎切换、场景加载、事件同步
│  └─ main.js              # 应用入口 + window.TopologySDK
├─ .env.example
├─ index.html
├─ package.json
└─ vite.config.js
```

## 布局插件化

所有布局都通过统一注册中心接入，`graph.js` 不关心具体算法，只消费布局实例。布局契约：

```js
{
  id: 'my-layout',
  name: '我的布局',
  icon: 'graph',
  description: '布局说明',
  order: 100,                 // 左侧布局菜单排序，越小越靠前
  mode: 'iterative',          // iterative：每帧迭代；targets：直接给目标坐标
  create(nodes, links, options, context) {
    // iterative 返回 { mode, tick(dt), reset?, dispose? }
    // targets   返回 { mode, getTargets(): Map<id, {x,y,z}>, recompute?, dispose? }
  },
}
```

- `iterative`：适合力导向、退火等持续演化的布局，引擎每帧调用 `tick(dt)`。
- `targets`：适合分层、环形、Dagre、G6 等一次算出坐标的布局，引擎平滑插值到目标坐标。
- 异步布局完成后调用 `context.onUpdate()`，引擎会重新读取 `getTargets()`。
- `graph.js` 切换布局时会自动 `dispose()` 上一个实例，避免计时器 / 监听泄漏。

直接注册一个目标坐标布局：

```js
import { registerLayout, defineTargetLayout } from './topology/layouts/index.js'

registerLayout(
  defineTargetLayout(
    { id: 'helix', name: '螺旋', icon: 'globe', order: 50 },
    (nodes) =>
      new Map(
        nodes.map((node, i) => [
          node.id,
          {
            x: Math.cos(i * 0.6) * 60,
            y: (i - nodes.length / 2) * 4,
            z: Math.sin(i * 0.6) * 60,
          },
        ]),
      ),
  ),
)
```

注册后，左侧「布局类型」菜单会通过 `subscribeLayouts()` 自动出现新按钮，无需改 UI。

## 基于 G6 布局二次封装

`defineG6Layout()` 把 G6 / @antv/layout 的二维结果投影到三维空间，支持三种布局形态：

1. 函数：`(nodes, edges, options) => positions`
2. 布局实例：`{ execute(data, options) }` 或 `{ layout(data) }`（@antv/layout / G6 5）
3. G6 4.x `registerLayout` 对象：`{ init(data), execute(), tick() }`

```js
import { registerLayout, defineG6Layout } from './topology/layouts/index.js'

registerLayout(
  defineG6Layout({
    id: 'g6-circular',
    name: 'G6 环形',
    order: 60,
    layout: async (nodes, edges) => {
      const { CircularLayout } = await import('@antv/layout')
      return new CircularLayout({ width: 1000, height: 1000 }).execute({ nodes, edges })
    },
    plane: 'xz',        // 二维 x/y -> 三维 x/z
    layerHeight: 46,    // node.layer 映射到高度
    scale: 0.6,         // 平面缩放
    center: true,       // 以包围盒中心对齐原点
  }),
)
```

`plane` 支持：

| plane | 映射 |
| --- | --- |
| `xz`（默认） | 布局 x → 三维 x，布局 y → 三维 z，`node.layer` → y |
| `xy` | 布局 x → 三维 x，布局 y → 三维 y，`node.layer` → z |
| `yz` | 布局 x → 三维 z，布局 y → 三维 y，`node.layer` → x |

也可以直接注册 G6 4.x 的布局对象：

```js
registerLayout(
  defineG6Layout({
    id: 'g6-ring',
    name: 'G6 环形',
    layout: {
      init(data) {
        this.nodes = data.nodes
      },
      execute() {
        this.nodes.forEach((node, index) => {
          const angle = (index / this.nodes.length) * Math.PI * 2
          node.x = Math.cos(angle) * 300
          node.y = Math.sin(angle) * 300
        })
      },
    },
  }),
)
```

## G6 分层 Combo（2.5D 透视）

`g6-combo-layer` 是 G6 页面专用的自研布局，把拓扑渲染成可拖拽的分层面板，节点直接放在层上：

```js
await loadGraph(data, {
  container: '#topo',
  engine: 'g6',
  layout: 'g6-combo-layer',
  layoutOptions: {
    perspective: true,   // 2.5D 透视开关
    farScale: 0.62,      // 最远层（最上方）缩放
    nearScale: 1.08,     // 最近层（最下方）缩放
    depthShiftX: 118,    // 远层向右偏移，形成斜向堆叠
    depthShiftY: 34,     // 远层向上偏移
    vanishingDistance: 0.6, // 灭点距离系数；所有梯形斜边汇聚到同一灭点
    topInsetSlope: 0.12, // 无灭点时的梯形斜率兜底
    layerGap: 92,        // 层间固定间距
    clusterGap: 44,      // 层内布局聚类间距（不渲染分组面板）
    nodeGap: 30,         // 节点间距
    layerPadding: [56, 60, 32, 60], // 左右略大于节点半宽，保证顶部节点不溢出斜边
  },
})

// 运行时开关 2.5D（不切换布局）
await view.setLayoutOptions({ perspective: false })

// 拖动 Combo / 节点后恢复分层
await view.relayout()

// 检查节点、层是否重叠
console.log(view.checkOverlaps()) // { ok: true, nodes: [], groups: [], layers: [] }
```

- 一级 Combo 按节点 `layer` 分层，节点直接挂在层上；`group` 只作为层内排布的聚类依据，
  不再生成二级分组面板；网络场景会把原始 `layer` 归并为「核心层 / 汇聚层 / 接入层」三层；
- 2.5D 开启时，层使用自定义 `combo-trapezoid`（顶窄底宽的梯形），
  所有梯形的斜边延长线都汇聚到同一个灭点（整体水平中心上方）；
- 透视缩放同时作用于节点尺寸、标签、间距与投影，布局计算与渲染尺寸一致；
- 节点阵列也按同一灭点分布：行宽随 `y` 递增（上窄下宽），顶部行的水平间距会先按压缩比放大，
  透视压缩后回落到正常间距，既保持梯形又不互相挤压；
- 布局阶段用 `src/g6/collision.js` 保证节点与层不重叠，渲染后再按 G6 真实包围盒兜底修正；
- 层之间用「位置 + keyShape 尺寸」的几何矩形判断碰撞（`_comboRectOf()`），
  节点用不含投影的稳定包围盒（`_stableBoundsOf()`）；梯形顶边的渲染外扩不会造成误判平移；
- 层尺寸不固定：拖动节点时按帧重算「包住全部子节点（含标签）」所需的最小 padding
  （`_growCombosForDraggedNode()`），层会随节点自动变宽变高；
- 需要的最小 padding 由梯形斜边的闭式解逐块求出（`_requiredSidePadding()`），
  只包住节点真实占位，不会因为包围盒的空白角把面板过度撑大；
- 松手后再按最终位置统一拟合一次（`_fitComboPaddings()`），并修正层之间的重叠；
- 其他布局即使生成 Combo 也会强制 `perspective: false`，不会被误缩放。

页面左侧的「2.5D 视图」按钮可一键开关该效果，状态记录在
`localStorage['topology-combo-depth-25d']`；关闭后回退为原生矩形 Combo 与 1:1 缩放。

完整参数、数据契约与碰撞机制见 **[Topology SDK 用户指南 · 6.5 分层 Combo 布局](docs/topology-sdk-guide.md#65-分层-combo-布局g6-combo-layer)**。

## 主题扩展

主题集中在 `src/topology/themes.js`：

- `SCENE_THEMES`：背景、雾、曝光、星空、网格、灯光、泛光参数
- `LAYER_THEMES`：链路颜色 / 混合模式、节点发光、机房地面、机柜、设备与灯带配色

切换流程：

1. `App.vue` 更新 `document.documentElement.dataset.theme`，CSS 变量与浅色覆盖生效。
2. `engine.setTheme(mode)` 更新 Three.js 场景、灯光、星空、网格、泛光。
3. `graph.js` / `datacenter.js` 的 `setTheme()` 重建材质与发光参数。
4. G6 画布保持透明，背景由 `.g6-host` 的 CSS 负责，主题切换不需要重建 Canvas。

当前选择写入 `localStorage['topology-theme']`，没有历史选择时跟随系统 `prefers-color-scheme`。新增主题只需：

```js
export const SCENE_THEMES = {
  dark: { /* ... */ },
  light: { /* ... */ },
  warm: { /* ... */ },   // 新增
}
```

再在 `setTheme()` 中允许 `warm` 模式，并补充 `[data-theme='warm']` CSS 变量即可。

## 其他扩展建议

- **新增场景**：在 `src/mock/data.js` 增加数据构造器，在 `SCENES` 注册，并在 `api` 中返回对应 `scene`。图数据可直接复用现有引擎。
- **新增节点形状**：`palette.js` 的 `TYPE_META` 增加 `shape`，`graph.js` 的 `shapeGeometry` 增加几何体。
- **性能**：当前实现面向 500 节点以内；更大规模建议将节点改为 `InstancedMesh`、力导向斥力改用空间网格 / Barnes-Hut，并将 CSS2D 标签改为按距离分级显示。
- **实时推送**：如需实时数据，可在业务层接入 WebSocket / SSE，收到消息后调用 `engine.updateData(payload)` / `updateGraph(payload)`，两者均支持无闪烁增量更新。

## 说明

- 三维引擎使用 Three.js 自研渲染管线；G6 5 既作为独立的二维渲染引擎，也通过 `defineG6Layout()` 为三维页面提供布局算法，不影响数据契约与 UI。
- 内置 Mock 数据仅用于开发演示；生产环境请配置 `VITE_API_BASE` 指向真实服务。
