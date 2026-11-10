/**
 * 内置示例数据（纯 JS，无任何浏览器/Node 依赖）
 * - 浏览器端作为 REST 不可用时的降级数据
 * - Vite 开发服务器通过 /api/topology 暴露为 Mock REST 接口
 */

export const SCENES = [
  { key: 'network', name: '网络拓扑', icon: 'network', desc: '企业园区网 / 广域网设备与链路' },
  { key: 'datacenter', name: '3D 机房', icon: 'datacenter', desc: '机柜、服务器与空间布局' },
  { key: 'graph', name: '知识图谱', icon: 'graph', desc: '技术栈与依赖关系网络' },
  { key: 'iot', name: '物联网', icon: 'iot', desc: '边云协同与物联设备拓扑' },
]

const BASE_TIME = new Date('2026-11-06T09:30:00+08:00').getTime()

function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickStatus(rnd, plan) {
  if (plan && plan.length) {
    const total = plan.reduce((sum, item) => sum + item[1], 0)
    let roll = rnd() * total
    for (const [status, weight] of plan) {
      roll -= weight
      if (roll <= 0) return status
    }
    return plan[0][0]
  }
  const roll = rnd()
  if (roll < 0.84) return 'ok'
  if (roll < 0.93) return 'warn'
  if (roll < 0.975) return 'error'
  if (roll < 0.99) return 'maintenance'
  return 'offline'
}

const STATUS_PLAN = [
  ['ok', 84],
  ['warn', 9],
  ['error', 4],
  ['maintenance', 2],
  ['offline', 1],
]

const STATUS_PLAN_STABLE = [
  ['ok', 92],
  ['warn', 5],
  ['error', 2],
  ['maintenance', 1],
]

function metrics(rnd, { cpu = 50, memory = 55, traffic = 200 } = {}) {
  return {
    cpu: Math.round(cpu + (rnd() - 0.5) * 38),
    memory: Math.round(memory + (rnd() - 0.5) * 30),
    traffic: Math.round(traffic + (rnd() - 0.5) * traffic * 0.6),
    latency: Math.round(2 + rnd() * 28),
    uptime: Math.round(30 + rnd() * 700),
  }
}

function ip(rnd, prefix = '10.10') {
  return `${prefix}.${Math.floor(rnd() * 12) + 1}.${Math.floor(rnd() * 250) + 2}`
}

/* ------------------------------------------------------------------ */
/* 场景一：企业网络拓扑                                                */
/* ------------------------------------------------------------------ */

