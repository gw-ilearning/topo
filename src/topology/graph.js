import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { getLayout, snapNodes } from './layouts/index.js'
import { spherePoints } from './layouts/sphere.js'
import { LAYER_THEMES } from './themes.js'
import { hashColor, nodeShape, statusColor } from './palette.js'

const SEGMENTS = 16

const GEOMETRY = {}
function shapeGeometry(shape) {
  if (GEOMETRY[shape]) return GEOMETRY[shape]
  let geometry
  switch (shape) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5)
      break
    case 'boxSmall':
      geometry = new THREE.BoxGeometry(1.1, 1.1, 1.1)
      break
    case 'octa':
      geometry = new THREE.OctahedronGeometry(1.15, 0)
      break
    case 'shield':
      geometry = new THREE.DodecahedronGeometry(1.05, 0)
      break
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.82, 0.82, 1.7, 20)
      break
    case 'tetra':
      geometry = new THREE.TetrahedronGeometry(1.15, 0)
      break
    case 'cone':
      geometry = new THREE.ConeGeometry(0.92, 1.8, 18)
      break
    case 'sphere':
      geometry = new THREE.SphereGeometry(1, 28, 20)
      break
    case 'icosa':
    default:
      geometry = new THREE.IcosahedronGeometry(1.1, 0)
      break
  }
  GEOMETRY[shape] = geometry
  return geometry
}

const glowCanvas = (() => {
  let texture = null
  return () => {
    if (texture) return texture
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.65)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.16)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
})()

const ringCanvas = (() => {
  let texture = null
  return () => {
    if (texture) return texture
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 4
    ctx.shadowColor = 'rgba(255,255,255,0.9)'
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(80, 80, 62, 0, Math.PI * 2)
    ctx.stroke()
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
})()

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[char]
  })

function linkColor(status, theme = 'dark') {
  const palette = LAYER_THEMES[theme] || LAYER_THEMES.dark
  if (status === 'warn') return palette.linkWarn
  if (status === 'error') return palette.linkError
  if (status === 'maintenance') return palette.linkMaintenance
  if (status === 'offline') return palette.linkOffline
  return palette.linkOk
}

/**
 * 拓扑图图层：节点、链路、布局、拾取与状态高亮
 */
export class GraphLayer {
  constructor() {
    this.object = new THREE.Group()
    this.object.name = 'graph-layer'

    this.nodes = []
    this.links = []
    this.nodeById = new Map()
    this.adjacency = new Map()

    this.raw = null
    this.colorMode = 'status'
    this.theme = 'dark'
    this.layoutId = 'force'
    this.layoutMode = 'iterative'
    this.layoutInstance = null
    this._pendingInstant = false
    this.statusFilter = null
    this.focusId = null
    this.hoverId = null
    this.showLabels = true
    this.targets = null
    this.time = 0

    this.linkGeometry = null
    this.linkMaterial = null
    this.linkPositions = null
    this.linkColorAttr = null
    this.linkFocusAttr = null

    this._disposed = false
  }

  /* ------------------------------ 数据 ------------------------------ */

