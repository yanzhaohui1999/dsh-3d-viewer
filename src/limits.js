// Hard input cap for the parsers. Kept pure (no three.js / wasm imports) so
// plain Node can unit-test it (scripts/test-limits.mjs).

/** Default cap: 64 MiB. STEP/STL are parsed eagerly on the main thread. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

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
