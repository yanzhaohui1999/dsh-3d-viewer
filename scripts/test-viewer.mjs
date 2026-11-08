// Unit tests for the resource-release and .gltf policy helpers (review
// 2026-11-08 P2-2 / P2-5). Plain Node, no DOM and no wasm: the helpers live in
// ../src/dispose.js and ../src/gltf.js precisely so this file can import the
// real implementations and drive them with mocks. Run: npm test
import assert from 'node:assert/strict'
import { disposeMaterial, disposeObject3D } from '../src/dispose.js'
import { externalGltfUris, assertSelfContainedGltf, isGlbBuffer } from '../src/gltf.js'

let assertions = 0
function ok(actual, expected, label) {
  assert.deepEqual(actual, expected, label)
  assertions += 1
}
function throws(fn, pattern, label) {
  assert.throws(fn, pattern, label)
  assertions += 1
}
function doesNotThrow(fn, label) {
  assert.doesNotThrow(fn, label)
  assertions += 1
}

// ---------------------------------------------------------------------------
// P2-2: disposing a material must also dispose the textures it references.
// three's Material.dispose() drops only the material itself.
// ---------------------------------------------------------------------------
{
  const calls = []
  const tex = (name) => ({ isTexture: true, name, dispose: () => calls.push(name) })
  const material = {
    map: tex('map'),
    normalMap: tex('normalMap'),
    roughnessMap: tex('roughnessMap'),
    color: { isColor: true, dispose: () => calls.push('color') }, // not a texture
    opacity: 0.5,
    dispose: () => calls.push('material'),
  }
  disposeMaterial(material)
  ok(calls.filter((c) => c === 'map').length, 1, 'map disposed exactly once')
  ok(calls.filter((c) => c === 'normalMap').length, 1, 'normalMap disposed')
  ok(calls.filter((c) => c === 'roughnessMap').length, 1, 'roughnessMap disposed')
  ok(calls.includes('color'), false, 'non-texture material values are untouched')
  ok(calls[calls.length - 1], 'material', 'material itself is disposed last')
  doesNotThrow(() => disposeMaterial(null), 'disposeMaterial(null) is a no-op')
  doesNotThrow(() => disposeMaterial(undefined), 'disposeMaterial(undefined) is a no-op')
}

// A mock Object3D tree: real traverse() so the helper walks children like three.
function mockNode(extra = {}) {
  const node = { children: [], ...extra }
  node.traverse = (cb) => {
    cb(node)
    node.children.forEach((child) => child.traverse(cb))
  }
  return node
}
{
  const disposed = []
  const texture = { isTexture: true, dispose: () => disposed.push('texture') }
  const materialA = { map: texture, dispose: () => disposed.push('material:A') }
  const materialB = { dispose: () => disposed.push('material:B') }
  const meshA = mockNode({
    geometry: { dispose: () => disposed.push('geometry:A') },
    material: materialA,
  })
  const meshB = mockNode({
    geometry: { dispose: () => disposed.push('geometry:B') },
    material: [materialB, materialA], // multi-material meshes are arrays
  })
  const group = mockNode()
  group.children.push(meshA, meshB)
  const root = mockNode()
  root.children.push(group)

  disposeObject3D(root)
  ok(disposed.includes('geometry:A'), true, 'geometry of first mesh disposed')
  ok(disposed.includes('geometry:B'), true, 'geometry of second mesh disposed')
  ok(disposed.filter((c) => c === 'material:A').length, 2, 'single material and array entry both disposed')
  ok(disposed.includes('material:B'), true, 'material array entry disposed')
  ok(disposed.includes('texture'), true, 'texture behind a material disposed')
  doesNotThrow(() => disposeObject3D(null), 'disposeObject3D(null) is a no-op')
}

// ---------------------------------------------------------------------------
// P2-5: .gltf may only reference inline data: URIs; everything else is an
// external fetch made with the DSH page's own origin.
// ---------------------------------------------------------------------------
{
  const external = externalGltfUris({
    buffers: [{ uri: 'scene.bin' }],
    images: [{ uri: 'textures/albedo.png' }],
  })
  ok(external.length, 2, 'relative buffer/image uris are external')
  ok(external[0], 'buffers[0].uri = "scene.bin"', 'reference is named for the error message')

  ok(externalGltfUris({
    buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }],
    images: [{ uri: 'data:image/png;base64,AAAA' }],
  }).length, 0, 'data: uris are self-contained')

  ok(externalGltfUris({
    buffers: [{ byteLength: 12 }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
  }).length, 0, 'bufferView / missing uri stays inside the file')

  ok(externalGltfUris({ images: [{ uri: 'https://example.com/x.png' }] }).length, 1, 'absolute url is external')
  ok(externalGltfUris({ images: [{ uri: 'blob:https://example.com/1' }] }).length, 1, 'blob url is external')
  ok(externalGltfUris({ buffers: [{ uri: 42 }] }).length, 1, 'non-string uri is rejected')
  ok(externalGltfUris({ shaders: [{ uri: 'shader.glsl' }] }).length, 1, 'shader uri is external')
  ok(externalGltfUris({ buffers: [{ uri: '' }] }).length, 1, 'empty uri is not inline: three fetches the document URL')
  ok(externalGltfUris({ buffers: [{ uri: null }] }).length, 1, 'null uri is rejected too')
  ok(externalGltfUris({ buffers: [{ uri: '  DATA:application/octet-stream;base64,AA' }] }).length, 0, 'data: match ignores case/whitespace')
  ok(externalGltfUris({ buffers: 'not-a-list' }).length, 0, 'malformed resource list is ignored')
  ok(externalGltfUris(null).length, 0, 'null document yields no references')
}

