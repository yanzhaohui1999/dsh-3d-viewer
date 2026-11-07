// Test-only entry: exposes the parser so a headless browser can exercise the
// inlined wasm. Not part of the installed bundle.
import { parseModel } from '../src/viewer.js'
window.__dsh3dSmoke = { parseModel }
