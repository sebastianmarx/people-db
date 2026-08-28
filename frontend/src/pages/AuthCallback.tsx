import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { request } from '../api/client'
import { useAuth } from '../auth/AuthProvider'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { recheck } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const exchanged = useRef(false)

  useEffect(() => {
    // React 18+ runs effects twice in dev; an authorization code is single-use.
    if (exchanged.current) return
    exchanged.current = true

    const code = params.get('code')
    const state = params.get('state')
    const oauthError = params.get('error_description') ?? params.get('error')

    if (oauthError) {
      setError(oauthError)
      return
    }
    if (!code || !state) {
      setError('The sign-in response was incomplete.')
      return
    }

    request('/api/auth/callback', { method: 'POST', body: { code, state } })
      .then(() => recheck())
      .then(() => navigate('/', { replace: true }))
      .catch(() => setError('Sign-in could not be completed. Please try again.'))
  }, [navigate, params, recheck])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {error ? (
        <>
          <p className="text-sm text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm"
          >
            Back
          </button>
        </>
      ) : (
        <p className="text-sm text-slate-400">Signing you in…</p>
      )}
    </div>
  )
}
