// Resource-release helpers. Deliberately three.js-free: they only rely on the
// duck-typed surface of Object3D / Material / Texture (`traverse`, `geometry`,
// `material`, `isTexture`, `dispose`), so plain Node can unit-test them with
// mocks (scripts/test-viewer.mjs) without importing three or the wasm.

/**
 * Dispose every texture referenced by a material, then the material itself.
 * three's Material.dispose() only drops the material; maps such as `map`,
 * `normalMap` and `aoMap` keep their GPU textures alive unless disposed too.
 */
export function disposeMaterial(material) {
  if (!material || typeof material !== 'object') return
  for (const value of Object.values(material)) {
    if (value && value.isTexture === true) value.dispose?.()
  }
  material.dispose?.()
}

/** Dispose geometries and materials (with their textures) under an Object3D. */
export function disposeObject3D(root) {
  if (!root || typeof root.traverse !== 'function') return
  root.traverse((node) => {
    node.geometry?.dispose?.()
    if (Array.isArray(node.material)) node.material.forEach(disposeMaterial)
    else disposeMaterial(node.material)
  })
}
