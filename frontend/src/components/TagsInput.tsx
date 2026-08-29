import { useState } from 'react'

/**
 * Tag entry as chips.
 *
 * The previous version was a single text field whose value was
 * `tags.join(', ')`. Every keystroke re-derived that string from the parsed
 * array, so the moment you typed a comma it was parsed away and the character
 * vanished before the next one arrived — the field was unusable for entering
 * more than one tag.
 *
 * Here the draft text is local state and only becomes a tag when it is
 * committed, so nothing rewrites what you are typing.
 */

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
}

export default function TagsInput({ tags, onChange }: Props) {
  const [draft, setDraft] = useState('')

  const commit = (raw: string) => {
    const cleaned = raw.trim().toLowerCase().replace(/^#/, '')
    if (cleaned && !tags.includes(cleaned)) onChange([...tags, cleaned])
    setDraft('')
  }

  const handleChange = (value: string) => {
    // A comma means "that tag is finished", not a character to keep.
    if (value.includes(',')) {
      const parts = value.split(',')
      const trailing = parts.pop() ?? ''
      const next = [...tags]
      for (const part of parts) {
        const cleaned = part.trim().toLowerCase().replace(/^#/, '')
        if (cleaned && !next.includes(cleaned)) next.push(cleaned)
      }
      onChange(next)
      setDraft(trailing)
      return
    }
    setDraft(value)
  }

  return (
    <div>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Tags</span>

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1.5 rounded-full bg-slate-800 py-1 pl-3 pr-1.5 text-sm text-slate-300"
            >
              #{tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-slate-300"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        placeholder="climbing, ex-colleague…"
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none placeholder:text-slate-600 focus:border-sky-500"
      />
      <span className="mt-1 block text-xs text-slate-600">
        Comma or Enter adds a tag. Backspace on an empty field removes the last one.
      </span>
    </div>
  )
}
