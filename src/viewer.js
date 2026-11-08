// Framework-free three.js viewer: orthographic camera, four axis presets,
// STL / GLB / GLTF / STEP parsing. No React, no DOM beyond the given element.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import occtimportjs from 'occt-import-js'
import occtWasm from 'occt-import-js/dist/occt-import-js.wasm'
import { disposeObject3D } from './dispose.js'
import { installContextRecovery } from './context.js'
import { clipPlanesFor, radiusFor } from './fit.js'
import { assertSelfContainedGltf } from './gltf.js'
import { assertFileSizeForExt } from './limits.js'

// extOf lives in format.js so plain Node can unit-test it without importing
// three.js or the wasm; re-exported here to keep viewer.js's surface unchanged.
export { extOf } from './format.js'

const CAD_EXTS = new Set(['step', 'stp', 'stl'])
// World space is Y-up: the model group is rotated -90° about X on mount.
const PRESETS = {
  iso: { dir: [0.62, 0.72, 0.55], up: [0, 1, 0] },
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  top: { dir: [0, 1, 0], up: [0, 0, -1] },
  side: { dir: [1, 0, 0], up: [0, 1, 0] },
}

let occtPromise = null
async function createOcct() {
  return occtimportjs({ wasmBinary: occtWasm })
}
function getOcct() {
  if (!occtPromise) {
    // A failed wasm init must not be cached for the rest of the page's life:
    // reset on rejection so the next STEP file retries instead of failing
    // instantly forever.
    occtPromise = createOcct().catch((error) => {
      occtPromise = null
      throw error
    })
  }
  return occtPromise
}

function meshGroupFromOcct(result) {
  const group = new THREE.Group()
  for (const mesh of result.meshes || []) {
    const position = mesh.attributes?.position?.array
    if (!position || position.length === 0) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    if (mesh.attributes?.normal?.array) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3))
    }
    // occt-import-js hands back plain arrays, not typed views
    if (mesh.index?.array) geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.index.array, 1))
    if (!mesh.attributes?.normal?.array) geometry.computeVertexNormals()
    const color = Array.isArray(mesh.color) && mesh.color.length >= 3
      ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
      : new THREE.Color(0x9fb3c8)
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color, metalness: 0.25, roughness: 0.55, side: THREE.DoubleSide,
    })))
  }
  if (group.children.length === 0) throw new Error('STEP 文件里没有可显示的网格')
  return group
}

async function parseCad(buffer) {
  const occt = await getOcct()
  // ReadStepFile is synchronous and can block for seconds on a large file.
  // Yield once so the browser can paint the 「解析中…」 state first.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const bytes = new Uint8Array(buffer)
  const result = occt.ReadStepFile(bytes, null)
  if (!result || result.success === false) throw new Error('STEP 解析失败（OpenCASCADE 拒绝了这份文件）')
  return meshGroupFromOcct(result)
}

function parseStl(buffer) {
  const geometry = new STLLoader().parse(buffer)
  geometry.computeVertexNormals()
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x9fb3c8, metalness: 0.25, roughness: 0.55, side: THREE.DoubleSide,
  })))
  return group
}

function parseGltf(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject)
  })
}

/** Parse bytes into an unrotated model group plus its true (CAD-space) bounds. */
export async function parseModel(buffer, ext) {
  const e = String(ext || '').toLowerCase()
  // One cap for every format, applied before any decode/parse: .glb/.gltf used
  // to bypass assertFileSize and a 100 MiB .gltf reached JSON.parse first
  // (review 2026-11-08 fix5).
  assertFileSizeForExt(buffer, e)
  let group
  if (e === 'step' || e === 'stp') group = await parseCad(buffer)
  else if (e === 'stl') group = parseStl(buffer)
  else if (e === 'glb' || e === 'gltf') {
    // Content, not extension: three decides JSON vs GLB by the 'glTF' magic, so
    // a JSON glTF renamed to .glb is still parsed as JSON and would fetch its
    // external buffers/images. Scan the bytes we actually got, then parse.
    assertSelfContainedGltf(buffer)
    group = await parseGltf(buffer)
  } else throw new Error(`不支持的格式 .${e}`)

  const box = new THREE.Box3().setFromObject(group)
  if (!isFinite(box.min.x)) throw new Error('模型为空，没有可显示的几何体')

  let triangles = 0
  group.traverse((node) => {
    const g = node.geometry
    if (!g) return
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3
  })
  const size = box.getSize(new THREE.Vector3())
  return {
    group,
    // STEP/STL carry CAD's Z-up convention; glTF is already Y-up per spec.
    zUp: e === 'step' || e === 'stp' || e === 'stl',
    triangles: Math.round(triangles),
    size: [size.x, size.y, size.z],
    center: box.getCenter(new THREE.Vector3()),
  }
}

