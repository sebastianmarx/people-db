import { useState } from 'react'

interface Props {
  aiEnabled: boolean
  busy: boolean
  onSave: (body: string, extract: boolean) => Promise<void>
}

export default function NoteComposer({ aiEnabled, busy, onSave }: Props) {
  const [body, setBody] = useState('')

  const submit = async (extract: boolean) => {
    const text = body.trim()
    if (!text) return
    await onSave(text, extract)
    setBody('')
  }

  return (
    <div className="safe-bottom sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-3 backdrop-blur">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What did you talk about? Use your keyboard's dictation key if it's easier."
        className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-base outline-none placeholder:text-slate-500 focus:border-sky-500"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => void submit(false)}
          className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-sm disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy || !body.trim() || !aiEnabled}
          onClick={() => void submit(true)}
          title={aiEnabled ? undefined : 'AI features are turned off'}
          className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-900 disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Save + extract'}
        </button>
      </div>
    </div>
  )
}
