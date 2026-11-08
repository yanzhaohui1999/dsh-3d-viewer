// Unit test for the viewport framing helper (review 2026-11-08 P3-1).
// Plain Node, no three/wasm: radiusFor lives in ../src/fit.js precisely so this
// file can import the real implementation. Run: npm test
import assert from 'node:assert/strict'
import { clipPlanesFor, radiusFor } from '../src/fit.js'

let assertions = 0
function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${label}: expected ${expected}, got ${actual}`)
  assertions += 1
}
function ok(condition, label) {
  assert.ok(condition, label)
  assertions += 1
}

// The regression: a fixed +1 margin made a 0.5 mm screw ~2.8x smaller than a
// 500 mm part at the same zoom. Both scales must now fill the same fraction of
// the viewport (radius / size = 0.8 here).
close(radiusFor(0.5), 0.4, '0.5 mm screw')
close(radiusFor(500), 400, '500 mm part')
close(radiusFor(0.5) / 0.5, radiusFor(500) / 500, 'padding is proportional at both scales')
close(radiusFor(10), 8, '10 mm sample keeps a similar framing to before (8.0 vs 8.5)')

ok(radiusFor(0.5) > 0.25, '0.5 mm model still fits inside the frustum')
ok(radiusFor(500) > 250, '500 mm model still fits inside the frustum')

// fix5 regression: fit() used a fixed near = 0.1 while the camera sits
// distance = radius * 4 from the centre. A 0.02 mm cube is only ~0.048 units in
// front of the camera — entirely inside the near plane — so it rendered black.
for (const size of [0.02, 0.5, 500]) {
  const radius = radiusFor(size)
  const { distance, near, far } = clipPlanesFor(radius)
  close(distance, radius * 4, `${size} mm: camera distance is 4x radius`)
  ok(near > 0 && near < distance - radius, `${size} mm: near plane stays in front of the model`)
  ok(far > distance + radius, `${size} mm: far plane stays behind the model`)
}
const tiny = clipPlanesFor(radiusFor(0.02))
close(tiny.near, tiny.distance / 1000, 'near scales with camera distance instead of a fixed 0.1')
ok(tiny.near < 0.1, '0.02 mm model clears the old fixed near plane')

// Degenerate / invalid sizes keep a usable camera instead of a zero-height
// frustum or NaNs.
close(radiusFor(0), 1e-3, 'zero size falls back to the 1e-3 floor')
close(radiusFor(-5), 1e-3, 'negative size falls back to the floor')
close(radiusFor(NaN), 1e-3, 'NaN size falls back to the floor')
close(radiusFor(Infinity), 1e-3, 'infinite size falls back to the floor')

console.log(`test-fit: ${assertions} assertions PASS`)