export class ModelViewer {
  constructor(container) {
    this.container = container
    this.renderer = this.createRenderer()
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x11161c)

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000)
    this.camera.up.set(0, 1, 0)

    // OrbitControls dispatches 'change' from its own pointer/wheel handlers;
    // that is what wakes the idle render loop back up.
    this.onControlsChange = () => this.requestRender()
    this.controls = this.createControls(this.renderer.domElement)

    this.scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x2b3440, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(1, 1.4, 1).multiplyScalar(100)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.7)
    fill.position.set(-1, -0.6, -0.8).multiplyScalar(100)
    this.scene.add(fill)

    this.root = new THREE.Group()
    this.scene.add(this.root)

    this.model = null
    this.radius = 1
    this.raf = 0
    this.needsRender = true
    this.disposed = false
    this.contextLost = false
    this.loop = this.loop.bind(this)
    this.resize = this.resize.bind(this)
    this.onVisibilityChange = this.onVisibilityChange.bind(this)
    this.onContextLost = this.onContextLost.bind(this)
    this.onContextRestored = this.onContextRestored.bind(this)
    // The lost event must be cancelled for the browser to restore the context;
    // installContextRecovery() does that before calling our handlers.
    this.stopContextRecovery = installContextRecovery(this.renderer.domElement, {
      onLost: this.onContextLost,
      onRestored: this.onContextRestored,
    })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
    this.startLoop()
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize)
      this.ro.observe(container)
    } else {
      window.addEventListener('resize', this.resize)
    }
  }

  createRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    renderer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    return renderer
  }

  createControls(domElement) {
    const controls = new OrbitControls(this.camera, domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controls.addEventListener('change', this.onControlsChange)
    return controls
  }

  /** Hidden tabs must not keep rendering (rAF is throttled, but still wakes up). */
  isVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  requestRender() {
    this.needsRender = true
    this.startLoop()
  }

  startLoop() {
    if (this.disposed || this.contextLost || this.raf || !this.isVisible()) return
    this.raf = requestAnimationFrame(this.loop)
  }

  stopLoop() {
    if (!this.raf) return
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  onVisibilityChange() {
    if (this.isVisible()) this.requestRender()
    else this.stopLoop()
  }

  onContextLost() {
    // The event was already cancelled by installContextRecovery(); without that
    // the browser never fires webglcontextrestored.
    this.contextLost = true
    this.stopLoop()
  }

  onContextRestored() {
    if (this.disposed) return
    try {
      this.rebuildRenderer()
    } catch (error) {
      // Keep the panel usable for the next mount instead of throwing out of a
      // browser event handler.
      console.warn('[dsh-3d-viewer] WebGL 上下文恢复失败：', error)
      return
    }
    this.contextLost = false
    this.restoreModel()
    this.requestRender()
  }

  /** Swap in a fresh renderer/controls after the old GL context was lost. */
  rebuildRenderer() {
    const previous = this.renderer
    const next = this.createRenderer()
    if (previous.domElement.parentNode) previous.domElement.replaceWith(next.domElement)
    else this.container.appendChild(next.domElement)
    this.stopContextRecovery?.()
    previous.dispose()
    this.renderer = next
    this.stopContextRecovery = installContextRecovery(next.domElement, {
      onLost: this.onContextLost,
      onRestored: this.onContextRestored,
    })
    // OrbitControls binds pointer listeners to the old canvas; recreate it
    // against the new one while keeping the camera and its target.
    const target = this.controls.target.clone()
    this.controls.removeEventListener('change', this.onControlsChange)
    this.controls.dispose()
    this.controls = this.createControls(next.domElement)
    this.controls.target.copy(target)
    this.controls.update()
    this.applyFrustum()
  }

  /** Reattach the CPU-side model so the fresh renderer uploads it again. */
  restoreModel() {
    if (!this.model) return
    this.root.clear()
    this.attachModel(this.model)
    this.applyFrustum()
  }

  loop() {
    this.raf = 0
    if (this.disposed || this.contextLost || !this.isVisible()) return
    // OrbitControls.update() returns true only while the camera is actually
    // moving (including damping), so an idle panel can stop redrawing instead
    // of burning 60 fps forever.
    const changed = this.controls.update()
    if (this.needsRender || changed) {
      this.needsRender = false
      this.renderer.render(this.scene, this.camera)
    }
    // Damping still needs frames; otherwise let the loop go idle until the next
    // interaction, resize or visibility change calls requestRender().
    if ((changed || this.needsRender) && !this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  resize() {
    // Resizing a lost context throws/warns; rebuildRenderer() picks up the
    // current container size when the context comes back.
    if (this.contextLost) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.applyFrustum()
    this.requestRender()
  }

  applyFrustum() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const aspect = w / h
    const r = this.radius || 1
    this.camera.left = -r * aspect
    this.camera.right = r * aspect
    this.camera.top = r
    this.camera.bottom = -r
    this.camera.updateProjectionMatrix()
  }

  setModel(model) {
    this.clearModel()
    this.model = model
    const wrapper = this.attachModel(model)
    const worldBox = new THREE.Box3().setFromObject(wrapper)
    this.worldCenter = worldBox.getCenter(new THREE.Vector3())
    const worldSize = worldBox.getSize(new THREE.Vector3())
    this.radius = radiusFor(Math.max(worldSize.x, worldSize.y, worldSize.z))
    this.applyFrustum()
    this.fit('iso')
    this.requestRender()
  }

  /** Add a model group to the scene, applying the CAD Z-up → Y-up rotation. */
  attachModel(model) {
    // CAD formats arrive Z-up; three.js is Y-up. glTF is already Y-up, so it must
    // not be rotated. The reported size stays in the file's own space either way.
    const wrapper = new THREE.Group()
    wrapper.add(model.group)
    if (model.zUp) wrapper.rotation.x = -Math.PI / 2
    this.root.add(wrapper)
    return wrapper
  }

  clearModel() {
    if (!this.model) return
    this.root.clear()
    // Geometries, materials and their textures all live on the GPU; detaching
    // the group is not enough.
    disposeObject3D(this.model.group)
    this.model = null
    this.requestRender()
  }

  fit(preset = 'iso') {
    if (!this.model) return
    const presetDef = PRESETS[preset] || PRESETS.iso
    const dir = new THREE.Vector3(...presetDef.dir).normalize()
    const up = new THREE.Vector3(...presetDef.up).normalize()
    const { distance, near, far } = clipPlanesFor(this.radius)
    this.camera.up.copy(up)
    this.camera.position.copy(this.worldCenter).add(dir.multiplyScalar(distance))
    this.camera.near = near
    this.camera.far = far
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(this.worldCenter)
    this.controls.update()
    this.requestRender()
  }

  screenshot(name = 'model') {
    this.renderer.render(this.scene, this.camera)
    const url = this.renderer.domElement.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.png`
    a.click()
  }

  dispose() {
    this.disposed = true
    this.stopLoop()
    this.stopContextRecovery?.()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
    this.controls.removeEventListener('change', this.onControlsChange)
    this.ro?.disconnect()
    window.removeEventListener('resize', this.resize)
    this.clearModel()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