function buildNetwork() {
  const rnd = mulberry32(0x3d70a1)
  const nodes = []
  const links = []

  const addNode = (id, name, type, layer, group, options = {}) => {
    const node = {
      id,
      name,
      type,
      layer,
      group,
      status: options.status || pickStatus(rnd, STATUS_PLAN),
      size: options.size,
      metrics: metrics(rnd, options.metrics),
      meta: {
        ip: options.ip || ip(rnd),
        location: options.location || ['A 栋 3F 机房', 'A 栋 4F 机房', 'B 栋 2F 机房'][Math.floor(rnd() * 3)],
        model: options.model || 'N/A',
        os: options.os || 'N/A',
      },
      tags: options.tags || [],
      description: options.description || `${name}，${group}层设备。`,
    }
    nodes.push(node)
    return node
  }

  addNode('internet', 'Internet 出口', 'cloud', 0, '边界出口', {
    status: 'ok',
    size: 4.6,
    ip: '203.0.113.10',
    location: '电信 + 联通双线',
    model: 'BGP 多线接入',
    metrics: { cpu: 20, memory: 30, traffic: 1800 },
    tags: ['双线', 'BGP'],
    description: '园区互联网出口，双运营商链路，BGP 动态选路。',
  })

  addNode('fw-01', '边界防火墙 FW-01', 'firewall', 1, '安全防护', {
    status: 'ok',
    size: 3.6,
    ip: '10.10.0.1',
    model: 'FortiGate 600F',
    os: 'FortiOS 7.4',
    tags: ['主用', 'HA'],
    description: '出口主防火墙，负责 NAT、IPS 与访问控制。',
  })
  addNode('fw-02', '边界防火墙 FW-02', 'firewall', 1, '安全防护', {
    status: 'warn',
    size: 3.6,
    ip: '10.10.0.2',
    model: 'FortiGate 600F',
    os: 'FortiOS 7.4',
    metrics: { cpu: 78, memory: 71, traffic: 1200 },
    tags: ['备机', 'HA'],
    description: '出口备防火墙，HA 心跳正常，CPU 持续偏高。',
  })

  addNode('core-01', '核心交换机 CORE-01', 'router', 2, '核心层', {
    status: 'ok',
    size: 4.2,
    ip: '10.10.1.1',
    model: 'Cisco Catalyst 9600',
    os: 'IOS-XE 17.12',
    metrics: { cpu: 34, memory: 48, traffic: 2600 },
    tags: ['核心', '堆叠'],
  })
  addNode('core-02', '核心交换机 CORE-02', 'router', 2, '核心层', {
    status: 'ok',
    size: 4.2,
    ip: '10.10.1.2',
    model: 'Cisco Catalyst 9600',
    os: 'IOS-XE 17.12',
    metrics: { cpu: 31, memory: 45, traffic: 2380 },
    tags: ['核心', '堆叠'],
  })

  const aggNames = ['行政楼汇聚', '研发楼汇聚', '生产楼汇聚', '访客区汇聚']
  aggNames.forEach((label, index) => {
    const id = `agg-0${index + 1}`
    addNode(id, `汇聚交换机 AGG-0${index + 1}`, 'switch', 3, '汇聚层', {
      status: index === 2 ? 'warn' : 'ok',
      size: 3.3,
      ip: `10.10.2.${index + 1}`,
      model: 'H3C S7506X',
      os: 'Comware 7.1',
      metrics: { cpu: index === 2 ? 82 : 46, memory: 52, traffic: 900 + index * 120 },
      tags: [label],
      description: `${label}汇聚交换机，双上行至核心。`,
    })
  })

  for (let i = 1; i <= 8; i += 1) {
    const id = `acc-0${i}`
    addNode(id, `接入交换机 ACC-0${i}`, 'switch', 4, '接入层', {
      status: i === 5 ? 'error' : i === 7 ? 'warn' : 'ok',
      size: 2.6,
      ip: `10.10.3.${i}`,
      model: 'H3C S5130',
      os: 'Comware 7.1',
      metrics: { cpu: i === 5 ? 94 : 38, memory: i === 5 ? 88 : 44, traffic: 120 + i * 18 },
      tags: ['PoE+'],
      description: `接入层交换机，为终端与服务器提供千兆接入。`,
    })
  }

  for (let i = 1; i <= 16; i += 1) {
    const number = String(i).padStart(2, '0')
    const forced =
      i === 11 ? 'offline' : i === 7 ? 'maintenance' : i === 3 ? 'warn' : null
    addNode(`srv-${number}`, `应用服务器 SRV-${number}`, 'server', 5, '计算资源', {
      status: forced || pickStatus(rnd, STATUS_PLAN_STABLE),
      size: 2.4,
      ip: `10.20.1.${i + 10}`,
      model: i % 4 === 0 ? 'Dell R760' : 'HPE DL380 Gen11',
      os: i % 3 === 0 ? 'Ubuntu 24.04' : 'Rocky Linux 9',
      metrics: { cpu: i === 3 ? 91 : 55, memory: 62, traffic: 320 },
      tags: i % 4 === 0 ? ['GPU', '推理'] : ['业务'],
      description: `业务应用服务器，运行内部服务与容器工作负载。`,
    })
  }

  addNode('db-01', '核心数据库 DB-01', 'database', 5, '存储资源', {
    status: 'ok',
    size: 3.2,
    ip: '10.20.2.11',
    model: 'PostgreSQL 16 / 主库',
    os: 'Debian 12',
    metrics: { cpu: 48, memory: 74, traffic: 680 },
    tags: ['主库', 'PITR'],
    description: '核心业务主数据库，流复制至 DB-02。',
  })
  addNode('db-02', '核心数据库 DB-02', 'database', 5, '存储资源', {
    status: 'warn',
    size: 3.2,
    ip: '10.20.2.12',
    model: 'PostgreSQL 16 / 从库',
    os: 'Debian 12',
    metrics: { cpu: 62, memory: 81, traffic: 540 },
    tags: ['从库', '只读'],
    description: '核心业务只读从库，复制延迟偶发升高。',
  })

  for (let i = 1; i <= 6; i += 1) {
    addNode(`pc-0${i}`, `办公终端 PC-0${i}`, 'pc', 6, '办公终端', {
      status: i === 6 ? 'offline' : 'ok',
      size: 1.8,
      ip: `10.30.1.${20 + i}`,
      location: `${['行政部', '研发部', '产品部'][i % 3]} · ${i}F`,
      model: 'ThinkCentre M90q',
      os: 'Windows 11',
      metrics: { cpu: 22, memory: 46, traffic: 24 },
      tags: ['有线'],
    })
  }

  const addLink = (source, target, options = {}) => {
    links.push({
      id: `net-l${links.length + 1}`,
      source,
      target,
      type: options.type || 'fiber',
      status: options.status || (rnd() < 0.94 ? 'ok' : 'warn'),
      bandwidth: options.bandwidth || [1000, 10000, 25000][Math.floor(rnd() * 3)],
      traffic: Math.round(80 + rnd() * 1400),
      latency: Math.round(1 + rnd() * 12),
    })
  }

  addLink('internet', 'fw-01', { bandwidth: 10000 })
  addLink('internet', 'fw-02', { bandwidth: 10000 })
  addLink('fw-01', 'core-01', { bandwidth: 25000 })
  addLink('fw-02', 'core-02', { bandwidth: 25000 })
  addLink('fw-01', 'core-02', { status: 'warn', bandwidth: 10000 })
  addLink('core-01', 'core-02', { bandwidth: 100000, type: 'stack' })

  addLink('core-01', 'agg-01', { bandwidth: 25000 })
  addLink('core-01', 'agg-02', { bandwidth: 25000 })
  addLink('core-02', 'agg-03', { status: 'warn', bandwidth: 25000 })
  addLink('core-02', 'agg-04', { bandwidth: 25000 })
  addLink('core-01', 'agg-03', { bandwidth: 10000 })
  addLink('core-02', 'agg-02', { bandwidth: 10000 })

  const aggTargets = ['agg-01', 'agg-02', 'agg-03', 'agg-04']
  const accessList = Array.from({ length: 8 }, (_, i) => `acc-0${i + 1}`)
  accessList.forEach((acc, index) => {
    addLink(aggTargets[Math.floor(index / 2)], acc, { bandwidth: 1000 })
  })

  const serverList = Array.from({ length: 16 }, (_, i) => `srv-${String(i + 1).padStart(2, '0')}`)
  serverList.forEach((srv, index) => {
    const acc = accessList[index % 8]
    addLink(acc, srv, { bandwidth: 1000, type: 'copper' })
  })

  addLink('acc-01', 'db-01', { bandwidth: 10000 })
  addLink('acc-02', 'db-02', { bandwidth: 10000 })
  addLink('db-01', 'db-02', { bandwidth: 10000, type: 'replication' })
  addLink('srv-01', 'db-01', { bandwidth: 10000 })
  addLink('srv-02', 'db-01', { bandwidth: 10000 })
  addLink('srv-04', 'db-02', { bandwidth: 10000 })
  addLink('srv-08', 'db-02', { bandwidth: 10000, type: 'replication' })

  for (let i = 0; i < 6; i += 1) {
    addLink(`acc-0${(i % 8) + 1}`, `pc-0${i + 1}`, { bandwidth: 1000, type: 'copper' })
  }

  attachNetworkSubgraphs(nodes)

  return apiPayload('network', '企业网络拓扑', 'status', nodes, links, {
    subtitle: '园区网 · 41 节点 / 49 链路',
  })
}

