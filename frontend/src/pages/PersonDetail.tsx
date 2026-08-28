import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  useAddNote,
  useApplyExtraction,
  useConfig,
  useDeleteNote,
  useDeletePerson,
  useNotes,
  usePerson,
  usePhotoUpload,
} from '../api/hooks'
import type { ExtractionResult, FieldChange } from '../api/types'
import Avatar from '../components/Avatar'
import ExtractionDiff from '../components/ExtractionDiff'
import NoteComposer from '../components/NoteComposer'
import {
  ageTurning,
  birthdayCountdown,
  formatAddress,
  formatBirthday,
  formatSalary,
  fullName,
  kidsSummary,
  resizeImage,
} from '../lib/format'

function Field({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <Link to={to} className="block border-b border-slate-800 py-2 last:border-0">
      <span className="block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className={value ? 'block text-slate-100' : 'block text-slate-600'}>
        {value || '+ add'}
      </span>
    </Link>
  )
}

export default function PersonDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const person = usePerson(id)
  const notes = useNotes(id)
  const config = useConfig()

  const addNote = useAddNote(id)
  const deleteNote = useDeleteNote(id)
  const applyExtraction = useApplyExtraction(id)
  const deletePerson = useDeletePerson()
  const uploadPhoto = usePhotoUpload(id)

  const fileInput = useRef<HTMLInputElement>(null)
  const [proposal, setProposal] = useState<ExtractionResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (person.isLoading) return <p className="p-4 text-sm text-slate-400">Loading…</p>
  if (person.error || !person.data)
    return <p className="p-4 text-sm text-rose-400">{(person.error as Error)?.message ?? 'Not found.'}</p>

  const p = person.data
  const editHref = `/p/${id}/edit`

  const handleNote = async (body: string, extract: boolean) => {
    setMessage(null)
    const result = await addNote.mutateAsync({ body, extract })
    if (result.extraction_error) setMessage(result.extraction_error)
    if (result.extraction) setProposal(result.extraction)
  }

  const handleApply = async (changes: FieldChange[]) => {
    await applyExtraction.mutateAsync({ changes, version: p.version })
    setProposal(null)
  }

  const handlePhoto = async (file: File) => {
    setMessage(null)
    try {
      await uploadPhoto.mutateAsync(await resizeImage(file))
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top flex items-center justify-between px-4 pb-2 pt-3">
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-sky-400">
          ‹ Back
        </button>
        <div className="flex gap-4">
          <Link to={editHref} className="text-sm text-sky-400">
            Edit
          </Link>
          <button
            type="button"
            className="text-sm text-rose-400"
            onClick={async () => {
              if (!confirm(`Delete ${fullName(p)} and all their notes? This cannot be undone.`)) return
              await deletePerson.mutateAsync(id)
              navigate('/', { replace: true })
            }}
          >
            Delete
          </button>
        </div>
      </header>

      {/* The important facts, always at the top. */}
      <section className="px-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => fileInput.current?.click()} className="relative">
            <Avatar url={p.photo_url} name={fullName(p)} size={72} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px]">
              {uploadPhoto.isPending ? '…' : 'edit'}
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handlePhoto(file)
              e.target.value = ''
            }}
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{fullName(p)}</h1>
            {p.job.title && (
              <p className="truncate text-sm text-slate-400">
                {[p.job.title, p.job.company].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-1">
          <Field label="Address" value={formatAddress(p.address)} to={editHref} />
          <Field
            label="Birthday"
            value={
              p.birthday
                ? [formatBirthday(p.birthday), ageTurning(p), birthdayCountdown(p.birthday)]
                    .filter(Boolean)
                    .join(' · ')
                : ''
            }
            to={editHref}
          />
          <Field label="Salary" value={formatSalary(p.salary)} to={editHref} />
          <Field label="Children" value={kidsSummary(p)} to={editHref} />
          <Field label="Job description" value={p.job.description ?? ''} to={editHref} />
          {(p.phone || p.email) && (
            <Field label="Contact" value={[p.phone, p.email].filter(Boolean).join(' · ')} to={editHref} />
          )}
          {p.how_we_met && <Field label="How we met" value={p.how_we_met} to={editHref} />}
        </div>

        {p.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {p.ai_optout && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            This person is excluded from all AI features.
          </p>
        )}
      </section>

      <section className="mt-6 flex-1 px-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Notes</h2>

        {message && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{message}</p>}

        {proposal && (
          <div className="mb-4">
            <ExtractionDiff
              result={proposal}
              busy={applyExtraction.isPending}
              onApply={(changes) => void handleApply(changes)}
              onDismiss={() => setProposal(null)}
            />
          </div>
        )}

        {notes.data?.length === 0 && (
          <p className="py-6 text-sm text-slate-500">Nothing written down yet.</p>
        )}

        <ul className="space-y-3 pb-4">
          {notes.data?.map((note) => (
            <li key={note.sk} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>{note.occurred_on}</span>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={() => {
                    if (confirm('Delete this note?')) void deleteNote.mutateAsync(note.sk)
                  }}
                >
                  delete
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{note.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <NoteComposer
        aiEnabled={config.data?.ai_enabled ?? false}
        busy={addNote.isPending}
        onSave={handleNote}
      />
    </div>
  )
}
