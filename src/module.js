// Registration logic. Two independent hosts:
//   1. dsh-better-sidebar's file tree (registerFileViewer) — primary
//   2. DSH's own document preview (documentPreviews + sidebar.right.tab.document) — fallback
import { createComponents } from './body.js'

export const VIEWER_EXTS = ['step', 'stp', 'stl', 'glb', 'gltf']
export const BODY_ID = 'dsh-3d-viewer:body'
export const VIEWER_ID = 'dsh-3d-viewer:file'

/** Resolve a better-sidebar host route without hard-coding a leading slash. */
function hostRoute(service, relative) {
  if (service && typeof service.hostRouteUrl === 'function') return service.hostRouteUrl(relative)
  return new URL(relative, document.baseURI).toString()
}

export function createPlugin(React) {
  const { SidebarBody, NativeBody } = createComponents(React)

  function registerNative(ctx) {
    const registry = ctx.documentPreviews
    if (!registry || typeof registry.register !== 'function') throw new Error('documentPreviews 服务不存在')
    if (!ctx.slots || typeof ctx.slots.register !== 'function') throw new Error('slots 服务不存在')

    ctx.effect(() => registry.register({
      id: BODY_ID,
      extensions: VIEWER_EXTS,
      binaryExtensions: VIEWER_EXTS,
      priority: 'extension',
      title: () => '3D 模型',
      loading: 'bytes-complete',
      wrap: false,
    }), 'dsh-3d-viewer: native metadata')

    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
      name: 'sidebar.right.tab.document',
      key: BODY_ID,
    }, NativeBody)), 'dsh-3d-viewer: native body')
  }

  function registerSidebar(service, effect) {
    if (!service || typeof service.registerFileViewer !== 'function') return false
    effect(() => service.registerFileViewer({
      id: VIEWER_ID,
      title: '3D 模型',
      exts: VIEWER_EXTS,
      // above the builtin code catch-all (-100) and markdown/html (0)
      priority: 20,
      fetchStrategy: 'custom',
      load: async (path, scope, signal) => {
        const query = new URLSearchParams({ sessionId: scope.sessionId, path })
        const response = await fetch(hostRoute(service, `sidebar/file?${query}`), { signal })
        if (!response.ok) throw new Error(`读取失败：HTTP ${response.status}`)
        return { buffer: await response.arrayBuffer(), path }
      },
      component: SidebarBody,
    }), 'dsh-3d-viewer: better-sidebar viewer')
    return true
  }

  return {
    inject: ['slots'],
    apply(ctx) {
      // 两个宿主各走一个带 inject 的子 fiber:服务不存在时那一路自然不激活,
      // 也不会把整条插件拖死。注意不能直接读 ctx.documentPreviews ——
      // Cordis 对未声明 inject 的服务属性会抛 "cannot get property ... without inject"。
      try {
        if (typeof ctx.inject !== 'function') throw new Error('ctx.inject 不可用')
        ctx.inject(['slots', 'documentPreviews'], (scope) => {
          try {
            registerNative(scope)
          } catch (error) {
            console.warn('[dsh-3d-viewer] 原生文档预览未注册（软降级）：', error)
          }
        })
      } catch (error) {
        console.warn('[dsh-3d-viewer] 原生文档预览接入失败（软降级）：', error)
      }
      try {
        if (typeof ctx.inject !== 'function') {
          console.warn('[dsh-3d-viewer] ctx.inject 不可用，跳过 better-sidebar 接入')
          return
        }
        ctx.inject(['betterSidebar'], (scope) => {
          try {
            // a scoped ctx carries the service; effect may live on either ctx
            const effect = typeof scope.effect === 'function' ? scope.effect.bind(scope) : ctx.effect.bind(ctx)
            registerSidebar(scope.betterSidebar ?? ctx.betterSidebar, effect)
          } catch (error) {
            console.warn('[dsh-3d-viewer] better-sidebar 文件预览器未注册（软降级）：', error)
          }
        })
      } catch (error) {
        console.warn('[dsh-3d-viewer] better-sidebar 接入失败（软降级）：', error)
      }
    },
  }
}
