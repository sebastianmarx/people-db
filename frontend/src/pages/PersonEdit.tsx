import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useConfig, useCreatePerson, useExtractText, usePerson, useUpdatePerson } from '../api/hooks'
import type { FieldChange, PersonInput } from '../api/types'
import { emptyPerson } from '../api/types'
import BirthdayInput from '../components/BirthdayInput'
import TagsInput from '../components/TagsInput'
import { deviceContactsSupported, parseVCard, pickDeviceContact } from '../lib/contacts'

function set<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.')
  const clone = { ...obj } as Record<string, unknown>
  let cursor = clone
  for (const part of parts.slice(0, -1)) {
    cursor[part] = { ...((cursor[part] as object) ?? {}) }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
  return clone as T
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, obj)
}

interface RowProps {
  label: string
  path: string
  form: PersonInput
  onChange: (path: string, value: unknown) => void
  type?: 'text' | 'number' | 'tel' | 'email'
  placeholder?: string
  multiline?: boolean
}

function Row({ label, path, form, onChange, type = 'text', placeholder, multiline }: RowProps) {
  const raw = get(form, path)
  const value = raw == null ? '' : String(raw)
  const common = {
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      const next = e.target.value
      onChange(path, type === 'number' ? (next === '' ? null : Number(next)) : next === '' ? null : next)
    },
    className:
      'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none placeholder:text-slate-600 focus:border-sky-500',
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      {multiline ? <textarea rows={3} {...common} /> : <input type={type} inputMode={type === 'number' ? 'numeric' : undefined} {...common} />}
    </label>
  )
}

