import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getSubscriptionPeriod } from '@/lib/stripe-subscription-period'
import type Stripe from 'stripe'

// Behavioral unit tests for getSubscriptionPeriod (the fix for the
// evt_1U3NsVQZ9Ibszi22IXBD1glE production incident), plus source-contract
// checks on the handlers, matching this repo's existing precedent for
// testing this route (no DB integration-test framework — see
// tests/generate-qbr-route.test.ts and tests/onboarding-advance-route.test.ts).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/webhooks/stripe/route.ts')

// Minimal fixture builder — only the fields getSubscriptionPeriod reads.
function makeSubscription(opts: {
  topLevelStart?: number
  topLevelEnd?: number
  itemStart?: number
  itemEnd?: number
  priceId?: string
}): Stripe.Subscription {
  const item: any = {
    id: 'si_test',
    price: { id: opts.priceId ?? 'price_1TbWU9QZ9Ibszi2293hEWBm1' },
  }
  if (typeof opts.itemStart === 'number') item.current_period_start = opts.itemStart
  if (typeof opts.itemEnd === 'number') item.current_period_end = opts.itemEnd

  return {
    id: 'sub_test',
    items: { data: [item] },
    current_period_start: opts.topLevelStart,
    current_period_end: opts.topLevelEnd,
  } as unknown as Stripe.Subscription
}

describe('getSubscriptionPeriod — production incident evt_1U3NsVQZ9Ibszi22IXBD1glE shape', () => {
  it('reads the period from the subscription item when only item-level fields exist (the actual production payload shape)', () => {
    const sub = makeSubscription({ itemStart: 1786486232, itemEnd: 1789164632 })
    const period = getSubscriptionPeriod(sub, 'price_1TbWU9QZ9Ibszi2293hEWBm1')

    expect(period.start.toISOString()).toBe(new Date(1786486232 * 1000).toISOString())
    expect(period.end.toISOString()).toBe(new Date(1789164632 * 1000).toISOString())
    expect(Number.isNaN(period.start.getTime())).toBe(false)
    expect(Number.isNaN(period.end.getTime())).toBe(false)
  })

  it('falls back to top-level fields when the subscription item has no period (older/pinned apiVersion fetches)', () => {
    const sub = makeSubscription({ topLevelStart: 1783807832, topLevelEnd: 1786486232 })
    const period = getSubscriptionPeriod(sub)

    expect(period.start.toISOString()).toBe(new Date(1783807832 * 1000).toISOString())
    expect(period.end.toISOString()).toBe(new Date(1786486232 * 1000).toISOString())
  })

  it('prefers the item matching the given priceId over an unrelated first item', () => {
    const sub: any = makeSubscription({ itemStart: 1, itemEnd: 2 })
    sub.items.data.unshift({
      id: 'si_unrelated',
      price: { id: 'price_unrelated' },
      current_period_start: 999,
      current_period_end: 1000,
    })

    const period = getSubscriptionPeriod(sub, 'price_1TbWU9QZ9Ibszi2293hEWBm1')
    expect(period.start.getTime()).toBe(1 * 1000)
    expect(period.end.getTime()).toBe(2 * 1000)
  })

  it('throws an explicit, diagnosable error instead of ever producing an Invalid Date when no period data exists anywhere', () => {
    const sub = makeSubscription({})
    expect(() => getSubscriptionPeriod(sub)).toThrow(/Unable to determine billing period for subscription sub_test/)
  })

  it('never returns a Date whose getTime() is NaN', () => {
    const sub = makeSubscription({})
    try {
      getSubscriptionPeriod(sub)
      expect.unreachable('should have thrown')
    } catch (err: any) {
      expect(err.message).not.toMatch(/Invalid Date/)
    }
  })
})

