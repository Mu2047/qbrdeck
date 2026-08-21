import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Parity tests for the mechanical extraction of app/api/export-pdf/route.ts
// and app/api/export-pptx/route.ts's inline business logic into the shared
// lib/qbr-export.ts helper (needed so app/api/onboarding/export/route.ts can
// reuse the exact same quota/ExportEvent/Subscription semantics without
// duplicating PDF/PPTX generation code — see P2 onboarding PR 7 preflight,
// Correction 2). Source-contract style, same precedent as
// tests/onboarding-client-schema-parity.test.ts: confirms behavior is
// unchanged, not merely that the files compile.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const pdfRoute = readSourceLF('app/api/export-pdf/route.ts')
const pptxRoute = readSourceLF('app/api/export-pptx/route.ts')
const helperSource = readSourceLF('lib/qbr-export.ts')

describe('generic export routes remain thin wrappers with identical auth/response behavior', () => {
  it.each([
    ['export-pdf', pdfRoute, 'pdf'],
    ['export-pptx', pptxRoute, 'pptx'],
  ] as const)('%s still authenticates, checks can.exportQBR, and reads qbrId from the browser body', (_name, source, format) => {
    expect(source).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(source).toMatch(/if \(!can\.exportQBR\(membership\.role\)\)/)
    expect(source).toMatch(/const \{ qbrId \} = await req\.json\(\)/)
    expect(source).toMatch(new RegExp(`performQbrExport\\(membership, qbrId, '${format}'\\)`))
  })

  it.each([
    ['export-pdf', pdfRoute],
    ['export-pptx', pptxRoute],
  ] as const)('%s maps the shared helper\'s typed errors back to the exact original response shapes', (_name, source) => {
    expect(source).toMatch(/if \(err instanceof ExportQbrNotFoundError\) \{\s*return NextResponse\.json\(\{ error: 'QBR not found' \}, \{ status: 404 \}\)/)
    expect(source).toMatch(/if \(err instanceof ExportNoSlidesError\) \{\s*return NextResponse\.json\(\{ error: 'QBR has no generated slides' \}, \{ status: 400 \}\)/)
    expect(source).toMatch(/if \(err instanceof ExportLimitError\) \{\s*return NextResponse\.json\(\s*\{ error: 'LIMIT_REACHED', limit: 'exports', plan: err\.plan, max: err\.max \},\s*\{ status: 403 \}\s*\)/)
  })

  it.each([
    ['export-pdf', pdfRoute],
    ['export-pptx', pptxRoute],
  ] as const)('%s no longer contains the inline quota/ExportEvent/Subscription logic — it lives only in the shared helper now', (_name, source) => {
    expect(source).not.toMatch(/exportEvent\.create/)
    expect(source).not.toMatch(/shouldResetPeriod/)
    expect(source).not.toMatch(/exportedQbrIds/)
    expect(source).not.toMatch(/generatePDF\(/)
    expect(source).not.toMatch(/generatePPTX\(/)
  })
})

describe('lib/qbr-export.ts helper preserves the exact original business semantics', () => {
  it('quota is checked only when not already exported, using the real getLimits/isUnderLimit', () => {
    expect(helperSource).toMatch(/const exportedIds: string\[\] = JSON\.parse\(sub\?\.exportedQbrIds \?\? '\[\]'\)/)
    expect(helperSource).toMatch(/const alreadyExported = exportedIds\.includes\(qbrId\) \|\| qbr\.status === 'EXPORTED'/)
    expect(helperSource).toMatch(/if \(!alreadyExported\) \{\s*const exportCount = sub\?\.exportCount \?\? 0\s*if \(!isUnderLimit\(exportCount, limits\.exportPackagesPerMonth\)\) \{\s*throw new ExportLimitError\(plan, limits\.exportPackagesPerMonth\)/)
  })

  it('a redownload (already exported) never consumes a second credit — isRedownload/consumedExportCredit are exact negations of alreadyExported', () => {
    expect(helperSource).toMatch(/const isRedownload\s*=\s*alreadyExported/)
    expect(helperSource).toMatch(/const consumedCredit\s*=\s*!alreadyExported/)
  })

  it('exportCount is only incremented, and exportedQbrIds only appended, inside the !alreadyExported branch', () => {
    const notAlreadyExportedBlockMatch = helperSource.match(/if \(!alreadyExported\) \{\s*const current: string\[\] = JSON\.parse[\s\S]*?\n  \}/)
    expect(notAlreadyExportedBlockMatch).not.toBeNull()
    expect(notAlreadyExportedBlockMatch?.[0] ?? '').toMatch(/exportCount:\s*\{ increment: 1 \}/)
  })

  it('period rollover resets qbrCount, exportCount, exportedQbrIds, and periodStart together — never a partial reset', () => {
    expect(helperSource).toMatch(/data:\s*\{ qbrCount:\s*0,\s*exportCount:\s*0,\s*exportedQbrIds:\s*'\[\]',\s*periodStart:\s*new Date\(\) \}/)
  })

  it('an ExportEvent is created for every export call, redownload or not, recording isRedownload/consumedExportCredit accurately', () => {
    expect(helperSource).toMatch(/await prisma\.exportEvent\.create\(\{/)
    expect(helperSource).toMatch(/isRedownload,/)
    expect(helperSource).toMatch(/consumedExportCredit:\s*consumedCredit,/)
  })

  it('qbr.status is set to EXPORTED and exportedById recorded on every export call', () => {
    expect(helperSource).toMatch(/data:\s*\{ status: 'EXPORTED', exportedById: membership\.userId \}/)
  })
})
