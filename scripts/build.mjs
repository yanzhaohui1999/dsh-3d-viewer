// Rebuild lib/client.js. The committed bundle is what users install, so this
// only needs to run when src/ changes.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

execFileSync('npx', [
  '--yes', 'esbuild@0.25.0',
  'src/client.js',
  '--bundle',
  '--format=iife',
  '--platform=browser',
  '--minify',
  // inline the 7.7 MB OpenCASCADE wasm as a Uint8Array; the viewer passes it as
  // `wasmBinary`, so no locateFile / fetch / static route is needed at runtime
  '--loader:.wasm=binary',
  // only reached inside emscripten's node-only branch, which never runs in the browser
  '--external:fs',
  '--external:path',
  '--outfile=lib/client.js',
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, npm_config_cache: '/tmp/npm-cache' },
})
