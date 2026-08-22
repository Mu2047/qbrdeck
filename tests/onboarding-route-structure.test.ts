import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

// Physical file-tree assertions for the PR 8 route-group restructuring.
// Next.js route groups (parenthesized directory names) are stripped from
// the URL, so moving files into app/(app)/dashboard/(gated)/ must not
// change any public URL — this test proves the physical moves landed where
// expected, and that nothing was left behind at the old locations (which
// would otherwise silently create a duplicate/colliding route). The build
// step (next build) is the final authoritative Next.js route-collision
// check; this test only verifies the file tree itself.

const ROOT = process.cwd()

function exists(relativePath: string): boolean {
  return existsSync(join(ROOT, relativePath))
}

describe('route-group restructuring — gated product routes moved under (gated)/', () => {
  it('the dashboard index page lives under (gated)/', () => {
    expect(exists('app/(app)/dashboard/(gated)/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/page.tsx')).toBe(false)
  })

  it('the clients subtree lives under (gated)/, including nested QBR routes', () => {
    expect(exists('app/(app)/dashboard/(gated)/clients/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/(gated)/clients/new/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/(gated)/clients/[id]/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/(gated)/clients/[id]/qbr/new/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/(gated)/clients/[id]/qbr/[qbrId]/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/clients')).toBe(false)
  })

  it('the analytics page lives under (gated)/', () => {
    expect(exists('app/(app)/dashboard/(gated)/analytics/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/analytics')).toBe(false)
  })

  it('the settings page lives under (gated)/', () => {
    expect(exists('app/(app)/dashboard/(gated)/settings/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/settings')).toBe(false)
  })

  it('the gated layout itself exists at the expected path', () => {
    expect(exists('app/(app)/dashboard/(gated)/layout.tsx')).toBe(true)
  })
})

describe('route-group restructuring — Billing stays completely outside (gated)/', () => {
  it('billing page and its button remain at their original physical location', () => {
    expect(exists('app/(app)/dashboard/billing/page.tsx')).toBe(true)
    expect(exists('app/(app)/dashboard/billing/billing-button.tsx')).toBe(true)
  })

  it('no billing file exists under (gated)/', () => {
    expect(exists('app/(app)/dashboard/(gated)/billing')).toBe(false)
  })
})

describe('route-group restructuring — root app layout and middleware untouched', () => {
  it('app/(app)/layout.tsx still exists at its original location', () => {
    expect(exists('app/(app)/layout.tsx')).toBe(true)
  })

  it('middleware.ts still exists at the repo root', () => {
    expect(exists('middleware.ts')).toBe(true)
  })
})
