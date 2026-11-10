import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GraphLayer } from './graph.js'
import { DataCenterLayer } from './datacenter.js'
import { SCENE_THEMES } from './themes.js'

const TMP_VEC = new THREE.Vector3()

/**
 * 三维场景引擎：渲染器、相机、后处理、拾取、相机动画
 */
export class TopologyEngine {
  constructor(container, callbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.disposed = false
    this.mode = 'graph'
    this.theme = 'dark'
    this.layer = null
    this.layout = 'force'
    this.selectedId = null
    this.statusFilter = null
    this.showLabels = true

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#05070f')
    this.scene.fog = new THREE.FogExp2('#05070f', 0.00055)

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 8000)
    this.camera.position.set(170, 120, 210)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x05070f, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.domElement.className = 'webgl-canvas'
    container.appendChild(this.renderer.domElement)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.domElement.className = 'label-layer'
    this.labelRenderer.domElement.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    container.appendChild(this.labelRenderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.minDistance = 12
    this.controls.maxDistance = 1400
    this.controls.maxPolarAngle = Math.PI * 0.93
    this.controls.autoRotateSpeed = 0.55
    this.controls.target.set(0, 0, 0)

    this._initLights()
    this._initStars()
    this._initGrid()
    this._initPost()
    this._initEvents()

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.elapsed = 0
    this.fpsAccum = 0
    this.fpsFrames = 0

    this._resizeObserver = new ResizeObserver(() => this.resize())
    this._resizeObserver.observe(container)
    this.resize()

    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  /* ------------------------------ 初始化 ------------------------------ */

  _initLights() {
    const theme = SCENE_THEMES[this.theme]
    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity)
    this.scene.add(this.hemi)

    this.keyLight = new THREE.DirectionalLight(theme.keyColor, theme.keyIntensity)
    this.keyLight.position.set(140, 220, 120)
    this.scene.add(this.keyLight)

    this.rimLight = new THREE.DirectionalLight(theme.rimColor, theme.rimIntensity)
    this.rimLight.position.set(-160, 60, -140)
    this.scene.add(this.rimLight)

    this.coreLight = new THREE.PointLight(theme.coreColor, theme.coreIntensity, 520, 2)
    this.coreLight.position.set(0, 40, 0)
    this.scene.add(this.coreLight)
  }

  _initStars() {
    const theme = SCENE_THEMES[this.theme]
    const count = 2600
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const radius = 900 + Math.random() * 1500
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.7
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: theme.starsColor,
      size: theme.starsSize,
      sizeAttenuation: true,
      transparent: true,
      opacity: theme.starsOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.stars = new THREE.Points(geometry, material)
    this.scene.add(this.stars)
  }

  _initGrid() {
    this._rebuildGrid()
  }

