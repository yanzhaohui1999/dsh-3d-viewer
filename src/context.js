// WebGL context-loss wiring, kept framework-free so Node can unit-test the
// event handling without a GPU (review 2026-11-08 P3-3).
export const CONTEXT_LOST = 'webglcontextlost'
export const CONTEXT_RESTORED = 'webglcontextrestored'

/**
 * Attach `webglcontextlost` / `webglcontextrestored` handlers to a canvas.
 *
 * The lost event must be cancelled: per the WebGL spec the browser only tries
 * to restore the context when `preventDefault()` was called. `onLost` and
 * `onRestored` run after that decision, so a throw inside them cannot turn a
 * recoverable context into a permanently lost one.
 *
 * @returns an idempotent detach function.
 */
export function installContextRecovery(target, { onLost, onRestored } = {}) {
  if (!target || typeof target.addEventListener !== 'function') return () => {}
  const handleLost = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof onLost === 'function') onLost(event)
  }
  const handleRestored = (event) => {
    if (typeof onRestored === 'function') onRestored(event)
  }
  target.addEventListener(CONTEXT_LOST, handleLost, false)
  target.addEventListener(CONTEXT_RESTORED, handleRestored, false)
  return () => {
    target.removeEventListener(CONTEXT_LOST, handleLost, false)
    target.removeEventListener(CONTEXT_RESTORED, handleRestored, false)
  }
}