{
  const encode = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
  const selfContained = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }],
    images: [{ uri: 'data:image/png;base64,AAAA' }],
  }
  doesNotThrow(() => assertSelfContainedGltf(encode(selfContained)), 'self-contained .gltf passes')
  throws(
    () => assertSelfContainedGltf(encode({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }] })),
    /内嵌资源/,
    'external buffer is rejected',
  )
  throws(
    () => assertSelfContainedGltf(encode({ images: [{ uri: 'https://example.com/a.png' }] })),
    /images\[0\]/,
    'error names the offending reference',
  )
  doesNotThrow(() => assertSelfContainedGltf(encode('not json')), 'invalid JSON is left to GLTFLoader')
  doesNotThrow(
    () => assertSelfContainedGltf(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 0, 0, 0])),
    '.glb magic is not JSON and is not rejected here',
  )
  doesNotThrow(
    () => assertSelfContainedGltf(encode('\uFEFF' + JSON.stringify(selfContained))),
    'UTF-8 BOM is tolerated',
  )
}

// ---------------------------------------------------------------------------
// fix5: the policy must follow the bytes, not the extension. three branches on
// the 'glTF' magic, so the JSON chunk of a GLB (including images[].uri) is
// scanned too, and a JSON glTF renamed to .glb goes through the same check.
// ---------------------------------------------------------------------------
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_BIN_CHUNK = 0x004e4942

function paddedJson(value) {
  const raw = new TextEncoder().encode(JSON.stringify(value))
  const padded = new Uint8Array(Math.ceil(raw.length / 4) * 4)
  padded.set(raw)
  padded.fill(0x20, raw.length) // spec: the JSON chunk is padded with spaces
  return padded
}

function buildGlb(chunks) {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.byteLength, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46]) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  let offset = 12
  for (const { type, data } of chunks) {
    view.setUint32(offset, data.byteLength, true)
    view.setUint32(offset + 4, type, true)
    out.set(data, offset + 8)
    offset += 8 + data.byteLength
  }
  return out
}

function glbFromJson(json, bin) {
  const chunks = [{ type: GLB_JSON_CHUNK, data: paddedJson(json) }]
  if (bin) chunks.push({ type: GLB_BIN_CHUNK, data: bin })
  return buildGlb(chunks)
}

{
  const jsonDoc = (value) => new TextEncoder().encode(JSON.stringify(value))
  const selfContainedGlb = glbFromJson(
    { asset: { version: '2.0' }, buffers: [{ byteLength: 12 }] },
    new Uint8Array(12),
  )
  ok(isGlbBuffer(selfContainedGlb), true, 'GLB magic is detected from the bytes')
  ok(isGlbBuffer(jsonDoc({ asset: { version: '2.0' } })), false, 'JSON glTF is not mistaken for GLB')
  doesNotThrow(() => assertSelfContainedGltf(selfContainedGlb), 'self-contained GLB with a BIN chunk passes')

  throws(
    () => assertSelfContainedGltf(glbFromJson({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }] })),
    /buffers\[0\]/,
    'GLB JSON chunk buffer uri is rejected',
  )
  throws(
    () => assertSelfContainedGltf(glbFromJson({ asset: { version: '2.0' }, images: [{ uri: 'textures/a.png' }] })),
    /images\[0\]/,
    'GLB JSON chunk images[].uri is rejected',
  )
  doesNotThrow(
    () => assertSelfContainedGltf(glbFromJson({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AA' }] })),
    'data: image inside a GLB passes',
  )

  // three keeps scanning and parses the *last* JSON chunk; a clean first chunk
  // must not hide an external second one.
  const twoJsonChunks = buildGlb([
    { type: GLB_JSON_CHUNK, data: paddedJson({ asset: { version: '2.0' } }) },
    { type: GLB_JSON_CHUNK, data: paddedJson({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }] }) },
  ])
  throws(() => assertSelfContainedGltf(twoJsonChunks), /buffers\[0\]/, 'the last JSON chunk is the one three parses and is checked')

  // The blind-audit bypass: the same JSON document, handed to the viewer with a
  // .glb path. The guard never sees the filename, so the bytes alone reject it
  // before GLTFLoader exists — no fetch can be issued.
  const renamed = jsonDoc({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 12 }] })
  throws(() => assertSelfContainedGltf(renamed), /内嵌资源/, 'JSON glTF renamed to .glb is rejected by the same bytes-only policy')
  ok(isGlbBuffer(renamed), false, 'renamed JSON glTF carries no GLB magic')
}

console.log(`test-viewer: ${assertions} assertions PASS`)
