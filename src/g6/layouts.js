/**
 * G6 5 布局注册中心（class 封装版）
 *
 * 每个布局都是一个 `G6LayoutDefinition` 子类实例，统一描述：
 * - id / type / name / icon / order / description
 * - options：布局默认参数
 * - combo：是否启用 Combo（自研分层布局为 true）
 * - resolveOptions(overrides)：合并默认参数与业务覆盖参数
 *
 * 页面左侧「布局类型」菜单直接渲染注册中心里的实例，
 * 新增布局只需实现一个子类并 register 即可。
 */

import {
  COMBO_LAYER_LAYOUT_ID,
  COMBO_LAYER_PRESET_OPTIONS,
} from './comboConfig.js'

/** 单个布局定义的基类 */
export class G6LayoutDefinition {
  constructor({
    id,
    type,
    name,
    icon = 'graph',
    order = 100,
    description = '',
    options = {},
    combo = false,
  } = {}) {
    if (!id) throw new Error('[g6] 布局定义必须包含 id')
    this.id = id
    this.type = type || id
    this.name = name || id
    this.icon = icon
    this.order = order
    this.description = description
    this.options = { ...options }
    this.combo = Boolean(combo)
  }

  /** 是否为 Combo 布局（分层 Combo 会启用 2.5D 透视与三级防重叠） */
  get isCombo() {
    return this.combo
  }

  /** 合并默认参数与业务传入的 layoutOptions */
  resolveOptions(overrides) {
    return {
      type: this.type,
      ...this.options,
      ...(overrides && typeof overrides === 'object' ? overrides : {}),
    }
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      icon: this.icon,
      order: this.order,
      description: this.description,
      options: { ...this.options },
      combo: this.combo,
    }
  }
}

/* ------------------------------ 内置布局子类 ------------------------------ */

export class G6ForceLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-force',
      type: 'd3-force',
      name: '力导向',
      icon: 'force',
      order: 10,
      description: 'G6 5 d3-force：按链路引力与节点斥力自然铺开',
      options: {
        link: { distance: 105, strength: 0.55 },
        manyBody: { strength: -320 },
        collide: { radius: 34, strength: 0.9 },
        centerStrength: 0.03,
        iterations: 320,
      },
    })
  }
}

export class G6ForceAtlas2Layout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-force-atlas2',
      type: 'force-atlas2',
      name: 'FA2',
      icon: 'activity',
      order: 20,
      description: 'G6 5 ForceAtlas2：社区结构更紧凑的力导向布局',
      options: {
        kr: 12,
        kg: 1.6,
        ks: 0.12,
        mode: 'normal',
        preventOverlap: true,
        nodeSize: 40,
        barnesHut: true,
        maxIteration: 320,
      },
    })
  }
}

export class G6DagreLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-dagre',
      type: 'dagre',
      name: '层次',
      icon: 'layers',
      order: 30,
      description: 'G6 5 Dagre：按边方向分层，适合网络层级与依赖关系',
      options: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 34,
        ranksep: 76,
        nodeSize: [56, 32],
      },
    })
  }
}

export class G6CircularLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-circular',
      type: 'circular',
      name: '环形',
      icon: 'globe',
      order: 40,
      description: 'G6 5 Circular：按拓扑 / 度数顺序环形排布',
      options: {
        radius: 250,
        ordering: 'degree',
        clockwise: true,
      },
    })
  }
}

export class G6ConcentricLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-concentric',
      type: 'concentric',
      name: '同心',
      icon: 'grid3d',
      order: 50,
      description: 'G6 5 Concentric：按度数分层同心圆，核心节点居中',
      options: {
        preventOverlap: true,
        nodeSize: 46,
        nodeSpacing: 12,
        sortBy: 'degree',
        startAngle: (3 / 2) * Math.PI,
        clockwise: true,
      },
    })
  }
}

export class G6GridLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-grid',
      type: 'grid',
      name: '网格',
      icon: 'grid3d',
      order: 60,
      description: 'G6 5 Grid：等距网格，适合机柜 / 设备清单',
      options: {
        preventOverlap: true,
        nodeSize: [72, 92],
        cols: 6,
        condense: false,
      },
    })
  }
}

export class G6RadialLayout extends G6LayoutDefinition {
  constructor() {
    super({
      id: 'g6-radial',
      type: 'radial',
      name: '径向',
      icon: 'focus',
      order: 70,
      description: 'G6 5 Radial：以核心节点为中心向外辐射',
      options: {
        focusNode: null,
        unitRadius: 105,
        linkDistance: 105,
        preventOverlap: true,
        nodeSize: 42,
        strictRadial: true,
      },
    })
  }
}

export class G6ComboLayerLayoutDefinition extends G6LayoutDefinition {
  constructor() {
    super({
      id: COMBO_LAYER_LAYOUT_ID,
      type: COMBO_LAYER_LAYOUT_ID,
      name: '分层 Combo',
      icon: 'layers',
      order: 80,
      description: '自研 2.5D 分层：按 layer 从上到下分层，节点直接放在层上，面板可拖拽',
      options: { ...COMBO_LAYER_PRESET_OPTIONS },
      combo: true,
    })
  }
}

/* ------------------------------ 注册中心 ------------------------------ */

export class G6LayoutRegistry {
  constructor(definitions = []) {
    this._definitions = new Map()
    definitions.forEach((definition) => this.register(definition))
  }

  /** 注册布局；传入普通对象时自动包装为 G6LayoutDefinition */
  register(definition) {
    const item =
      definition instanceof G6LayoutDefinition
        ? definition
        : new G6LayoutDefinition(definition)
    this._definitions.set(item.id, item)
    return item
  }

  unregister(id) {
    return this._definitions.delete(id)
  }

  get(id) {
    return this._definitions.get(id) || null
  }

  has(id) {
    return this._definitions.has(id)
  }

  /** 按 order 排序后的布局列表（左侧菜单直接使用） */
  list() {
    return [...this._definitions.values()].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name),
    )
  }

  get defaultId() {
    return this.list()[0]?.id || ''
  }

  resolveOptions(id, overrides) {
    const definition = this.get(id) || this.list()[0]
    return definition
      ? definition.resolveOptions(overrides)
      : { type: id, ...(overrides && typeof overrides === 'object' ? overrides : {}) }
  }
}

/** 全局 G6 布局注册中心 */
export const g6LayoutRegistry = new G6LayoutRegistry([
  new G6ForceLayout(),
  new G6ForceAtlas2Layout(),
  new G6DagreLayout(),
  new G6CircularLayout(),
  new G6ConcentricLayout(),
  new G6GridLayout(),
  new G6RadialLayout(),
  new G6ComboLayerLayoutDefinition(),
])

/** 兼容旧 API：布局实例数组 */
export const G6_LAYOUTS = g6LayoutRegistry.list()

export const G6_DEFAULT_LAYOUT = 'g6-force'

export function getG6LayoutPreset(id) {
  return g6LayoutRegistry.get(id) || g6LayoutRegistry.list()[0]
}

/** 合并预设参数 + 业务传入的 layoutOptions */
export function resolveG6LayoutOptions(id, overrides) {
  return g6LayoutRegistry.resolveOptions(id, overrides)
}
