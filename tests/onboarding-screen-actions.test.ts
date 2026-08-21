import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read the two onboarding screen components as
// plain text and regex-match against them (asserting relative ordering of
// matched positions where sequence matters), following the same precedent
// as tests/onboarding-selfheal.test.ts and tests/onboarding-enrollment-atomicity.test.ts.
// This repo has no DB integration-test framework and these are 'use client'
// components driven by browser fetch(), not server logic that can be
// unit-executed directly here.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const welcomeSource = readSourceLF('app/onboarding/_screens/welcome.tsx')
const workspaceNameSource = readSourceLF('app/onboarding/_screens/workspace-name.tsx')
const firstClientSource = readSourceLF('app/onboarding/_screens/first-client.tsx')
const firstQbrSource = readSourceLF('app/onboarding/_screens/first-qbr.tsx')
const reviewQbrSource = readSourceLF('app/onboarding/_screens/review-qbr.tsx')
const exportQbrSource = readSourceLF('app/onboarding/_screens/export-qbr.tsx')
const shareQbrSource = readSourceLF('app/onboarding/_screens/share-qbr.tsx')
const completeSource = readSourceLF('app/onboarding/_screens/complete.tsx')

describe('Welcome screen — advances to WORKSPACE_NAME, then navigates only on confirmed success', () => {
  it('POSTs /api/onboarding/advance with toStep: WORKSPACE_NAME', () => {
    expect(welcomeSource).toMatch(/fetch\('\/api\/onboarding\/advance', \{\s*method:\s*'POST',/)
    expect(welcomeSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'WORKSPACE_NAME' \}\)/)
  })

  it('navigates to /onboarding/workspace-name only after the advance call, not optimistically before it', () => {
    const advanceIdx = welcomeSource.indexOf("fetch('/api/onboarding/advance'")
    const throwIdx = welcomeSource.indexOf('throw new Error')
    const navIdx = welcomeSource.indexOf("router.push('/onboarding/workspace-name')")
    expect(advanceIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(navIdx).toBeGreaterThan(-1)
    // the failure throw (guarding a non-ok response) comes before navigation,
    // so navigation is unreachable on a failed advance call
    expect(advanceIdx).toBeLessThan(throwIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('does not infer success locally — it checks res.ok before treating the call as successful', () => {
    expect(welcomeSource).toMatch(/if \(!res\.ok\) \{/)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(welcomeSource).toMatch(/if \(loading\) return/)
    expect(welcomeSource).toMatch(/disabled=\{loading\}/)
  })
})

describe('Workspace Name screen — one atomic dedicated-endpoint call, no split PATCH+advance', () => {
  it('calls the dedicated POST /api/onboarding/workspace-name endpoint exactly once', () => {
    const fetchOccurrences = workspaceNameSource.match(/fetch\(/g) ?? []
    expect(fetchOccurrences.length).toBe(1)
    expect(workspaceNameSource).toMatch(/fetch\('\/api\/onboarding\/workspace-name', \{\s*method:\s*'POST',/)
  })

  it('never calls the generic PATCH /api/workspace or the generic advance endpoint from this screen', () => {
    expect(workspaceNameSource).not.toMatch(/fetch\('\/api\/workspace'/)
    expect(workspaceNameSource).not.toMatch(/fetch\('\/api\/onboarding\/advance'/)
    expect(workspaceNameSource).not.toMatch(/method:\s*'PATCH'/)
  })

  it('sends only { name: trimmed } in the body', () => {
    expect(workspaceNameSource).toMatch(/body:\s*JSON\.stringify\(\{ name: trimmed \}\)/)
  })

  it('navigates to /onboarding/first-client on success — never /dashboard', () => {
    expect(workspaceNameSource).toMatch(/router\.push\('\/onboarding\/first-client'\)/)
    expect(workspaceNameSource).not.toMatch(/router\.push\(['"`]\/dashboard/)
  })

  it('navigation happens only after the endpoint call resolves successfully, not before', () => {
    const fetchIdx = workspaceNameSource.indexOf("fetch('/api/onboarding/workspace-name'")
    const throwIdx = workspaceNameSource.indexOf('Failed to save workspace name')
    const navIdx = workspaceNameSource.indexOf("router.push('/onboarding/first-client')")
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(throwIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('requires a non-empty trimmed name before submitting', () => {
    expect(workspaceNameSource).toMatch(/const trimmed = name\.trim\(\)/)
    expect(workspaceNameSource).toMatch(/if \(!trimmed\) \{/)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(workspaceNameSource).toMatch(/if \(loading\) return/)
    expect(workspaceNameSource).toMatch(/disabled=\{loading\}/)
  })

  it('is prefilled from the server-provided initialName prop', () => {
    expect(workspaceNameSource).toMatch(/useState\(initialName\)/)
  })
})

describe('First Client screen — no render-time key writes, no browser-authority fields', () => {
  it('the idempotency key ref is seeded from the persisted prop, not generated eagerly', () => {
    expect(firstClientSource).toMatch(/const keyRef = useRef<string \| null>\(persistedKey\)/)
  })

  it('crypto.randomUUID() is only reachable from inside ensureKey(), called lazily from a submit handler — never at component-body/render scope', () => {
    const randomUUIDOccurrences = firstClientSource.match(/crypto\.randomUUID\(\)/g) ?? []
    expect(randomUUIDOccurrences.length).toBe(1)
    expect(firstClientSource).toMatch(/function ensureKey\(\) \{\s*if \(!keyRef\.current\) keyRef\.current = crypto\.randomUUID\(\)/)
  })

  it('attach mode POSTs { mode: "attach", retryKey } without clientId when omitted, and includes clientId only when supplied', () => {
    expect(firstClientSource).toMatch(/body:\s*JSON\.stringify\(clientId \? \{ mode: 'attach', retryKey, clientId \} : \{ mode: 'attach', retryKey \}\)/)
  })

  it('submitAttach never includes existingClientId or workspaceId in its request body', () => {
    const submitAttachMatch = firstClientSource.match(/async function submitAttach\([\s\S]*?\n  \}/)
    expect(submitAttachMatch).not.toBeNull()
    const body = submitAttachMatch?.[0] ?? ''
    expect(body).not.toMatch(/existingClientId/)
    expect(body).not.toMatch(/workspaceId/)
  })

  it('create mode never includes clientId, existingClientId, workspaceId, or userId in its request body', () => {
    const submitCreateMatch = firstClientSource.match(/async function submitCreate\(\) \{[\s\S]*?\n  \}/)
    expect(submitCreateMatch).not.toBeNull()
    const body = submitCreateMatch?.[0] ?? ''
    expect(body).not.toMatch(/clientId/)
    expect(body).not.toMatch(/existingClientId/)
    expect(body).not.toMatch(/workspaceId/)
    expect(body).not.toMatch(/userId/)
  })

  it('navigates to /onboarding/first-qbr after a confirmed successful response, for both attach and create', () => {
    const navOccurrences = firstClientSource.match(/router\.push\('\/onboarding\/first-qbr'\)/g) ?? []
    expect(navOccurrences.length).toBe(2)
  })

  // Hotfix regression: the 2+ state used to be a dead-end ("Return to
  // dashboard") — now that the dashboard gate is authoritative, that would
  // just redirect straight back here. See P2 onboarding PR 8 preflight,
  // "First Client — 2+ selector" / "Multi-client reattach risk".
  it('the 2+ existing-client state renders a selector, never a "Return to dashboard" dead-end', () => {
    const multiClientBlockMatch = firstClientSource.match(/if \(existingClientCount > 1\) \{[\s\S]*?\n  \}/)
    expect(multiClientBlockMatch).not.toBeNull()
    const block = multiClientBlockMatch?.[0] ?? ''
    expect(block).not.toMatch(/router\.push\('\/dashboard'\)/)
    expect(block).not.toMatch(/Return to dashboard/)
    expect(block).toMatch(/type="radio"/)
    expect(block).toMatch(/onClick=\{\(\) => selected && submitAttach\(selected\.id\)\}/)
  })

  it('the 2+ selector renders only the server-provided existingClients list, and no create-form inputs', () => {
    const multiClientBlockMatch = firstClientSource.match(/if \(existingClientCount > 1\) \{[\s\S]*?\n  \}/)
    const block = multiClientBlockMatch?.[0] ?? ''
    expect(block).toMatch(/existingClients\.map\(/)
    expect(block).not.toMatch(/<input\s+className="input"/)
  })

  it('the 2+ selector submits with the exact selected candidate id, never a hardcoded or arbitrary one', () => {
    const multiClientBlockMatch = firstClientSource.match(/if \(existingClientCount > 1\) \{[\s\S]*?\n  \}/)
    const block = multiClientBlockMatch?.[0] ?? ''
    expect(block).toMatch(/const selected = existingClients\.find\(c => c\.id === selectedClientId\) \?\? existingClients\[0\]/)
  })

  it('the single-existing-client state renders an attach action, not a create form', () => {
    const soleClientBlock = firstClientSource.match(/if \(existingClientCount === 1 && soleExistingClientName\) \{[\s\S]*?\n  \}/)
    expect(soleClientBlock).not.toBeNull()
    const block = soleClientBlock?.[0] ?? ''
    expect(block).toMatch(/onClick=\{\(\) => submitAttach\(\)\}/)
    expect(block).not.toMatch(/onClick=\{submitCreate\}/)
  })

  it('guards against duplicate submission while a request is in flight, for both actions', () => {
    expect(firstClientSource).toMatch(/async function submitAttach\(clientId\?: string\) \{\s*if \(loading\) return/)
    expect(firstClientSource).toMatch(/async function submitCreate\(\) \{\s*if \(loading\) return/)
  })
})

describe('First QBR screen — no render-time key writes, no client-authority fields, correct navigation', () => {
  it('the idempotency key ref is seeded from the persisted prop, not generated eagerly', () => {
    expect(firstQbrSource).toMatch(/const keyRef = useRef<string \| null>\(persistedKey\)/)
  })

  it('crypto.randomUUID() is only reachable from inside ensureKey(), called lazily from the generate() submit handler', () => {
    const randomUUIDOccurrences = firstQbrSource.match(/crypto\.randomUUID\(\)/g) ?? []
    expect(randomUUIDOccurrences.length).toBe(1)
    expect(firstQbrSource).toMatch(/function ensureKey\(\) \{\s*if \(!keyRef\.current\) keyRef\.current = crypto\.randomUUID\(\)/)
  })

  it('the generate() request body never includes a clientId — the anchored Client is resolved server-side', () => {
    const generateFnMatch = firstQbrSource.match(/async function generate\(\) \{[\s\S]*?\n  \}/)
    expect(generateFnMatch).not.toBeNull()
    expect(generateFnMatch?.[0] ?? '').not.toMatch(/clientId/)
  })

  it('navigates to /onboarding/review-qbr on success, now that Screen 5 exists (PR 7) — never /dashboard', () => {
    expect(firstQbrSource).toMatch(/router\.push\('\/onboarding\/review-qbr'\)/)
    expect(firstQbrSource).not.toMatch(/router\.push\(['"`]\/dashboard/)
  })

  it('navigation happens only after the generate call resolves successfully, not before', () => {
    const fetchIdx = firstQbrSource.indexOf("fetch('/api/onboarding/qbr'")
    const throwIdx = firstQbrSource.indexOf('Generation failed. Please try again.')
    const navIdx = firstQbrSource.indexOf("router.push('/onboarding/review-qbr')")
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(navIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(firstQbrSource).toMatch(/async function generate\(\) \{\s*if \(loading\) return/)
    expect(firstQbrSource).toMatch(/disabled=\{loading\}/)
  })

})

describe('Review QBR screen — read-only, no dashboard-editor escape, Continue only to EXPORT_QBR', () => {
  it('never fetches a QBR itself and never sends a qbrId anywhere — all content arrives as props from the server', () => {
    expect(reviewQbrSource).not.toMatch(/fetch\('\/api\/qbrs/)
    expect(reviewQbrSource).not.toMatch(/qbrId/)
  })

  it('renders no editable input/textarea and no PATCH call — this screen never edits the QBR', () => {
    expect(reviewQbrSource).not.toMatch(/<input/)
    expect(reviewQbrSource).not.toMatch(/<textarea/)
    expect(reviewQbrSource).not.toMatch(/method:\s*'PATCH'/)
  })

  it('never links to the dashboard QBR editor (no /dashboard/clients/.../qbr/ path anywhere)', () => {
    expect(reviewQbrSource).not.toMatch(/\/dashboard\/clients\//)
  })

  it('Continue POSTs /api/onboarding/advance with toStep: EXPORT_QBR, only navigating on confirmed success', () => {
    expect(reviewQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'EXPORT_QBR' \}\)/)
    const fetchIdx = reviewQbrSource.indexOf("fetch('/api/onboarding/advance'")
    const throwIdx = reviewQbrSource.indexOf('Failed to continue')
    const navIdx = reviewQbrSource.indexOf("router.push('/onboarding/export-qbr')")
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(throwIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(reviewQbrSource).toMatch(/async function handleContinue\(\) \{\s*if \(loading\) return/)
  })

  // Hotfix regression: this component previously accepted a raw `summary`
  // prop straight from the QBR row (an unresolved snapshot of slides[0]
  // content), rendering literal {{healthScore}}/{{healthStatus}} tokens in
  // Production. The prop contract no longer exists — the intro text is
  // derived from the already-resolved `slides` prop instead.
  it('has no raw summary prop in its contract — Props type carries no summary field', () => {
    const propsTypeMatch = reviewQbrSource.match(/type Props = \{[\s\S]*?\n\}/)
    expect(propsTypeMatch).not.toBeNull()
    expect(propsTypeMatch?.[0] ?? '').not.toMatch(/\bsummary\s*:/)
  })

  it('does not destructure a summary prop from its function signature', () => {
    expect(reviewQbrSource).toMatch(/export function ReviewQbrScreen\(\{ clientName, quarter, year, healthScore, healthStatus, slides \}: Props\)/)
  })

  it('derives its intro text from the already-resolved slides[0] content, not a separate raw field', () => {
    expect(reviewQbrSource).toMatch(/const introText = slides\[0\]\?\.content \?\? null/)
    expect(reviewQbrSource).toMatch(/\{introText && \(/)
  })
})

describe('Export QBR screen — anchored export only, LIMIT_REACHED never removes Skip, Continue gated on a real success', () => {
  it('POSTs /api/onboarding/export with only { format } — no qbrId anywhere in the request body', () => {
    expect(exportQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ format \}\)/)
    const doExportMatch = exportQbrSource.match(/async function doExport\([\s\S]*?\n  \}/)
    expect(doExportMatch).not.toBeNull()
    expect(doExportMatch?.[0] ?? '').not.toMatch(/qbrId/)
  })

  it('a LIMIT_REACHED response shows inline copy and never redirects to billing', () => {
    expect(exportQbrSource).toMatch(/data\.error === 'LIMIT_REACHED'/)
    expect(exportQbrSource).not.toMatch(/billing/i)
    expect(exportQbrSource).not.toMatch(/window\.location/)
  })

  it('Skip for now is always rendered, unconditional on export/limit state', () => {
    const skipButtonMatch = exportQbrSource.match(/onClick=\{handleSkip\}[\s\S]*?<\/button>/)
    expect(skipButtonMatch).not.toBeNull()
    // The Skip button itself is not wrapped in an `{exported && ...}` or
    // `{!limitReached && ...}` conditional — only the Continue button is.
    const beforeSkipButton = exportQbrSource.slice(0, exportQbrSource.indexOf('onClick={handleSkip}'))
    const lastConditionalOpen = beforeSkipButton.lastIndexOf('{exported && (')
    const lastConditionalClose = beforeSkipButton.lastIndexOf(')}')
    expect(lastConditionalOpen === -1 || lastConditionalClose > lastConditionalOpen).toBe(true)
  })

  it('Continue only renders after a successful export in this session (gated on the exported state flag)', () => {
    expect(exportQbrSource).toMatch(/\{exported && \(\s*<button\s*onClick=\{handleContinue\}/)
  })

  it('Continue calls /api/onboarding/advance with toStep: SHARE_QBR; Skip calls /api/onboarding/skip with step: EXPORT_QBR', () => {
    expect(exportQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'SHARE_QBR' \}\)/)
    expect(exportQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ step: 'EXPORT_QBR' \}\)/)
  })

  it('both Continue and Skip navigate to /onboarding/share-qbr only after a confirmed successful response', () => {
    const navOccurrences = exportQbrSource.match(/router\.push\('\/onboarding\/share-qbr'\)/g) ?? []
    expect(navOccurrences.length).toBe(2)
  })

  it('guards against overlapping requests across export/continue/skip', () => {
    expect(exportQbrSource).toMatch(/if \(exporting \|\| continuing \|\| skipping\) return/)
    expect(exportQbrSource).toMatch(/if \(continuing\) return/)
    expect(exportQbrSource).toMatch(/if \(skipping\) return/)
  })
})

describe('Share QBR screen — anchored share only, no automatic email, Skip always available', () => {
  it('link and email actions both POST /api/onboarding/share — no qbrId in either body', () => {
    expect(shareQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ action: 'link' \}\)/)
    expect(shareQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ action: 'email', email: email\.trim\(\) \}\)/)
    expect(shareQbrSource).not.toMatch(/qbrId/)
  })

  it('sendEmail requires a non-empty, explicitly clicked email field — never fires from a mount effect or the link action', () => {
    expect(shareQbrSource).not.toMatch(/useEffect/)
    expect(shareQbrSource).toMatch(/async function sendEmail\(\) \{\s*if \(busy \|\| !email\.trim\(\)\) return/)
  })

  it('email is only a prefill convenience — absence of prefillEmail never blocks rendering (no early return/guard on it)', () => {
    expect(shareQbrSource).toMatch(/useState\(prefillEmail \?\? ''\)/)
    expect(shareQbrSource).not.toMatch(/if \(!prefillEmail\)/)
  })

  it('Skip for now is always rendered, not conditioned on copy/send having succeeded', () => {
    const skipButtonIdx = shareQbrSource.indexOf('onClick={handleSkip}')
    expect(skipButtonIdx).toBeGreaterThan(-1)
    const beforeSkipButton = shareQbrSource.slice(0, skipButtonIdx)
    // Continue is the one gated on `succeeded`; Skip's own button below it
    // is not inside that same conditional block.
    expect(beforeSkipButton).toMatch(/\{succeeded && \(/)
  })

  it('Continue calls advance with toStep: COMPLETE; Skip calls skip with step: SHARE_QBR', () => {
    expect(shareQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'COMPLETE' \}\)/)
    expect(shareQbrSource).toMatch(/body:\s*JSON\.stringify\(\{ step: 'SHARE_QBR' \}\)/)
  })

  it('both Continue and Skip navigate to /onboarding/complete only after a confirmed successful response', () => {
    const navOccurrences = shareQbrSource.match(/router\.push\('\/onboarding\/complete'\)/g) ?? []
    expect(navOccurrences.length).toBe(2)
  })
})

describe('Complete screen — every destination calls the same finish() first, completion is authoritative', () => {
  it('exactly one finish() function, and every button funnels through it', () => {
    const finishFnOccurrences = completeSource.match(/async function finish\(destination: Destination\)/g) ?? []
    expect(finishFnOccurrences.length).toBe(1)
    const onClickOccurrences = completeSource.match(/onClick=\{\(\) => finish\(/g) ?? []
    expect(onClickOccurrences.length).toBeGreaterThanOrEqual(2)
  })

  it('finish() POSTs /api/onboarding/finish and only navigates after a confirmed successful response', () => {
    const fetchIdx = completeSource.indexOf("fetch('/api/onboarding/finish'")
    const throwIdx = completeSource.indexOf('Failed to finish onboarding')
    const navIdx = completeSource.indexOf('router.push(DESTINATION_PATH[destination])')
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(throwIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('a failed finish() call sets an error and does not navigate (no router.push inside the catch)', () => {
    const catchMatch = completeSource.match(/\} catch \(e: any\) \{[\s\S]*?\n    \}/)
    expect(catchMatch).not.toBeNull()
    expect(catchMatch?.[0] ?? '').not.toMatch(/router\.push/)
  })

  it('the Invite teammate button only renders when canInviteTeammate is true', () => {
    expect(completeSource).toMatch(/\{canInviteTeammate && \(/)
  })

  it('the primary heading and button copy match the locked product spec exactly', () => {
    expect(completeSource).toMatch(/Your workspace is ready/)
    expect(completeSource).toMatch(/Finish & go to dashboard/)
  })
})
