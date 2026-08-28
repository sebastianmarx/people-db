import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { AuthRequired, request } from '../api/client'

type Status = 'checking' | 'signed-in' | 'signed-out'

interface AuthState {
  status: Status
  sub: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  recheck: () => Promise<void>
}

const Context = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [sub, setSub] = useState<string | null>(null)

  const recheck = useCallback(async () => {
    try {
      const me = await request<{ sub: string }>('/api/auth/me')
      setSub(me.sub)
      setStatus('signed-in')
    } catch (error) {
      if (!(error instanceof AuthRequired)) console.error(error)
      setSub(null)
      setStatus('signed-out')
    }
  }, [])

  useEffect(() => {
    void recheck()
  }, [recheck])

  const signIn = useCallback(async () => {
    // The backend mints the PKCE verifier and keeps it in an HttpOnly cookie,
    // so it is never reachable from JavaScript.
    const { authorize_url } = await request<{ authorize_url: string }>('/api/auth/login')
    window.location.assign(authorize_url)
  }, [])

  const signOut = useCallback(async () => {
    const { logout_url } = await request<{ logout_url: string }>('/api/auth/logout', {
      method: 'POST',
    })
    window.location.assign(logout_url)
  }, [])

  return (
    <Context.Provider value={{ status, sub, signIn, signOut, recheck }}>{children}</Context.Provider>
  )
}

export function useAuth(): AuthState {
  const value = useContext(Context)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
