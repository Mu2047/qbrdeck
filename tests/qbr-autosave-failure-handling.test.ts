import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { SerializedLatestQueue } from '@/lib/serialized-latest-queue'
import type { ApiResult } from '@/lib/api-client'

// This repo has no jsdom/@testing-library/react (see tests/qbr-send-failure-
// handling.test.ts and tests/qbr-share-failure-handling.test.ts for the
// precedent this file follows). Throughout this file:
//  - "source contract" tests read page.tsx as plain text and regex-match
//    against it. They do NOT render React, do NOT exercise the real DOM /
//    browser accessibility tree, and do NOT run the actual page module —
//    they prove the source contains the expected code shape, nothing more.
//  - the save-state decision logic (enqueueSaveBody / saveSlides / retrySave)
//    is mirrored here as a small harness and given real behavioral test
//    cases against the REAL, imported SerializedLatestQueue (not a
//    reimplementation) — so ordering/concurrency/version-ownership
//    guarantees are exercised for real, not just asserted via regex. A
//    source-contract pin below ties the mirror's shape to the real
//    page.tsx source so the two cannot silently drift.
//
// Stage 4 correction: latestSaveBodyRef has been removed entirely. Every
// save attempt — including one whose JSON.stringify fails — now claims a
// SerializedLatestQueue version via enqueueSaveBody(), so no attempt can
// bypass the version/isLatest ownership model. Retry save no longer resends
// a cached body; it re-runs saveSlides(rawSlides) against whatever is
// currently visible on screen. The harness mirrors this exactly, including
// exposing setRawSlides() the same way page.tsx's real React state setter is
// called independently of saveSlides() by every updater.

const PAGE_PATH = join(
  process.cwd(),
  'app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx'
)
// Normalized to LF regardless of the checked-out line-ending style, so the
// literal multi-line toContain() checks below aren't sensitive to CRLF.
const pageSource = readFileSync(PAGE_PATH, 'utf-8').replace(/\r\n/g, '\n')

function extractFunctionSource(name: string, nextSiblingName: string): string {
  const pattern = new RegExp(
    `(?:async )?function ${name}\\([^)]*\\)[\\s\\S]*?(?=\\n\\s*(?:async )?function ${nextSiblingName}\\b)`
  )
  const match = pageSource.match(pattern)
  if (!match) throw new Error(`could not locate function ${name}() in page.tsx source`)
  return match[0]
}

const enqueueSaveBodySource = extractFunctionSource('enqueueSaveBody', 'saveSlides')
const saveSlidesSource      = extractFunctionSource('saveSlides', 'retrySave')
const retrySaveSource       = extractFunctionSource('retrySave', 'updateContent')

const SAVE_FAILURE_MESSAGE = 'Your latest changes were not saved. Please retry.'

// ── page.tsx source contract ─────────────────────────────────────────────────

