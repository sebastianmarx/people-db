import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAddRelationship, usePeople, useRelationships, useRemoveRelationship } from '../api/hooks'
import type { RelationshipType } from '../api/types'
import { RELATIONSHIP_LABELS } from '../api/types'
import Avatar from './Avatar'

const TYPES = Object.keys(RELATIONSHIP_LABELS) as RelationshipType[]

interface Props {
  personId: string
  personName: string
}

export default function Connections({ personId, personName }: Props) {
  const relationships = useRelationships(personId)
  const people = usePeople()
  const add = useAddRelationship(personId)
  const remove = useRemoveRelationship(personId)

  const [open, setOpen] = useState(false)
  const [type, setType] = useState<RelationshipType>('spouse')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const connectedIds = useMemo(
    () => new Set((relationships.data ?? []).map((r) => r.other_id)),
    [relationships.data],
  )

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (people.data ?? [])
      .filter((p) => p.id !== personId && !connectedIds.has(p.id))
      .filter((p) => (q ? p.display_name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [people.data, personId, connectedIds, query])

  const link = async (otherId: string) => {
    setError(null)
    try {
      await add.mutateAsync({ other_id: otherId, type })
      setQuery('')
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">Connections</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-sm text-sky-400">
          {open ? 'Cancel' : '+ add'}
        </button>
      </div>

      {relationships.data && relationships.data.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
          {relationships.data.map((rel) => (
            <li key={rel.other_id} className="flex items-center gap-3 px-3 py-2">
              <Link to={`/p/${rel.other_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar url={rel.other_photo_url} name={rel.other_name} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-slate-100">{rel.other_name}</span>
                  <span className="block text-xs text-slate-500">
                    {RELATIONSHIP_LABELS[rel.type]}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Remove ${rel.other_name}`}
                onClick={() => {
                  if (confirm(`Remove the link between ${personName} and ${rel.other_name}?`)) {
                    void remove.mutateAsync(rel.other_id)
                  }
                }}
                className="px-2 text-slate-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {relationships.data?.length === 0 && !open && (
        <p className="text-sm text-slate-600">No connections yet.</p>
      )}

      {open && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">
              The person I pick is {personName}'s…
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RelationshipType)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {RELATIONSHIP_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a person…"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none placeholder:text-slate-600 focus:border-sky-500"
          />

          <ul className="mt-2 space-y-1">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => void link(p.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-slate-800 disabled:opacity-50"
                >
                  <Avatar url={p.photo_url} name={p.display_name} size={32} />
                  <span className="truncate text-sm">{p.display_name}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="px-2 py-2 text-sm text-slate-600">
                {people.data?.length ? 'Nobody left to link.' : 'Add another person first.'}
              </li>
            )}
          </ul>

          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </section>
  )
}
