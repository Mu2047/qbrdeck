import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

// This repo has no jsdom/@testing-library/react (see tests/reminder-status-
// consistency.test.ts and tests/qbr-send-failure-handling.test.ts for the
// precedent this file follows). Throughout this file:
//  - "source contract" tests read page.tsx as plain text and regex-match
//    against it. They do NOT render React, do NOT exercise the real DOM,
//    and do NOT run any real browser clipboard behavior or real timers —
//    they prove the source contains the expected code shape, nothing more.
//  - the pure token-validation predicate is mirrored here (page.tsx's App
//    Router contract forbids exporting anything but its fixed set of
//    framework exports) and given real behavioral test cases, with a
//    source-contract check pinning the mirror's logic and messages to the
//    real implementation so the two cannot silently drift.

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

// retryCopyShareUrl() has no nested braces in its body, so a lazy match to
// the first 2-space-indented closing brace is unambiguous and safe here.
function extractLeafFunctionSource(name: string): string {
  const pattern = new RegExp(`async function ${name}\\(\\)[\\s\\S]*?\\n {2}\\}`)
  const match = pageSource.match(pattern)
  if (!match) throw new Error(`could not locate function ${name}() in page.tsx source`)
  return match[0]
}

const copyShareUrlSource = extractFunctionSource('copyShareUrl', 'shareQBR')
const shareQBRSource = extractFunctionSource('shareQBR', 'retryCopyShareUrl')
const retryCopyShareUrlSource = extractLeafFunctionSource('retryCopyShareUrl')

const API_FAILURE_MESSAGE = 'Unable to create the share link. Please try again.'
const CLIPBOARD_FAILURE_MESSAGE =
  'The share link was created, but it could not be copied. Please copy it manually.'

// ── Pure predicate (mirrors page.tsx's private isValidShareToken) ───────────

function isValidShareToken(token: unknown): token is string {
  if (typeof token !== 'string') return false
  const trimmed = token.trim()
  return trimmed.length > 0 && trimmed !== 'undefined' && trimmed !== 'null'
}

