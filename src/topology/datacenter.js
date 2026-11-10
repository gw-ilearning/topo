import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { statusColor } from './palette.js'
import { LAYER_THEMES } from './themes.js'

const RACK_WIDTH = 5
const RACK_DEPTH = 3.4
const RACK_HEIGHT = 14
const DEVICE_H = 13.2 / 42

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[char]
  })

/**
 * 3D 机房图层：地面、机柜、设备、空调通道与拾取
 */
export class DataCenterLayer {
  constructor() {
    this.object = new THREE.Group()
    this.object.name = 'datacenter-layer'
    this.raw = null
    this.theme = 'dark'
    this.rackById = new Map()
    this.rackGroups = new Map()
    this.labelEls = []
    this.focusId = null
    this.hoverId = null
    this.statusFilter = null
    this.showLabels = true
    this.time = 0
    this.ring = null
    this.floor = null
  }

  _palette() {
    return LAYER_THEMES[this.theme] || LAYER_THEMES.dark
  }

  setTheme(mode) {
    const next = mode === 'light' ? 'light' : 'dark'
    if (this.theme === next) return
    this.theme = next
    if (!this.raw) return

    const { focusId, hoverId, statusFilter } = this
    this.setData(this.raw)
    this.statusFilter = statusFilter
    if (focusId) this.setFocus(focusId)
    if (hoverId) this.setHover(hoverId)
    this.applyVisualState()
  }

  setData(raw) {
    this._clear()
    this.raw = raw
    const racks = Array.isArray(raw?.racks) ? raw.racks : []

    this._buildRoom(raw, racks)
    for (const rack of racks) this._buildRack(rack)
    this._buildFocusRing()
    this.applyVisualState()
  }

  /* ------------------------------ 房间 ------------------------------ */

  _buildRoom(raw, racks) {
    const xs = racks.map((rack) => Number(rack.x) || 0)
    const zs = racks.map((rack) => Number(rack.z) || 0)
    const minX = Math.min(...xs, 0) - 16
    const maxX = Math.max(...xs, 0) + 16
    const minZ = Math.min(...zs, 0) - 14
    const maxZ = Math.max(...zs, 0) + 14
    const width = maxX - minX
    const depth = maxZ - minZ
    const centerX = (minX + maxX) / 2
    const centerZ = (minZ + maxZ) / 2

    this.roomBounds = { minX, maxX, minZ, maxZ, width, depth }
    const palette = this._palette()

    const floorGeometry = new THREE.PlaneGeometry(width, depth)
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: palette.floor,
      roughness: palette.floorRoughness,
      metalness: 0.18,
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(centerX, 0, centerZ)
    this.object.add(floor)
    this.floor = floor

    const grid = new THREE.GridHelper(
      Math.max(width, depth),
      Math.round(Math.max(width, depth) / 4),
      palette.gridMajor,
      palette.gridMinor,
    )
    grid.position.set(centerX, 0.03, centerZ)
    grid.material.transparent = true
    grid.material.opacity = palette.gridOpacity
    grid.material.depthWrite = false
    this.object.add(grid)

    // 房间边框
    const borderPoints = [
      new THREE.Vector3(minX, 0.06, minZ),
      new THREE.Vector3(maxX, 0.06, minZ),
      new THREE.Vector3(maxX, 0.06, maxZ),
      new THREE.Vector3(minX, 0.06, maxZ),
      new THREE.Vector3(minX, 0.06, minZ),
    ]
    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints)
    const borderMaterial = new THREE.LineBasicMaterial({
      color: palette.border,
      transparent: true,
      opacity: 0.65,
    })
    this.object.add(new THREE.Line(borderGeometry, borderMaterial))

