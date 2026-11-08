// Unit test for extOf (review 2026-11-08 P1-2). Plain Node, no three/wasm:
// extOf lives in ../src/format.js precisely so this file can import the real
// implementation instead of re-declaring it. Run: npm test
import assert from 'node:assert/strict'
import { extOf } from '../src/format.js'

const cases = [
  // The regression: native preview passes resourceAddress, which may carry a
  // query string or fragment. The old regex anchored on `$` and returned ''.
  ['model.step?x=1', 'step'],
  ['a.GLB#k', 'glb'],
  ['https://host/files/model.STEP?session=1#frag', 'step'],
  // Plain paths and non-paths keep working.
  ['samples/cube-10mm.stl', 'stl'],
  ['viewer.js', 'js'],
  ['dir.v2/model', ''],       // dot in a directory is not an extension
  ['README', ''],
  ['', ''],
  [undefined, ''],
]

let assertions = 0
for (const [input, expected] of cases) {
  assert.equal(extOf(input), expected, `extOf(${JSON.stringify(input)})`)
  assertions += 1
}
console.log(`test-extof: ${assertions} assertions PASS`)
