import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { can } from '@/lib/permissions'
import { selectActiveMembership } from '@/lib/workspace'

// Billing UI must show Owner-only billing controls to the Owner only.
//
// Production certification: an ADMIN in Test Growth saw "Manage Subscription"
// on /dashboard/billing (and Upgrade buttons on every other plan card), while
// /api/billing/portal and /api/billing/checkout both refuse non-Owners via
// can.manageBilling. The page rendered <BillingButton> with no role check.
//
// Same honesty labels as the other suites here:
//  - EXECUTABLE: real can.manageBilling and selectActiveMembership, run per
//    role and per active workspace.
//  - SOURCE-CONTRACT: which JSX each gate guards, proven by reading the page
//    as text (this repo has no component rendering harness).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const billingSource  = readSourceLF('app/(app)/dashboard/billing/page.tsx')
const settingsSource = readSourceLF('app/(app)/dashboard/(gated)/settings/page.tsx')
const checkoutSource = readSourceLF('app/api/billing/checkout/route.ts')
const portalSource   = readSourceLF('app/api/billing/portal/route.ts')

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to   = source.indexOf(end, from + start.length)
  expect(from, `marker not found: ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `marker not found: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

const planCards  = between(billingSource, '{/* ── Plan cards', '{/* ── Manage subscription')
const manageCard = between(billingSource, '{/* ── Manage subscription', '<p className="text-gray-400 text-xs mt-4">')
const usageCard  = between(billingSource, '{/* ── Usage card', '{/* ── Plan cards')
const whiteLabel = between(settingsSource, '{/* White-label */}', '{/* Billing */}')
const settingsBillingCard = between(settingsSource, '{/* Billing */}', '{/* ── Team Tab')

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — the gate the page uses, per role and per active workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('can.manageBilling — the gate the Billing page now uses (EXECUTABLE)', () => {
  it('OWNER may manage billing; ADMIN, MEMBER and VIEWER may not', () => {
    expect(can.manageBilling('OWNER')).toBe(true)
    expect(can.manageBilling('ADMIN')).toBe(false)
    expect(can.manageBilling('MEMBER')).toBe(false)
    expect(can.manageBilling('VIEWER')).toBe(false)
  })

  it('same user, Owner in A and Admin in B: billing controls follow the ACTIVE workspace only', () => {
    const memberships = [
      { workspaceId: 'ws_a', role: 'OWNER' as const },
      { workspaceId: 'ws_b', role: 'ADMIN' as const },
    ]
    const activeA = selectActiveMembership(memberships, 'ws_a')!
    const activeB = selectActiveMembership(memberships, 'ws_b')!
    expect(can.manageBilling(activeA.role)).toBe(true)
    expect(can.manageBilling(activeB.role)).toBe(false)
  })

  it('reverse order (Admin in the earliest-joined workspace) — still no bleed either way', () => {
    const memberships = [
      { workspaceId: 'ws_b', role: 'ADMIN' as const },
      { workspaceId: 'ws_a', role: 'OWNER' as const },
    ]
    expect(can.manageBilling(selectActiveMembership(memberships, 'ws_b')!.role)).toBe(false)
    expect(can.manageBilling(selectActiveMembership(memberships, 'ws_a')!.role)).toBe(true)
    // No cookie -> earliest membership (ADMIN) -> no billing controls.
    expect(can.manageBilling(selectActiveMembership(memberships, null)!.role)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — Billing page
// ─────────────────────────────────────────────────────────────────────────────

describe('Billing page gate (SOURCE-CONTRACT)', () => {
  it('derives canManageBilling from can.manageBilling on the active-workspace role', () => {
    expect(billingSource).toContain("import { can } from '@/lib/permissions'")
    expect(billingSource).toContain('const ctx = await getWorkspaceContext()')
    expect(billingSource).toContain('const canManageBilling = can.manageBilling(ctx.member.role)')
  })

  it('does not hard-code its own role comparison', () => {
    expect(billingSource).not.toMatch(/role\s*===\s*'OWNER'/)
  })
})

describe('Manage Subscription (SOURCE-CONTRACT)', () => {
  it('is rendered only when canManageBilling — Owner yes; Admin, Member, Viewer no', () => {
    expect(manageCard).toMatch(/^\{\/\* ── Manage subscription[^\n]*\*\/\}\n\s*\{canManageBilling && sub\?\.stripeSubscriptionId && \(/)
    expect(manageCard).toContain('<BillingButton planKey="MANAGE"')
  })

  it('is the only place the page renders the MANAGE button', () => {
    expect(billingSource.match(/planKey="MANAGE"/g)).toHaveLength(1)
  })
})

describe('plan-card upgrade controls (SOURCE-CONTRACT)', () => {
  it('the Upgrade/checkout BillingButton is rendered only when canManageBilling', () => {
    expect(planCards).toMatch(/\{canManageBilling \? \(\s*<BillingButton planKey=\{planKey\} isCurrent=\{isCurrent\} checkoutAvailable=\{checkoutAvailable\} \/>/)
    // The only BillingButton in the plan cards is the gated one.
    expect(planCards.match(/<BillingButton\b/g)).toHaveLength(1)
  })

  it('non-Owners get a disabled "Current plan" marker on their current plan and no button elsewhere', () => {
    const nonOwner = planCards.slice(planCards.indexOf(') : isCurrent ? ('))
    expect(nonOwner).toMatch(/<button disabled[^>]*>\s*Current plan\s*<\/button>/)
    expect(nonOwner).toMatch(/\) : null\}/)
    expect(nonOwner).not.toMatch(/onClick|BillingButton|priceId|checkoutAvailable/)
  })

  it('non-Owners are told why there are no billing actions', () => {
    expect(billingSource).toMatch(/\{!canManageBilling && \(\s*<p[^>]*>\s*Only the workspace Owner can change the plan or manage the subscription\./)
  })
})

describe('plan and usage stay visible to every role (SOURCE-CONTRACT)', () => {
  it('the usage card and plan cards are not role-gated', () => {
    expect(usageCard).not.toMatch(/canManageBilling/)
    expect(usageCard).toContain('label="Clients"')
    expect(usageCard).toContain('label="QBRs generated this month"')
    // Prices and features render for every plan card regardless of role.
    expect(planCards).toContain('{formatRegionalPrice(planKey, region)}')
    expect(planCards).toContain('buildFeatureList(planKey)')
    expect(billingSource).toContain('Current plan: <span className="font-medium text-navy-800">{PLAN_NAMES[currentPlan]}</span>')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — Settings billing controls
// ─────────────────────────────────────────────────────────────────────────────

describe('Settings billing controls (SOURCE-CONTRACT)', () => {
  it('the white-label "Upgrade to Growth" link is Owner-only; others are told to ask the Owner', () => {
    expect(whiteLabel).toMatch(/\{isOwner \? \(\s*<a href="\/dashboard\/billing"[^>]*>Upgrade to Growth<\/a>/)
    const otherwise = whiteLabel.slice(whiteLabel.indexOf(') : (', whiteLabel.indexOf('{isOwner ? (')))
    expect(otherwise).toContain('Ask your workspace Owner to upgrade to Growth.')
    expect(otherwise).not.toMatch(/<a\b|billing/)
  })

  it('the General-tab billing card with Manage Subscription is still Owner-only', () => {
    expect(settingsBillingCard).toMatch(/\{!subLoading && subscription && isOwner && \(/)
    expect(settingsBillingCard).toContain('<ManageSubscriptionButton />')
  })

  it('every billing link in Settings sits behind isOwner', () => {
    // Two links: white-label card and Team-tab plan gate, each Owner-only.
    expect(settingsSource.match(/href="\/dashboard\/billing"/g)).toHaveLength(2)
    expect(settingsSource.match(/\{isOwner \? \(\s*(?:<>\s*<p[^>]*>[^<]*<\/p>\s*)?<a href="\/dashboard\/billing"/g)).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — backend authority unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('billing routes remain Owner-only on the active workspace (SOURCE-CONTRACT)', () => {
  for (const [name, source] of [['checkout', checkoutSource], ['portal', portalSource]] as const) {
    it(`${name}: resolves the active membership and refuses non-Owners with 403 before any Stripe call`, () => {
      expect(source).toContain('const membership = await getWorkspaceMembership(clerkId)')
      const gate   = source.indexOf('if (!can.manageBilling(membership.role))')
      const stripe = source.indexOf('stripe.')
      expect(gate).toBeGreaterThan(-1)
      expect(source.slice(gate, gate + 200)).toContain('status: 403')
      expect(stripe).toBeGreaterThan(gate)
    })
  }
})
