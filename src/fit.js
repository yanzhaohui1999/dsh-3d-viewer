// Pure framing helper. Kept free of three.js / DOM / wasm imports so plain
// Node can unit-test it (scripts/test-fit.mjs).

/**
 * Half-height of the orthographic frustum for a model whose largest bounding-box
 * dimension is `size`.
 *
 * The old `size * 0.75 + 1` added a fixed 1 world unit of margin, which is fine
 * for a 100 mm part but dwarfs a 0.5 mm screw: the model became ~1/3 of a pixel
 * (review 2026-11-08 P3-1). Padding has to scale with the model instead.
 *
 * 0.75 * size leaves the model at ~62.5% of the viewport height; 5% of size
 * provides the margin, floored at 1e-3 so a degenerate (zero-size) box still
 * gets a usable camera.
 */
export function radiusFor(size) {
  const s = Number.isFinite(size) && size > 0 ? size : 0
  return s * 0.75 + Math.max(s * 0.05, 1e-3)
}

/**
 * Camera distance and clip planes for the orthographic frustum.
 *
 * The camera sits `distance = radius * 4` away from the model centre. A fixed
 * `near = 0.1` (the previous code) clipped any model whose near face was
 * closer than 0.1 world units: a 0.02 mm cube sits only ~0.048 units in front
 * of the camera, entirely before the near plane, so it rendered black (review
 * 2026-11-08 fix5). near has to scale with the camera distance; far already
 * scaled with distance and radius and keeps doing so.
 */
export function clipPlanesFor(radius) {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1e-3
  const distance = r * 4
  return {
    distance,
    near: Math.max(distance / 1000, 1e-6),
    // view depth of the model is distance ± r; keep a 4x margin on both sides.
    far: distance * 4 + r * 4,
  }
}
