// Typed JSON request helper. Wraps fetch so callers get a discriminated
// result instead of having to remember to check response.ok, guard against
// invalid JSON, and catch network rejection every time.

export type ApiSuccess<T> = {
  ok: true
  status: number
  data: T
}

export type ApiFailure = {
  ok: false
  status: number | null
  error: string
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure

const NETWORK_ERROR_MESSAGE = 'Network error — please check your connection and try again.'

function genericErrorForStatus(status: number): string {
  if (status === 401) return 'You are not signed in.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'The requested resource was not found.'
  if (status === 429) return 'Too many requests — please try again shortly.'
  if (status >= 500) return 'Something went wrong on our end. Please try again.'
  return 'The request could not be completed.'
}

async function parseJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const value = await res.json()
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

function readErrorField(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string' &&
    (value as { error: string }).error.trim().length > 0
  ) {
    return (value as { error: string }).error
  }
  return null
}

/**
 * Perform a single fetch and resolve to a discriminated ApiResult instead of
 * throwing or requiring the caller to inspect response.ok / parse JSON.
 */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    return { ok: false, status: null, error: NETWORK_ERROR_MESSAGE }
  }

  const parsed = await parseJson(res)

  if (!res.ok) {
    const message = parsed.ok ? readErrorField(parsed.value) : null
    return { ok: false, status: res.status, error: message ?? genericErrorForStatus(res.status) }
  }

  if (!parsed.ok) {
    return { ok: false, status: res.status, error: 'The server returned an unexpected response.' }
  }

  return { ok: true, status: res.status, data: parsed.value as T }
}
