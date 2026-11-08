// Framework-free three.js viewer: orthographic camera, four axis presets,
// STL / GLB / GLTF / STEP parsing. No React, no DOM beyond the given element.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import occtimportjs from 'occt-import-js'
import occtWasm from 'occt-import-js/dist/occt-import-js.wasm'

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
function getOcct() {
  if (!occtPromise) occtPromise = occtimportjs({ wasmBinary: occtWasm })
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
  let group
  if (e === 'step' || e === 'stp') group = await parseCad(buffer)
  else if (e === 'stl') group = parseStl(buffer)
  else if (e === 'glb' || e === 'gltf') group = await parseGltf(buffer)
  else throw new Error(`不支持的格式 .${e}`)

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x11161c)

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000)
    this.camera.up.set(0, 1, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }

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
    this.loop = this.loop.bind(this)
    this.resize = this.resize.bind(this)
    this.raf = requestAnimationFrame(this.loop)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize)
      this.ro.observe(container)
    } else {
      window.addEventListener('resize', this.resize)
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.applyFrustum()
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
    // CAD formats arrive Z-up; three.js is Y-up. glTF is already Y-up, so it must
    // not be rotated. The reported size stays in the file's own space either way.
    const wrapper = new THREE.Group()
    wrapper.add(model.group)
    if (model.zUp) wrapper.rotation.x = -Math.PI / 2
    this.root.add(wrapper)
    const worldBox = new THREE.Box3().setFromObject(wrapper)
    this.worldCenter = worldBox.getCenter(new THREE.Vector3())
    const worldSize = worldBox.getSize(new THREE.Vector3())
    this.radius = Math.max(worldSize.x, worldSize.y, worldSize.z) * 0.75 + 1
    this.applyFrustum()
    this.fit('iso')
  }

  clearModel() {
    if (!this.model) return
    this.root.clear()
    this.model.group.traverse((node) => {
      node.geometry?.dispose?.()
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose?.())
      else node.material?.dispose?.()
    })
    this.model = null
  }

  fit(preset = 'iso') {
    if (!this.model) return
    const presetDef = PRESETS[preset] || PRESETS.iso
    const dir = new THREE.Vector3(...presetDef.dir).normalize()
    const up = new THREE.Vector3(...presetDef.up).normalize()
    const distance = this.radius * 4
    this.camera.up.copy(up)
    this.camera.position.copy(this.worldCenter).add(dir.multiplyScalar(distance))
    this.camera.near = 0.1
    this.camera.far = distance * 4 + this.radius * 4
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(this.worldCenter)
    this.controls.update()
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
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    window.removeEventListener('resize', this.resize)
    this.clearModel()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