/**
 * 为部分网络节点挂载子拓扑，演示「聚合 → 下钻 → 再下钻」。
 *
 * 子图结构与主数据完全一致（meta / nodes / links），
 * 因此可以直接被 normalizeTopology、聚合、diff 等数据层函数复用。
 */
function attachNetworkSubgraphs(nodes) {
  const child = (id, name, type, status, extra = {}) => ({
    id,
    name,
    type,
    status,
    layer: extra.layer ?? 0,
    group: extra.group || '核心层',
    size: extra.size || 2.2,
    metrics: extra.metrics || {
      cpu: Math.round(20 + Math.random() * 55),
      memory: Math.round(30 + Math.random() * 45),
      traffic: Math.round(40 + Math.random() * 600),
    },
    meta: extra.meta || {},
    tags: extra.tags || [],
    description: extra.description || '',
  })

  const byId = new Map(nodes.map((node) => [node.id, node]))

  // 二级下钻：核心交换机 -> 业务板卡 -> 端口
  const slotPorts = {
    meta: {
      name: '核心交换机 CORE-01 · 板卡 1 端口',
      subtitle: '下钻层级 2 · 端口状态',
    },
    nodes: Array.from({ length: 8 }, (_, index) =>
      child(`core-01-slot1-p${index + 1}`, `Te1/1/${index + 1}`, 'switch', index === 5 ? 'error' : 'ok', {
        group: '端口',
        size: 1.5,
        tags: ['25G'],
        description: `板卡 1 第 ${index + 1} 个 25G 端口。`,
      }),
    ),
    links: [],
  }
  for (let i = 1; i < slotPorts.nodes.length; i += 1) {
    slotPorts.links.push({
      id: `core01-slot1-p-l${i}`,
      source: slotPorts.nodes[0].id,
      target: slotPorts.nodes[i].id,
      type: 'fiber',
      status: 'ok',
      bandwidth: 25000,
      traffic: Math.round(100 + Math.random() * 900),
      latency: 1,
    })
  }

  const coreSubgraph = {
    meta: {
      name: '核心交换机 CORE-01 · 板卡视图',
      subtitle: '下钻层级 1 · 板卡 / 电源 / 风扇',
    },
    nodes: [
      child('core-01-slot1', '业务板卡 SLOT-1', 'switch', 'warn', {
        group: '板卡',
        size: 2.6,
        tags: ['48x25G'],
        description: '48 口 25G 业务板卡，端口 6 出现 CRC 错误。',
        subgraph: slotPorts,
      }),
      child('core-01-slot2', '业务板卡 SLOT-2', 'switch', 'ok', {
        group: '板卡',
        size: 2.6,
        tags: ['48x25G'],
      }),
      child('core-01-slot3', '上行板卡 SLOT-3', 'router', 'ok', {
        group: '板卡',
        size: 2.6,
        tags: ['8x100G'],
      }),
      child('core-01-psu1', '电源模块 PSU-1', 'server', 'ok', {
        group: '供电',
        size: 1.9,
        tags: ['1600W'],
      }),
      child('core-01-psu2', '电源模块 PSU-2', 'server', 'ok', {
        group: '供电',
        size: 1.9,
        tags: ['1600W'],
      }),
      child('core-01-fan1', '风扇模块 FAN-1', 'server', 'ok', {
        group: '散热',
        size: 1.7,
        tags: ['热插拔'],
      }),
    ],
    links: [
      { id: 'core01-l1', source: 'core-01-slot1', target: 'core-01-slot2', type: 'stack', status: 'ok', bandwidth: 100000, traffic: 3200, latency: 1 },
      { id: 'core01-l2', source: 'core-01-slot2', target: 'core-01-slot3', type: 'stack', status: 'ok', bandwidth: 100000, traffic: 2800, latency: 1 },
      { id: 'core01-l3', source: 'core-01-psu1', target: 'core-01-slot1', type: 'power', status: 'ok', bandwidth: 0, traffic: 0, latency: 0 },
      { id: 'core01-l4', source: 'core-01-psu2', target: 'core-01-slot2', type: 'power', status: 'ok', bandwidth: 0, traffic: 0, latency: 0 },
      { id: 'core01-l5', source: 'core-01-fan1', target: 'core-01-slot3', type: 'cooling', status: 'ok', bandwidth: 0, traffic: 0, latency: 0 },
    ],
  }

  const aggSubgraph = {
    meta: {
      name: '汇聚交换机 AGG-01 · 接入设备',
      subtitle: '下钻层级 1 · 双上行接入交换机',
    },
    nodes: [
      child('agg-01-acc1', '接入交换机 ACC-01A', 'switch', 'ok', {
        group: '接入层',
        size: 2.2,
        tags: ['PoE+'],
        description: '行政楼 1F 接入交换机。',
      }),
      child('agg-01-acc2', '接入交换机 ACC-01B', 'switch', 'warn', {
        group: '接入层',
        size: 2.2,
        tags: ['PoE+'],
        description: '行政楼 2F 接入交换机，端口拥塞。',
      }),
      child('agg-01-acc3', '接入交换机 ACC-01C', 'switch', 'ok', {
        group: '接入层',
        size: 2.2,
        tags: ['PoE+'],
        description: '行政楼 3F 接入交换机。',
      }),
    ],
    links: [
      { id: 'agg01-l1', source: 'agg-01-acc1', target: 'agg-01-acc2', type: 'fiber', status: 'ok', bandwidth: 10000, traffic: 600, latency: 2 },
      { id: 'agg01-l2', source: 'agg-01-acc2', target: 'agg-01-acc3', type: 'fiber', status: 'warn', bandwidth: 10000, traffic: 880, latency: 4 },
    ],
  }

  const serverSubgraph = {
    meta: {
      name: '应用服务器 SRV-01 · 容器视图',
      subtitle: '下钻层级 1 · Pod 与依赖服务',
    },
    nodes: [
      child('srv-01-pod-api', 'Pod · topology-api', 'server', 'ok', {
        group: '容器',
        size: 1.9,
        tags: ['node:20', '2/2'],
        description: '拓扑查询 API 容器组。',
      }),
      child('srv-01-pod-web', 'Pod · topology-web', 'server', 'ok', {
        group: '容器',
        size: 1.9,
        tags: ['nginx', '2/2'],
        description: '静态资源与反向代理容器组。',
      }),
      child('srv-01-cache', 'Redis 实例', 'database', 'warn', {
        group: '依赖',
        size: 1.8,
        metrics: { cpu: 42, memory: 88, traffic: 260 },
        tags: ['6.2'],
        description: '本地缓存实例，内存使用率偏高。',
      }),
      child('srv-01-sidecar', 'Sidecar 代理', 'gateway', 'ok', {
        group: '容器',
        size: 1.6,
        tags: ['envoy'],
        description: '服务网格 Sidecar。',
      }),
    ],
    links: [
      { id: 'srv01-l1', source: 'srv-01-pod-web', target: 'srv-01-pod-api', type: 'copper', status: 'ok', bandwidth: 1000, traffic: 210, latency: 1 },
      { id: 'srv01-l2', source: 'srv-01-pod-api', target: 'srv-01-cache', type: 'copper', status: 'warn', bandwidth: 1000, traffic: 460, latency: 3 },
      { id: 'srv01-l3', source: 'srv-01-pod-api', target: 'srv-01-sidecar', type: 'copper', status: 'ok', bandwidth: 1000, traffic: 120, latency: 1 },
    ],
  }

  const mapping = {
    'core-01': coreSubgraph,
    'agg-01': aggSubgraph,
    'srv-01': serverSubgraph,
  }

  for (const [id, subgraph] of Object.entries(mapping)) {
    const node = byId.get(id)
    if (node) node.subgraph = subgraph
  }
}

