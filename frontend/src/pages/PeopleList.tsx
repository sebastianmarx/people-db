import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { usePeople } from '../api/hooks'
import Avatar from '../components/Avatar'
import Brand from '../components/Brand'
import { useAuth } from '../auth/AuthProvider'

export default function PeopleList() {
  const { data, isLoading, error } = usePeople()
  const { signOut } = useAuth()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data ?? []
    const terms = q.split(/\s+/)
    return (data ?? []).filter((p) => {
      const haystack = [p.display_name, p.job_title, p.company, p.city, ...p.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return terms.every((t) => haystack.includes(t))
    })
  }, [data, query])

  return (
    <div className="relative h-full">
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Brand />
            <h1 className="text-lg font-semibold">People</h1>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-xs text-slate-400 underline underline-offset-4"
          >
            Sign out
          </button>
        </div>
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, city, company, tag…"
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none placeholder:text-slate-500 focus:border-sky-500"
        />
      </header>

      {isLoading && <p className="px-4 py-6 text-sm text-slate-400">Loading…</p>}
      {error && <p className="px-4 py-6 text-sm text-rose-400">{(error as Error).message}</p>}

      {!isLoading && filtered.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-slate-400">
          {data?.length ? 'Nobody matches that search.' : 'No people yet. Tap + to add someone.'}
        </p>
      )}

      <ul className="divide-y divide-slate-800 pb-24">
        {filtered.map((person) => (
          <li key={person.id}>
            <Link to={`/p/${person.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-800">
              <Avatar url={person.photo_url} name={person.display_name} />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {person.family_name}
                  {person.family_name && person.given_name ? ', ' : ''}
                  {person.given_name}
                </span>
                <span className="block truncate text-sm text-slate-400">
                  {[person.job_title, person.city].filter(Boolean).join(' · ') || ' '}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/p/new"
        aria-label="Add person"
        className="fixed bottom-20 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-3xl leading-none text-slate-900 shadow-lg"
      >
        +
      </Link>
    </div>
  )
}
