// UI chrome strings live in locale/{zh,en}.json so the plugin metadata and the
// rendered interface share one source. When DSH's locale service is available
// the same dictionaries are registered there and translation follows the
// Host-backed locale preference; standalone (smoke pages, unit tests, older
// hosts) falls back to the browser language, then English.
import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

/** Namespace used when registering the dictionaries with DSH's locale service. */
export const LOCALE_NAMESPACE = 'dsh3dViewer'
const FALLBACK_LOCALE = 'en'
/** Flat key → text dictionaries derived from the locale files. */
export const UI_DICTIONARIES = Object.freeze({ zh: zh.ui, en: en.ui })

function primarySubtag(tag) {
  return String(tag || '').toLowerCase().split('-')[0]
}

/** Pick the first supported language from a `navigator.languages` style list. */
export function pickLocale(languages = []) {
  for (const tag of languages) {
    const primary = primarySubtag(tag)
    if (primary === 'zh' || primary === 'en') return primary
  }
  return FALLBACK_LOCALE
}

/** Browser-derived locale, used only when the host locale service is absent. */
export function detectLocale(nav = globalThis.navigator) {
  const languages = Array.isArray(nav?.languages) && nav.languages.length > 0
    ? nav.languages
    : nav?.language ? [nav.language] : []
  return pickLocale(languages)
}

/** Local translator with `{name}` interpolation, mirroring the host's `bind()`. */
export function createTranslator(locale = detectLocale(), dictionaries = UI_DICTIONARIES) {
  const dict = dictionaries[locale] || dictionaries[FALLBACK_LOCALE]
  const fallback = dictionaries[FALLBACK_LOCALE]
  return function translate(key, params) {
    const template = dict[key] ?? fallback[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ))
  }
}

/**
 * Register the dictionaries with DSH's locale service (when present) and return
 * a translate function. Host translations win so a language switch is picked up
 * live; keys the host does not know fall back locally instead of rendering the
 * raw key.
 */
export function attachTranslator(ctx) {
  const locale = typeof ctx?.get === 'function' ? ctx.get('locale') : undefined
  if (locale && typeof locale.register === 'function') {
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => locale.register(LOCALE_NAMESPACE, UI_DICTIONARIES), 'dsh-3d-viewer: locale dictionaries')
      } else {
        locale.register(LOCALE_NAMESPACE, UI_DICTIONARIES)
      }
    } catch (error) {
      console.warn('[dsh-3d-viewer] 注册 locale 词条失败（回退到本地词表）：', error)
    }
  }

  const local = createTranslator(detectLocale())
  if (!locale || typeof locale.bind !== 'function') return local
  let host
  try {
    host = locale.bind(LOCALE_NAMESPACE)
  } catch (error) {
    console.warn('[dsh-3d-viewer] 绑定宿主 locale 失败（回退到本地词表）：', error)
    return local
  }
  return (key, params) => {
    const text = host(key, params)
    return text === key ? local(key, params) : text
  }
}
