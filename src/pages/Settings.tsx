import { useEffect, useState, type FormEvent } from 'react'
import { saveSettings, useSettings } from '../lib/data'
import { ErrorNote, Field, PageHeader, friendlyError } from '../components/ui'

export function Settings() {
  const current = useSettings()
  const [rate, setRate] = useState(String(current.usdToKhr))
  const [cats, setCats] = useState(current.categories.join('\n'))
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRate(String(current.usdToKhr))
    setCats(current.categories.join('\n'))
  }, [current])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const r = Number(rate)
    if (!(r > 0)) return setError('Exchange rate must be more than 0.')
    const categories = [...new Set(cats.split('\n').map((c) => c.trim()).filter(Boolean))]
    try {
      await saveSettings({ usdToKhr: r, categories })
      setMsg('Saved.')
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <form onSubmit={submit} className="card max-w-md space-y-4">
        <ErrorNote message={error} />
        {msg && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
        <Field label="1 USD = ? riel" hint="Costs are saved in USD and shown in riel with this rate, like grove-system-kh.">
          <input className="input" type="number" min="1" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Item categories (one per line)">
          <textarea className="input min-h-40" value={cats} onChange={(e) => setCats(e.target.value)} />
        </Field>
        <button className="btn">Save settings</button>
      </form>
    </>
  )
}