describe('isValidShareToken — token-validation predicate (real behavioral tests of a mirrored pure function; see source-contract pin below)', () => {
  it('pins the mirror\'s logic and messages to the real page.tsx source, so the two cannot silently drift — and is not a duplicated /^[a-f0-9]{64}$/ client-side rule', () => {
    expect(pageSource).toMatch(
      /function isValidShareToken\(token: unknown\): token is string \{\s*if \(typeof token !== 'string'\) return false\s*const trimmed = token\.trim\(\)\s*return trimmed\.length > 0 && trimmed !== 'undefined' && trimmed !== 'null'\s*\}/
    )
    expect(pageSource).not.toMatch(/\/\^\[a-f0-9\]\{64\}\$\//)
    expect(pageSource).toContain(API_FAILURE_MESSAGE)
    expect(pageSource).toContain(CLIPBOARD_FAILURE_MESSAGE)
  })

  it('accepts a normal non-empty token', () => {
    expect(isValidShareToken('abc123def456')).toBe(true)
  })

  it('rejects a whitespace-only token', () => {
    expect(isValidShareToken('   ')).toBe(false)
  })

  it('rejects an empty string token', () => {
    expect(isValidShareToken('')).toBe(false)
  })

  it('rejects an undefined (missing) token', () => {
    expect(isValidShareToken(undefined)).toBe(false)
  })

  it('rejects a null token', () => {
    expect(isValidShareToken(null)).toBe(false)
  })

  it('rejects a non-string token (number)', () => {
    expect(isValidShareToken(42)).toBe(false)
  })

  it('rejects a non-string token (object)', () => {
    expect(isValidShareToken({ token: 'abc' })).toBe(false)
  })

  it('rejects the literal string "undefined"', () => {
    expect(isValidShareToken('undefined')).toBe(false)
  })

  it('rejects the literal string "null"', () => {
    expect(isValidShareToken('null')).toBe(false)
  })

  it('rejects "undefined"/"null" even with surrounding whitespace', () => {
    expect(isValidShareToken('  undefined  ')).toBe(false)
    expect(isValidShareToken('  null  ')).toBe(false)
  })

  it('a valid token builds the expected portal URL', () => {
    const token = 'abc123def456'
    const origin = 'https://app.example.com'
    expect(isValidShareToken(token)).toBe(true)
    const url = `${origin}/portal/${token.trim()}`
    expect(url).toBe('https://app.example.com/portal/abc123def456')
  })

  it('none of the rejected token shapes could ever produce /portal/undefined, /portal/null, or /portal/', () => {
    const rejected: unknown[] = [undefined, null, '', '   ', 'undefined', 'null', 42, {}]
    for (const token of rejected) {
      expect(isValidShareToken(token)).toBe(false)
    }
    // Structural guarantee: page.tsx only ever builds the URL after
    // isValidShareToken() returns true (see source-contract check below),
    // so none of these values can reach `/portal/${token}`.
  })
})

// ── page.tsx source contract — shareQBR() ────────────────────────────────────

describe('page.tsx — Share Link source contract (static text checks against the real source; no rendering)', () => {
  it('shareQBR calls requestJson<{ token: string }>() against the exact share endpoint', () => {
    expect(shareQBRSource).toMatch(
      /requestJson<\{\s*token:\s*string\s*\}>\(\s*`\/api\/qbrs\/\$\{params\.qbrId\}\/share`/
    )
  })

  it('the request uses method: POST', () => {
    expect(shareQBRSource).toMatch(/method:\s*'POST'/)
  })

  it('no longer performs a bare unchecked fetch to the share endpoint', () => {
    expect(shareQBRSource).not.toMatch(/await fetch\(`\/api\/qbrs\/\$\{params\.qbrId\}\/share`/)
  })

  it('clears any previous share error before a new attempt, before sharing is set', () => {
    const errorIdx = shareQBRSource.search(/setShareError\(null\)/)
    const sharingIdx = shareQBRSource.search(/setSharing\(true\)/)
    expect(errorIdx).toBeGreaterThan(-1)
    expect(sharingIdx).toBeGreaterThan(-1)
    expect(errorIdx).toBeLessThan(sharingIdx)
  })

  it('validates result.ok and isValidShareToken(result.data?.token) before building any URL', () => {
    const guardIdx = shareQBRSource.search(/if\s*\(!result\.ok \|\| !isValidShareToken\(result\.data\?\.token\)\)/)
    const urlIdx = shareQBRSource.search(/const url = `\$\{window\.location\.origin\}\/portal\/\$\{result\.data\.token\.trim\(\)\}`/)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(urlIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(urlIdx)
  })

  it('the validation-failure branch never reaches the URL-building or clipboard code (early return)', () => {
    const failureBlock = shareQBRSource.match(
      /if\s*\(!result\.ok \|\| !isValidShareToken\(result\.data\?\.token\)\)\s*\{[\s\S]*?\n {6}\}/
    )?.[0] ?? ''
    expect(failureBlock).toMatch(/setShareError\(SHARE_API_FAILURE_MESSAGE\)/)
    expect(failureBlock).toMatch(/return/)
    expect(failureBlock).not.toMatch(/portal/)
    expect(failureBlock).not.toMatch(/clipboard/)
  })

  it('clipboard is only ever invoked inside copyShareUrl, called after the URL is built and shareUrl is set', () => {
    const setUrlIdx = shareQBRSource.search(/setShareUrl\(url\)/)
    const copyCallIdx = shareQBRSource.search(/await copyShareUrl\(url\)/)
    expect(setUrlIdx).toBeGreaterThan(-1)
    expect(copyCallIdx).toBeGreaterThan(-1)
    expect(setUrlIdx).toBeLessThan(copyCallIdx)
    // shareQBR itself never calls the clipboard API directly.
    expect(shareQBRSource).not.toMatch(/navigator\.clipboard/)
  })

  it('always resets sharing in a finally block', () => {
    expect(shareQBRSource).toMatch(/finally\s*\{\s*setSharing\(false\)/)
  })

  it('does not retry the API automatically — exactly one requestJson call per attempt', () => {
    const calls = shareQBRSource.match(/requestJson</g) ?? []
    expect(calls.length).toBe(1)
  })
})

// ── Concurrency: clipboard-copy mutex ────────────────────────────────────────

describe('page.tsx — clipboard-copy mutex source contract (static text checks; does not execute React, clipboard, or timers)', () => {
  it('declares shareCopyInFlight as a ref (the authoritative, synchronous concurrency guard), not just React state', () => {
    expect(pageSource).toMatch(/const shareCopyInFlight\s*=\s*useRef\(false\)/)
  })

  it('declares copyingShareUrl as separate UI-facing state', () => {
    expect(pageSource).toMatch(/const \[copyingShareUrl, setCopyingShareUrl\]\s*=\s*useState\(false\)/)
  })

  it('copyShareUrl checks shareCopyInFlight.current and returns immediately, before anything else in the function', () => {
    expect(copyShareUrlSource).toMatch(
      /async function copyShareUrl\(url: string\) \{\s*if \(shareCopyInFlight\.current\) return/
    )
  })

  it('copyShareUrl sets shareCopyInFlight.current = true before the clipboard await', () => {
    const setRefIdx = copyShareUrlSource.search(/shareCopyInFlight\.current = true/)
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    expect(setRefIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(setRefIdx).toBeLessThan(writeIdx)
  })

  it('copyShareUrl sets copyingShareUrl(true) before the clipboard await', () => {
    const setStateIdx = copyShareUrlSource.search(/setCopyingShareUrl\(true\)/)
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    expect(setStateIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(setStateIdx).toBeLessThan(writeIdx)
  })

  it('the ref is set true strictly before the state is set true (ref is authoritative)', () => {
    const setRefIdx = copyShareUrlSource.search(/shareCopyInFlight\.current = true/)
    const setStateIdx = copyShareUrlSource.search(/setCopyingShareUrl\(true\)/)
    expect(setRefIdx).toBeGreaterThan(-1)
    expect(setStateIdx).toBeGreaterThan(-1)
    expect(setRefIdx).toBeLessThan(setStateIdx)
  })

  it('copyShareUrl resets both the ref and the state in a finally block, guaranteeing release even on clipboard rejection', () => {
    expect(copyShareUrlSource).toMatch(
      /finally\s*\{\s*shareCopyInFlight\.current = false\s*setCopyingShareUrl\(false\)\s*\}/
    )
  })

  it('shareQBR checks shareCopyInFlight.current in its guard, alongside sharing', () => {
    expect(shareQBRSource).toMatch(/if\s*\(sharing \|\| shareCopyInFlight\.current\)\s*return/)
  })

  it('retryCopyShareUrl checks shareCopyInFlight.current in its guard, alongside shareUrl and sharing', () => {
    expect(retryCopyShareUrlSource).toMatch(
      /if\s*\(!shareUrl \|\| sharing \|\| shareCopyInFlight\.current\)\s*return/
    )
  })

  it('the Share Link button is disabled and aria-busy while either sharing or a copy is in flight', () => {
    expect(pageSource).toMatch(
      /onClick=\{shareQBR\}\s*disabled=\{sharing \|\| copyingShareUrl\}\s*aria-busy=\{sharing \|\| copyingShareUrl\}/
    )
  })

  it('the retry-copy button is disabled while either sharing or a copy is in flight', () => {
    expect(pageSource).toMatch(
      /onClick=\{retryCopyShareUrl\}\s*disabled=\{sharing \|\| copyingShareUrl\}/
    )
  })

  it('the retry-copy button exposes aria-busy tied to copyingShareUrl', () => {
    expect(pageSource).toMatch(
      /disabled=\{sharing \|\| copyingShareUrl\}\s*aria-busy=\{copyingShareUrl\}\s*aria-label="Copy share link to clipboard"/
    )
  })

  it('no two copy operations are intentionally allowed to overlap: copyShareUrl is the single entry point for both the fresh-token auto-copy and the manual retry, and it self-guards on shareCopyInFlight', () => {
    // shareQBR's auto-copy and retryCopyShareUrl both funnel through
    // copyShareUrl(), and copyShareUrl() is the sole place that sets/reads
    // shareCopyInFlight — so a second caller arriving while one copy is in
    // flight always hits the early-return guard, not a fresh clipboard call.
    expect(shareQBRSource).toMatch(/await copyShareUrl\(url\)/)
    expect(retryCopyShareUrlSource).toMatch(/await copyShareUrl\(shareUrl\)/)
    const clipboardCalls = copyShareUrlSource.match(/navigator\.clipboard\.writeText/g) ?? []
    expect(clipboardCalls.length).toBe(1)
    expect(shareQBRSource).not.toMatch(/navigator\.clipboard/)
    expect(retryCopyShareUrlSource).not.toMatch(/navigator\.clipboard/)
  })
})

// ── copyShareUrl / retryCopyShareUrl ─────────────────────────────────────────

describe('page.tsx — copyShareUrl / retryCopyShareUrl source contract', () => {
  it('copyShareUrl awaits navigator.clipboard.writeText before setting copied:true', () => {
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    const copiedIdx = copyShareUrlSource.search(/setCopied\(true\)/)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(copiedIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeLessThan(copiedIdx)
  })

  it('setCopied(true) is only reachable through the try block, never unconditionally', () => {
    expect(copyShareUrlSource).toMatch(/try\s*\{\s*await navigator\.clipboard\.writeText\(url\)\s*setCopied\(true\)/)
  })

  it('a clipboard rejection sets the distinct clipboard failure message, not the API failure message, and never exposes the raw exception', () => {
    const catchBlock = copyShareUrlSource.match(/catch\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(catchBlock).toMatch(/setShareError\(SHARE_CLIPBOARD_FAILURE_MESSAGE\)/)
    expect(catchBlock).not.toMatch(/SHARE_API_FAILURE_MESSAGE/)
    // catch {} takes no error binding, so there is no captured exception
    // value available to leak into UI state in the first place.
    expect(copyShareUrlSource).toMatch(/\}\s*catch\s*\{/)
  })

  it('a clipboard rejection never clears shareUrl, so the link stays available for manual copy/retry', () => {
    const catchBlock = copyShareUrlSource.match(/catch\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(catchBlock).not.toMatch(/setShareUrl/)
  })

  it('retryCopyShareUrl reuses shareUrl and never calls the share API', () => {
    expect(retryCopyShareUrlSource).toMatch(/if\s*\(!shareUrl \|\| sharing \|\| shareCopyInFlight\.current\)\s*return/)
    expect(retryCopyShareUrlSource).toMatch(/await copyShareUrl\(shareUrl\)/)
    expect(retryCopyShareUrlSource).not.toMatch(/requestJson/)
    expect(retryCopyShareUrlSource).not.toMatch(/fetch\(/)
  })

  it('the retry-copy button keeps its accessible name "Copy share link to clipboard"', () => {
    expect(pageSource).toMatch(/aria-label="Copy share link to clipboard"/)
  })
})

// ── Timer lifecycle ───────────────────────────────────────────────────────────

describe('page.tsx — Share Link timer lifecycle (source contract only; no fake timers are run)', () => {
  it('uses a dedicated copiedTimer ref, distinct from the send and autosave timers', () => {
    expect(pageSource).toMatch(
      /const copiedTimer\s*=\s*useRef<ReturnType<typeof setTimeout> \| null>\(null\)/
    )
    // Distinct identifiers — not a reuse of sendConfirmationTimer or saveTimer.
    expect(pageSource).toMatch(/const sendConfirmationTimer\s*=\s*useRef/)
    expect(pageSource).toMatch(/const saveTimer\s*=\s*useRef/)
  })

  it('copyShareUrl clears any existing copied timer after mutex acquisition, before touching copied/shareError', () => {
    const mutexIdx = copyShareUrlSource.search(/setCopyingShareUrl\(true\)/)
    const clearIdx = copyShareUrlSource.search(/clearTimeout\(copiedTimer\.current\)/)
    const copiedResetIdx = copyShareUrlSource.search(/setCopied\(false\)/)
    expect(mutexIdx).toBeGreaterThan(-1)
    expect(clearIdx).toBeGreaterThan(-1)
    expect(copiedResetIdx).toBeGreaterThan(-1)
    expect(mutexIdx).toBeLessThan(clearIdx)
    expect(clearIdx).toBeLessThan(copiedResetIdx)
  })

  it('the timer ref is set to null right after being cleared', () => {
    expect(copyShareUrlSource).toMatch(
      /if\s*\(copiedTimer\.current\)\s*\{\s*clearTimeout\(copiedTimer\.current\)\s*copiedTimer\.current = null\s*\}/
    )
  })

  it('resets copied to false at the start of every genuine copy attempt, before the clipboard write', () => {
    const copiedResetIdx = copyShareUrlSource.search(/setCopied\(false\)/)
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    expect(copiedResetIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(copiedResetIdx).toBeLessThan(writeIdx)
  })

  it('clears the previous clipboard error at the start of every genuine copy attempt, before the clipboard write', () => {
    const errorClearIdx = copyShareUrlSource.search(/setShareError\(null\)/)
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    expect(errorClearIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(errorClearIdx).toBeLessThan(writeIdx)
  })

  it('stores exactly one new 3-second timer following clipboard success, and resets copied/the ref when it fires', () => {
    const timerMatches = copyShareUrlSource.match(/copiedTimer\.current = setTimeout\(/g) ?? []
    expect(timerMatches.length).toBe(1)
    expect(copyShareUrlSource).toMatch(
      /copiedTimer\.current = setTimeout\(\(\) => \{\s*setCopied\(false\)\s*copiedTimer\.current = null\s*\}, 3000\)/
    )
  })

  it('because the mutex prevents overlap, only one copy attempt can ever be mid-flight, so no orphaned timer or stale completion can exist', () => {
    // Structural guarantee: shareCopyInFlight.current gates entry to the
    // entire body of copyShareUrl (timer clear, copied reset, clipboard
    // write, new timer creation) — a second concurrent call returns before
    // reaching any of that code, so it can never clear/replace a timer that
    // belongs to an attempt still in flight.
    const guardIdx = copyShareUrlSource.search(/if \(shareCopyInFlight\.current\) return/)
    const clearIdx = copyShareUrlSource.search(/clearTimeout\(copiedTimer\.current\)/)
    expect(copyShareUrlSource).toMatch(/^async function copyShareUrl\(url: string\) \{\s*if \(shareCopyInFlight\.current\) return/)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(clearIdx).toBeGreaterThan(guardIdx)
  })

  it('shareQBR no longer duplicates the timer-clear/copied-reset logic itself — that now lives solely in copyShareUrl', () => {
    expect(shareQBRSource).not.toMatch(/copiedTimer\.current/)
    expect(shareQBRSource).not.toMatch(/setCopied\(false\)/)
  })

  it('cleans up the pending copied timer on unmount, in its own effect (independent of the send confirmation timer\'s cleanup)', () => {
    expect(pageSource).toMatch(
      /return \(\) => \{\s*if \(copiedTimer\.current\) clearTimeout\(copiedTimer\.current\)\s*\}/
    )
  })
})

// ── Existing share URL preservation ──────────────────────────────────────────

describe('page.tsx — prior share URL preservation (a new share link never revokes an old one, so the UI must not erase it speculatively)', () => {
  it('shareQBR never calls setShareUrl(null)', () => {
    expect(shareQBRSource).not.toMatch(/setShareUrl\(null\)/)
  })

  it('shareQBR does not clear shareUrl before calling requestJson — the prior URL stays visible during the new attempt', () => {
    const requestIdx = shareQBRSource.search(/requestJson</)
    expect(requestIdx).toBeGreaterThan(-1)
    const beforeRequest = shareQBRSource.slice(0, requestIdx)
    expect(beforeRequest).not.toMatch(/setShareUrl/)
  })

  it('setShareUrl(url) is only reached after both result.ok and isValidShareToken have passed', () => {
    const guardIdx = shareQBRSource.search(/if\s*\(!result\.ok \|\| !isValidShareToken\(result\.data\?\.token\)\)/)
    const setUrlIdx = shareQBRSource.search(/setShareUrl\(url\)/)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(setUrlIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(setUrlIdx)
    // The failure branch above returns before reaching setShareUrl at all
    // (see the "validation-failure branch never reaches" test above), so an
    // API failure leaves whatever the prior shareUrl state was untouched.
  })

  it('a clipboard failure inside copyShareUrl never touches shareUrl, so the newly validated URL remains available', () => {
    expect(copyShareUrlSource).not.toMatch(/setShareUrl/)
  })

  it('the manual share-link fallback renders from the persisted shareUrl state, not a value scoped to a single request', () => {
    expect(pageSource).toMatch(/\{shareUrl && \(\s*<div className="card p-4 mb-4 flex items-center gap-3">\s*<input/)
    expect(pageSource).toMatch(/value=\{shareUrl\}/)
  })
})

// ── Status / accessibility ───────────────────────────────────────────────────

describe('page.tsx — Share Link accessibility contract (static text checks against the real source; no rendering)', () => {
  it('the Share Link button has a stable accessible name via aria-label', () => {
    expect(pageSource).toMatch(/aria-label="Share Link"/)
  })

  it('renders role="status" and aria-live="polite" for the share status region only while sharing, copyingShareUrl, or copied — never a permanently empty region', () => {
    expect(pageSource).toMatch(
      /\{\(sharing \|\| copyingShareUrl \|\| copied\) && \(\s*<div role="status" aria-live="polite"/
    )
  })

  it('the share status region covers all three announcements: "Creating share link...", "Copying share link...", "Copied!"', () => {
    const shareStatusBlock = pageSource.match(
      /\{\(sharing \|\| copyingShareUrl \|\| copied\) && \([\s\S]*?<\/div>\s*\)\}/
    )?.[0] ?? ''
    expect(shareStatusBlock).toMatch(/Creating share link\.\.\./)
    expect(shareStatusBlock).toMatch(/Copying share link\.\.\./)
    expect(shareStatusBlock).toMatch(/Copied!/)
  })

  it('the "Copying share link..." line is only shown while not sharing (mutually exclusive with the "Creating" message)', () => {
    const shareStatusBlock = pageSource.match(
      /\{\(sharing \|\| copyingShareUrl \|\| copied\) && \([\s\S]*?<\/div>\s*\)\}/
    )?.[0] ?? ''
    expect(shareStatusBlock).toMatch(/\{!sharing && copyingShareUrl && /)
  })

  it('the "Copied!" line is only shown once neither sharing nor copyingShareUrl is active', () => {
    const shareStatusBlock = pageSource.match(
      /\{\(sharing \|\| copyingShareUrl \|\| copied\) && \([\s\S]*?<\/div>\s*\)\}/
    )?.[0] ?? ''
    expect(shareStatusBlock).toMatch(/\{!sharing && !copyingShareUrl && copied && /)
  })

  it('marks decorative spinner/check icons inside the share status region as aria-hidden', () => {
    const shareStatusBlock = pageSource.match(
      /\{\(sharing \|\| copyingShareUrl \|\| copied\) && \([\s\S]*?<\/div>\s*\)\}/
    )?.[0] ?? ''
    expect(shareStatusBlock).toMatch(/Loader2[^/]*aria-hidden="true"/)
    expect(shareStatusBlock).toMatch(/Check[^/]*aria-hidden="true"/)
  })

  it('failures (API and clipboard) are announced via role="alert"', () => {
    expect(pageSource).toMatch(/role="alert" className="text-xs text-red-600 mb-2">\{shareError\}/)
  })

  it('the read-only share-link field has an accessible name via aria-label', () => {
    expect(pageSource).toMatch(/aria-label="Share link URL"/)
  })

  it('the share-link field is read-only, not editable', () => {
    expect(pageSource).toMatch(/type="text"\s*readOnly\s*aria-label="Share link URL"/)
  })

  it('the retry-copy button keeps its accessible name via aria-label', () => {
    expect(pageSource).toMatch(/onClick=\{retryCopyShareUrl\}[\s\S]{0,120}aria-label="Copy share link to clipboard"/)
  })

  it('the Copy icon on the retry-copy button is aria-hidden', () => {
    expect(pageSource).toMatch(/<Copy size=\{14\} aria-hidden="true" \/> Copy/)
  })

  it('the manual share-link fallback is only rendered while shareUrl is set — never permanently present', () => {
    expect(pageSource).toMatch(/\{shareUrl && \(\s*<div className="card p-4 mb-4 flex items-center gap-3">\s*<input/)
  })
})

// ── Existing safety, re-affirmed after the mutex changes ────────────────────

describe('page.tsx — existing safety re-affirmed (unchanged by the mutex correction pass)', () => {
  it('retry copy never invokes requestJson or fetch', () => {
    expect(retryCopyShareUrlSource).not.toMatch(/requestJson/)
    expect(retryCopyShareUrlSource).not.toMatch(/fetch\(/)
  })

  it('invalid tokens never reach URL construction in shareQBR', () => {
    const guardIdx = shareQBRSource.search(/if\s*\(!result\.ok \|\| !isValidShareToken\(result\.data\?\.token\)\)/)
    const urlIdx = shareQBRSource.search(/const url = `\$\{window\.location\.origin\}\/portal\//)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(urlIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(urlIdx)
  })

  it('clipboard is awaited before copied=true, even with the mutex in place', () => {
    const writeIdx = copyShareUrlSource.search(/await navigator\.clipboard\.writeText\(url\)/)
    const copiedIdx = copyShareUrlSource.search(/setCopied\(true\)/)
    expect(writeIdx).toBeGreaterThan(-1)
    expect(copiedIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeLessThan(copiedIdx)
  })

  it('no /portal/undefined, /portal/null, or empty portal path can be copied: the URL is only built from a trimmed, validated token', () => {
    expect(shareQBRSource).toMatch(/const url = `\$\{window\.location\.origin\}\/portal\/\$\{result\.data\.token\.trim\(\)\}`/)
    expect(shareQBRSource).not.toMatch(/\/portal\/\$\{result\.data\.token\}`/)
  })
})

// ── Unchanged files (out of scope for this stage; re-affirmed, not modified) ─

describe('share route — source contract (unchanged by this stage; no genuine server defect was found on inspection)', () => {
  const ROUTE_PATH = join(process.cwd(), 'app/api/qbrs/[qbrId]/share/route.ts')
  const routeSource = readFileSync(ROUTE_PATH, 'utf-8')

  it('awaits createShareLink before returning { token }, inside the same try block', () => {
    const tryBlock = routeSource.match(/try\s*\{[\s\S]*?\n\s*\} catch/)?.[0] ?? ''
    const tokenIdx = tryBlock.search(/const token = await createShareLink\(/)
    const returnIdx = tryBlock.search(/NextResponse\.json\(\{\s*token\s*\}\)/)
    expect(tokenIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(-1)
    expect(tokenIdx).toBeLessThan(returnIdx)
  })

  it('the catch block converts any thrown error into a non-2xx JSON response', () => {
    expect(routeSource).toMatch(
      /catch\s*\([^)]*\)\s*\{[\s\S]*?NextResponse\.json\(\{\s*error:[\s\S]*?\},\s*\{\s*status:\s*500\s*\}\)/
    )
  })

  it('the POST handler\'s success response body is exactly { token } — no other 2xx return path exists in POST', () => {
    // Scoped to the POST export only — the DELETE (revoke) export has its
    // own, unrelated { success: true } response and is out of scope here.
    const postHandler = routeSource.match(/export async function POST\([\s\S]*?\n\}/)?.[0] ?? ''
    const successReturns = postHandler.match(/NextResponse\.json\(\{[^}]*\}\)(?!\s*,\s*\{\s*status)/g) ?? []
    for (const line of successReturns) {
      expect(line).toMatch(/\{\s*token\s*\}/)
    }
    expect(successReturns.length).toBeGreaterThan(0)
  })
})

describe('lib/share-links.ts — createShareLink() source contract (unchanged by this stage)', () => {
  const LIB_PATH = join(process.cwd(), 'lib/share-links.ts')
  const libSource = readFileSync(LIB_PATH, 'utf-8')

  it('always generates a fresh random token before returning, never a literal "undefined"/"null"/empty value', () => {
    expect(libSource).toMatch(/const rawToken\s*=\s*randomBytes\(32\)\.toString\('hex'\)/)
    expect(libSource).toMatch(/return rawToken/)
  })
})