  _rebuildGrid() {
    const theme = SCENE_THEMES[this.theme]
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.geometry.dispose()
      this.grid.material.dispose()
      this.grid = null
    }
    const grid = new THREE.GridHelper(1600, 80, theme.gridMajor, theme.gridMinor)
    grid.position.y = -78
    grid.material.transparent = true
    grid.material.opacity = theme.gridOpacity
    grid.material.depthWrite = false
    this.scene.add(grid)
    this.grid = grid
  }

  _initPost() {
    const theme = SCENE_THEMES[this.theme]
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      theme.bloomStrength,
      theme.bloomRadius,
      theme.bloomThreshold,
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  _initEvents() {
    this._onPointerMove = (event) => this._handlePointerMove(event)
    this._onPointerDown = (event) => {
      this._pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() }
    }
    this._onPointerUp = (event) => this._handlePointerUp(event)
    this._onPointerLeave = () => {
      this.layer?.setHover(null)
      this.callbacks.onHover?.(null)
    }
    this._onDoubleClick = (event) => {
      const id = this._pickAt(event.clientX, event.clientY)
      if (id) {
        this.select(id)
        this.focusNode(id)
      }
    }

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointermove', this._onPointerMove)
    canvas.addEventListener('pointerdown', this._onPointerDown)
    canvas.addEventListener('pointerup', this._onPointerUp)
    canvas.addEventListener('pointerleave', this._onPointerLeave)
    canvas.addEventListener('dblclick', this._onDoubleClick)
    canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  /* ------------------------------ 数据 ------------------------------ */

  setData(payload) {
    const isDataCenter = Array.isArray(payload?.racks)
    this._disposeLayer()

    this.mode = isDataCenter ? 'datacenter' : 'graph'
    this.grid.visible = !isDataCenter
    this.layer = isDataCenter ? new DataCenterLayer() : new GraphLayer()
    this.layer.setTheme?.(this.theme)
    this.scene.add(this.layer.object)
    this.layer.setData(payload)
    this.layer.setShowLabels(this.showLabels)
    if (this.statusFilter) this.layer.setStatusFilter(this.statusFilter)

    this.selectedId = null
    this.layout = 'force'
    this.layer.setLayout?.('force')
    if (this._fitTimer) clearTimeout(this._fitTimer)
    this._fitTimer = setTimeout(() => this.fitView(true), 260)
  }

  updateData(payload) {
    if (!this.layer) {
      this.setData(payload)
      return
    }
    const isDataCenter = Array.isArray(payload?.racks)
    if ((isDataCenter && this.mode !== 'datacenter') || (!isDataCenter && this.mode !== 'graph')) {
      this.setData(payload)
      return
    }

    const rebuilt = this.layer.updateData(payload)
    if (rebuilt) {
      this.layer.setLayout?.(this.mode === 'datacenter' ? undefined : this.layout)
      this.layer.setShowLabels(this.showLabels)
      if (this.statusFilter) this.layer.setStatusFilter(this.statusFilter)
      this.selectedId = null
      this.callbacks.onSelect?.(null)
    } else if (this.selectedId) {
      const data = this.layer.getPickData(this.selectedId)
      if (!data) {
        this.select(null)
      } else {
        this.callbacks.onSelect?.({
          kind: this.mode === 'datacenter' ? 'rack' : 'node',
          id: this.selectedId,
          data,
        })
      }
    }
  }

  /* ------------------------------ 相机 ------------------------------ */

  fitView(animated = true) {
    if (!this.layer) return
    const box = this.layer.getBounds()
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return

    const radius = Math.max(sphere.radius, 12)
    const fov = (this.camera.fov * Math.PI) / 180
    let distance = (radius / Math.sin(fov / 2)) * 1.18
    if (this.camera.aspect < 1) distance /= Math.max(0.55, this.camera.aspect)

    const direction =
      this.mode === 'datacenter' ? new THREE.Vector3(1.05, 0.82, 1.35) : new THREE.Vector3(1, 0.66, 1)
    direction.normalize()

    const target = sphere.center.clone()
    if (this.mode === 'datacenter') target.y = 6
    const position = target.clone().add(direction.multiplyScalar(distance))
    this._moveCamera(position, target, animated ? 0.95 : 0)
  }

  focusNode(id) {
    const data = this.layer?.getPickData(id)
    if (!data) return
    this.select(id)

    let target
    if (this.mode === 'datacenter') {
      const rack = this.layer.getRack(id)
      if (!rack) return
      target = new THREE.Vector3(rack.x, 7, rack.z)
    } else {
      const node = this.layer.getNode(id)
      if (!node) return
      target = new THREE.Vector3(node.x, node.y, node.z)
    }

    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    const distance = this.mode === 'datacenter' ? 42 : Math.max(26, (data.size || 2) * 14)
    const position = target.clone().add(direction.multiplyScalar(distance))
    this._moveCamera(position, target, 0.75)
  }

  _moveCamera(position, target, duration = 0.8) {
    if (!duration) {
      this.camera.position.copy(position)
      this.controls.target.copy(target)
      this.controls.update()
      this.tween = null
      return
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      t: 0,
      duration,
    }
  }

  _updateTween(dt) {
    if (!this.tween) return
    this.tween.t += dt / this.tween.duration
    const raw = Math.min(1, this.tween.t)
    const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2
    this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, t)
    this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, t)
    if (raw >= 1) this.tween = null
  }

  /* ------------------------------ 交互 ------------------------------ */

  _pickAt(clientX, clientY) {
    if (!this.layer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.layer.getPickables(), false)
    if (!hits.length) return null
    return hits[0].object.userData.rackId || hits[0].object.userData.nodeId || null
  }

  _handlePointerMove(event) {
    const id = this._pickAt(event.clientX, event.clientY)
    this.layer?.setHover(id)
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
    if (!id) {
      this.callbacks.onHover?.(null)
      return
    }
    const data = this.layer.getPickData(id)
    if (!data) return
    this.callbacks.onHover?.({
      kind: this.mode === 'datacenter' ? 'rack' : 'node',
      id,
      data,
      x: event.clientX,
      y: event.clientY,
    })
  }

  _handlePointerUp(event) {
    if (!this._pointerDown) return
    const dx = event.clientX - this._pointerDown.x
    const dy = event.clientY - this._pointerDown.y
    const elapsed = performance.now() - this._pointerDown.time
    this._pointerDown = null
    if (Math.sqrt(dx * dx + dy * dy) > 6 || elapsed > 800) return
    if (event.button !== 0) return

    const id = this._pickAt(event.clientX, event.clientY)
    if (id) this.select(id)
    else this.select(null)
  }

  select(id, { fly = false, emit = true } = {}) {
    const valid = id && this.layer?.getPickData(id) ? String(id) : null
    this.selectedId = valid
    this.layer?.setFocus(valid)
    if (fly && valid) this.focusNode(valid)
    if (emit) {
      this.callbacks.onSelect?.(
        valid
          ? {
              kind: this.mode === 'datacenter' ? 'rack' : 'node',
              id: valid,
              data: this.layer.getPickData(valid),
            }
          : null,
      )
    }
  }

  /* ------------------------------ 设置 ------------------------------ */

  setLayout(layout, options = {}) {
    if (!this.layer || this.mode === 'datacenter') return
    this.layout = layout
    this.layer.setLayout(layout, options)
  }

  setTheme(mode) {
    const next = mode === 'light' ? 'light' : 'dark'
    this.theme = next
    const theme = SCENE_THEMES[next]

    this.scene.background.set(theme.background)
    if (this.scene.fog) {
      this.scene.fog.color.set(theme.background)
      this.scene.fog.density = theme.fogDensity
    }
    this.renderer.setClearColor(theme.background, 1)
    this.renderer.toneMappingExposure = theme.exposure

    if (this.hemi) {
      this.hemi.color.set(theme.hemiSky)
      this.hemi.groundColor.set(theme.hemiGround)
      this.hemi.intensity = theme.hemiIntensity
    }
    if (this.keyLight) {
      this.keyLight.color.set(theme.keyColor)
      this.keyLight.intensity = theme.keyIntensity
    }
    if (this.rimLight) {
      this.rimLight.color.set(theme.rimColor)
      this.rimLight.intensity = theme.rimIntensity
    }
    if (this.coreLight) {
      this.coreLight.color.set(theme.coreColor)
      this.coreLight.intensity = theme.coreIntensity
    }

    if (this.stars) {
      this.stars.material.color.set(theme.starsColor)
      this.stars.material.size = theme.starsSize
      this.stars.material.opacity = theme.starsOpacity
      this.stars.material.needsUpdate = true
    }

    if (this.bloom) {
      this.bloom.strength = theme.bloomStrength
      this.bloom.radius = theme.bloomRadius
      this.bloom.threshold = theme.bloomThreshold
    }

    this._rebuildGrid()
    if (this.layer) this.grid.visible = this.mode !== 'datacenter'

    this.layer?.setTheme?.(next)
  }

  setStatusFilter(statuses) {
    this.statusFilter = statuses && statuses.length ? [...statuses] : null
    this.layer?.setStatusFilter(this.statusFilter)
  }

  setShowLabels(show) {
    this.showLabels = show
    this.layer?.setShowLabels(show)
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = !!enabled
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.labelRenderer.setSize(width, height)
  }

  capture() {
    this.composer.render()
    return this.renderer.domElement.toDataURL('image/png')
  }

  /* ------------------------------ 主循环 ------------------------------ */

  _loop() {
    if (this.disposed) return
    this._raf = requestAnimationFrame(this._loop)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.05)
    this.elapsed += dt

    this._updateTween(dt)
    this.controls.update()
    this.layer?.update(dt, this.elapsed)
    if (this.stars) this.stars.rotation.y += dt * 0.006

    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)

    this.fpsAccum += dt
    this.fpsFrames += 1
    if (this.fpsAccum >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum)
      this.callbacks.onStats?.({ fps })
      this.fpsAccum = 0
      this.fpsFrames = 0
    }
  }

  /* ------------------------------ 清理 ------------------------------ */

  _disposeLayer() {
    if (!this.layer) return
    this.scene.remove(this.layer.object)
    this.layer.dispose()
    this.layer = null
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this._raf)
    if (this._fitTimer) clearTimeout(this._fitTimer)
    this._resizeObserver?.disconnect()

    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this._onPointerMove)
    canvas.removeEventListener('pointerdown', this._onPointerDown)
    canvas.removeEventListener('pointerup', this._onPointerUp)
    canvas.removeEventListener('pointerleave', this._onPointerLeave)
    canvas.removeEventListener('dblclick', this._onDoubleClick)

    this._disposeLayer()
    this.controls.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    canvas.remove()
    this.labelRenderer.domElement.remove()
  }
}
