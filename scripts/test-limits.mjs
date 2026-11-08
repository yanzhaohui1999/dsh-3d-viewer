// Unit test for the parser input cap (review 2026-11-08 P3-4).
// Plain Node, no three/wasm: assertFileSize lives in ../src/limits.js.
// Run: npm test
import assert from 'node:assert/strict'
import { assertFileSize, MAX_FILE_BYTES } from '../src/limits.js'

let assertions = 0
function ok(fn, label) {
  assert.doesNotThrow(fn, label)
  assertions += 1
}
function throws(fn, pattern, label) {
  assert.throws(fn, pattern, label)
  assertions += 1
}

ok(() => assertFileSize({ byteLength: 0 }), 'empty buffer passes')
ok(() => assertFileSize({ byteLength: 1024 }), 'small buffer passes')
ok(() => assertFileSize({ byteLength: MAX_FILE_BYTES }), 'exactly 64 MiB passes')
throws(
  () => assertFileSize({ byteLength: MAX_FILE_BYTES + 1 }),
  /文件过大/,
  'one byte over the default cap is rejected',
)
throws(
  () => assertFileSize({ byteLength: 100 }, 10),
  /文件过大/,
  'an explicit smaller limit is honored',
)
throws(
  () => assertFileSize({ byteLength: 65 * 1024 * 1024 }),
  /文件过大：65 MB（68,157,440 字节），上限 64 MB/,
  'error reports both actual size and cap',
)
throws(
  () => assertFileSize({ byteLength: MAX_FILE_BYTES + 1 }),
  /67,108,865 字节/,
  'one byte over shows the exact byte count instead of rounding to 64.0 MB',
)
ok(() => assertFileSize(null), 'missing buffer is left to the parser')
assert.equal(MAX_FILE_BYTES, 64 * 1024 * 1024, 'default cap is 64 MiB')
assertions += 1

console.log(`test-limits: ${assertions} assertions PASS`)
