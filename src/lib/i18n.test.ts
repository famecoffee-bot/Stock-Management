/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLangForTest, t, tMessage } from './i18n'
import { KM } from './km'

// Every t('…') phrase in the app, found by reading the source files.
function phrasesInSource(dir: string, out = new Map<string, string>()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) phrasesInSource(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'km.ts' && name !== 'i18n.tsx') {
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
        const text = m[2].replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1')
        if (!out.has(text)) out.set(text, p)
      }
    }
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('Khmer wording', () => {
  const phrases = phrasesInSource(join(__dirname, '..'))

  it('finds the phrases', () => {
    expect(phrases.size).toBeGreaterThan(500)
  })

  it('has Khmer for every phrase on screen', () => {
    const missing = [...phrases].filter(([text]) => !(text in KM)).map(([text, file]) => `${file}: ${text}`)
    expect(missing).toEqual([])
  })

  it('keeps the {placeholders} in the Khmer', () => {
    const wrong = Object.entries(KM).filter(([en, km]) => placeholders(en).join() !== placeholders(km).join())
    expect(wrong).toEqual([])
  })
})

describe('t()', () => {
  afterEach(() => setLangForTest('en'))

  it('gives English back unchanged, with values filled in', () => {
    expect(t('Stock')).toBe('Stock')
    expect(t('{d} days left', { d: 3 })).toBe('3 days left')
  })

  it('gives Khmer when Khmer is chosen', () => {
    setLangForTest('km')
    expect(t('Stock')).toBe('ស្តុក')
    expect(t('{d} days left', { d: 3 })).toBe('នៅសល់ 3 ថ្ងៃ')
  })

  it('falls back to English for a phrase without Khmer', () => {
    setLangForTest('km')
    expect(t('Something new')).toBe('Something new')
  })

  it('translates server messages, keeping item names and numbers', () => {
    setLangForTest('km')
    expect(tMessage('Fresh milk: Not enough stock: only -2300 left.')).toBe('Fresh milk៖ ស្តុកមិនគ្រប់គ្រាន់ទេ នៅសល់តែ -2300 ប៉ុណ្ណោះ។')
    expect(tMessage('You need manager rights at this branch.')).toBe('អ្នកត្រូវមានសិទ្ធិអ្នកគ្រប់គ្រងនៅសាខានេះ។')
    expect(tMessage('Transfer not found.')).toBe('រកមិនឃើញការផ្ទេរទេ។')
    expect(tMessage('Something the app never heard of')).toBe('Something the app never heard of')
  })
})
