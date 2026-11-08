// Hard input cap for the parsers. Kept pure (no three.js / wasm imports) so
// plain Node can unit-test it (scripts/test-limits.mjs).

/** Default cap: 64 MiB. Every format we parse is decoded eagerly on the main thread. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

/** Every extension the viewer parses; they all share the cap. */
const MODEL_EXTS = new Set(['step', 'stp', 'stl', 'glb', 'gltf'])

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    // Integer caps read better as "64 MB"; odd sizes keep one decimal.
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  }
  return `${Math.ceil(bytes / 1024)} KB`
}

/**
 * Throw a user-facing「文件过大」error when `buffer` exceeds `limit`.
 * Returns the byte count so callers can reuse it.
 */
export function assertFileSize(buffer, limit = MAX_FILE_BYTES) {
  const bytes = typeof buffer?.byteLength === 'number' ? buffer.byteLength : 0
  if (bytes > limit) {
    throw new Error(`文件过大：${formatBytes(bytes)}（${bytes.toLocaleString('en-US')} 字节），上限 ${formatBytes(limit)}`)
  }
  return bytes
}

/**
 * Cap check for one input, before any decode or parse.
 *
 * .glb/.gltf used to skip assertFileSize entirely, so a 100 MiB .gltf reached
 * JSON.parse first (review 2026-11-08 fix5). Unknown extensions are left to the
 * caller's「不支持的格式」error instead of being reported as too large.
 */
export function assertFileSizeForExt(buffer, ext) {
  const e = String(ext || '').toLowerCase()
  if (!MODEL_EXTS.has(e)) return 0
  return assertFileSize(buffer)
}
