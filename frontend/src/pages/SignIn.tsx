import { useState } from 'react'

import { useAuth } from '../auth/AuthProvider'
import Brand from '../components/Brand'

export default function SignIn() {
  const { signIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="flex flex-col items-center">
        <Brand className="mb-5 h-20 w-20" />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">people<span className="text-sky-400">_db</span></h1>
        <p className="mt-2 text-sm text-slate-400">Everything you know about the people you know.</p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await signIn()
          } catch {
            setError('Could not start sign-in. Check your connection and try again.')
            setBusy(false)
          }
        }}
        className="w-full max-w-xs rounded-xl bg-sky-500 px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
      >
        {busy ? 'Redirecting…' : 'Sign in'}
      </button>

      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  )
}
