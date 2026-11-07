// Headless check of the STEP pipeline: same library and same wasmBinary option
// the browser bundle uses, so a pass here means the parser half is sound.
// Defaults to the repo's 10 mm cube sample; pass a path to check your own file.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import occtimportjs from 'occt-import-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const stepPath = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'samples/cube-10mm.step')
const wasmPath = resolve(root, 'node_modules/occt-import-js/dist/occt-import-js.wasm')
const EXPECTED = [10.0, 10.0, 10.0]
const TOLERANCE = 0.5

const [wasm, step] = await Promise.all([readFile(wasmPath), readFile(stepPath)])
const occt = await occtimportjs({ wasmBinary: new Uint8Array(wasm) })
const result = occt.ReadStepFile(new Uint8Array(step), null)

if (!result || result.success === false) {
  console.error('FAIL: OpenCASCADE 拒绝了这份 STEP 文件')
  process.exit(1)
}

const meshes = result.meshes || []
let triangles = 0
const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (const mesh of meshes) {
  const position = mesh.attributes?.position?.array
  if (!position) continue
  triangles += (mesh.index?.array?.length || position.length / 3) / 3
  for (let i = 0; i < position.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = position[i + axis]
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
}

const size = min.map((value, axis) => max[axis] - value)
const sortedSize = [...size].sort((a, b) => a - b)
const sortedExpected = [...EXPECTED].sort((a, b) => a - b)
const diffs = sortedSize.map((value, index) => Math.abs(value - sortedExpected[index]))
const pass = diffs.every((diff) => diff <= TOLERANCE)

const shownPath = stepPath.startsWith(root) ? relative(root, stepPath) : stepPath
console.log(`file      ${shownPath}`)
console.log(`meshes    ${meshes.length}`)
console.log(`triangles ${Math.round(triangles)}`)
console.log(`bbox      ${size.map((n) => n.toFixed(2)).join(' x ')} mm`)
console.log(`expected  ${EXPECTED.map((n) => n.toFixed(2)).join(' x ')} mm (+/- ${TOLERANCE})`)
console.log(`max diff  ${Math.max(...diffs).toFixed(3)} mm`)
console.log(pass ? 'RESULT    PASS' : 'RESULT    FAIL')
process.exit(pass ? 0 : 1)