    // 通道灯带
    const rows = Array.isArray(raw?.rows) ? raw.rows : []
    const rowZs = rows.map((row) => Number(row.z) || 0).sort((a, b) => a - b)
    const aisleMaterial = new THREE.MeshBasicMaterial({
      color: palette.aisle,
      transparent: true,
      opacity: this.theme === 'light' ? 0.4 : 0.55,
      blending: this.theme === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    })
    for (let i = 0; i < rowZs.length - 1; i += 1) {
      const z = (rowZs[i] + rowZs[i + 1]) / 2
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(width - 10, 0.16), aisleMaterial)
      strip.rotation.x = -Math.PI / 2
      strip.position.set(centerX, 0.05, z)
      this.object.add(strip)
    }

    // 区域标签
    rows.forEach((row) => {
      const el = document.createElement('div')
      el.className = 'row-label'
      el.textContent = row.name
      const label = new CSS2DObject(el)
      label.position.set(maxX - 1, 0.8, row.z)
      this.object.add(label)
      this.labelEls.push(el)
    })
  }

  /* ------------------------------ 机柜 ------------------------------ */

  _buildRack(rack) {
    const palette = this._palette()
    const group = new THREE.Group()
    group.position.set(Number(rack.x) || 0, 0, Number(rack.z) || 0)
    group.userData.rackId = rack.id

    const bodyGeometry = new THREE.BoxGeometry(RACK_WIDTH, RACK_HEIGHT, RACK_DEPTH)
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: palette.rackBody,
      emissive: palette.rackEmissive,
      emissiveIntensity: palette.rackEmissiveIntensity,
      roughness: 0.42,
      metalness: this.theme === 'light' ? 0.25 : 0.55,
      transparent: true,
      opacity: this.theme === 'light' ? 0.78 : 0.58,
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.position.y = RACK_HEIGHT / 2
    body.userData.rackId = rack.id
    group.add(body)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeometry),
      new THREE.LineBasicMaterial({ color: palette.rackEdge, transparent: true, opacity: 0.8 }),
    )
    edges.position.y = RACK_HEIGHT / 2
    group.add(edges)

    // 柜内背板
    const backGeometry = new THREE.BoxGeometry(RACK_WIDTH - 0.4, RACK_HEIGHT - 1.2, 2.4)
    const backMaterial = new THREE.MeshStandardMaterial({
      color: palette.rackBack,
      roughness: 0.85,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    })
    const back = new THREE.Mesh(backGeometry, backMaterial)
    back.position.set(0, RACK_HEIGHT / 2, -0.35)
    group.add(back)

    // 顶部状态灯带
    const ledMaterial = new THREE.MeshBasicMaterial({ color: statusColor(rack.status) })
    const led = new THREE.Mesh(new THREE.BoxGeometry(RACK_WIDTH + 0.1, 0.16, RACK_DEPTH + 0.1), ledMaterial)
    led.position.y = RACK_HEIGHT + 0.08
    group.add(led)

    const deviceMeshes = []
    for (const device of rack.devices || []) {
      const height = Math.max(1, Number(device.height) || 2)
      const u = Math.max(1, Number(device.u) || 1)
      const deviceMaterial = new THREE.MeshStandardMaterial({
        color: palette.deviceBase,
        emissive: new THREE.Color(statusColor(device.status)),
        emissiveIntensity: palette.deviceEmissive,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 1,
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(RACK_WIDTH - 0.9, height * DEVICE_H * 0.82, 0.18), deviceMaterial)
      mesh.position.set(0, (u - 1) * DEVICE_H + (height * DEVICE_H) / 2 + 0.25, RACK_DEPTH / 2 + 0.05)
      mesh.userData.rackId = rack.id
      mesh.userData.deviceId = device.id
      group.add(mesh)
      deviceMeshes.push({ id: device.id, mesh, material: deviceMaterial, status: device.status })
    }

    const labelEl = document.createElement('div')
    labelEl.className = 'rack-label'
    const nameEl = document.createElement('span')
    nameEl.className = 'rl-name'
    nameEl.textContent = rack.name
    const metaEl = document.createElement('span')
    metaEl.className = 'rl-meta'
    metaEl.textContent = `${Number(rack.temperature).toFixed(1)}°C · ${Number(rack.power).toFixed(1)}kW`
    labelEl.append(nameEl, metaEl)
    const label = new CSS2DObject(labelEl)
    label.position.set(0, RACK_HEIGHT + 1.6, 0)
    group.add(label)
    this.labelEls.push(labelEl)

    this.object.add(group)
    const record = {
      raw: rack,
      group,
      body,
      bodyMaterial,
      edges,
      led,
      ledMaterial,
      label,
      labelEl,
      nameEl,
      metaEl,
      deviceMeshes,
      x: Number(rack.x) || 0,
      z: Number(rack.z) || 0,
    }
    this.rackById.set(rack.id, record)
    this.rackGroups.set(rack.id, record)
  }

  _buildFocusRing() {
    const palette = this._palette()
    const geometry = new THREE.RingGeometry(4.1, 4.6, 56)
    const material = new THREE.MeshBasicMaterial({
      color: palette.focusRing,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: this.theme === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.08
    ring.visible = false
    this.object.add(ring)
    this.ring = ring
  }

  /* ------------------------------ 更新 ------------------------------ */

  updateData(raw) {
    const racks = Array.isArray(raw?.racks) ? raw.racks : []
    const sameStructure =
      this.raw &&
      racks.length === this.rackById.size &&
      racks.every((rack) => this.rackById.has(rack.id))

    if (!sameStructure) {
      this.setData(raw)
      return true
    }

    this.raw = raw
    for (const rack of racks) {
      const record = this.rackById.get(rack.id)
      if (!record) continue
      record.raw = rack

      const color = statusColor(rack.status)
      record.ledMaterial.color.set(color)
      record.nameEl.textContent = rack.name
      record.metaEl.textContent = `${Number(rack.temperature).toFixed(1)}°C · ${Number(rack.power).toFixed(1)}kW`

      const deviceMap = new Map((rack.devices || []).map((device) => [device.id, device]))
      for (const item of record.deviceMeshes) {
        const next = deviceMap.get(item.id)
        if (!next) continue
        item.status = next.status
        item.material.emissive.set(statusColor(next.status))
      }
    }
    this.applyVisualState()
    return false
  }

  setFocus(id) {
    const next = id && this.rackById.has(String(id)) ? String(id) : null
    this.focusId = next
    if (this.ring) {
      if (next) {
        const record = this.rackById.get(next)
        this.ring.position.set(record.x, 0.08, record.z)
        this.ring.material.color.set(statusColor(record.raw.status))
        this.ring.visible = true
      } else {
        this.ring.visible = false
      }
    }
    this.applyVisualState()
  }

  setHover(id) {
    const next = id && this.rackById.has(String(id)) ? String(id) : null
    if (this.hoverId === next) return
    this.hoverId = next
    this._applyRackOffsets()
  }

  _applyRackOffsets() {
    const palette = this._palette()
    for (const [id, record] of this.rackById) {
      const lift = id === this.hoverId || id === this.focusId ? 0.16 : 0
      record.group.position.y = lift
      record.edges.material.opacity = id === this.hoverId ? 1 : 0.8
      record.edges.material.color.set(
        id === this.hoverId ? palette.rackEdgeHover : palette.rackEdge,
      )
    }
  }

  applyVisualState() {
    const palette = this._palette()
    for (const [id, record] of this.rackById) {
      const status = record.raw?.status
      const filtered = this.statusFilter && !this.statusFilter.has(status)
      const isFocus = this.focusId === id
      const dim = filtered || (this.focusId && !isFocus)

      record.bodyMaterial.opacity = filtered
        ? 0.08
        : dim
          ? 0.24
          : this.theme === 'light'
            ? 0.78
            : 0.58
      record.bodyMaterial.emissiveIntensity = isFocus
        ? palette.rackEmissiveIntensity + 0.75
        : dim
          ? palette.dimEmissive
          : palette.rackEmissiveIntensity

      record.ledMaterial.color.set(statusColor(status)).multiplyScalar(dim ? palette.ledDim : 1)
      record.ledMaterial.transparent = true
      record.ledMaterial.opacity = filtered ? 0.2 : 1

      for (const item of record.deviceMeshes) {
        item.material.opacity = filtered ? 0.14 : dim ? 0.34 : 1
        item.material.emissiveIntensity = filtered
          ? palette.dimEmissive
          : dim
            ? palette.deviceDimEmissive
            : palette.deviceEmissive
      }

      record.labelEl.classList.toggle('is-hidden', !this.showLabels || filtered)
      record.labelEl.classList.toggle('is-dim', !!dim && !isFocus)
      record.labelEl.classList.toggle('is-focus', isFocus)
    }
    this._applyRackOffsets()
  }

  setStatusFilter(statuses) {
    this.statusFilter = statuses && statuses.length ? new Set(statuses) : null
    this.applyVisualState()
  }

  setShowLabels(show) {
    this.showLabels = show
    this.applyVisualState()
  }

  update(dt, elapsed) {
    this.time = elapsed
    if (this.ring?.visible) {
      const pulse = 1 + Math.sin(elapsed * 2.8) * 0.06
      this.ring.scale.setScalar(pulse)
      this.ring.material.opacity = 0.55 + Math.sin(elapsed * 2.8) * 0.2
    }
  }

  getPickables() {
    return Array.from(this.rackById.values()).map((record) => record.body)
  }

  getPickData(id) {
    return this.rackById.get(String(id))?.raw || null
  }

  getRack(id) {
    return this.rackById.get(String(id))?.raw || null
  }

  getBounds() {
    if (!this.rackById.size) {
      return new THREE.Box3(new THREE.Vector3(-60, 0, -60), new THREE.Vector3(60, 18, 60))
    }
    const box = new THREE.Box3()
    for (const record of this.rackById.values()) {
      box.expandByPoint(new THREE.Vector3(record.x - RACK_WIDTH / 2, 0, record.z - RACK_DEPTH / 2))
      box.expandByPoint(
        new THREE.Vector3(record.x + RACK_WIDTH / 2, RACK_HEIGHT + 2, record.z + RACK_DEPTH / 2),
      )
    }
    return box
  }

  _clear() {
    this.labelEls.forEach((el) => el.remove())
    this.labelEls = []
    this.object.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
        else child.material.dispose()
      }
    })
    this.object.clear()
    this.rackById = new Map()
    this.rackGroups = new Map()
    this.focusId = null
    this.hoverId = null
    this.ring = null
    this.floor = null
  }

  dispose() {
    this._clear()
  }
}
