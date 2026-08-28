import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useChat, useConfig } from '../api/hooks'
import type { PersonSummary } from '../api/types'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  people?: PersonSummary[]
}

const SUGGESTIONS = [
  'Whose birthday is this month?',
  'How many people do I know earning over 50k?',
  'Who do I know in Munich?',
]

export default function Chat() {
  const config = useConfig()
  const ask = useChat()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const send = async (text: string) => {
    const question = text.trim()
    if (!question) return

    // Chat is ephemeral by design: the transcript lives in this component only
    // and is replayed to the API, never stored server-side.
    const history: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(history)
    setInput('')
    setError(null)
    queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }))

    try {
      const answer = await ask.mutateAsync(history.map((t) => ({ role: t.role, content: t.content })))
      setTurns([...history, { role: 'assistant', content: answer.answer, people: answer.people }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  const disabled = config.data ? !config.data.ai_enabled : false

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h1 className="text-lg font-semibold">Chat</h1>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} className="text-xs text-slate-400 underline">
            Clear
          </button>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {disabled && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            AI features are turned off for this deployment.
          </p>
        )}

        {turns.length === 0 && !disabled && (
          <div className="space-y-2 pt-6">
            <p className="text-sm text-slate-500">Ask anything about the people you've stored.</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="block w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left text-sm text-slate-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                turn.role === 'user'
                  ? 'bg-sky-500 text-slate-900'
                  : 'border border-slate-800 bg-slate-900/60 text-slate-200'
              }`}
            >
              <p className="whitespace-pre-wrap">{turn.content}</p>
              {turn.people && turn.people.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {turn.people.map((p) => (
                    <Link
                      key={p.id}
                      to={`/p/${p.id}`}
                      className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-sky-300"
                    >
                      {p.display_name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {ask.isPending && <p className="text-sm text-slate-500">Thinking…</p>}
        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="safe-bottom flex gap-2 border-t border-slate-800 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || ask.isPending}
          placeholder="Ask about someone…"
          className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none placeholder:text-slate-500 focus:border-sky-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || ask.isPending || !input.trim()}
          className="rounded-xl bg-sky-500 px-4 py-3 font-medium text-slate-900 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  )
}
