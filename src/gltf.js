// glTF resource policy (review 2026-11-08 fix5). A JSON glTF may point at
// external files (buffers, images, shaders). three's GLTFLoader resolves those
// against the document base and fetches them, so a crafted document would make
// the viewer issue arbitrary requests with the DSH page's own origin.
//
// The check has to follow the bytes, not the file extension: GLTFLoader decides
// "binary vs JSON" by the 'glTF' magic (GLTFLoader.js parse()), so a JSON glTF
// renamed to .glb is still parsed as JSON and its `scene.bin` is fetched. Both
// representations are scanned here:
//   * GLB (magic)     → the JSON chunk that three parses (bytes 12..)
//   * everything else → the whole buffer as UTF-8 JSON text
// Only inline data: URIs are accepted. A GLB stays self-contained because its
// buffer and image bytes live in the BIN chunk / bufferViews with no uri at all.
//
// Kept three.js-free so plain Node can unit-test it (scripts/test-viewer.mjs).

const RESOURCE_LISTS = ['buffers', 'images', 'shaders']
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] // 'glTF'
const GLB_HEADER_BYTES = 12
const GLB_JSON_CHUNK = 0x4e4f534a // 'JSON' as a little-endian uint32
const TEXT_DECODER = new TextDecoder()

function asBytes(buffer) {
  if (buffer instanceof Uint8Array) return buffer
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer)
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return null
}

/** True when the bytes start with the GLB magic; three branches on this, not on the name. */
export function isGlbBuffer(buffer) {
  const bytes = asBytes(buffer)
  return !!bytes && bytes.byteLength >= 4
    && GLB_MAGIC.every((byte, index) => bytes[index] === byte)
}

/**
 * The JSON text three will parse out of a GLB container, or null when the
 * container is malformed (GLTFLoader then throws before loading any resource).
 *
 * Mirrors GLTFBinaryExtension in three's GLTFLoader: chunks start at byte 12
 * and are scanned while `chunkIndex < header.length - 12`; the *last* JSON
 * chunk wins, exactly like three. A chunk that runs past the buffer makes the
 * loader throw, so returning null cannot let a resource slip through unseen.
 */
function glbJsonText(bytes) {
  if (bytes.byteLength < GLB_HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) < 2) return null // legacy GLB: loader rejects it
  const chunkContentsLength = view.getUint32(8, true) - GLB_HEADER_BYTES
  if (!(chunkContentsLength > 0)) return null
  let offset = GLB_HEADER_BYTES
  let text = null
  while (offset - GLB_HEADER_BYTES < chunkContentsLength) {
    if (offset + 8 > bytes.byteLength) return null
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8
    if (offset + chunkLength > bytes.byteLength) return null
    if (chunkType === GLB_JSON_CHUNK) {
      text = TEXT_DECODER.decode(bytes.subarray(offset, offset + chunkLength))
    }
    offset += chunkLength
  }
  return text
}

/**
 * True for a uri that GLTFLoader would turn into a network/filesystem fetch.
 *
 * Only an *absent* uri means "the bytes are in a bufferView / the GLB BIN
 * chunk". An empty string or null still resolves to the document URL
 * (LoaderUtils.resolveURL → '', FileLoader.load('') → fetch of the page), so
 * anything that is not a data: URI counts as external.
 */
function isExternalUri(uri) {
  if (uri === undefined) return false
  if (typeof uri !== 'string') return true
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

/**
 * Reject a glTF/GLB whose bytes reference anything outside their own data:
 * URIs. Content-based on purpose: the filename never reaches this function.
 */
export function assertSelfContainedGltf(buffer) {
  const bytes = asBytes(buffer)
  if (!bytes) return
  let text
  if (isGlbBuffer(bytes)) {
    text = glbJsonText(bytes)
    // Malformed GLB: GLTFLoader rejects the container before any resource load.
    if (text === null) return
  } else {
    text = TEXT_DECODER.decode(bytes)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // Not valid JSON: let GLTFLoader raise its own parse error, which is a
    // better message than anything we could produce here.
    return
  }
  const external = externalGltfUris(json)
  if (external.length > 0) {
    throw new Error(
      `glTF/GLB 只支持内嵌资源（data: URI），发现外部引用：${external.slice(0, 3).join('；')}`,
    )
  }
}
