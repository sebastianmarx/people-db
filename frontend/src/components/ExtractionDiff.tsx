import { useState } from 'react'

import type { ExtractionResult, FieldChange } from '../api/types'
import { labelForPath, renderValue } from '../lib/format'

interface Props {
  result: ExtractionResult
  onApply: (changes: FieldChange[]) => void
  onDismiss: () => void
  busy?: boolean
}

/**
 * The model proposes; the user decides. Nothing here writes to the database
 * until the user taps Apply, which is what keeps a hallucinated value out of
 * the record.
 */
export default function ExtractionDiff({ result, onApply, onDismiss, busy }: Props) {
  const [accepted, setAccepted] = useState<Set<number>>(
    () => new Set(result.changes.map((_, i) => i)),
  )

  if (result.changes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300">
        <p>No new facts found in that note.</p>
        <button type="button" onClick={onDismiss} className="mt-2 text-sky-400 underline">
          Dismiss
        </button>
      </div>
    )
  }

  const toggle = (index: number) =>
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <div className="rounded-xl border border-sky-800 bg-slate-800 p-3">
      <p className="mb-2 text-sm font-medium text-sky-300">Suggested updates</p>
      {result.summary && <p className="mb-3 text-xs text-slate-400">{result.summary}</p>}

      <ul className="space-y-2">
        {result.changes.map((change, index) => (
          <li key={`${change.path}-${index}`}>
            <label className="flex items-start gap-3 rounded-lg bg-slate-900/60 p-3">
              <input
                type="checkbox"
                checked={accepted.has(index)}
                onChange={() => toggle(index)}
                className="mt-1 h-5 w-5 accent-sky-500"
              />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium text-slate-200">
                  {labelForPath(change.path)}
                </span>
                <span className="block break-words text-slate-400">
                  <span className="line-through opacity-60">{renderValue(change.current)}</span>
                  {' → '}
                  <span className="text-slate-100">{renderValue(change.proposed)}</span>
                </span>
                {change.reason && (
                  <span className="mt-1 block text-xs italic text-slate-500">“{change.reason}”</span>
                )}
                {change.confidence < 0.6 && (
                  <span className="mt-1 block text-xs text-amber-400">Low confidence — check this</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || accepted.size === 0}
          onClick={() => onApply(result.changes.filter((_, i) => accepted.has(i)))}
          className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 font-medium text-slate-900 disabled:opacity-40"
        >
          {busy ? 'Applying…' : `Apply ${accepted.size}`}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