  setData(raw, { preservePositions = false } = {}) {
    const previous = new Map()
    if (preservePositions) {
      for (const node of this.nodes) {
        previous.set(node.id, { x: node.x, y: node.y, z: node.z, vx: node.vx, vy: node.vy, vz: node.vz })
      }
    }

    this._clear()
    this.raw = raw
    this.colorMode = raw?.meta?.colorMode === 'group' ? 'group' : 'status'

    const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : []
    const rawLinks = Array.isArray(raw?.links) ? raw.links : []
    const nodeIds = new Set(rawNodes.map((node) => String(node.id)))

    const degree = new Map()
    const validLinks = rawLinks
      .map((link) => {
        const source = typeof link.source === 'object' ? link.source?.id : link.source
        const target = typeof link.target === 'object' ? link.target?.id : link.target
        return { ...link, sourceId: String(source), targetId: String(target) }
      })
      .filter((link) => nodeIds.has(link.sourceId) && nodeIds.has(link.targetId))

    for (const link of validLinks) {
      degree.set(link.sourceId, (degree.get(link.sourceId) || 0) + 1)
      degree.set(link.targetId, (degree.get(link.targetId) || 0) + 1)
      if (!this.adjacency.has(link.sourceId)) this.adjacency.set(link.sourceId, new Set())
      if (!this.adjacency.has(link.targetId)) this.adjacency.set(link.targetId, new Set())
      this.adjacency.get(link.sourceId).add(link.targetId)
      this.adjacency.get(link.targetId).add(link.sourceId)
    }

    const seedRadius = Math.max(62, Math.sqrt(Math.max(1, rawNodes.length)) * 17)
    const seeds = spherePoints(rawNodes.length, seedRadius)

    this.nodes = rawNodes.map((item, index) => {
      const id = String(item.id)
      const deg = degree.get(id) || 0
      const rawPosition = item.position || item.pos
      let position = seeds[index]
      if (rawPosition) {
        if (Array.isArray(rawPosition)) {
          position = { x: Number(rawPosition[0]) || 0, y: Number(rawPosition[1]) || 0, z: Number(rawPosition[2]) || 0 }
        } else if (typeof rawPosition === 'object') {
          position = {
            x: Number(rawPosition.x) || 0,
            y: Number(rawPosition.y) || 0,
            z: Number(rawPosition.z) || 0,
          }
        }
      }
      if (previous.has(id)) position = previous.get(id)

      const size = Number(item.size) || Math.min(4.8, 1.8 + Math.sqrt(deg) * 0.72)
      const color =
        this.colorMode === 'group' ? item.color || hashColor(item.group || item.name) : statusColor(item.status)

      return {
        ...item,
        id,
        raw: item,
        degree: deg,
        size,
        baseColor: color,
        baseColorObj: new THREE.Color(color),
        x: position.x,
        y: position.y,
        z: position.z,
        vx: previous.get(id)?.vx || 0,
        vy: previous.get(id)?.vy || 0,
        vz: previous.get(id)?.vz || 0,
        fx: 0,
        fy: 0,
        fz: 0,
      }
    })
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]))

    this.links = validLinks.map((link, index) => ({
      ...link,
      index,
      bendX: Math.cos(index * 2.399) * 0.17,
      bendY: 0.06 + (index % 3) * 0.03,
      bendZ: Math.sin(index * 2.399) * 0.17,
      vertexStart: index * SEGMENTS * 2,
    }))

    for (const node of this.nodes) this._createNodeVisual(node)
    this._buildLinks()

    this.targets = null
    this.focusId = null
    this.hoverId = null
    this.applyVisualState()
    this.updateLinks()
  }

  updateData(raw) {
    const sameStructure =
      this.raw &&
      raw &&
      Array.isArray(raw.nodes) &&
      Array.isArray(raw.links) &&
      raw.nodes.length === this.nodes.length &&
      raw.links.length === this.links.length &&
      raw.nodes.every((node) => this.nodeById.has(String(node.id)))

    if (!sameStructure) {
      this.setData(raw, { preservePositions: true })
      return true
    }

    this.raw = raw
    this.colorMode = raw?.meta?.colorMode === 'group' ? 'group' : 'status'

    const nodeMap = new Map(raw.nodes.map((node) => [String(node.id), node]))
    for (const node of this.nodes) {
      const next = nodeMap.get(node.id)
      if (!next) continue
      node.raw = next
      node.status = next.status
      node.name = next.name
      node.metrics = next.metrics
      node.meta = next.meta
      node.tags = next.tags
      node.description = next.description
      node.group = next.group
      node.layer = next.layer
      const size = Number(next.size)
      if (size) node.size = size
      if (this.colorMode === 'group') {
        node.baseColor = next.color || hashColor(next.group || next.name)
      } else {
        node.baseColor = statusColor(next.status)
      }
      node.baseColorObj.set(node.baseColor)
      if (node.labelDot) node.labelDot.style.background = node.baseColor
      if (node.labelText) node.labelText.textContent = node.name
      if (node.mesh) node.mesh.scale.setScalar(node.size)
      if (node.ring) node.ring.scale.setScalar(node.size * 4.4)
      if (node.label) node.label.position.set(0, node.size + 1.6, 0)
    }

    const linkMap = new Map(raw.links.map((link, index) => [link.id ?? `link-${index}`, link]))
    for (const link of this.links) {
      const next = linkMap.get(link.id ?? `link-${link.index}`) || raw.links[link.index]
      if (!next) continue
      link.status = next.status
      link.traffic = next.traffic
      link.bandwidth = next.bandwidth
      link.type = next.type
    }
    this._refreshLinkColors()
    this.applyVisualState()
    return false
  }

  /* ------------------------------ 视觉 ------------------------------ */

  _createNodeVisual(node) {
    const palette = LAYER_THEMES[this.theme] || LAYER_THEMES.dark
    const blending = palette.glowBlending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
    const group = new THREE.Group()
    group.position.set(node.x, node.y, node.z)

    const material = new THREE.MeshStandardMaterial({
      color: node.baseColorObj,
      emissive: node.baseColorObj,
      emissiveIntensity: palette.emissive,
      roughness: 0.32,
      metalness: 0.35,
      transparent: true,
      opacity: 1,
    })

    const mesh = new THREE.Mesh(shapeGeometry(nodeShape(node.type)), material)
    mesh.scale.setScalar(node.size)
    mesh.userData.nodeId = node.id
    group.add(mesh)

    const glowMaterial = new THREE.SpriteMaterial({
      map: glowCanvas(),
      color: node.baseColorObj,
      transparent: true,
      opacity: palette.glowOpacity,
      depthWrite: false,
      blending,
    })
    const glow = new THREE.Sprite(glowMaterial)
    glow.scale.setScalar(node.size * 4.4)
    glow.renderOrder = 1
    group.add(glow)

    const ringMaterial = new THREE.SpriteMaterial({
      map: ringCanvas(),
      color: node.baseColorObj,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending,
    })
    const ring = new THREE.Sprite(ringMaterial)
    ring.scale.setScalar(node.size * 4.4)
    ring.visible = false
    ring.renderOrder = 2
    group.add(ring)

    const labelEl = document.createElement('div')
    labelEl.className = 'node-label'
    const dot = document.createElement('span')
    dot.className = 'nl-dot'
    dot.style.background = node.baseColor
    const text = document.createElement('span')
    text.className = 'nl-text'
    text.textContent = node.name
    labelEl.append(dot, text)

    const label = new CSS2DObject(labelEl)
    label.position.set(0, node.size + 1.6, 0)
    group.add(label)

    node.object = group
    node.mesh = mesh
    node.material = material
    node.glow = glow
    node.ring = ring
    node.label = label
    node.labelEl = labelEl
    node.labelDot = dot
    node.labelText = text

    this.object.add(group)
  }

  _buildLinks() {
    if (!this.links.length) {
      this.linkGeometry = null
      this.linkMaterial = null
      return
    }

    const vertexCount = this.links.length * SEGMENTS * 2
    const positions = new Float32Array(vertexCount * 3)
    const colors = new Float32Array(vertexCount * 3)
    const tValues = new Float32Array(vertexCount)
    const focusValues = new Float32Array(vertexCount)
    focusValues.fill(1)
    const palette = LAYER_THEMES[this.theme] || LAYER_THEMES.dark

    for (const link of this.links) {
      const color = new THREE.Color(linkColor(link.status, this.theme))
      const start = link.vertexStart
      for (let s = 0; s < SEGMENTS; s += 1) {
        const t0 = s / SEGMENTS
        const t1 = (s + 1) / SEGMENTS
        const i0 = start + s * 2
        const i1 = i0 + 1
        tValues[i0] = t0
        tValues[i1] = t1
        colors[i0 * 3] = color.r
        colors[i0 * 3 + 1] = color.g
        colors[i0 * 3 + 2] = color.b
        colors[i1 * 3] = color.r
        colors[i1 * 3 + 1] = color.g
        colors[i1 * 3 + 2] = color.b
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aT', new THREE.BufferAttribute(tValues, 1))
    geometry.setAttribute('aFocus', new THREE.BufferAttribute(focusValues, 1).setUsage(THREE.DynamicDrawUsage))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: palette.linkOpacity },
        uFocusActive: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aFocus;
        attribute vec3 aColor;
        varying float vT;
        varying float vFocus;
        varying vec3 vColor;
        void main() {
          vT = aT;
          vFocus = aFocus;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uFocusActive;
        varying float vT;
        varying float vFocus;
        varying vec3 vColor;
        void main() {
          float dim = mix(1.0, 0.06, uFocusActive * (1.0 - vFocus));
          float head = fract(uTime * 0.22 - vT * 1.4);
          float pulse = smoothstep(0.0, 0.05, head) * (1.0 - smoothstep(0.05, 0.3, head));
          float dash = smoothstep(0.44, 0.5, abs(fract(vT * 24.0 - uTime * 0.45) - 0.5));
          vec3 color = vColor * (0.2 + pulse * 2.4 + dash * 0.12);
          float alpha = (0.2 + pulse * 1.1 + dash * 0.1) * uOpacity * dim;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: palette.linkBlending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    })

    const line = new THREE.LineSegments(geometry, material)
    line.frustumCulled = false
    line.renderOrder = 0
    this.object.add(line)

    this.linkGeometry = geometry
    this.linkMaterial = material
    this.linkPositions = positions
    this.linkColorAttr = geometry.attributes.aColor
    this.linkFocusAttr = geometry.attributes.aFocus
    this.linkLine = line
    this.updateLinks()
  }

  updateLinks() {
    if (!this.linkPositions || !this.links.length) return
    const positions = this.linkPositions

    for (const link of this.links) {
      const a = this.nodeById.get(link.sourceId)
      const b = this.nodeById.get(link.targetId)
      if (!a || !b) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
      const bow = Math.min(length * 0.2, 30)
      const cx = (a.x + b.x) / 2 + link.bendX * bow
      const cy = (a.y + b.y) / 2 + link.bendY * bow
      const cz = (a.z + b.z) / 2 + link.bendZ * bow

      let offset = link.vertexStart * 3
      for (let s = 0; s < SEGMENTS; s += 1) {
        for (let k = 0; k < 2; k += 1) {
          const t = (s + k) / SEGMENTS
          const inv = 1 - t
          const x = inv * inv * a.x + 2 * inv * t * cx + t * t * b.x
          const y = inv * inv * a.y + 2 * inv * t * cy + t * t * b.y
          const z = inv * inv * a.z + 2 * inv * t * cz + t * t * b.z
          positions[offset] = x
          positions[offset + 1] = y
          positions[offset + 2] = z
          offset += 3
        }
      }
    }

    this.linkGeometry.attributes.position.needsUpdate = true
  }

  _refreshLinkColors() {
    if (!this.linkColorAttr) return
    const colors = this.linkColorAttr.array
    for (const link of this.links) {
      const color = new THREE.Color(linkColor(link.status, this.theme))
      const start = link.vertexStart
      for (let v = 0; v < SEGMENTS * 2; v += 1) {
        const offset = (start + v) * 3
        colors[offset] = color.r
        colors[offset + 1] = color.g
        colors[offset + 2] = color.b
      }
    }
    this.linkColorAttr.needsUpdate = true
  }

  /* ---------------------------- 交互 / 状态 ---------------------------- */

  setFocus(id) {
    const next = id && this.nodeById.has(String(id)) ? String(id) : null
    this.focusId = next
    if (this.linkFocusAttr) {
      const values = this.linkFocusAttr.array
      const focus = next
      for (const link of this.links) {
        const active = !focus || link.sourceId === focus || link.targetId === focus
        const start = link.vertexStart
        for (let v = 0; v < SEGMENTS * 2; v += 1) values[start + v] = active ? 1 : 0
      }
      this.linkFocusAttr.needsUpdate = true
      this.linkMaterial.uniforms.uFocusActive.value = focus ? 1 : 0
    }
    this.applyVisualState()
    this.updateHoverScale()
  }

  setHover(id) {
    const next = id && this.nodeById.has(String(id)) ? String(id) : null
    if (this.hoverId === next) return
    this.hoverId = next
    this.updateHoverScale()
    this.updateLabelClasses()
  }

  updateHoverScale() {
    for (const node of this.nodes) {
      if (!node.object) continue
      const active = node.id === this.hoverId || node.id === this.focusId
      node.object.scale.setScalar(active ? 1.14 : 1)
    }
  }

  updateLabelClasses() {
    for (const node of this.nodes) {
      if (!node.labelEl) continue
      const isFocus = this.focusId === node.id
      const isHover = this.hoverId === node.id
      const filtered = this.statusFilter && !this.statusFilter.has(node.status)
      const related =
        !this.focusId ||
        isFocus ||
        (this.adjacency.get(this.focusId)?.has(node.id) ?? false)
      node.labelEl.classList.toggle('is-hidden', !this.showLabels || filtered)
      node.labelEl.classList.toggle('is-dim', !related && !isHover)
      node.labelEl.classList.toggle('is-focus', isFocus)
      node.labelEl.classList.toggle('is-hover', isHover)
    }
  }

  applyVisualState() {
    const palette = LAYER_THEMES[this.theme] || LAYER_THEMES.dark
    for (const node of this.nodes) {
      if (!node.material) continue
      const isFocus = this.focusId === node.id
      const filtered = this.statusFilter && !this.statusFilter.has(node.status)
      const related =
        !this.focusId ||
        isFocus ||
        (this.adjacency.get(this.focusId)?.has(node.id) ?? false)
      const dim = filtered || !related
      const color = node.baseColorObj

      node.material.color
        .copy(color)
        .multiplyScalar(filtered ? palette.filteredColor : dim ? palette.dimColor : 1)
      node.material.emissive.copy(color)
      node.material.emissiveIntensity = isFocus
        ? palette.focusEmissive
        : dim
          ? palette.dimEmissive
          : palette.emissive
      node.material.opacity = filtered ? palette.filteredOpacity : 1

      node.glow.material.color.copy(color)
      node.glow.material.opacity = filtered
        ? palette.filteredGlow
        : isFocus
          ? palette.focusGlow
          : dim
            ? palette.dimGlow
            : palette.glowOpacity
      node.ring.material.color.copy(color)
      node.ring.visible = isFocus
    }
    this.updateLabelClasses()
  }

  setStatusFilter(statuses) {
    this.statusFilter = statuses && statuses.length ? new Set(statuses) : null
    this.applyVisualState()
  }

  setShowLabels(show) {
    this.showLabels = show
    this.updateLabelClasses()
  }

  setTheme(mode) {
    this.theme = mode === 'light' ? 'light' : 'dark'
    const palette = LAYER_THEMES[this.theme]
    const blending = palette.glowBlending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
    for (const node of this.nodes) {
      node.glow.material.blending = blending
      node.glow.material.needsUpdate = true
      node.ring.material.blending = blending
      node.ring.material.needsUpdate = true
    }
    if (this.linkMaterial) {
      this.linkMaterial.blending =
        palette.linkBlending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
      this.linkMaterial.uniforms.uOpacity.value = palette.linkOpacity
      this.linkMaterial.needsUpdate = true
    }
    this._refreshLinkColors()
    this.applyVisualState()
    this.updateLinks()
  }

  /* ------------------------------ 布局 ------------------------------ */

  setLayout(layoutId, { instant = false, options = {} } = {}) {
    const definition = getLayout(layoutId) || getLayout('force')
    if (!definition) return

    this.layoutInstance?.dispose?.()
    this.layoutInstance = null
    this.layoutId = definition.id
    this.layoutMode = definition.mode

    let instance = null
    const handleUpdate = () => {
      if (!instance || instance.mode !== 'targets') return
      this.targets = instance.getTargets?.() || new Map()
      if (this._pendingInstant) {
        snapNodes(this.nodes, this.targets)
        this._pendingInstant = false
        this.updateLinks()
      }
    }

    instance = definition.create(this.nodes, this.links, options, { onUpdate: handleUpdate })
    this.layoutInstance = instance
    this.layoutMode = instance.mode || definition.mode

    if (this.layoutMode === 'iterative') {
      this.targets = null
      instance.reset?.()
      return
    }

    this.targets = instance.getTargets?.() || new Map()
    this._pendingInstant = instant
    if (instant && this.targets.size) {
      snapNodes(this.nodes, this.targets)
      this._pendingInstant = false
      this.updateLinks()
    }
  }

  update(dt, elapsed) {
    this.time = elapsed
    if (this.linkMaterial) this.linkMaterial.uniforms.uTime.value = elapsed

    if (this.layoutInstance) {
      if (this.layoutMode === 'iterative') {
        this.layoutInstance.tick?.(dt)
      } else if (this.targets && this.targets.size) {
        const k = Math.min(1, dt * 4.6)
        for (const node of this.nodes) {
          const target = this.targets.get(node.id)
          if (!target) continue
          node.x += (target.x - node.x) * k
          node.y += (target.y - node.y) * k
          node.z += (target.z - node.z) * k
          node.vx = node.vy = node.vz = 0
        }
      }
    }

    for (const node of this.nodes) {
      node.object.position.set(node.x, node.y, node.z)
      if (node.ring.visible) {
        const pulse = 1 + Math.sin(elapsed * 3.2) * 0.07
        node.ring.scale.setScalar(node.size * 4.4 * pulse)
      }
    }

    this.updateLinks()
  }

  /* ------------------------------ 查询 ------------------------------ */

  getPickables() {
    return this.nodes.map((node) => node.mesh).filter(Boolean)
  }

  getPickData(id) {
    return this.nodeById.get(String(id))?.raw || null
  }

  getNode(id) {
    return this.nodeById.get(String(id)) || null
  }

  getBounds() {
    if (!this.nodes.length) {
      return new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60))
    }
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    for (const node of this.nodes) {
      box.expandByPoint(point.set(node.x, node.y, node.z))
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(120, 120, 120))
    return box
  }

  /* ------------------------------ 清理 ------------------------------ */

  _clear() {
    this.layoutInstance?.dispose?.()
    this.layoutInstance = null
    this._pendingInstant = false
    this.nodes.forEach((node) => {
      node.labelEl?.remove()
      node.material?.dispose()
      node.glow?.material?.dispose()
      node.ring?.material?.dispose()
    })
    this.nodes = []
    this.links = []
    this.nodeById = new Map()
    this.adjacency = new Map()
    this.linkGeometry?.dispose()
    this.linkMaterial?.dispose()
    this.linkGeometry = null
    this.linkMaterial = null
    this.linkPositions = null
    this.linkFocusAttr = null
    this.linkColorAttr = null
    this.object.clear()
    this.targets = null
    this.focusId = null
    this.hoverId = null
  }

  dispose() {
    this._clear()
    Object.values(GEOMETRY).forEach((geometry) => geometry.dispose())
    Object.keys(GEOMETRY).forEach((key) => delete GEOMETRY[key])
    glowCanvas().dispose()
    ringCanvas().dispose()
    this._disposed = true
  }
}
