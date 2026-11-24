import { Link } from 'react-router-dom'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { visibleBranchIds } from '../lib/permissions'
import type { Branch, Item } from '../lib/types'
import { PageHeader } from '../components/ui'

export function Dashboard() {
  const me = useProfile()
  const branches = useCollection<Branch>(COL.branches)
  const items = useCollection<Item>(COL.items)
  const myBranches = visibleBranchIds(me, branches.rows.filter((b) => b.active).map((b) => b.id))
  const activeItems = items.rows.filter((i) => i.active)

  const steps = [
    { done: branches.rows.length > 0, text: 'Add your branches', to: '/branches' },
    { done: activeItems.length > 0, text: 'Add the items you keep in stock', to: '/items' },
    { done: false, text: 'Add your staff and give them branches', to: '/users' },
  ]

  return (
    <>
      <PageHeader title={`Hello, ${me.name}`} subtitle="Here is your stock at a glance." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Branches" value={myBranches.length} />
        <Stat label="Items in use" value={activeItems.length} />
        <Stat label="Low stock alerts" value="—" note="Coming in phase 5" />
      </div>
      <div className="card">
        <h2 className="mb-2 font-semibold text-bean-900">Getting started</h2>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.text} className="flex items-center gap-2 text-sm">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${s.done ? 'bg-green-600 text-white' : 'bg-stone-200'}`}>
                {s.done ? '✓' : i + 1}
              </span>
              <Link to={s.to} className="hover:underline">
                {s.text}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-semibold text-bean-900">{value}</div>
      {note && <div className="text-xs text-stone-400">{note}</div>}
    </div>
  )
}