/* ------------------------------------------------------------------ */
/* 场景二：3D 机房                                                     */
/* ------------------------------------------------------------------ */

function buildDataCenter() {
  const rnd = mulberry32(0x0dc2026)
  const rows = [
    { id: 'row-a', name: 'A 区', z: -16 },
    { id: 'row-b', name: 'B 区', z: 0 },
    { id: 'row-c', name: 'C 区', z: 16 },
  ]
  const racks = []
  const deviceTypes = ['server', 'server', 'server', 'storage', 'switch', 'firewall']

  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < 4; i += 1) {
      const rackId = `rack-${String.fromCharCode(97 + rowIndex)}${i + 1}`
      const devices = []
      let u = 2
      const count = 8 + Math.floor(rnd() * 6)
      for (let d = 0; d < count; d += 1) {
        const type = deviceTypes[Math.floor(rnd() * deviceTypes.length)]
        const height = type === 'storage' ? 4 : type === 'switch' || type === 'firewall' ? 1 : 2
        if (u + height > 42) break
        const status = pickStatus(rnd, STATUS_PLAN_STABLE)
        devices.push({
          id: `${rackId}-d${d + 1}`,
          name: `${['应用节点', '数据节点', '存储节点', '交换模块', '安全模块'][Math.floor(rnd() * 5)]}-${String(d + 1).padStart(2, '0')}`,
          type,
          status,
          u,
          height,
          power: Math.round(180 + rnd() * 420),
          temperature: Math.round((21 + rnd() * 9) * 10) / 10,
          model: type === 'storage' ? 'OceanStor 5310' : type === 'switch' ? 'CE6881' : 'RH2288 V6',
        })
        u += height + 1
      }
      const worst = devices.some((d) => d.status === 'error')
        ? 'error'
        : devices.some((d) => d.status === 'warn')
          ? 'warn'
          : devices.some((d) => d.status === 'maintenance')
            ? 'maintenance'
            : 'ok'
      racks.push({
        id: rackId,
        name: `${row.name}-第 ${i + 1} 列`,
        row: row.name,
        rowId: row.id,
        x: (i - 1.5) * 8,
        z: row.z,
        status: worst,
        temperature: Math.round((20 + rnd() * 10) * 10) / 10,
        power: Math.round(3 + rnd() * 6.4),
        capacity: 42,
        usedU: u - 1,
        devices,
      })
    }
  })

  const totalDevices = racks.reduce((sum, r) => sum + r.devices.length, 0)
  const totalPower = racks.reduce((sum, r) => sum + r.power, 0)
  const avgTemp = racks.reduce((sum, r) => sum + r.temperature, 0) / racks.length
  const alerts = racks.filter((r) => r.status !== 'ok').length

  return {
    meta: {
      scene: 'datacenter',
      name: '3D 数据中心机房',
      subtitle: 'A/B/C 三区 · 12 机柜',
      colorMode: 'status',
      generatedAt: new Date(BASE_TIME).toISOString(),
    },
    rows,
    racks,
    summary: {
      racks: racks.length,
      devices: totalDevices,
      power: Math.round(totalPower * 10) / 10,
      avgTemperature: Math.round(avgTemp * 10) / 10,
      alerts,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 场景三：知识图谱                                                    */
/* ------------------------------------------------------------------ */

function buildGraph() {
  const rnd = mulberry32(0x6a3f19)
  const groups = [
    { key: 'frontend', name: '表现层', color: '#38bdf8', layer: 0 },
    { key: 'engine', name: '三维引擎', color: '#8b5cf6', layer: 1 },
    { key: 'data', name: '数据接入', color: '#22d3a6', layer: 2 },
    { key: 'backend', name: '服务端', color: '#f59e0b', layer: 3 },
    { key: 'ops', name: '可观测性', color: '#f472b6', layer: 4 },
  ]

  const definitions = [
    ['vue', 'Vue 3', 'frontend', 5.2, '渐进式前端框架，承载整个拓扑工作台。'],
    ['vite', 'Vite', 'frontend', 4.2, '开发与构建工具，提供秒级热更新。'],
    ['pinia', 'Pinia', 'frontend', 3.2, '状态管理，保存场景、筛选与选中态。'],
    ['router', 'Vue Router', 'frontend', 3.0, '多页面路由与场景切换。'],
    ['echarts', 'ECharts', 'frontend', 4.0, '状态分布与类型统计图表。'],
    ['three', 'Three.js', 'frontend', 5.6, 'WebGL 三维渲染内核。'],
    ['css2d', 'CSS2DRenderer', 'frontend', 3.0, '节点标签的 DOM 叠加渲染。'],
    ['uikit', 'UI 组件层', 'frontend', 3.4, '深色玻璃拟态面板与交互控件。'],

    ['webgl', 'WebGL 2', 'engine', 4.6, '浏览器端 GPU 渲染能力。'],
    ['glsl', 'GLSL 着色器', 'engine', 4.2, '链路流光与粒子效果的实现基础。'],
    ['bloom', 'UnrealBloom', 'engine', 3.6, '泛光后处理，强化科技感。'],
    ['raycaster', 'Raycaster', 'engine', 3.2, '鼠标拾取节点与机柜。'],
    ['orbit', 'OrbitControls', 'engine', 3.2, '轨道相机控制器。'],
    ['force', '力导向布局', 'engine', 4.4, '三维斥力/弹簧迭代，自适应成团。'],
    ['layered', '分层布局', 'engine', 3.8, '按网络层级自上而下排布。'],
    ['sphere', '球面布局', 'engine', 3.2, '斐波那契球面均匀散布。'],

    ['rest', 'REST API', 'data', 4.6, '拓扑数据的主接入方式。'],
    ['schema', 'JSON Schema', 'data', 3.2, '节点与链路的字段契约。'],
    ['poll', '增量轮询', 'data', 3.4, '定时拉取状态与流量指标。'],
    ['normalize', '数据归一化', 'data', 3.6, '兼容多种后端字段命名。'],
    ['mock', 'Mock 服务', 'data', 3.0, '开发期接口与降级数据。'],
    ['ws', 'WebSocket 扩展', 'data', 2.8, '推送实时告警与状态变化。'],

    ['node', 'Node.js', 'backend', 4.0, '轻量 BFF 与接口聚合。'],
    ['spring', 'Spring Boot', 'backend', 4.0, '企业内网拓扑服务。'],
    ['pg', 'PostgreSQL', 'backend', 4.0, '拓扑与指标存储。'],
    ['redis', 'Redis', 'backend', 3.2, '状态缓存与热点数据。'],
    ['nginx', 'Nginx', 'backend', 3.0, '静态资源与反向代理。'],
    ['docker', 'Docker', 'backend', 3.4, '服务容器化交付。'],
    ['k8s', 'Kubernetes', 'backend', 4.2, '弹性伸缩与编排。'],

    ['prom', 'Prometheus', 'ops', 3.8, '指标采集与时序存储。'],
    ['grafana', 'Grafana', 'ops', 3.2, '监控看板与告警可视化。'],
    ['tracing', '链路追踪', 'ops', 3.0, '定位跨服务调用瓶颈。'],
    ['alert', '告警中心', 'ops', 3.4, '阈值规则与通知分发。'],
    ['log', '日志平台', 'ops', 2.8, '集中检索与审计。'],
  ]

  const nodes = definitions.map(([id, name, groupKey, size, description]) => {
    const group = groups.find((g) => g.key === groupKey)
    return {
      id,
      name,
      type: 'concept',
      layer: group.layer,
      group: group.name,
      color: group.color,
      status: ['tracing', 'alert'].includes(id) ? 'warn' : 'ok',
      size,
      weight: size,
      metrics: {
        cpu: Math.round(10 + rnd() * 60),
        memory: Math.round(20 + rnd() * 50),
        traffic: Math.round(20 + rnd() * 300),
        latency: Math.round(2 + rnd() * 18),
        uptime: Math.round(60 + rnd() * 300),
      },
      meta: {
        category: group.name,
        stage: ['调研', '使用中', '已上线'][Math.floor(rnd() * 3)],
        owner: ['架构组', '前端组', '平台组'][Math.floor(rnd() * 3)],
      },
      tags: [group.name],
      description,
    }
  })

  const pairs = [
    ['vue', 'vite'], ['vue', 'pinia'], ['vue', 'router'], ['vue', 'echarts'], ['vue', 'three'],
    ['vue', 'uikit'], ['uikit', 'css2d'], ['three', 'webgl'], ['webgl', 'glsl'],
    ['three', 'bloom'], ['three', 'raycaster'], ['three', 'orbit'], ['three', 'force'],
    ['three', 'layered'], ['three', 'sphere'], ['three', 'css2d'], ['echarts', 'uikit'],
    ['rest', 'schema'], ['rest', 'poll'], ['rest', 'normalize'], ['normalize', 'mock'],
    ['normalize', 'three'], ['poll', 'rest'], ['ws', 'rest'], ['schema', 'normalize'],
    ['node', 'rest'], ['spring', 'rest'], ['node', 'pg'], ['spring', 'pg'], ['node', 'redis'],
    ['docker', 'nginx'], ['k8s', 'docker'], ['k8s', 'node'], ['k8s', 'spring'], ['nginx', 'node'],
    ['prom', 'k8s'], ['grafana', 'prom'], ['alert', 'prom'], ['tracing', 'node'],
    ['log', 'k8s'], ['grafana', 'alert'], ['tracing', 'log'], ['echarts', 'prom'],
    ['force', 'glsl'], ['bloom', 'glsl'], ['three', 'rest'], ['uikit', 'echarts'],
  ]

  const links = pairs.map(([source, target], index) => ({
    id: `graph-l${index + 1}`,
    source,
    target,
    type: index % 5 === 0 ? 'dependency' : 'relation',
    status: index === 21 ? 'warn' : 'ok',
    bandwidth: 0,
    traffic: 0,
    latency: 0,
  }))

  return apiPayload('graph', '技术栈知识图谱', 'group', nodes, links, {
    subtitle: '34 节点 / 47 关系',
  })
}

/* ------------------------------------------------------------------ */
/* 场景四：物联网                                                      */
/* ------------------------------------------------------------------ */

function buildIot() {
  const rnd = mulberry32(0x10a2026)
  const nodes = []
  const links = []

  const add = (id, name, type, layer, group, options = {}) => {
    nodes.push({
      id,
      name,
      type,
      layer,
      group,
      status: options.status || pickStatus(rnd, STATUS_PLAN),
      size: options.size,
      metrics: {
        cpu: Math.round(10 + rnd() * 55),
        memory: Math.round(18 + rnd() * 50),
        traffic: Math.round(2 + rnd() * 120),
        latency: Math.round(4 + rnd() * 70),
        uptime: Math.round(5 + rnd() * 200),
      },
      meta: {
        ip: options.ip || `172.16.${Math.floor(rnd() * 8) + 1}.${Math.floor(rnd() * 240) + 5}`,
        location: options.location || `园区 ${['1 号楼', '2 号楼', '3 号楼'][Math.floor(rnd() * 3)]} · ${Math.floor(rnd() * 5) + 1}F`,
        model: options.model || 'IoT Device',
        firmware: options.firmware || `v${Math.floor(rnd() * 3) + 1}.${Math.floor(rnd() * 9)}.${Math.floor(rnd() * 9)}`,
      },
      tags: options.tags || [],
      description: options.description || `${group}设备，接入园区物联网平台。`,
    })
  }

  add('iot-cloud', '物联网云平台', 'cloud', 0, '云平台', {
    status: 'ok',
    size: 4.8,
    ip: '47.96.12.34',
    location: '公有云 · 华东 1',
    model: 'IoT Hub',
    tags: ['MQTT', '多租户'],
    description: '统一设备接入、影子模型与规则引擎。',
  })
  add('edge-01', '边缘节点 EDGE-01', 'edge', 1, '边缘层', {
    status: 'ok',
    size: 3.6,
    ip: '172.16.0.11',
    model: 'EdgeGateway X5',
    tags: ['本地推理'],
    description: '园区边缘计算节点，负责协议转换与断网续传。',
  })
  add('edge-02', '边缘节点 EDGE-02', 'edge', 1, '边缘层', {
    status: 'warn',
    size: 3.6,
    ip: '172.16.0.12',
    model: 'EdgeGateway X5',
    tags: ['冷备'],
    description: '边缘备用节点，磁盘使用率接近阈值。',
  })

  const gateways = [
    ['gw-01', '1 号楼网关', '园区 1 号楼'],
    ['gw-02', '2 号楼网关', '园区 2 号楼'],
    ['gw-03', '3 号楼网关', '园区 3 号楼'],
    ['gw-04', '地下车库网关', '地下车库 B1'],
  ]
  gateways.forEach(([id, name, location], index) => {
    add(id, name, 'gateway', 2, '网关层', {
      status: index === 3 ? 'warn' : 'ok',
      size: 2.9,
      location,
      model: 'GW-4000',
      tags: ['LoRa', 'Modbus'],
    })
  })

  const sensorGroups = [
    ['env', '环境监测', 'sensor', ['温湿度', 'PM2.5', 'CO₂', '噪声'], 8],
    ['security', '安防感知', 'camera', ['枪机', '球机', '门禁', '烟感'], 8],
    ['energy', '能源计量', 'meter', ['电表', '水表', '空压表'], 5],
    ['control', '执行控制', 'controller', ['空调', '照明', '水泵'], 4],
  ]

  sensorGroups.forEach(([prefix, group, type, labels, count]) => {
    for (let i = 0; i < count; i += 1) {
      const label = labels[i % labels.length]
      add(`${prefix}-${i + 1}`, `${label} ${String(i + 1).padStart(2, '0')}`, type, 3, group, {
        status: i === 5 && prefix === 'env' ? 'error' : i === 2 && prefix === 'security' ? 'warn' : pickStatus(rnd, STATUS_PLAN_STABLE),
        size: type === 'camera' ? 2.0 : type === 'meter' ? 2.0 : type === 'controller' ? 2.2 : 1.8,
        model: type === 'camera' ? 'IPC-H265' : type === 'meter' ? 'DTSD-1352' : type === 'controller' ? 'CTRL-8' : 'ENV-S2',
        tags: [label],
        description: `${group} · ${label}，通过 ${type === 'camera' ? 'RTSP / ONVIF' : 'MQTT'} 上报数据。`,
      })
    }
  })

  const addLink = (source, target, options = {}) => {
    links.push({
      id: `iot-l${links.length + 1}`,
      source,
      target,
      type: options.type || (rnd() < 0.6 ? 'wireless' : 'fiber'),
      status: options.status || 'ok',
      bandwidth: options.bandwidth || [10, 100, 1000][Math.floor(rnd() * 3)],
      traffic: Math.round(1 + rnd() * 90),
      latency: Math.round(3 + rnd() * 40),
    })
  }

  addLink('iot-cloud', 'edge-01', { type: 'fiber', bandwidth: 1000 })
  addLink('iot-cloud', 'edge-02', { type: 'fiber', bandwidth: 1000, status: 'warn' })
  addLink('edge-01', 'edge-02', { type: 'fiber', bandwidth: 1000 })

  gateways.forEach(([id], index) => {
    addLink(index < 2 ? 'edge-01' : 'edge-02', id, { bandwidth: 1000 })
  })
  addLink('gw-01', 'gw-02', { type: 'fiber', bandwidth: 1000 })
  addLink('gw-02', 'gw-03', { type: 'fiber', bandwidth: 1000 })

  const gatewayFor = (index) => gateways[index % gateways.length][0]
  let sensorIndex = 0
  for (const node of nodes) {
    if (!['sensor', 'camera', 'meter', 'controller'].includes(node.type)) continue
    addLink(gatewayFor(sensorIndex), node.id, {
      type: node.type === 'camera' ? 'fiber' : 'wireless',
      bandwidth: node.type === 'camera' ? 1000 : 100,
      status: node.status === 'offline' ? 'warn' : 'ok',
    })
    sensorIndex += 1
  }

  // 传感器之间的联动（烟感 -> 空调 / 门禁）
  addLink('security-4', 'control-1', { type: 'wireless', bandwidth: 10 })
  addLink('security-3', 'control-2', { type: 'wireless', bandwidth: 10 })

  return apiPayload('iot', '园区物联网拓扑', 'status', nodes, links, {
    subtitle: '32 节点 / 36 链路',
  })
}

/* ------------------------------------------------------------------ */

function apiPayload(scene, name, colorMode, nodes, links, extra = {}) {
  const counts = { ok: 0, warn: 0, error: 0, offline: 0, maintenance: 0 }
  nodes.forEach((node) => {
    counts[node.status] = (counts[node.status] || 0) + 1
  })
  return {
    meta: {
      scene,
      name,
      subtitle: extra.subtitle || '',
      colorMode,
      generatedAt: new Date(BASE_TIME).toISOString(),
    },
    nodes,
    links,
    summary: {
      nodes: nodes.length,
      links: links.length,
      ...counts,
    },
  }
}

const BUILDERS = {
  network: buildNetwork,
  datacenter: buildDataCenter,
  graph: buildGraph,
  iot: buildIot,
}

const CACHE = new Map()

export function getMockTopology(sceneKey = 'network') {
  const key = BUILDERS[sceneKey] ? sceneKey : 'network'
  if (!CACHE.has(key)) CACHE.set(key, BUILDERS[key]())
  return structuredClone(CACHE.get(key))
}

/** 模拟实时变化：状态抖动 + 指标漂移，用于轮询演示 */
export function jitterTopology(payload) {
  const data = structuredClone(payload)
  const drift = (value, range = 12, min = 1, max = 99) =>
    Math.max(min, Math.min(max, Math.round(value + (Math.random() - 0.5) * range)))

  const statuses = ['ok', 'ok', 'ok', 'ok', 'warn', 'error']

  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) {
      if (!node.metrics) continue
      node.metrics.cpu = drift(node.metrics.cpu, 16, 5, 98)
      node.metrics.memory = drift(node.metrics.memory, 8, 10, 96)
      node.metrics.traffic = drift(node.metrics.traffic, node.metrics.traffic * 0.25, 1, 99999)
      node.metrics.latency = drift(node.metrics.latency, 6, 1, 120)
      if (Math.random() < 0.006) {
        node.status = statuses[Math.floor(Math.random() * statuses.length)]
      }
    }
  }

  if (Array.isArray(data.racks)) {
    for (const rack of data.racks) {
      rack.temperature = Math.round((rack.temperature + (Math.random() - 0.5) * 0.8) * 10) / 10
      rack.power = Math.round((rack.power + (Math.random() - 0.5) * 0.6) * 10) / 10
      for (const device of rack.devices) {
        device.temperature = Math.round((device.temperature + (Math.random() - 0.5) * 0.6) * 10) / 10
        if (Math.random() < 0.004) {
          device.status = statuses[Math.floor(Math.random() * statuses.length)]
        }
      }
    }
  }

  if (data.meta) data.meta.generatedAt = new Date().toISOString()
  if (data.summary) data.summary.updatedAt = new Date().toISOString()
  return data
}

export function getSceneMeta(sceneKey) {
  return SCENES.find((item) => item.key === sceneKey) || SCENES[0]
}
