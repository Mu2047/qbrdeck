import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiResult } from '@/lib/api-client'
import { sendQBREmail } from '@/lib/email'

// This repo has no jsdom/@testing-library/react and no established Clerk/
// Prisma mocking pattern for route handlers (see tests/reminder-status-
// consistency.test.ts for the precedent this file follows). So, throughout
// this file:
//  - "source contract" tests read page.tsx / route.ts as plain text and
//    regex-match against it. They do NOT render React, do NOT exercise the
//    real DOM, and do NOT run any timers — they prove the source contains
//    the expected code shape, nothing more. This applies to the guard,
//    accessibility, and timer-lifecycle checks below.
//  - the pure success/failure decision logic is mirrored here (page.tsx's
//    App Router contract forbids exporting anything but its fixed set of
//    framework exports) and given real behavioral test cases, with a
//    source-contract check pinning the mirror's fallback message to the
//    real implementation
//  - lib/email.ts is exercised directly (real behavioral test, not a
//    source-contract check) against a mocked 'resend' module
//  - the send route's try/catch shape is verified via source contract only,
//    since no request-level test harness exists yet for it in this repo

const PAGE_PATH = join(
  process.cwd(),
  'app/(app)/dashboard/(gated)/clients/[id]/qbr/[qbrId]/page.tsx'
)
const pageSource = readFileSync(PAGE_PATH, 'utf-8')

function extractFunctionSource(name: string, nextSiblingName: string): string {
  const pattern = new RegExp(
    `(?:async )?function ${name}\\([^)]*\\)[\\s\\S]*?(?=\\n\\s*(?:async )?function ${nextSiblingName}\\b)`
  )
  const match = pageSource.match(pattern)
  if (!match) throw new Error(`could not locate function ${name}() in page.tsx source`)
  return match[0]
}

const sendToClientSource = extractFunctionSource('sendToClient', 'exportFile')

const REAL_FAILURE_MESSAGE = 'The email could not be sent. Please try again.'

// ── Pure decision logic (mirrors page.tsx's private resolveSendResult) ──────

function resolveSendResult(
  result: ApiResult<{ success: boolean }>
): { sent: boolean; error: string | null } {
  if (result.ok && result.data?.success === true) {
    return { sent: true, error: null }
  }
  return {
    sent: false,
    error: result.ok ? REAL_FAILURE_MESSAGE : result.error,
  }
}

describe('resolveSendResult — success/failure decision logic (real behavioral tests of a mirrored pure function; see source-contract pin below)', () => {
  it('pins the mirror\'s fallback message to the real page.tsx source, so the two cannot silently drift', () => {
    expect(pageSource).toContain(REAL_FAILURE_MESSAGE)
  })

  it('200 { success: true } → sent:true, no error', () => {
    const result: ApiResult<{ success: boolean }> = { ok: true, status: 200, data: { success: true } }
    expect(resolveSendResult(result)).toEqual({ sent: true, error: null })
  })

  it('200 { success: false } → sent:false, exact fallback message, never displays Sent', () => {
    const result: ApiResult<{ success: boolean }> = { ok: true, status: 200, data: { success: false } }
    expect(resolveSendResult(result)).toEqual({ sent: false, error: REAL_FAILURE_MESSAGE })
  })

  for (const status of [401, 403, 404, 500]) {
    it(`${status} response → sent:false, server-provided error surfaced`, () => {
      const result: ApiResult<{ success: boolean }> = { ok: false, status, error: 'Unauthorized' }
      expect(resolveSendResult(result)).toEqual({ sent: false, error: 'Unauthorized' })
    })
  }

  it('network rejection (status:null) → sent:false, safe network message surfaced', () => {
    const result: ApiResult<{ success: boolean }> = {
      ok: false,
      status: null,
      error: 'Network error — please check your connection and try again.',
    }
    expect(resolveSendResult(result)).toEqual({
      sent: false,
      error: 'Network error — please check your connection and try again.',
    })
  })

  it('invalid JSON payload → sent:false, safe message surfaced', () => {
    const result: ApiResult<{ success: boolean }> = {
      ok: false,
      status: 200,
      error: 'The server returned an unexpected response.',
    }
    expect(resolveSendResult(result)).toEqual({
      sent: false,
      error: 'The server returned an unexpected response.',
    })
  })

  it('never returns sent:true unless ok:true and data.success === true', () => {
    const cases: Array<ApiResult<{ success: boolean }>> = [
      { ok: true, status: 200, data: { success: false } },
      { ok: false, status: 500, error: 'x' },
      { ok: false, status: null, error: 'x' },
      { ok: false, status: 401, error: 'x' },
    ]
    for (const c of cases) {
      expect(resolveSendResult(c).sent).toBe(false)
    }
  })
})