describe('webhook route — all three period-reading handlers use the shared helper', () => {
  it('handleCheckoutCompleted derives its period from getSubscriptionPeriod, not sub.current_period_start/end directly', () => {
    const fn = routeSource.match(/async function handleCheckoutCompleted[\s\S]*?\n}\n/)?.[0] ?? ''
    expect(fn).toMatch(/const period\s*=\s*getSubscriptionPeriod\(sub, priceId\)/)
    expect(fn).toMatch(/stripeCurrentPeriodStart:\s*period\.start/)
    expect(fn).toMatch(/stripeCurrentPeriodEnd:\s*period\.end/)
    expect(fn).toMatch(/currentPeriodEnd:\s*period\.end/)
    expect(fn).toMatch(/periodStart:\s*period\.start/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_start/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_end/)
  })

  it('handleSubscriptionUpdated derives its period from getSubscriptionPeriod and still sets plan/status/ids alongside it', () => {
    const fn = routeSource.match(/async function handleSubscriptionUpdated[\s\S]*?\n}\n/)?.[0] ?? ''
    expect(fn).toMatch(/const period\s*=\s*getSubscriptionPeriod\(sub, priceId\)/)
    expect(fn).toMatch(/plan,/)
    expect(fn).toMatch(/stripeStatus:\s*sub\.status/)
    expect(fn).toMatch(/stripePriceId:\s*priceId/)
    expect(fn).toMatch(/stripeSubscriptionId:\s*sub\.id/)
    expect(fn).toMatch(/stripeCustomerId:\s*customerId/)
    expect(fn).toMatch(/stripeCurrentPeriodStart:\s*period\.start/)
    expect(fn).toMatch(/stripeCurrentPeriodEnd:\s*period\.end/)
    expect(fn).toMatch(/currentPeriodEnd:\s*period\.end/)
    expect(fn).toMatch(/cancelAtPeriodEnd:\s*sub\.cancel_at_period_end/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_start/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_end/)
  })

  it('handleInvoicePaid derives its period from getSubscriptionPeriod', () => {
    const fn = routeSource.match(/async function handleInvoicePaid[\s\S]*?\n}\n/)?.[0] ?? ''
    expect(fn).toMatch(/const period\s*=\s*getSubscriptionPeriod\(sub, sub\.items\.data\[0\]\?\.price\.id\)/)
    expect(fn).toMatch(/stripeCurrentPeriodEnd:\s*period\.end/)
    expect(fn).toMatch(/currentPeriodEnd:\s*period\.end/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_start/)
    expect(fn).not.toMatch(/new Date\(sub\.current_period_end/)
  })

  it('handleSubscriptionDeleted and handleInvoicePaymentFailed are untouched — they never read period fields', () => {
    const deletedFn = routeSource.match(/async function handleSubscriptionDeleted[\s\S]*?\n}\n/)?.[0] ?? ''
    const failedFn  = routeSource.match(/async function handleInvoicePaymentFailed[\s\S]*?\n}\n/)?.[0] ?? ''
    expect(deletedFn).not.toMatch(/current_period|getSubscriptionPeriod/)
    expect(failedFn).not.toMatch(/current_period|getSubscriptionPeriod/)
  })

  it('no remaining direct reads of sub.current_period_start/end anywhere in the route', () => {
    expect(routeSource).not.toMatch(/new Date\(sub\.current_period_start \* 1000\)/)
    expect(routeSource).not.toMatch(/new Date\(sub\.current_period_end\s*\*\s*1000\)/)
  })
})

describe('webhook route — FAILED StripeEvent idempotency (unchanged by this fix)', () => {
  it('only short-circuits on PROCESSED or PROCESSING; a FAILED event falls through and is retried', () => {
    expect(routeSource).toMatch(/if \(existingEvent\.status === 'PROCESSED'\) return NextResponse\.json\(\{ received: true, idempotent: true \}\)/)
    expect(routeSource).toMatch(/if \(existingEvent\.status === 'PROCESSING'\) return NextResponse\.json\(\{ received: true, processing: true \}\)/)
    expect(routeSource).not.toMatch(/existingEvent\.status === 'FAILED'/)
  })

  it('the upsert after those guards always moves the event back to PROCESSING and increments retryCount on any re-delivery', () => {
    expect(routeSource).toMatch(/update:\s*\{\s*status:\s*'PROCESSING',\s*retryCount:\s*\{\s*increment:\s*existingEvent \? 1 : 0\s*\},/)
  })
})
