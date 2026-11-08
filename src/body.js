// React components for both hosts. React is injected so the bundle never has to
// resolve it through esbuild (the DSH loader supplies it at runtime).
import { ModelViewer, parseModel, extOf } from './viewer.js'
import { disposeObject3D } from './dispose.js'

const TOOLBAR = [
  ['适配', 'fit'],
  ['前', 'front'],
  ['顶', 'top'],
  ['侧', 'side'],
  ['等轴', 'iso'],
  ['截图', 'shot'],
]

function toArrayBuffer(data) {
  if (!data) return undefined
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  return undefined
}

function basename(path) {
  const clean = String(path || '').split(/[?#]/)[0]
  return clean.slice(clean.lastIndexOf('/') + 1) || 'model'
}

export function createComponents(React) {
  const { useEffect, useRef, useState, useMemo, createElement: h } = React

  function ViewerSurface({ bytes, path }) {
    const hostRef = useRef(null)
    const viewerRef = useRef(null)
    const [state, setState] = useState({ kind: 'loading' })
    const ext = useMemo(() => extOf(path), [path])
    const buffer = useMemo(() => toArrayBuffer(bytes), [bytes])

    useEffect(() => {
      const host = hostRef.current
      if (!host) return undefined
      if (!buffer) {
        setState({ kind: 'error', message: '没有读到文件内容' })
        return undefined
      }
      let alive = true
      let viewer
      try {
        viewer = new ModelViewer(host)
      } catch (error) {
        // three's WebGLRenderer throws when no context can be created (GPU
        // disabled, headless host, browser policy). If that escapes the effect
        // the panel stays on 「解析中…」 forever, so surface it instead.
        console.warn('[dsh-3d-viewer] WebGL 初始化失败：', error)
        setState({ kind: 'error', message: '当前环境不支持 WebGL' })
        return undefined
      }
      viewerRef.current = viewer
      setState({ kind: 'loading' })
      parseModel(buffer, ext).then((model) => {
        if (!alive) {
          // The effect was torn down while the model was still parsing: the
          // viewer and its GL context are already gone, so release the
          // geometry/materials/textures we just built instead of leaking them
          // for the rest of the page's life.
          disposeObject3D(model.group)
          return
        }
        viewer.setModel(model)
        setState({ kind: 'ready', triangles: model.triangles, size: model.size })
      }).catch((error) => {
        if (alive) setState({ kind: 'error', message: error?.message || String(error) })
      })
      return () => {
        alive = false
        viewer.dispose()
        viewerRef.current = null
      }
    }, [buffer, ext])

    useEffect(() => {
      const host = hostRef.current
      if (!host) return undefined
      const onDouble = () => viewerRef.current?.fit('iso')
      host.addEventListener('dblclick', onDouble)
      return () => host.removeEventListener('dblclick', onDouble)
    }, [])

    const act = (kind) => {
      const viewer = viewerRef.current
      if (!viewer) return
      if (kind === 'shot') viewer.screenshot(basename(path))
      else viewer.fit(kind)
    }

    const size = state.kind === 'ready'
      ? `${state.size.map((n) => n.toFixed(2)).join(' × ')} mm`
      : ''
    const stats = state.kind === 'ready' ? `${state.triangles} 三角面 · ${size}` : ''

    return h('div', {
      style: {
        position: 'relative', display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%', minHeight: 0, background: '#11161c', color: '#c9d4e0',
        font: '12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
    },
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
        borderBottom: '1px solid #1f2833', flex: '0 0 auto',
      },
    }, TOOLBAR.map(([label, kind]) => h('button', {
      key: kind,
      type: 'button',
      onClick: () => act(kind),
      style: {
        padding: '2px 8px', borderRadius: 4, border: '1px solid #263241',
        background: '#161d26', color: '#c9d4e0', cursor: 'pointer', font: 'inherit',
      },
    }, label))),
    h('div', { ref: hostRef, style: { position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } }),
    h('div', {
      style: {
        flex: '0 0 auto', padding: '3px 8px', borderTop: '1px solid #1f2833',
        color: state.kind === 'error' ? '#ff9b9b' : '#7f8fa3', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      },
    }, state.kind === 'error'
      ? state.message
      : state.kind === 'ready' ? stats : '解析中…'))
  }

  /** better-sidebar file viewer body: bytes come from our own load(). */
  function SidebarBody(props) {
    const data = props?.customData
    return h(ViewerSurface, { bytes: data?.buffer, path: props?.path })
  }

  /** Native document preview body: the host hands us complete bytes. */
  function NativeBody(props) {
    const content = props?.content
    const bytes = content?.kind === 'bytes' ? content.data : undefined
    return h(ViewerSurface, { bytes, path: props?.resourceAddress })
  }

  return { ViewerSurface, SidebarBody, NativeBody }
}