describe('page.tsx — SaveState / imports / typing source contract', () => {
  it('SaveState includes an error state, alongside idle/saving/saved', () => {
    expect(pageSource).toMatch(/type SaveState = 'idle' \| 'saving' \| 'saved' \| 'error'/)
  })

  it('pins SAVE_FAILURE_MESSAGE to the real source, so the mirror below cannot silently drift', () => {
    expect(pageSource).toContain(SAVE_FAILURE_MESSAGE)
  })

  it('imports the serialized queue helper, and uses ApiResult<unknown> — not ApiResult<QBR> or any — as the queue/request generic', () => {
    expect(pageSource).toMatch(/import \{ SerializedLatestQueue \} from '@\/lib\/serialized-latest-queue'/)
    expect(pageSource).toMatch(/requestJson<unknown>\(/)
    expect(pageSource).not.toMatch(/requestJson<any>/)
    expect(pageSource).not.toMatch(/requestJson<QBR>/)
  })

  it('the obsolete Prisma QBR import is absent — nothing else in the page needs it now that the generic is unknown', () => {
    expect(pageSource).not.toMatch(/from '@prisma\/client'/)
    expect(pageSource).not.toMatch(/import type \{ QBR \}/)
  })

  it('declares saveQueueRef as SerializedLatestQueue<ApiResult<unknown>>', () => {
    expect(pageSource).toMatch(
      /const saveQueueRef\s*=\s*useRef\(new SerializedLatestQueue<ApiResult<unknown>>\(\)\)/
    )
  })

  it('latestSaveBodyRef no longer exists anywhere in the source — rawSlides state is the only source of truth Retry ever reads', () => {
    expect(pageSource).not.toMatch(/latestSaveBodyRef/)
  })
})

describe('page.tsx — enqueueSaveBody() owns the version/isLatest decision logic for every save attempt', () => {
  it('takes a task thunk that resolves an ApiResult, not a precomputed request body string', () => {
    expect(pageSource).toMatch(
      /async function enqueueSaveBody\(task: \(\) => Promise<ApiResult<unknown>>\): Promise<void> \{/
    )
  })

  it('enqueues the task on saveQueueRef rather than awaiting a bare request directly', () => {
    expect(enqueueSaveBodySource).toMatch(
      /const \{ version, settled \} = saveQueueRef\.current\.enqueue\(task\)/
    )
  })

  it('never constructs or serializes a request body itself — that is saveSlides()\'s job, not enqueueSaveBody()\'s', () => {
    expect(enqueueSaveBodySource).not.toMatch(/JSON\.stringify/)
    expect(enqueueSaveBodySource).not.toMatch(/requestJson\(/)
  })

  it('only the latest queued attempt may set the final visible state — the isLatest guard appears both after a rejection and after a successful settle, before either Saved or Error', () => {
    const guardOccurrences = enqueueSaveBodySource.match(/if\s*\(!saveQueueRef\.current\.isLatest\(version\)\)\s*return/g) ?? []
    expect(guardOccurrences.length).toBe(2) // once in the catch block, once after the try
    const savedIdx = enqueueSaveBodySource.search(/setSaveState\('saved'\)/)
    const firstGuardIdx = enqueueSaveBodySource.search(/if\s*\(!saveQueueRef\.current\.isLatest\(version\)\)\s*return/)
    expect(firstGuardIdx).toBeGreaterThan(-1)
    expect(firstGuardIdx).toBeLessThan(savedIdx)
  })

  it('a non-ok result can never reach setSaveState(\'saved\') — the two live in mutually exclusive if/else branches', () => {
    const ifElse = enqueueSaveBodySource.match(/if\s*\(result\.ok\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
    const ifBlock = ifElse.match(/if\s*\(result\.ok\)\s*\{[\s\S]*?\n\s{4}\}\s*else/)?.[0] ?? ''
    const elseBlock = ifElse.slice(ifElse.indexOf('else'))
    expect(ifBlock).toMatch(/setSaveState\('saved'\)/)
    expect(elseBlock).toMatch(/setSaveState\('error'\)/)
    expect(elseBlock).not.toMatch(/setSaveState\('saved'\)/)
  })
})

describe('page.tsx — a rejected queued task is caught, never leaves the UI stuck on Saving', () => {
  it('await settled is wrapped in try/catch', () => {
    expect(enqueueSaveBodySource).toMatch(/try\s*\{\s*result = await settled\s*\}\s*catch\s*\{/)
  })

  it('the catch branch checks isLatest before touching visible state, exactly like the success/failure path', () => {
    const catchBlock = enqueueSaveBodySource.match(/catch\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
    expect(catchBlock).toMatch(/if\s*\(!saveQueueRef\.current\.isLatest\(version\)\)\s*return/)
    expect(catchBlock).toMatch(/setSaveState\('error'\)/)
    expect(catchBlock).toMatch(/setSaveError\(SAVE_FAILURE_MESSAGE\)/)
  })

  it('the catch branch never exposes the thrown exception — no reference to a caught error binding or its message', () => {
    const catchBlock = enqueueSaveBodySource.match(/catch\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
    expect(enqueueSaveBodySource).toMatch(/\}\s*catch\s*\{/)
    expect(catchBlock).not.toMatch(/\.message/)
    expect(catchBlock).not.toMatch(/err\b/)
  })

  it('the catch branch never schedules the Saved-reset timer', () => {
    const catchBlock = enqueueSaveBodySource.match(/catch\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
    expect(catchBlock).not.toMatch(/setTimeout/)
  })
})

describe('page.tsx — saveSlides() serializes synchronously and enqueues exactly one task, regardless of the outcome', () => {
  it('attempts JSON.stringify synchronously, storing null on failure instead of throwing or returning early', () => {
    expect(saveSlidesSource).toContain(
      `    let requestBody: string | null\n` +
      `    try {\n` +
      `      requestBody = JSON.stringify({ slides: nextRawSlides })\n` +
      `    } catch {\n` +
      `      requestBody = null\n` +
      `    }`
    )
  })

  it('captures the serialized (or null) body into an immutable const before enqueueing', () => {
    const bodyIdx = saveSlidesSource.search(/const body = requestBody/)
    const enqueueIdx = saveSlidesSource.search(/await enqueueSaveBody\(/)
    expect(bodyIdx).toBeGreaterThan(-1)
    expect(enqueueIdx).toBeGreaterThan(-1)
    expect(bodyIdx).toBeLessThan(enqueueIdx)
  })

  it('enqueueSaveBody is called exactly once, unconditionally — a serialization failure never skips enqueueing', () => {
    const calls = saveSlidesSource.match(/enqueueSaveBody\(/g) ?? []
    expect(calls.length).toBe(1)
  })

  it('the queued task returns a safe local ApiFailure — never calling requestJson — when serialization failed', () => {
    expect(saveSlidesSource).toContain(
      `      if (body === null) {\n` +
      `        return Promise.resolve<ApiResult<unknown>>({\n` +
      `          ok: false,\n` +
      `          status: null,\n` +
      `          error: SAVE_FAILURE_MESSAGE,\n` +
      `        })\n` +
      `      }`
    )
  })

  it('the queued task never throws — the JSON.stringify exception is caught in saveSlides(), never re-raised inside the task passed to enqueueSaveBody', () => {
    const taskBody = saveSlidesSource.match(/await enqueueSaveBody\(\(\) => \{[\s\S]*?\n {4}\}\)/)?.[0] ?? ''
    expect(taskBody).not.toBe('')
    expect(taskBody).not.toMatch(/throw/)
  })

  it('the queued task calls requestJson with the exact PATCH endpoint, method, headers, and the immutable body only when serialization succeeded', () => {
    expect(saveSlidesSource).toContain(
      `      return requestJson<unknown>(\`/api/qbrs/\${params.qbrId}\`, {\n` +
      `        method: 'PATCH',\n` +
      `        headers: { 'Content-Type': 'application/json' },\n` +
      `        body,\n` +
      `      })`
    )
    expect(saveSlidesSource).not.toMatch(/await fetch\(`\/api\/qbrs\/\$\{params\.qbrId\}`/)
  })

  it('no direct parallel PATCH path remains anywhere in the file — exactly one PATCH call site', () => {
    const patchCalls = pageSource.match(/method:\s*'PATCH'/g) ?? []
    expect(patchCalls.length).toBe(1)
  })

  it('latestSaveBodyRef is never written to — no such assignment exists anywhere', () => {
    expect(saveSlidesSource).not.toMatch(/latestSaveBodyRef/)
  })
})

describe('page.tsx — Retry mutex: a synchronous ref, not just saveState/retryingSave', () => {
  it('declares retrySaveInFlight as a ref and retryingSave as UI state', () => {
    expect(pageSource).toMatch(/const retrySaveInFlight\s*=\s*useRef\(false\)/)
    expect(pageSource).toMatch(/const \[retryingSave, setRetryingSave\]\s*=\s*useState\(false\)/)
  })

  it('retrySave checks retrySaveInFlight.current first, before any await, and never gates on a cached body', () => {
    expect(retrySaveSource).toMatch(
      /^async function retrySave\(\) \{\s*if \(retrySaveInFlight\.current\) return/
    )
    expect(retrySaveSource).not.toMatch(/latestSaveBodyRef/)
    expect(retrySaveSource).not.toMatch(/if \(!.*\) return\s*\n\s*retrySaveInFlight\.current = true/)
  })

  it('sets the ref true before setRetryingSave and before the await', () => {
    const refIdx = retrySaveSource.search(/retrySaveInFlight\.current = true/)
    const stateIdx = retrySaveSource.search(/setRetryingSave\(true\)/)
    const awaitIdx = retrySaveSource.search(/await saveSlides\(rawSlides\)/)
    expect(refIdx).toBeGreaterThan(-1)
    expect(stateIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeGreaterThan(-1)
    expect(refIdx).toBeLessThan(stateIdx)
    expect(stateIdx).toBeLessThan(awaitIdx)
  })

  it('resets both the ref and the state in a finally block, guaranteeing release even on failure', () => {
    expect(retrySaveSource).toMatch(
      /finally\s*\{\s*retrySaveInFlight\.current = false\s*setRetryingSave\(false\)\s*\}/
    )
  })

  it('retry re-runs the identical serialize/enqueue path as any edit, against the CURRENT rawSlides — never a cached body, never a direct JSON.stringify/requestJson/fetch call', () => {
    expect(retrySaveSource).toMatch(/await saveSlides\(rawSlides\)/)
    expect(retrySaveSource).not.toMatch(/fetch\(/)
    expect(retrySaveSource).not.toMatch(/requestJson/)
    expect(retrySaveSource).not.toMatch(/JSON\.stringify/)
    expect(retrySaveSource).not.toMatch(/enqueueSaveBody/)
  })

  it('retrySave is never invoked automatically — its only call site is the Retry save button, and neither enqueueSaveBody, saveSlides, nor the reset timer ever calls it', () => {
    expect(pageSource).toMatch(/onClick=\{retrySave\}/)
    expect(enqueueSaveBodySource).not.toMatch(/retrySave/)
    expect(saveSlidesSource).not.toMatch(/retrySave/)
    const timerCallback = enqueueSaveBodySource.match(/setTimeout\(\(\) => \{[\s\S]*?\}, 2000\)/)?.[0] ?? ''
    expect(timerCallback).not.toMatch(/retrySave/)
  })
})

describe('page.tsx — Retry UI remains mounted and observable through the whole retry attempt', () => {
  it('the retry area is mounted while saveError exists OR retryingSave is true', () => {
    expect(pageSource).toMatch(/\{\(saveError \|\| retryingSave\) && \(/)
  })

  it('role="alert" wraps only the failure text, conditionally on saveError, not the whole retry area', () => {
    expect(pageSource).toMatch(/\{saveError && <span role="alert">\{saveError\}<\/span>\}/)
    const retryBlock = pageSource.match(/\{\(saveError \|\| retryingSave\) && \([\s\S]*?\n\s{6}\)\}/)?.[0] ?? ''
    expect(retryBlock).not.toMatch(/<div role="alert"/)
  })

  it('the Retry button is a sibling of the alert span, not nested inside the saveError-only conditional — so it stays visible while only retryingSave is true', () => {
    const retryBlock = pageSource.match(/\{\(saveError \|\| retryingSave\) && \([\s\S]*?\n\s{6}\)\}/)?.[0] ?? ''
    expect(retryBlock).toMatch(/<button\s*\n\s*onClick=\{retrySave\}/)
  })

  it('Retry has an accessible name, native disabled tied only to retryingSave/saving (never to a cached-body check), and aria-busy tied to retryingSave', () => {
    expect(pageSource).toMatch(
      /onClick=\{retrySave\}\s*disabled=\{retryingSave \|\| saveState === 'saving'\}\s*aria-busy=\{retryingSave\}\s*aria-label="Retry save"/
    )
  })

  it('the Retry button label reflects the in-flight state', () => {
    expect(pageSource).toMatch(/\{retryingSave \? 'Retrying\.\.\.' : 'Retry save'\}/)
  })

  it('the Saving role="status" region is unaffected by the retry-area change and remains the pending announcement', () => {
    expect(pageSource).toMatch(
      /\{\(saveState === 'saving' \|\| saveState === 'saved'\) && \(\s*<div\s*\n\s*role="status"/
    )
  })

  it('neither the retry area nor the save-status region is ever rendered permanently empty', () => {
    expect(pageSource).toMatch(/\{\(saveError \|\| retryingSave\) && \(/)
    expect(pageSource).toMatch(/\{\(saveState === 'saving' \|\| saveState === 'saved'\) && \(/)
  })
})

describe('page.tsx — editing stays available; every edit re-enters the same serialized queue', () => {
  it('none of the slide updaters (updateContent/updateBullet/updateMetric) are gated on saveState — the editor is never disabled while saving or in error', () => {
    const updatersSource = pageSource.slice(
      pageSource.indexOf('function updateContent'),
      pageSource.indexOf('// ── Export')
    )
    expect(updatersSource).not.toMatch(/saveState/)
    expect(updatersSource).toMatch(/saveSlides\(nextRaw\)/g)
  })

  it('every updater calls saveSlides with the fresh raw snapshot — exactly five call sites', () => {
    const calls = pageSource.match(/saveSlides\(nextRaw\)/g) ?? []
    expect(calls.length).toBe(5) // updateContent, updateBullet, updateMetric, updatePriority, updateRecommendation
  })

  it('saveSlides/enqueueSaveBody never touch rawSlides/resolvedSlides state — a save failure cannot roll back or clear the visible edit', () => {
    expect(saveSlidesSource).not.toMatch(/setRawSlides/)
    expect(saveSlidesSource).not.toMatch(/setResolvedSlides/)
    expect(enqueueSaveBodySource).not.toMatch(/setRawSlides/)
    expect(enqueueSaveBodySource).not.toMatch(/setResolvedSlides/)
  })
})

describe('page.tsx — save timer lifecycle (source contract only; no fake timers are run)', () => {
  it('uses a dedicated saveTimer ref, reset to null (not merely cleared) after use', () => {
    expect(pageSource).toMatch(
      /const saveTimer\s*=\s*useRef<ReturnType<typeof setTimeout> \| null>\(null\)/
    )
  })

  it('clears any pending save-reset timer at the very start of enqueueSaveBody, before saving state is set', () => {
    expect(enqueueSaveBodySource).toMatch(
      /^async function enqueueSaveBody\(task: \(\) => Promise<ApiResult<unknown>>\): Promise<void> \{\s*if \(saveTimer\.current\) \{\s*clearTimeout\(saveTimer\.current\)\s*saveTimer\.current = null\s*\}/
    )
  })

  it('only a successful, still-latest save creates a new reset timer, and the timer itself re-checks isLatest before clearing state', () => {
    expect(enqueueSaveBodySource).toMatch(
      /setSaveState\('saved'\)\s*saveTimer\.current = setTimeout\(\(\) => \{\s*if \(saveQueueRef\.current\.isLatest\(version\)\) setSaveState\('idle'\)\s*saveTimer\.current = null\s*\}, 2000\)/
    )
  })

  it('cleans up the pending save-reset timer on unmount, in its own effect (independent of the send/copy timers\' cleanup)', () => {
    expect(pageSource).toMatch(
      /return \(\) => \{\s*if \(saveTimer\.current\) clearTimeout\(saveTimer\.current\)\s*\}/
    )
  })
})

// ── Real behavioral tests: save-state decision logic against the REAL queue ──
//
// enqueueSaveBody/saveSlides/retrySave's decision logic is mirrored here as a
// small harness so it can be driven with deferred promises. The queue itself
// is the real, imported SerializedLatestQueue — not reimplemented — so every
// ordering/version-ownership guarantee below is exercised for real, not
// merely asserted via regex. The mirror's shape (including the pre-enqueue
// JSON.stringify, the null-body local-failure task, and the retry-reads-
// current-rawSlides design) is pinned to the real source by the
// source-contract tests above, so the two cannot silently drift.
//
// setRawSlides()/rawSlides on the harness mirror the real component's
// useState<any[]>([]) pair: every real updater calls setRawSlides(nextRaw)
// immediately before saveSlides(nextRaw), and retrySave() reads whatever
// rawSlides currently holds — the harness reproduces that exact coupling.

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function ok(id: string): ApiResult<{ id: string }> {
  return { ok: true, status: 200, data: { id } }
}

function fail(status: number | null): ApiResult<{ id: string }> {
  return { ok: false, status, error: 'irrelevant to the UI-facing message' }
}

function circularSlides(): any {
  const slide: any = { content: 'x' }
  slide.self = slide // JSON.stringify throws on a circular reference
  return [slide]
}

type RequestFn = (body: string) => Promise<ApiResult<{ id: string }>>

function createSaveHarness() {
  const queue = new SerializedLatestQueue<ApiResult<{ id: string }>>()
  let saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle'
  let saveError: string | null = null
  let retrySaveInFlight = false
  let retryingSave = false
  let rawSlides: unknown = []

  async function enqueueSaveBody(task: () => Promise<ApiResult<{ id: string }>>) {
    saveError = null
    saveState = 'saving'

    const { version, settled } = queue.enqueue(task)

    let result: ApiResult<{ id: string }>
    try {
      result = await settled
    } catch {
      if (!queue.isLatest(version)) return
      saveState = 'error'
      saveError = SAVE_FAILURE_MESSAGE
      return
    }

    if (!queue.isLatest(version)) return

    if (result.ok) {
      saveState = 'saved'
    } else {
      saveState = 'error'
      saveError = SAVE_FAILURE_MESSAGE
    }
  }

  async function saveSlides(nextSlides: unknown, requestFn: RequestFn) {
    rawSlides = nextSlides
    let requestBody: string | null
    try {
      requestBody = JSON.stringify({ slides: nextSlides })
    } catch {
      requestBody = null
    }
    const body = requestBody

    await enqueueSaveBody(() => {
      if (body === null) {
        return Promise.resolve<ApiResult<{ id: string }>>({
          ok: false,
          status: null,
          error: SAVE_FAILURE_MESSAGE,
        })
      }
      return requestFn(body)
    })
  }

  async function retrySave(requestFn: RequestFn) {
    if (retrySaveInFlight) return
    retrySaveInFlight = true
    retryingSave = true
    try {
      await saveSlides(rawSlides, requestFn)
    } finally {
      retrySaveInFlight = false
      retryingSave = false
    }
  }

  return {
    saveSlides,
    retrySave,
    setRawSlides(next: unknown) { rawSlides = next },
    get saveState() { return saveState },
    get saveError() { return saveError },
    get retryingSave() { return retryingSave },
    get rawSlides() { return rawSlides },
  }
}

describe('save-state decision logic — real behavioral tests against the real SerializedLatestQueue', () => {
  it('PATCH 200 with valid JSON becomes Saved', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => ok('1'))
    expect(h.saveState).toBe('saved')
    expect(h.saveError).toBeNull()
  })

  it.each([400, 401, 403, 404])('PATCH %i results in Error, never Saved', async status => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(status))
    expect(h.saveState).toBe('error')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  it('PATCH 429 results in Error, never Saved', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(429))
    expect(h.saveState).toBe('error')
  })

  it('PATCH 500 results in Error, never Saved', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(500))
    expect(h.saveState).toBe('error')
  })

  it('a network rejection (surfaced by requestJson as status: null) results in Error, and is not stuck on Saving', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(null))
    expect(h.saveState).toBe('error')
    expect(h.saveState).not.toBe('saving')
  })

  it('a malformed/empty 2xx response (requestJson still reports ok: false) results in Error, never Saved', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(200))
    expect(h.saveState).toBe('error')
  })

  // ── Immutable body ──────────────────────────────────────────────────────

  it('mutating the original slides object after saveSlides() returns does not change the request body actually sent', async () => {
    const h = createSaveHarness()
    const slide: { content: string } = { content: 'original' }
    let capturedBodyAtSendTime: string | null = null

    const pending = h.saveSlides([slide], (body) => {
      capturedBodyAtSendTime = body
      return Promise.resolve(ok('1'))
    })

    // JSON.stringify already ran synchronously inside saveSlides() before
    // this line executes — mutating the same object now simulates a
    // hypothetical future updater that mutates in place instead of copying.
    slide.content = 'mutated-after-enqueue'

    await pending

    expect(capturedBodyAtSendTime).toBe(JSON.stringify({ slides: [{ content: 'original' }] }))
    expect(capturedBodyAtSendTime).not.toContain('mutated-after-enqueue')
  })

  // ── Serialization failure ──────────────────────────────────────────────

  it('a JSON.stringify failure (circular reference) never reaches the network task and becomes Error', async () => {
    const h = createSaveHarness()
    let taskCalls = 0
    await h.saveSlides(circularSlides(), async () => { taskCalls++; return ok('1') })

    expect(taskCalls).toBe(0)
    expect(h.saveState).toBe('error')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  it('a JSON.stringify failure never exposes the raw exception text', async () => {
    const h = createSaveHarness()
    await h.saveSlides(circularSlides(), async () => ok('1'))
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
    expect(h.saveError).not.toMatch(/circular/i)
    expect(h.saveError).not.toMatch(/JSON/i)
  })

  it('a JSON.stringify failure does not block a subsequent valid save from succeeding', async () => {
    const h = createSaveHarness()
    await h.saveSlides(circularSlides(), async () => ok('1'))
    expect(h.saveState).toBe('error')

    await h.saveSlides(['fine'], async () => ok('2'))
    expect(h.saveState).toBe('saved')
  })

  // ── Rejected task ───────────────────────────────────────────────────────

  it('a rejecting/throwing task becomes Error and is not left stuck on Saving', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['x'], async () => { throw new Error('boom') })
    expect(h.saveState).toBe('error')
    expect(h.saveState).not.toBe('saving')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  it('a rejecting task never exposes the raw exception text', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['x'], async () => { throw new Error('raw internal detail') })
    expect(h.saveError).not.toMatch(/raw internal detail/)
  })

  it('a rejected older task cannot overwrite a newer successful result', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], async () => ok('2'))

    aDeferred.reject(new Error('A rejected'))
    await pA
    await pB

    expect(h.saveState).toBe('saved')
    expect(h.saveError).toBeNull()
  })

  it('a rejected newer task overwrites an older successful result — final state is Error', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], async () => { throw new Error('B rejected') })

    aDeferred.resolve(ok('1'))
    await pA
    await pB

    expect(h.saveState).toBe('error')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  it('a save after a rejected task still succeeds normally', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['x'], async () => { throw new Error('boom') })
    expect(h.saveState).toBe('error')
    await h.saveSlides(['y'], async () => ok('1'))
    expect(h.saveState).toBe('saved')
  })

  // ── Retry: Case A — no prior successful body ─────────────────────────────

  it('Retry after the very first-ever save attempt fails to serialize genuinely retries — never a silent no-op', async () => {
    const h = createSaveHarness()
    await h.saveSlides(circularSlides(), async () => ok('should not be called'))
    expect(h.saveState).toBe('error')

    // The bad value is superseded (mirrors setRawSlides() being called by a
    // subsequent corrective edit, independently of saveSlides()).
    h.setRawSlides(['fixed'])

    let taskCalls = 0
    await h.retrySave(async () => { taskCalls++; return ok('1') })

    expect(taskCalls).toBe(1)
    expect(h.saveState).toBe('saved')
  })

  it('Retry while the content is still unserializable genuinely re-attempts through the real flow and returns to Error — never silently no-ops', async () => {
    const h = createSaveHarness()
    await h.saveSlides(circularSlides(), async () => ok('never'))
    expect(h.saveState).toBe('error')

    let taskCalls = 0
    await h.retrySave(async () => { taskCalls++; return ok('never') })

    expect(taskCalls).toBe(0) // still circular — never reaches the network
    expect(h.saveState).toBe('error')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  // ── Retry: Case B — a prior successful body exists ───────────────────────

  it('Retry after a newer serialization failure never resends an older edit\'s body, and sends the current edit once it is serializable', async () => {
    const h = createSaveHarness()
    const bodiesSent: string[] = []

    // Edit A: serializes and saves successfully.
    await h.saveSlides(['A'], async (body) => { bodiesSent.push(body); return ok('1') })
    expect(h.saveState).toBe('saved')

    // Edit B: fails to serialize — never reaches the network.
    await h.saveSlides(circularSlides(), async (body) => { bodiesSent.push(body); return ok('should not be called') })
    expect(h.saveState).toBe('error')

    // The bad value is superseded by a corrected, serializable edit
    // representing the same "B" intent (mirrors setRawSlides() being called
    // independently of saveSlides() by every real updater).
    h.setRawSlides(['B-fixed'])

    await h.retrySave(async (body) => { bodiesSent.push(body); return ok('2') })

    expect(h.saveState).toBe('saved')
    expect(bodiesSent).toEqual([
      JSON.stringify({ slides: ['A'] }),
      JSON.stringify({ slides: ['B-fixed'] }),
    ])
    // Explicit assertion: edit A's old body is never resent by Retry.
    expect(bodiesSent[bodiesSent.length - 1]).not.toBe(JSON.stringify({ slides: ['A'] }))
  })

  it('manual retry after a normal PATCH failure, on success, becomes Saved', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(500))
    expect(h.saveState).toBe('error')
    await h.retrySave(async () => ok('1'))
    expect(h.saveState).toBe('saved')
    expect(h.saveError).toBeNull()
  })

  it('manual retry after a normal PATCH failure, on failure again, remains Error', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['snapshot'], async () => fail(500))
    await h.retrySave(async () => fail(500))
    expect(h.saveState).toBe('error')
  })

  it('never retries automatically: a failed save never re-enqueues on its own', async () => {
    const h = createSaveHarness()
    let taskCalls = 0
    await h.saveSlides(['snapshot'], async () => { taskCalls++; return fail(500) })
    await Promise.resolve()
    await Promise.resolve()
    expect(taskCalls).toBe(1)
  })

  it('rapid duplicate Retry attempts enqueue only once (synchronous ref mutex)', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['x'], async () => fail(500))
    expect(h.saveState).toBe('error')

    let taskCalls = 0
    const deferred = createDeferred<ApiResult<{ id: string }>>()
    const requestFn: RequestFn = () => { taskCalls++; return deferred.promise }

    // Two "clicks" back to back, synchronously, before either settles.
    const r1 = h.retrySave(requestFn)
    const r2 = h.retrySave(requestFn)

    deferred.resolve(ok('1'))
    await r1
    await r2

    expect(taskCalls).toBe(1)
    expect(h.saveState).toBe('saved')
  })

  it('retryingSave is true only while the retry is in flight, and resets afterward even on failure', async () => {
    const h = createSaveHarness()
    await h.saveSlides(['x'], async () => fail(500))

    const deferred = createDeferred<ApiResult<{ id: string }>>()
    const pending = h.retrySave(() => deferred.promise)
    expect(h.retryingSave).toBe(true)

    deferred.resolve(fail(500))
    await pending
    expect(h.retryingSave).toBe(false)
    expect(h.saveState).toBe('error')
  })

  // ── Ordering / latest-version ────────────────────────────────────────────

  it('edit A followed quickly by edit B: server work executes A, then B, strictly in order', async () => {
    const h = createSaveHarness()
    const order: string[] = []
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => { order.push('A-start'); return aDeferred.promise })
    const pB = h.saveSlides(['B'], async () => { order.push('B-start'); return ok('2') })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['A-start'])

    aDeferred.resolve(ok('1'))
    await pA
    await pB
    expect(order).toEqual(['A-start', 'B-start'])
  })

  it('A fails, then queued B succeeds: final state is Saved for B', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], async () => ok('2'))

    aDeferred.resolve(fail(500))
    await pA
    await pB

    expect(h.saveState).toBe('saved')
    expect(h.saveError).toBeNull()
  })

  it('A succeeds, then queued B fails: final state is Error for B', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], async () => fail(500))

    aDeferred.resolve(ok('1'))
    await pA
    await pB

    expect(h.saveState).toBe('error')
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })

  it('an old success cannot overwrite a newer failure, even if the newer task\'s outcome is armed before the older one settles', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()
    const bDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], () => bDeferred.promise)

    bDeferred.resolve(fail(500))
    aDeferred.resolve(ok('1'))

    await pA
    await pB

    expect(h.saveState).toBe('error')
  })

  it('an old failure cannot overwrite a newer success, even if the newer task\'s outcome is armed before the older one settles', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()
    const bDeferred = createDeferred<ApiResult<{ id: string }>>()

    const pA = h.saveSlides(['A'], () => aDeferred.promise)
    const pB = h.saveSlides(['B'], () => bDeferred.promise)

    bDeferred.resolve(ok('2'))
    aDeferred.resolve(fail(500))

    await pA
    await pB

    expect(h.saveState).toBe('saved')
  })

  // ── The mandatory race: A (serializable, in flight) vs B (newer, fails to
  // serialize) — a serialization failure must claim a version and must be
  // able to invalidate an older still-in-flight success. ─────────────────

  it('A serializes and starts a deferred PATCH; B (the newest edit) fails to serialize before A resolves — A cannot set Saved, B ends in Error, no PATCH is ever issued for B, and B owns the newest version', async () => {
    const h = createSaveHarness()
    const aDeferred = createDeferred<ApiResult<{ id: string }>>()
    const aBodies: string[] = []
    const bCalls: string[] = []

    // A: serializes fine, enqueues, and suspends waiting on the network.
    const pA = h.saveSlides(['A'], (body) => { aBodies.push(body); return aDeferred.promise })

    // B: the newest visible edit, fails to serialize — but still claims a
    // queue version synchronously, in the same tick, before A resolves.
    const pB = h.saveSlides(circularSlides(), (body) => { bCalls.push(body); return Promise.resolve(ok('should not be called')) })

    // Only now does A's PATCH resolve successfully.
    aDeferred.resolve(ok('1'))
    await pA
    await pB

    expect(aBodies).toEqual([JSON.stringify({ slides: ['A'] })]) // A's request did go out...
    expect(bCalls).toEqual([]) // ...but B never issues a PATCH at all
    expect(h.saveState).toBe('error') // ...and A's stale success can never show as Saved
    expect(h.saveError).toBe(SAVE_FAILURE_MESSAGE)
  })
})