// ── page.tsx source contract ─────────────────────────────────────────────────

describe('page.tsx — Send to Client source contract (static text checks against the real source; no rendering)', () => {
  it('imports requestJson from the shared api-client module', () => {
    expect(pageSource).toMatch(
      /import\s*\{[^}]*\brequestJson\b[^}]*\}\s*from\s*['"]@\/lib\/api-client['"]/
    )
  })

  it('sendToClient calls requestJson against the exact send endpoint', () => {
    expect(sendToClientSource).toMatch(
      /requestJson<[^>]*>\(\s*`\/api\/qbrs\/\$\{params\.qbrId\}\/send`/
    )
  })

  it('the request uses method: POST', () => {
    expect(sendToClientSource).toMatch(/method:\s*'POST'/)
  })

  it('the request sets the Content-Type: application/json header', () => {
    expect(sendToClientSource).toMatch(/'Content-Type':\s*'application\/json'/)
  })

  it('the request body is exactly JSON.stringify({ email: sendEmail })', () => {
    expect(sendToClientSource).toMatch(/body:\s*JSON\.stringify\(\{\s*email:\s*sendEmail\s*\}\)/)
  })

  it('no longer performs a bare unchecked fetch to the send endpoint', () => {
    expect(sendToClientSource).not.toMatch(/await fetch\(`\/api\/qbrs\/\$\{params\.qbrId\}\/send`/)
  })

  it('requires both ok:true and data.success === true before treating the send as successful', () => {
    expect(pageSource).toMatch(/result\.ok\s*&&\s*result\.data\?\.success\s*===\s*true/)
  })

  it('clears sendError and sent at the start of a new attempt, before sending is set', () => {
    const errorIdx = sendToClientSource.search(/setSendError\(null\)/)
    const sentIdx = sendToClientSource.search(/setSent\(false\)/)
    const sendingIdx = sendToClientSource.search(/setSending\(true\)/)

    expect(errorIdx).toBeGreaterThan(-1)
    expect(sentIdx).toBeGreaterThan(-1)
    expect(sendingIdx).toBeGreaterThan(-1)
    expect(errorIdx).toBeLessThan(sendingIdx)
    expect(sentIdx).toBeLessThan(sendingIdx)
  })

  it('resets sending in a finally block', () => {
    expect(sendToClientSource).toMatch(/finally\s*\{\s*setSending\(false\)/)
  })

  it('never clears the entered recipient email, so it stays available to retry', () => {
    expect(sendToClientSource).not.toMatch(/setSendEmail\(/)
  })

  it('does not retry automatically — exactly one requestJson call per attempt', () => {
    const calls = sendToClientSource.match(/requestJson</g) ?? []
    expect(calls.length).toBe(1)
  })

  it('guards against both a missing email and an already in-flight send', () => {
    expect(sendToClientSource).toMatch(/if\s*\(!sendEmail \|\| sending\)\s*return/)
  })

  it('the Enter-key handler calls sendToClient(), so it is covered by the same in-flight guard as the button (no separate bypass path exists)', () => {
    expect(pageSource).toMatch(/onKeyDown=\{e => e\.key === 'Enter' && sendToClient\(\)\}/)
  })

  it('the panel-toggle button is disabled while sending', () => {
    expect(pageSource).toMatch(
      /onClick=\{\(\) => setShowEmailInput\(v => !v\)\}\s*disabled=\{sending\}/
    )
  })

  it('a failure forces the email panel open, so the alert can never be hidden by a closed panel', () => {
    expect(sendToClientSource).toMatch(/setShowEmailInput\(true\)\s*\n\s*setSendError\(outcome\.error\)/)
  })
})

describe('page.tsx — send confirmation timer lifecycle (source contract only; no fake timers are run)', () => {
  it('holds the success timer in a ref typed for a nullable timeout handle', () => {
    expect(pageSource).toMatch(
      /const sendConfirmationTimer\s*=\s*useRef<ReturnType<typeof setTimeout> \| null>\(null\)/
    )
  })

  it('clears an existing confirmation timer and resets the ref to null before a new attempt starts', () => {
    expect(sendToClientSource).toMatch(
      /if\s*\(sendConfirmationTimer\.current\)\s*\{\s*clearTimeout\(sendConfirmationTimer\.current\)\s*sendConfirmationTimer\.current = null\s*\}/
    )
  })

  it('the timer clear-and-reset happens before sending is set to true for the new attempt', () => {
    const clearIdx = sendToClientSource.search(/clearTimeout\(sendConfirmationTimer\.current\)/)
    const sendingIdx = sendToClientSource.search(/setSending\(true\)/)
    expect(clearIdx).toBeGreaterThan(-1)
    expect(sendingIdx).toBeGreaterThan(-1)
    expect(clearIdx).toBeLessThan(sendingIdx)
  })

  it('stores a new 3-second timer in the ref only after a validated success', () => {
    const successBlock = sendToClientSource.match(/if \(outcome\.sent\) \{[\s\S]*?\n {6}\} else/)?.[0] ?? ''
    expect(successBlock).toMatch(/sendConfirmationTimer\.current = setTimeout\(\(\) => \{/)
    expect(successBlock).toMatch(/\}, 3000\)/)
  })

  it('resets the ref to null when the confirmation timer fires', () => {
    expect(sendToClientSource).toMatch(
      /setTimeout\(\(\) => \{\s*setSent\(false\)\s*sendConfirmationTimer\.current = null\s*\}, 3000\)/
    )
  })

  it('a previous send timer can never clear a newer send\'s success state, because it is cleared at the start of every new attempt', () => {
    // Structural guarantee: the clear-before-restart check above plus the
    // ref-based (not closure-based) timer means a stale timer literally
    // cannot exist by the time a new attempt begins.
    expect(sendToClientSource).toMatch(/sendConfirmationTimer\.current = null/)
  })

  it('cleans up the pending confirmation timer on unmount', () => {
    expect(pageSource).toMatch(
      /return \(\) => \{\s*if \(sendConfirmationTimer\.current\) clearTimeout\(sendConfirmationTimer\.current\)\s*\}/
    )
  })
})

describe('page.tsx — Send to Client accessibility contract (static text checks against the real source; no rendering)', () => {
  it('renders role="status" and aria-live="polite" only while sending or sent — never a permanently empty status region', () => {
    expect(pageSource).toMatch(/\{\(sending \|\| sent\) && \(\s*<div role="status" aria-live="polite"/)
  })

  it('uses role="alert" for the send failure message', () => {
    expect(pageSource).toMatch(/role="alert"[^>]*>\{sendError\}/)
  })

  it('exposes aria-busy tied to the sending state on the send button', () => {
    expect(pageSource).toMatch(/aria-busy=\{sending\}/)
  })

  it('keeps the native disabled state on the send button while sending', () => {
    expect(pageSource).toMatch(/disabled=\{sending \|\| !sendEmail\}/)
  })

  it('marks decorative spinner/check icons inside the status region as aria-hidden', () => {
    const statusBlock = pageSource.match(/role="status"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(statusBlock).toMatch(/Loader2[^/]*aria-hidden="true"/)
    expect(statusBlock).toMatch(/Check[^/]*aria-hidden="true"/)
  })

  it('the email input has an accessible name via aria-label, not only a placeholder', () => {
    expect(pageSource).toMatch(/aria-label="Client email address"/)
  })

  it('keeps the email input\'s type, placeholder, value, and change handler unchanged', () => {
    expect(pageSource).toMatch(/type="email"/)
    expect(pageSource).toMatch(/placeholder="Client email address"/)
    expect(pageSource).toMatch(/value=\{sendEmail\}/)
    expect(pageSource).toMatch(/onChange=\{e => setSendEmail\(e\.target\.value\)\}/)
  })
})

// ── lib/email.ts — Resend error propagation ──────────────────────────────────
// lib/email.ts itself is out of scope for this correction pass (already
// approved and unchanged) — only the rigor of the tests below is updated.

const mockSend = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function MockResend() {
    return { emails: { send: mockSend } }
  }),
}))

const SAFE_MESSAGE = 'Unable to send the email. Please try again.'

function baseEmailArgs() {
  return {
    to: 'client@example.com',
    clientName: 'Acme Corp',
    quarter: '3',
    year: 2026,
    mspName: 'MSP',
    portalUrl: 'https://example.com/portal/abc123',
  }
}

beforeEach(() => {
  mockSend.mockReset()
})

describe('sendQBREmail — Resend error propagation (real behavioral tests against the actual lib/email.ts, with only the resend package mocked)', () => {
  it('resolves normally when Resend returns a success result', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })

    await expect(sendQBREmail(baseEmailArgs())).resolves.toBeUndefined()
  })

  it('throws when Resend resolves with a non-null error field instead of throwing', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Invalid `to` field', statusCode: 422, name: 'validation_error' },
    })

    await expect(sendQBREmail(baseEmailArgs())).rejects.toThrow()
  })

  it('the thrown message is exactly the safe generic message and leaks no recipient, token, or provider detail', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: {
        message: 'Invalid `to` field: leaked-secret@example.com',
        statusCode: 422,
        name: 'validation_error',
      },
    })

    let thrown: unknown
    try {
      await sendQBREmail({
        ...baseEmailArgs(),
        to: 'leaked-secret@example.com',
        portalUrl: 'https://example.com/portal/super-secret-token',
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toBe(SAFE_MESSAGE)
    expect(message).not.toContain('leaked-secret@example.com')
    expect(message).not.toContain('super-secret-token')
    expect(message).not.toContain('validation_error')
    expect(message).not.toContain('Invalid `to` field')
  })

  it('throws exactly the safe message (no more, no less) when the SDK call itself rejects (network failure)', async () => {
    mockSend.mockRejectedValue(new TypeError('fetch failed'))

    let thrown: unknown
    try {
      await sendQBREmail(baseEmailArgs())
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toBe(SAFE_MESSAGE)
    expect(message).not.toContain('fetch failed')
  })
})

// ── send route — source contract ─────────────────────────────────────────────

describe('send route — source contract (no Clerk/Prisma request-mocking harness exists yet for direct route testing)', () => {
  const ROUTE_PATH = join(process.cwd(), 'app/api/qbrs/[qbrId]/send/route.ts')
  const routeSource = readFileSync(ROUTE_PATH, 'utf-8')

  it('awaits sendQBREmail before returning success:true, inside the same try block', () => {
    const tryBlock = routeSource.match(/try\s*\{[\s\S]*?\n\s*\} catch/)?.[0] ?? ''
    const sendIdx = tryBlock.search(/await sendQBREmail\(/)
    const successIdx = tryBlock.search(/success:\s*true/)

    expect(sendIdx).toBeGreaterThan(-1)
    expect(successIdx).toBeGreaterThan(-1)
    expect(sendIdx).toBeLessThan(successIdx)
  })

  it('the catch block converts any thrown error into a non-2xx JSON response', () => {
    expect(routeSource).toMatch(
      /catch\s*\([^)]*\)\s*\{[\s\S]*?NextResponse\.json\(\{\s*error:[\s\S]*?\},\s*\{\s*status:\s*500\s*\}\)/
    )
  })
})
