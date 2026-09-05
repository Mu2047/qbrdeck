import type Stripe from 'stripe'

// Stripe moved current_period_start/current_period_end off the top-level
// Subscription and onto each SubscriptionItem in newer API versions — this
// account's webhook events now serialize at a version where the top-level
// fields are absent (root cause of evt_1U3NsVQZ9Ibszi22IXBD1glE processing
// as FAILED with an Invalid Date). Fetches made through lib/stripe.ts's
// pinned apiVersion can still return the older top-level shape, so both are
// read here; the bundled Stripe types don't declare the item-level fields
// yet, hence the loose cast.
type SubscriptionItemWithPeriod = Stripe.SubscriptionItem & {
  current_period_start?: number
  current_period_end?: number
}

export function getSubscriptionPeriod(
  sub: Stripe.Subscription,
  priceId?: string
): { start: Date; end: Date } {
  const item = (priceId
    ? sub.items.data.find(i => i.price.id === priceId)
    : sub.items.data[0]) as SubscriptionItemWithPeriod | undefined

  const start = item?.current_period_start ?? sub.current_period_start
  const end   = item?.current_period_end   ?? sub.current_period_end

  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error(
      `Unable to determine billing period for subscription ${sub.id}: no current_period_start/current_period_end on the matching subscription item or the subscription itself`
    )
  }

  return { start: new Date(start * 1000), end: new Date(end * 1000) }
}
