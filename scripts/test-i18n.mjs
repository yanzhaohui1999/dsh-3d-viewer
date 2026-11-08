// Unit test for the UI dictionaries and translator wiring (review 2026-11-08
// P3-2). Plain Node: ../src/i18n.js imports the same locale/*.json files the
// plugin ships, and takes a fake locale service for the host path.
// Run: npm test
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  LOCALE_NAMESPACE,
  UI_DICTIONARIES,
  attachTranslator,
  createTranslator,
  detectLocale,
  pickLocale,
} from '../src/i18n.js'

let assertions = 0
function ok(actual, expected, label) {
  assert.deepEqual(actual, expected, label)
  assertions += 1
}
function truthy(value, label) {
  assert.ok(value, label)
  assertions += 1
}

const zhFile = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'))
const enFile = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'))

// ---------------------------------------------------------------------------
// Both files carry the same UI keys, every value is a non-empty string, and
// the plugin metadata stays present (the host reads meta.title/description).
// ---------------------------------------------------------------------------
const zhKeys = Object.keys(UI_DICTIONARIES.zh).sort()
const enKeys = Object.keys(UI_DICTIONARIES.en).sort()
ok(zhKeys, enKeys, 'zh and en UI dictionaries have identical keys')
truthy(zhKeys.length >= 10, 'UI dictionary has the toolbar and status entries')
for (const [locale, dict] of Object.entries(UI_DICTIONARIES)) {
  for (const [key, value] of Object.entries(dict)) {
    truthy(typeof value === 'string' && value.trim().length > 0, `${locale}.${key} is a non-empty string`)
  }
}
truthy(zhFile.meta?.title && zhFile.meta?.description, 'zh.json keeps plugin metadata')
truthy(enFile.meta?.title && enFile.meta?.description, 'en.json keeps plugin metadata')
ok(zhFile.ui, UI_DICTIONARIES.zh, 'zh.json ui block is the dictionary source')
ok(enFile.ui, UI_DICTIONARIES.en, 'en.json ui block is the dictionary source')

// ---------------------------------------------------------------------------
// Locale selection and translation.
// ---------------------------------------------------------------------------
ok(pickLocale(['zh-CN', 'en-US']), 'zh', 'first supported language wins')
ok(pickLocale(['ja-JP', 'en-US']), 'en', 'unsupported languages are skipped')
ok(pickLocale([]), 'en', 'empty language list falls back to en')
ok(detectLocale({ languages: ['zh-HK'] }), 'zh', 'navigator.languages drives detection')
ok(detectLocale({ language: 'en-GB' }), 'en', 'navigator.language is the single-value fallback')
ok(detectLocale({}), 'en', 'missing navigator data falls back to en')

const en = createTranslator('en')
const zh = createTranslator('zh')
ok(en('fit'), 'Fit', 'en toolbar label')
ok(zh('fit'), '适配', 'zh toolbar label')
ok(en('loading'), 'Loading…', 'en loading status')
ok(zh('loading'), '解析中…', 'zh loading status')
ok(en('stats', { triangles: 12, size: '10.00 × 10.00 × 10.00' }), '12 triangles · 10.00 × 10.00 × 10.00 mm', 'en stats interpolate count and size')
ok(zh('stats', { triangles: 12, size: '10.00 × 10.00 × 10.00' }), '12 三角面 · 10.00 × 10.00 × 10.00 mm', 'zh stats interpolate count and size')
ok(en('missing-key'), 'missing-key', 'unknown keys stay visible instead of blank')
ok(createTranslator('fr')('fit'), 'Fit', 'unsupported locale falls back to en')
ok(createTranslator('en')('stats', { triangles: 3 }), '3 triangles · {size} mm', 'missing params keep their placeholder')

// ---------------------------------------------------------------------------
// Host wiring: dictionaries are registered under our namespace, host text
// wins, and keys the host does not know fall back to the local dictionary.
// ---------------------------------------------------------------------------
{
  const registered = []
  const locale = {
    register(ns, dictionaries) {
      registered.push({ ns, dictionaries })
      return () => {}
    },
    bind(ns) {
      return (key, params) => (ns === LOCALE_NAMESPACE && key === 'fit' ? 'Anpassen' : key)
    },
  }
  const ctx = {
    get: (name) => (name === 'locale' ? locale : undefined),
    effect: (fn) => fn(),
  }
  const t = attachTranslator(ctx)
  ok(registered.length, 1, 'locale service receives one registration')
  ok(registered[0].ns, LOCALE_NAMESPACE, 'registration uses the plugin namespace')
  ok(registered[0].dictionaries, UI_DICTIONARIES, 'registration carries both dictionaries')
  ok(t('fit'), 'Anpassen', 'host translation wins when present')
  truthy(['Front', '前'].includes(t('front')), 'unknown host key falls back to the local dictionary')
  ok(t('stats', { triangles: 1, size: '1.00 × 1.00 × 1.00' }).includes('{triangles}'), false, 'fallback interpolation runs')
}

{
  // No locale service (older host / standalone page): local translator only.
  const t = attachTranslator({ effect: (fn) => fn() })
  truthy(['Fit', '适配'].includes(t('fit')), 'missing locale service does not break translation')
  truthy(['No file content was received', '没有读到文件内容'].includes(t('noContent')), 'local fallback covers status text')
}

console.log(`test-i18n: ${assertions} assertions PASS`)
