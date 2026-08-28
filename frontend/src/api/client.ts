/**
 * API client.
 *
 * Two non-obvious requirements:
 *
 *  1. `x-amz-content-sha256`. CloudFront signs requests to the Lambda Function
 *     URL with SigV4 but does not hash the body itself, so for POST/PUT/PATCH
 *     the viewer has to supply the payload hash or the origin rejects the
 *     signature. We send it on every request for consistency.
 *
 *  2. `X-Requested-With`. Auth is cookie-based, so a custom header is required
 *     on mutating calls; only same-origin XHR can set one, which blocks CSRF.
 */

const XHR_HEADER = 'people-db'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class AuthRequired extends ApiError {}

async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  allowRefresh?: boolean
}

let refreshInFlight: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  // Collapse concurrent 401s into a single refresh call.
  if (!refreshInFlight) {
    refreshInFlight = rawRequest('/api/auth/refresh', { method: 'POST', allowRefresh: false })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

async function rawRequest<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const payload = options.body === undefined ? '' : JSON.stringify(options.body)

  const headers: Record<string, string> = {
    'X-Requested-With': XHR_HEADER,
    'x-amz-content-sha256': await sha256Hex(payload),
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(path, {
    method,
    headers,
    body: payload === '' ? undefined : payload,
    credentials: 'same-origin',
    cache: 'no-store',
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    const message = detailOf(data) ?? `Request failed (${response.status})`
    if (response.status === 401) throw new AuthRequired(401, message)
    throw new ApiError(response.status, message)
  }

  return data as T
}

function detailOf(data: unknown): string | null {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
  }
  return null
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options)
  } catch (error) {
    const canRetry = options.allowRefresh !== false && error instanceof AuthRequired
    if (!canRetry) throw error

    const refreshed = await refreshSession()
    if (!refreshed) throw error
    return rawRequest<T>(path, { ...options, allowRefresh: false })
  }
}
