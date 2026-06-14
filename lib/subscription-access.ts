// lib/subscription-access.ts
// ─────────────────────────────────────────────────────────────────────────────
// Centralized subscription access logic.
//
// RULES:
//   - All plan access decisions go through these functions.
//   - Backend routes, middleware, and UI all import from here.
//   - Never duplicate access logic inline in routes or components.
//   - Grace period is determined by graceEndsAt — not derived from other fields.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from '@prisma/client'

// ── Grace period constant ─────────────────────────────────────────────────────
// Single definition used by webhook, UI warning, email, and enforcement.
// Change here only — never repeat the number 7 elsewhere.
export const PAYMENT_GRACE_PERIOD_DAYS = 7

// ── Subscription shape ────────────────────────────────────────────────────────
// Minimal interface — only the fields needed for access decisions.
// Compatible with the Prisma Subscription model.

export interface SubscriptionAccess {
  plan:             Plan
  status:           string        // legacy field
  stripeStatus:     string | null // authoritative Stripe status
  pastDueAt:        Date | null
  graceEndsAt:      Date | null
  cancelAtPeriodEnd: boolean
}

// ── Core access functions ─────────────────────────────────────────────────────

/**
 * Returns true if the subscription is currently in a payment grace period.
 * Grace period: payment failed, but graceEndsAt is in the future.
 */
export function isInPaymentGracePeriod(sub: SubscriptionAccess): boolean {
  if (!sub.pastDueAt || !sub.graceEndsAt) return false
  return new Date() < sub.graceEndsAt
}

/**
 * Returns true if the grace period has expired (past_due and no longer covered).
 */
export function isGracePeriodExpired(sub: SubscriptionAccess): boolean {
  if (!sub.pastDueAt || !sub.graceEndsAt) return false
  return new Date() >= sub.graceEndsAt
}

/**
 * Returns true if the workspace has active paid plan access.
 * Covers active, trialing, and past_due within grace period.
 */
export function hasPaidAccess(sub: SubscriptionAccess): boolean {
  const stripeStatus = sub.stripeStatus ?? sub.status

  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return true

    case 'past_due':
      // Paid access continues during grace period only
      return isInPaymentGracePeriod(sub)

    case 'unpaid':
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return false

    default:
      // Unknown status — fail safe, no paid access
      return false
  }
}

/**
 * Returns the effective plan for limit enforcement and feature gating.
 * Returns FREE if paid access has lapsed.
 */
export function getEffectivePlan(sub: SubscriptionAccess): Plan {
  if (hasPaidAccess(sub)) return sub.plan
  return 'FREE'
}

/**
 * Returns true if a payment warning banner should be shown to the user.
 * Shown during grace period and immediately after grace expires.
 */
export function shouldShowPaymentWarning(sub: SubscriptionAccess): boolean {
  const stripeStatus = sub.stripeStatus ?? sub.status
  return stripeStatus === 'past_due' || stripeStatus === 'unpaid'
}

/**
 * Returns a human-readable payment warning message.
 * Returns null if no warning needed.
 */
export function getPaymentWarningMessage(sub: SubscriptionAccess): string | null {
  const stripeStatus = sub.stripeStatus ?? sub.status

  if (stripeStatus === 'past_due') {
    if (isInPaymentGracePeriod(sub) && sub.graceEndsAt) {
      const daysLeft = Math.ceil(
        (sub.graceEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
      return `Your payment failed. Please update your payment method within ${daysLeft} day${daysLeft !== 1 ? 's' : ''} to keep your plan.`
    }
    return 'Your payment failed and your grace period has expired. Please update your payment method to restore access.'
  }

  if (stripeStatus === 'unpaid') {
    return 'Your account has an unpaid balance. Please update your payment method to restore access.'
  }

  return null
}

/**
 * Returns true if the subscription will cancel at the end of the current period.
 */
export function isCancellingAtPeriodEnd(sub: SubscriptionAccess): boolean {
  return sub.cancelAtPeriodEnd === true
}

/**
 * Maps a Stripe subscription status string to a product access level.
 * Used for logging and display — not for access decisions (use hasPaidAccess).
 */
export function describeAccess(sub: SubscriptionAccess): string {
  const stripeStatus = sub.stripeStatus ?? sub.status
  switch (stripeStatus) {
    case 'active':    return 'Full plan access'
    case 'trialing':  return 'Trial — full plan access'
    case 'past_due':
      return isInPaymentGracePeriod(sub)
        ? `Past due — grace period active until ${sub.graceEndsAt?.toISOString()}`
        : 'Past due — grace period expired, downgraded to Free'
    case 'unpaid':             return 'Unpaid — Free behavior'
    case 'canceled':           return 'Canceled — Free behavior'
    case 'incomplete':         return 'Incomplete — no paid access'
    case 'incomplete_expired': return 'Incomplete expired — no paid access'
    case 'paused':             return 'Paused — define behavior before use'
    default:                   return `Unknown status: ${stripeStatus}`
  }
}
