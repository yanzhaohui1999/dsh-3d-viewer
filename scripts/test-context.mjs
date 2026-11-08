// Unit test for the WebGL context-loss wiring (review 2026-11-08 P3-3).
// Plain Node, no DOM and no GPU: ../src/context.js is deliberately framework-free,
// so a mock canvas can drive the real event callbacks.
// Run: npm test
import assert from 'node:assert/strict'
import { installContextRecovery, CONTEXT_LOST, CONTEXT_RESTORED } from '../src/context.js'

let assertions = 0
function ok(actual, expected, label) {
  assert.deepEqual(actual, expected, label)
  assertions += 1
}

function fakeCanvas() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn))
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event)
    },
  }
}

// ---------------------------------------------------------------------------
// A lost context must be cancelled (otherwise the browser never restores it),
// and both callbacks must be reachable from the canvas events.
// ---------------------------------------------------------------------------
{
  const canvas = fakeCanvas()
  const seen = []
  let prevented = 0
  const detach = installContextRecovery(canvas, {
    onLost: (event) => seen.push(['lost', event.type]),
    onRestored: (event) => seen.push(['restored', event.type]),
  })

  ok(canvas.listeners.get(CONTEXT_LOST)?.length, 1, 'lost listener installed')
  ok(canvas.listeners.get(CONTEXT_RESTORED)?.length, 1, 'restored listener installed')

  canvas.dispatch(CONTEXT_LOST, { type: CONTEXT_LOST, preventDefault: () => { prevented += 1 } })
  ok(prevented, 1, 'webglcontextlost calls preventDefault exactly once')
  ok(seen[0], ['lost', CONTEXT_LOST], 'onLost runs after preventDefault')

  canvas.dispatch(CONTEXT_RESTORED, { type: CONTEXT_RESTORED })
  ok(seen[1], ['restored', CONTEXT_RESTORED], 'onRestored runs on webglcontextrestored')

  detach()
  ok(canvas.listeners.get(CONTEXT_LOST)?.length, 0, 'detach removes the lost listener')
  ok(canvas.listeners.get(CONTEXT_RESTORED)?.length, 0, 'detach removes the restored listener')
  canvas.dispatch(CONTEXT_RESTORED, { type: CONTEXT_RESTORED })
  ok(seen.length, 2, 'detached callbacks are not invoked')
  assert.doesNotThrow(detach, 'detach is idempotent')
  assertions += 1
}

// Defensive shapes: a missing target, missing handlers and an event without
// preventDefault must all be no-ops instead of throwing from inside the handler.
{
  assert.doesNotThrow(() => installContextRecovery(null, {}), 'null canvas returns a no-op')
  assertions += 1
  assert.doesNotThrow(() => installContextRecovery(undefined), 'undefined canvas returns a no-op')
  assertions += 1

  const canvas = fakeCanvas()
  let lost = 0
  const detach = installContextRecovery(canvas, { onLost: () => { lost += 1 } })
  assert.doesNotThrow(
    () => canvas.dispatch(CONTEXT_LOST, { type: CONTEXT_LOST }),
    'an event without preventDefault does not throw',
  )
  assertions += 1
  ok(lost, 1, 'onLost still runs without a preventDefault method')
  detach()
}

console.log(`test-context: ${assertions} assertions PASS`)
