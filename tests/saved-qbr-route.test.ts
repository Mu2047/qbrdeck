import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/qbrs/[qbrId]/route.ts as plain
// text and regex-match against it. They do NOT invoke the GET/PATCH route
// handlers, do NOT connect to a database, do NOT send malformed HTTP
// requests, and do NOT mutate Production — this repo has no DB
// integration-test framework (see tests/onboarding-advance-route.test.ts
// and tests/generate-qbr-route.test.ts for the same precedent). These
// tests prove the intended source contract, not executed runtime HTTP
// behavior.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/qbrs/[qbrId]/route.ts')

// Isolate GET and PATCH handler bodies so an assertion about one handler
// cannot be accidentally satisfied by source that only exists in the other.
const getMatch = routeSource.match(/export async function GET\([\s\S]*?\n\}\n\nexport async function PATCH/)
const getBody = getMatch?.[0] ?? ''
const patchMatch = routeSource.match(/export async function PATCH\([\s\S]*$/)
const patchBody = patchMatch?.[0] ?? ''

describe('saved-QBR route — handler extraction', () => {
  it('locates both the GET and PATCH handler bodies', () => {
    expect(getMatch).not.toBeNull()
    expect(patchMatch).not.toBeNull()
  })
})

describe('saved-QBR route — GET: security and lookup semantics unchanged', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(getBody).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(getBody).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves membership and checks can.viewQBR', () => {
    expect(getBody).toMatch(/getWorkspaceMembership\(clerkId\)/)
    expect(getBody).toMatch(/if \(!can\.viewQBR\(membership\.role\)\)/)
  })

  it('the QBR lookup remains scoped by id, workspaceId, and deletedAt: null', () => {
    expect(getBody).toMatch(/const qbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{ id: params\.qbrId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('a missing/cross-workspace/deleted QBR still returns 404 Not found', () => {
    expect(getBody).toMatch(/if \(!qbr\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/)
  })
})

describe('saved-QBR route — GET: error hygiene', () => {
  const catchMatch = getBody.match(/\} catch \(err: any\) \{[\s\S]*?\n  \}\n\}/)
  const catchBody = catchMatch?.[0] ?? ''

  it('locates the GET catch block', () => {
    expect(catchMatch).not.toBeNull()
  })

  it('logs server-side via console.error(\'[saved-qbr-get]\', params.qbrId, err)', () => {
    expect(catchBody).toMatch(/console\.error\('\[saved-qbr-get\]', params\.qbrId, err\)/)
  })

  it('returns exactly { error: \'Failed to load QBR\' } at 500, never raw err.message', () => {
    expect(catchBody).toMatch(/return NextResponse\.json\(\{ error: 'Failed to load QBR' \}, \{ status: 500 \}\)/)
    expect(catchBody).not.toMatch(/err\.message/)
  })
})

describe('saved-QBR route — PATCH: security and lookup semantics unchanged', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(patchBody).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(patchBody).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves membership and checks can.generateQBR', () => {
    expect(patchBody).toMatch(/getWorkspaceMembership\(clerkId\)/)
    expect(patchBody).toMatch(/if \(!can\.generateQBR\(membership\.role\)\)/)
  })

  it('the QBR lookup remains scoped by id, workspaceId, and deletedAt: null', () => {
    expect(patchBody).toMatch(/const qbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{ id: params\.qbrId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('a missing/cross-workspace/deleted QBR still returns 404 Not found, before body parsing', () => {
    const notFoundIdx = patchBody.indexOf("if (!qbr) return NextResponse.json({ error: 'Not found' }, { status: 404 })")
    const bodyParseIdx = patchBody.indexOf('await req.json()')
    expect(notFoundIdx).toBeGreaterThan(-1)
    expect(bodyParseIdx).toBeGreaterThan(-1)
    expect(notFoundIdx).toBeLessThan(bodyParseIdx)
  })
})

describe('saved-QBR route — PATCH: malformed JSON never reaches the generic 500', () => {
  it('req.json() is wrapped in try/catch, returning 400 Invalid request body on parse failure', () => {
    expect(patchBody).toMatch(/let body: unknown\s*try \{\s*body = await req\.json\(\)\s*\} catch \{\s*return NextResponse\.json\(\{ error: 'Invalid request body' \}, \{ status: 400 \}\)\s*\}/)
  })
})

describe('saved-QBR route — PATCH: minimal structural slides validation', () => {
  it('declares a local patchSchema requiring slides to be an array of object records', () => {
    expect(routeSource).toMatch(/const patchSchema = z\.object\(\{\s*slides: z\.array\(z\.record\(z\.string\(\), z\.unknown\(\)\)\),\s*\}\)/)
  })

  it('the schema is not .strict() and does not require a non-empty array — historical slide shapes stay accepted', () => {
    const schemaMatch = routeSource.match(/const patchSchema = z\.object\(\{[\s\S]*?\}\)/)
    const schemaBody = schemaMatch?.[0] ?? ''
    expect(schemaBody).not.toMatch(/\.strict\(\)/)
    expect(schemaBody).not.toMatch(/\.min\(/)
  })

  it('never mirrors the full QBRSlide field shape (title/type/content/metrics/priorities/recommendations)', () => {
    const schemaMatch = routeSource.match(/const patchSchema = z\.object\(\{[\s\S]*?\}\)/)
    const schemaBody = schemaMatch?.[0] ?? ''
    for (const field of ['title:', 'type:', 'content:', 'metrics:', 'priorities:', 'recommendations:']) {
      expect(schemaBody).not.toContain(field)
    }
  })

  it('PATCH uses patchSchema.safeParse(body), and a failed parse returns 400 Invalid request body', () => {
    expect(patchBody).toMatch(/const parsed = patchSchema\.safeParse\(body\)/)
    expect(patchBody).toMatch(/if \(!parsed\.success\) \{\s*return NextResponse\.json\(\{ error: 'Invalid request body' \}, \{ status: 400 \}\)\s*\}/)
  })

  it('valid parsed slides are destructured from parsed.data and passed into prisma.qBR.update', () => {
    expect(patchBody).toMatch(/const \{ slides \} = parsed\.data/)
    expect(patchBody).toMatch(/const updated = await prisma\.qBR\.update\(\{\s*where:\s*\{ id: params\.qbrId \},\s*data:\s*\{ slides: slides as any \},/)
  })
})

describe('saved-QBR route — PATCH: error hygiene for unexpected failures', () => {
  const catchMatch = patchBody.match(/\} catch \(err: any\) \{[\s\S]*?\n  \}\n\}/)
  const catchBody = catchMatch?.[0] ?? ''

  it('locates the PATCH catch block', () => {
    expect(catchMatch).not.toBeNull()
  })

  it('logs server-side via console.error(\'[saved-qbr-patch]\', params.qbrId, err)', () => {
    expect(catchBody).toMatch(/console\.error\('\[saved-qbr-patch\]', params\.qbrId, err\)/)
  })

  it('returns exactly { error: \'Failed to save QBR\' } at 500, never raw err.message', () => {
    expect(catchBody).toMatch(/return NextResponse\.json\(\{ error: 'Failed to save QBR' \}, \{ status: 500 \}\)/)
    expect(catchBody).not.toMatch(/err\.message/)
  })
})
