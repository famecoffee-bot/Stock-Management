import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { limit, orderBy, where, type QueryConstraint } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useBranch } from '../lib/branch'
import { WASTE_REASONS, type Item, type Movement, type MovementType } from '../lib/types'
import { formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, PageHeader } from '../components/ui'
import { dateLocale, t } from '../lib/i18n'

const TYPE_TEXT: Record<MovementType, { label: string; tone: 'green' | 'red' | 'amber' | 'stone' }> = {
  receive: { label: t('Received'), tone: 'green' },
  transfer_in: { label: t('Transfer in'), tone: 'green' },
  transfer_out: { label: t('Transfer out'), tone: 'amber' },
  waste: { label: t('Waste'), tone: 'red' },
  adjust: { label: t('Adjust'), tone: 'stone' },
  sale: { label: t('Sale'), tone: 'stone' },
  sale_void: { label: t('Sale cancelled'), tone: 'amber' },
  count: { label: t('Stock count'), tone: 'stone' },
}
const reasonText = (r: string | null) => WASTE_REASONS.find((w) => w.value === r)?.label ?? r ?? ''
const PAGE = 200

export function History() {
  const { current } = useBranch()
  const [params, setParams] = useSearchParams()
  const type = (params.get('type') ?? '') as MovementType | ''
  const itemId = params.get('item') ?? ''
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const [size, setSize] = useState(PAGE)

  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [where('branchId', '==', current?.id ?? '')]
    if (type) c.push(where('type', '==', type))
    else if (itemId) c.push(where('itemId', '==', itemId))
    c.push(orderBy('createdAt', 'desc'), limit(size))
    return c
  }, [current?.id, type, itemId, size])
  const moves = useCollection<Movement>(COL.movements, constraints, `${current?.id}|${type}|${itemId}|${size}`, !current)
  // when both filters are set, the type is filtered by the database and the item here
  const list = type && itemId ? moves.rows.filter((m) => m.itemId === itemId) : moves.rows
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>

  return (
    <>
      <PageHeader title={t('History · {name}', { name: current.name })} subtitle={t('Every change to stock, newest first. Nothing here can be edited or deleted.')} />
      <ErrorNote message={moves.error} />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input max-w-[12rem]" value={type} onChange={(e) => set('type', e.target.value)}>
          <option value="">{t('All kinds')}</option>
          {Object.entries(TYPE_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select className="input max-w-[14rem]" value={itemId} onChange={(e) => set('item', e.target.value)}>
          <option value="">{t('All items')}</option>
          {items.rows.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      {!moves.loading && list.length === 0 ? (
        <Empty>{t('No changes yet.')}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[680px]">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">{t('When')}</th>
                <th className="th">{t('Item')}</th>
                <th className="th">{t('Kind')}</th>
                <th className="th text-right">{t('Change')}</th>
                <th className="th text-right">{t('After')}</th>
                <th className="th text-right">{t('Value')}</th>
                <th className="th">{t('By · why')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td className="td whitespace-nowrap text-xs text-stone-500">
                    {m.createdAt?.toDate().toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' }) ?? '…'}
                  </td>
                  <td className="td">{m.itemName}</td>
                  <td className="td">
                    <Badge tone={TYPE_TEXT[m.type]?.tone ?? 'stone'}>{TYPE_TEXT[m.type]?.label ?? m.type}</Badge>
                  </td>
                  <td className={`td text-right font-medium ${m.qtyChange < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {m.qtyChange > 0 ? '+' : ''}
                    {formatQty(m.qtyChange, m.baseUnit)}
                  </td>
                  <td className="td text-right text-stone-500">{formatQty(m.qtyAfter, m.baseUnit)}</td>
                  <td className="td text-right text-stone-500">{formatUsd(m.valueUsd)}</td>
                  <td className="td text-xs">
                    {m.userName}
                    {(m.reason || m.note || m.expiryDate) && (
                      <div className="text-stone-400">
                        {[reasonText(m.reason), m.note, m.expiryDate && t('expires {date}', { date: m.expiryDate })].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moves.rows.length >= size && (
        <button className="btn-ghost mt-3 w-full" onClick={() => setSize((s) => s + PAGE)}>
          {t('Show older')}
        </button>
      )}
    </>
  )
}
