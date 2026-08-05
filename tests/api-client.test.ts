import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestJson } from '@/lib/api-client'

// ── Fixture helpers ──────────────────────────────────────────────────────────

function fakeResponse(opts: {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    json: opts.json ?? (async () => ({})),
  } as unknown as Response
}

function mockFetchResolving(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mockFetchRejecting(err: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(err)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Expected messages ─────────────────────────────────────────────────────────
// Mirrors the exact strings returned by lib/api-client.ts. Not imported since
// they aren't exported (they're intentionally private implementation detail),
// so these are the tests' pinned expectations of that contract.

const NETWORK_ERROR_MESSAGE = 'Network error — please check your connection and try again.'
const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'
const SERVER_ERROR_MESSAGE = 'Something went wrong on our end. Please try again.'

// ── Success cases ─────────────────────────────────────────────────────────────

describe('requestJson — success responses', () => {
  it('returns ok:true with parsed data and status for a 200 with valid JSON', async () => {
    mockFetchResolving(fakeResponse({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }))

    const result = await requestJson<{ hello: string }>('/api/thing')

    expect(result).toEqual({ ok: true, status: 200, data: { hello: 'world' } })
  })

  it('returns ok:true with parsed data and status for a 201 with valid JSON', async () => {
    mockFetchResolving(fakeResponse({ ok: true, status: 201, json: async () => ({ id: 'abc' }) }))

    const result = await requestJson<{ id: string }>('/api/thing', { method: 'POST' })

    expect(result).toEqual({ ok: true, status: 201, data: { id: 'abc' } })
  })
})

// ── Non-2xx with a JSON error field ──────────────────────────────────────────

describe('requestJson — non-2xx responses with a JSON error field', () => {
  const cases: Array<{ status: number; error: string }> = [
    { status: 400, error: 'Email required' },
    { status: 401, error: 'Unauthorized' },
    { status: 403, error: 'Forbidden' },
    { status: 404, error: 'Not found' },
    { status: 429, error: 'Too many requests' },
    { status: 500, error: 'Failed to send' },
  ]

  for (const { status, error } of cases) {
    it(`returns ok:false, the preserved status, and the JSON error field for ${status}`, async () => {
      mockFetchResolving(fakeResponse({ ok: false, status, json: async () => ({ error }) }))

      const result = await requestJson('/api/thing')

      expect(result).toEqual({ ok: false, status, error })
    })
  }

  it('falls back to the exact generic message when the JSON error field is empty', async () => {
    mockFetchResolving(fakeResponse({ ok: false, status: 500, json: async () => ({ error: '' }) }))

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: 500, error: SERVER_ERROR_MESSAGE })
  })
})

// ── Non-2xx with a missing or non-string error field ─────────────────────────

describe('requestJson — non-2xx responses with a missing or non-string error field', () => {
  const cases: Array<{ label: string; body: unknown }> = [
    { label: 'no error key at all', body: {} },
    { label: 'a non-string (number) error value', body: { error: 42 } },
    { label: 'a null error value', body: { error: null } },
    { label: 'an array error value', body: { error: ['x'] } },
  ]

  for (const { label, body } of cases) {
    it(`falls back to the exact generic status-based message for ${label}`, async () => {
      mockFetchResolving(fakeResponse({ ok: false, status: 500, json: async () => body }))

      const result = await requestJson('/api/thing')

      expect(result).toEqual({ ok: false, status: 500, error: SERVER_ERROR_MESSAGE })
    })
  }
})

// ── Non-2xx with a non-JSON / invalid body ───────────────────────────────────

describe('requestJson — non-2xx responses with an invalid or non-JSON body', () => {
  it('returns ok:false with the exact generic message for an HTML/invalid body on a non-2xx response, without throwing', async () => {
    mockFetchResolving(
      fakeResponse({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0')
        },
      })
    )

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: 502, error: SERVER_ERROR_MESSAGE })
  })
})

// ── 2xx with a missing/invalid payload ───────────────────────────────────────

describe('requestJson — 2xx responses with a missing or invalid JSON payload', () => {
  it('returns ok:false with the exact unexpected-response message for a 2xx response with invalid JSON', async () => {
    mockFetchResolving(
      fakeResponse({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input')
        },
      })
    )

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: 200, error: UNEXPECTED_RESPONSE_MESSAGE })
  })

  it('returns ok:false with the exact unexpected-response message for a 2xx response with an empty body', async () => {
    mockFetchResolving(
      fakeResponse({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input')
        },
      })
    )

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: 204, error: UNEXPECTED_RESPONSE_MESSAGE })
  })
})

// ── Network-level rejection ──────────────────────────────────────────────────

describe('requestJson — network rejection', () => {
  it('returns status:null and the exact safe network message, without exposing the rejection message', async () => {
    mockFetchRejecting(new TypeError('Failed to fetch'))

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: null, error: NETWORK_ERROR_MESSAGE })
    expect((result as { error: string }).error).not.toContain('Failed to fetch')
  })

  it('does not expose a raw stack trace or exception message in the returned error message', async () => {
    const err = new Error('boom')
    mockFetchRejecting(err)

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: null, error: NETWORK_ERROR_MESSAGE })
    const message = (result as { error: string }).error
    expect(message).not.toContain('boom')
    expect(message).not.toContain(err.stack ?? '')
    expect(message).not.toMatch(/\bat\s+\S+:\d+:\d+/)
  })
})

// ── Call discipline / contract ───────────────────────────────────────────────

describe('requestJson — call discipline', () => {
  it('calls fetch exactly once per invocation', async () => {
    const fetchMock = mockFetchResolving(fakeResponse({ ok: true, status: 200, json: async () => ({}) }))

    await requestJson('/api/thing')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves the response status on the success path', async () => {
    mockFetchResolving(fakeResponse({ ok: true, status: 207, json: async () => ({ ok: true }) }))

    const result = await requestJson('/api/thing')

    expect(result.status).toBe(207)
  })

  it('preserves the response status on the failure path', async () => {
    mockFetchResolving(fakeResponse({ ok: false, status: 418, json: async () => ({ error: "I'm a teapot" }) }))

    const result = await requestJson('/api/thing')

    expect(result.status).toBe(418)
  })

  it('never throws for a malformed response, even when json() rejects on a failure status', async () => {
    mockFetchResolving(
      fakeResponse({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json')
        },
      })
    )

    const result = await requestJson('/api/thing')

    expect(result).toEqual({ ok: false, status: 503, error: SERVER_ERROR_MESSAGE })
  })
})
