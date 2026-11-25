import { createContext, useContext, type ReactNode } from 'react'
import { KM, KM_PATTERNS } from './km'

// Two languages: English and Khmer.
//
// How it works: every piece of screen text goes through t('English text').
// In English, t() gives the text back unchanged. In Khmer, it looks the text up
// in the Khmer list (km.ts). Anything missing from that list stays in English,
// so a forgotten phrase never shows a blank.
//
// Words inside {curly brackets} are filled in: t('{n} days left', { n: 3 }).
// Each person's choice is saved on their own phone or computer.

export type Lang = 'en' | 'km'
const STORAGE_KEY = 'grove-stock-lang'

function savedLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'km' ? 'km' : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang = savedLang()
if (typeof document !== 'undefined') document.documentElement.lang = current

export const getLang = () => current

/** For dates: Khmer month names in Khmer, "25 Nov 2026" in English. */
export const dateLocale = () => (current === 'km' ? 'km-KH' : 'en-GB')

/** For tests. */
export function setLangForTest(l: Lang) {
  current = l
}

export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  let s = current === 'km' ? (KM[text] ?? text) : text
  if (vars) s = s.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k] ?? '') : m))
  return s
}

/** Messages that come from the server, such as "Fresh milk: Not enough stock: only 200 left". */
export function tMessage(message: string): string {
  if (current !== 'km') return message
  if (KM[message]) return KM[message]
  for (const [re, make] of KM_PATTERNS) {
    const m = message.match(re)
    if (m) return make(m)
  }
  return message
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} })

export function LanguageProvider({ children }: { children: ReactNode }) {
  function setLang(l: Lang) {
    if (l === current) return
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // Some private browsing modes cannot save it; then the switch does nothing.
    }
    // Reloading draws every page again in the new language. You stay signed in.
    window.location.reload()
  }
  return <Ctx.Provider value={{ lang: current, setLang }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)

/** The "English | ខ្មែរ" switch. */
export function LanguageSwitch({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLang()
  const base = 'rounded-md px-2 py-1 text-xs font-medium'
  const on = dark ? 'bg-white text-bean-900' : 'bg-bean-700 text-white'
  const off = dark ? 'text-bean-100 hover:bg-white/10' : 'text-stone-600 hover:bg-stone-100'
  return (
    <div className={`inline-flex gap-0.5 rounded-lg border p-0.5 ${dark ? 'border-white/30' : 'border-stone-300'}`} role="group" aria-label="Language / ភាសា">
      <button type="button" className={`${base} ${lang === 'en' ? on : off}`} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>
        English
      </button>
      <button type="button" className={`${base} ${lang === 'km' ? on : off}`} onClick={() => setLang('km')} aria-pressed={lang === 'km'}>
        ខ្មែរ
      </button>
    </div>
  )
}