export default function PersonEdit() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const existing = usePerson(isNew ? undefined : id)
  const config = useConfig()
  const create = useCreatePerson()
  const update = useUpdatePerson(id ?? '')
  const extract = useExtractText()

  const [form, setForm] = useState<PersonInput>(emptyPerson())
  const [version, setVersion] = useState<number | undefined>()
  const [paste, setPaste] = useState('')
  const [error, setError] = useState<string | null>(null)
  const vcardInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!existing.data) return
    const { id: _id, photo_key, photo_url, created_at, updated_at, version: v, ...rest } = existing.data
    void _id
    void photo_key
    void photo_url
    void created_at
    void updated_at
    setForm(rest)
    setVersion(v)
  }, [existing.data])

  const onChange = (path: string, value: unknown) => setForm((f) => set(f, path, value))

  const applyChanges = (changes: FieldChange[]) => {
    setForm((f) => changes.reduce((acc, c) => set(acc, c.path, c.proposed), f))
  }

  const save = async () => {
    setError(null)
    try {
      if (isNew) {
        const created = await create.mutateAsync(form)
        navigate(`/p/${created.id}`, { replace: true })
      } else {
        await update.mutateAsync({ ...form, version })
        navigate(`/p/${id}`, { replace: true })
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <div className="flex min-h-full flex-col pb-8">
      <header className="safe-top sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-slate-400">
          Cancel
        </button>
        <h1 className="text-sm font-medium">{isNew ? 'New person' : 'Edit'}</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="text-sm font-medium text-sky-400 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </header>

      {error && <p className="mx-4 mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <div className="space-y-4 px-4 pt-4">
        {isNew && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-sm text-slate-300">Import from contacts</p>
            <p className="mt-1 text-xs text-slate-500">
              Nothing is saved until you tap Save, and the file never leaves your phone.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {deviceContactsSupported() && (
                <button
                  type="button"
                  onClick={async () => {
                    setError(null)
                    try {
                      const picked = await pickDeviceContact()
                      if (picked) setForm((f) => ({ ...picked, ai_optout: f.ai_optout }))
                    } catch {
                      setError('Could not open your contacts.')
                    }
                  }}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
                >
                  Pick a contact
                </button>
              )}
              <button
                type="button"
                onClick={() => vcardInput.current?.click()}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
              >
                Import a .vcf file
              </button>
            </div>
            {!deviceContactsSupported() && (
              <p className="mt-2 text-xs text-slate-600">
                Direct contact access needs Chrome on Android. Everywhere else, open the
                contact, share it, save the .vcf, and pick it here.
              </p>
            )}
            <input
              ref={vcardInput}
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setError(null)
                try {
                  const [first, ...rest] = parseVCard(await file.text())
                  if (!first) {
                    setError('No contact found in that file.')
                    return
                  }
                  setForm((f) => ({ ...first, ai_optout: f.ai_optout }))
                  if (rest.length) {
                    setError(
                      `That file held ${rest.length + 1} contacts; the first one was loaded.`,
                    )
                  }
                } catch {
                  setError('That file could not be read as a contact card.')
                }
              }}
            />
          </div>
        )}

        {config.data?.ai_enabled && (
          <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <summary className="cursor-pointer text-sm text-sky-400">Fill from text</summary>
            <p className="mt-2 text-xs text-slate-500">
              Paste anything — a message, a business card you typed out, notes from a conversation.
              The suggestions land in the form below and nothing is saved until you tap Save.
            </p>
            <textarea
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-base outline-none focus:border-sky-500"
            />
            <button
              type="button"
              disabled={!paste.trim() || extract.isPending}
              onClick={async () => {
                setError(null)
                try {
                  const result = await extract.mutateAsync({
                    text: paste,
                    personId: isNew ? undefined : id,
                  })
                  applyChanges(result.changes)
                  if (result.changes.length === 0) setError('Nothing recognisable in that text.')
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
              className="mt-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-40"
            >
              {extract.isPending ? 'Reading…' : 'Extract'}
            </button>
          </details>
        )}

        <Row label="First name" path="given_name" form={form} onChange={onChange} />
        <Row label="Last name" path="family_name" form={form} onChange={onChange} />
        <Row label="Street" path="address.street" form={form} onChange={onChange} />
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Row label="Postcode" path="address.postal_code" form={form} onChange={onChange} />
          <Row label="City" path="address.city" form={form} onChange={onChange} />
        </div>
        <BirthdayInput value={form.birthday} onChange={(iso) => onChange('birthday', iso)} />

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Row label="Salary (€)" path="salary.amount" form={form} onChange={onChange} type="number" />
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Per</span>
            <select
              value={form.salary.period}
              onChange={(e) => onChange('salary.period', e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
            >
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="hour">hour</option>
            </select>
          </label>
        </div>
        <Row label="Job title" path="job.title" form={form} onChange={onChange} />
        <Row label="Company" path="job.company" form={form} onChange={onChange} />
        <Row label="Job description" path="job.description" form={form} onChange={onChange} multiline />

        <fieldset>
          <legend className="mb-1 text-xs uppercase tracking-wide text-slate-500">Children</legend>
          {form.kids.map((kid, index) => (
            <div key={index} className="mb-2 grid grid-cols-[2fr_1fr_auto] items-end gap-2">
              <input
                value={kid.name ?? ''}
                placeholder="Name"
                onChange={(e) =>
                  onChange('kids', form.kids.map((k, i) => (i === index ? { ...k, name: e.target.value } : k)))
                }
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
              />
              <input
                value={kid.birth_year ?? ''}
                placeholder="Year"
                inputMode="numeric"
                onChange={(e) =>
                  onChange(
                    'kids',
                    form.kids.map((k, i) =>
                      i === index ? { ...k, birth_year: e.target.value ? Number(e.target.value) : null } : k,
                    ),
                  )
                }
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => onChange('kids', form.kids.filter((_, i) => i !== index))}
                className="px-2 py-2.5 text-slate-500"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange('kids', [...form.kids, { name: '', birth_year: null }])}
            className="text-sm text-sky-400"
          >
            + add child
          </button>
        </fieldset>

        <Row label="Phone" path="phone" form={form} onChange={onChange} type="tel" />
        <Row label="Email" path="email" form={form} onChange={onChange} type="email" />
        <Row label="How we met" path="how_we_met" form={form} onChange={onChange} multiline />

        <TagsInput tags={form.tags} onChange={(tags) => onChange('tags', tags)} />

        <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <input
            type="checkbox"
            checked={form.ai_optout}
            onChange={(e) => onChange('ai_optout', e.target.checked)}
            className="mt-1 h-5 w-5 accent-sky-500"
          />
          <span className="text-sm">
            <span className="block text-slate-200">Exclude from AI</span>
            <span className="block text-xs text-slate-500">
              This person's data is never sent to the model, and the chat cannot see them.
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
