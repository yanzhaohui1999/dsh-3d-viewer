// Pure path helpers. Kept free of three.js / occt-import-js / wasm imports so
// plain Node can unit-test them (scripts/test-extof.mjs); viewer.js re-exports
// extOf to keep the renderer's public surface unchanged.

/** Lowercase file extension, ignoring a trailing `?query` or `#hash`. */
export function extOf(path) {
  const clean = String(path || '').split(/[?#]/)[0]
  const m = /\.([a-z0-9]+)$/i.exec(clean)
  return m ? m[1].toLowerCase() : ''
}
