// Client entry. The DSH client module loader hands us `require`, which only
// resolves modules DSH itself registered (react, react-dom, ...). Everything
// else — three, occt-import-js, the OpenCASCADE wasm — is bundled below.
import { createPlugin } from './module.js'

window.__ModuleLoader__.load({
  id: 'dsh-3d-viewer',
  factory(require) {
    const React = require('react')
    return createPlugin(React)
  },
})
