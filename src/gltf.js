// .gltf resource policy (review 2026-11-08 P2-5). A JSON glTF may point at
// external files (buffers, images, shaders). three's GLTFLoader resolves those
// against the document base and fetches them, so a crafted .gltf would make
// the viewer issue arbitrary requests with the DSH page's own origin. We only
// accept self-contained files: every `uri` must be an inline data: URI.
// .glb keeps its resources in the binary chunk and is not checked here.
//
// Kept three.js-free so plain Node can unit-test it (scripts/test-viewer.mjs).

const RESOURCE_LISTS = ['buffers', 'images', 'shaders']

/** True for a uri that GLTFLoader would turn into a network/filesystem fetch. */
function isExternalUri(uri) {
  if (uri === undefined || uri === null || uri === '') return false
  if (typeof uri !== 'string') return true
  // The URL parser strips surrounding whitespace, so " data:..." is still
  // inline; anything that does not become a data: URI is an external fetch.
  return !/^data:/i.test(uri.trim())
}

/**
 * Every external resource reference in a parsed glTF JSON document, as
 * human-readable `buffers[0].uri = "scene.bin"` strings.
 */
export function externalGltfUris(json) {
  const found = []
  if (!json || typeof json !== 'object') return found
  for (const key of RESOURCE_LISTS) {
    const list = json[key]
    if (!Array.isArray(list)) continue
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return
      if (isExternalUri(entry.uri)) found.push(`${key}[${index}].uri = ${JSON.stringify(entry.uri)}`)
    })
  }
  return found
}

/** Reject a .gltf that references anything outside its own data: URIs. */
export function assertSelfContainedGltf(buffer) {
  let json
  try {
    json = JSON.parse(new TextDecoder().decode(buffer))
  } catch {
    // Not valid JSON: let GLTFLoader raise its own parse error, which is a
    // better message than anything we could produce here.
    return
  }
  const external = externalGltfUris(json)
  if (external.length > 0) {
    throw new Error(
      `.gltf 只支持内嵌资源（data: URI），发现外部引用：${external.slice(0, 3).join('；')}`,
    )
  }
}
