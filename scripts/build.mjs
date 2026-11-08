// Rebuild lib/client.js. The committed bundle is what users install, so this
// only needs to run when src/ changes.
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const outfile = resolve(root, 'lib/client.js')

// esbuild is pinned in devDependencies (exactly 0.25.0) and resolved from
// node_modules. The old `npx --yes esbuild@0.25.0` reached the network on every
// build and, when its cache was bad, failed without showing esbuild's stderr.
let esbuild
try {
  esbuild = require.resolve('esbuild/bin/esbuild')
} catch {
  console.error('找不到 esbuild：请先在仓库根目录运行 npm ci（esbuild 已钉在 devDependencies）')
  process.exit(1)
}

const args = [
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
  `--outfile=${outfile}`,
]

try {
  execFileSync(esbuild, args, {
    cwd: root,
    encoding: 'utf8',
    // Capture both streams: with `stdio: 'inherit'` a failure only left
    // `output: [null, null, null]` and esbuild's own diagnostic was lost.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  if (error.stdout) process.stdout.write(String(error.stdout))
  const stderr = error.stderr ? String(error.stderr) : ''
  if (stderr) process.stderr.write(stderr)
  const status = error.status == null ? '' : `（exit ${error.status}）`
  console.error(`esbuild 构建失败${status}`)
  process.exit(1)
}

console.log(`built lib/client.js (${statSync(outfile).size} bytes)`)
