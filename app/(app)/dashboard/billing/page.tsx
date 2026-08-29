import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { PLANS } from '@/lib/stripe'
import { PLAN_LIMITS, formatLimit } from '@/lib/limits'
import { prisma } from '@/lib/prisma'
import { getWorkspaceContext } from '@/lib/workspace'
import { Check, Zap } from 'lucide-react'
import { BillingButton } from './billing-button'

export default async function BillingPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  const currentPlan = (ctx.subscription?.plan ?? 'FREE') as keyof typeof PLANS
  const sub         = ctx.subscription
  const limits      = PLAN_LIMITS[currentPlan]

  // ── Live usage counters ───────────────────────────────────────────────────
  const workspaceId  = ctx.workspaceId
  const clientCount  = await prisma.client.count({ where: { workspaceId } })
  const memberCount  = await prisma.workspaceMember.count({ where: { workspaceId } })
  const qbrUsed      = sub?.qbrCount    ?? 0
  const exportUsed   = sub?.exportCount ?? 0

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-800">Billing & Plan</h1>
        <p className="text-gray-500 text-sm mt-1">
          Current plan: <span className="font-medium text-navy-800">{PLANS[currentPlan].name}</span>
        </p>
      </div>

      {/* ── Usage card — shown for all plans ─────────────────────────────────── */}
      <div className={`card p-5 mb-8 ${currentPlan === 'FREE' ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Zap size={15} className={currentPlan === 'FREE' ? 'text-amber-500' : 'text-navy-500'} />
          <p className={`text-sm font-medium ${currentPlan === 'FREE' ? 'text-amber-800' : 'text-navy-800'}`}>
            {currentPlan === 'FREE' ? 'Free plan usage this month' : `${PLANS[currentPlan].name} plan usage`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">

          {/* Clients */}
          <UsageRow
            label="Clients"
            used={clientCount}
            limit={limits.clients}
            isFree={currentPlan === 'FREE'}
          />

          {/* QBRs */}
          <UsageRow
            label="QBRs generated this month"
            used={qbrUsed}
            limit={limits.qbrsPerMonth}
            isFree={currentPlan === 'FREE'}
          />

          {/* Export packages */}
          <UsageRow
            label="Export packages this month"
            used={exportUsed}
            limit={limits.exportPackagesPerMonth}
            isFree={currentPlan === 'FREE'}
          />

          {/* Team seats */}
          <UsageRow
            label="Team members"
            used={memberCount}
            limit={limits.teamSeats}
            isFree={currentPlan === 'FREE'}
          />
        </div>
      </div>

      {/* ── Plan cards ────────────────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-4 gap-4">

        {/* Free */}
        <div className={`card p-6 flex flex-col ${currentPlan === 'FREE' ? 'ring-2 ring-navy-800' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-navy-800 text-lg">Free</h2>
            {currentPlan === 'FREE' && <span className="badge-gray">Current</span>}
          </div>
          <div className="mb-5">
            <span className="text-3xl font-bold text-navy-800">$0</span>
            <span className="text-gray-400 text-sm">/month</span>
          </div>
          <ul className="space-y-2 mb-6 flex-1">
            {buildFeatureList('FREE').map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                <Check size={14} className="text-green-500 flex-shrink-0" />{f}
              </li>
            ))}
          </ul>
          <button disabled className="btn-secondary text-sm py-2 w-full opacity-50 cursor-not-allowed">
            {currentPlan === 'FREE' ? 'Current plan' : 'Free'}
          </button>
        </div>

        {(['SOLO', 'GROWTH', 'AGENCY'] as const).map(planKey => {
          const plan      = PLANS[planKey]
          const isCurrent = currentPlan === planKey
          return (
            <div key={planKey} className={`card p-6 flex flex-col relative ${isCurrent ? 'ring-2 ring-navy-800' : planKey === 'GROWTH' ? 'ring-2 ring-gold-500' : ''}`}>
              {planKey === 'GROWTH' && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-gold-500 text-white text-xs font-bold px-3 py-1 rounded-full">Most Popular</span>
                </div>
              )}
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-navy-800 text-lg">{plan.name}</h2>
                {isCurrent && <span className="badge-gray">Current</span>}
              </div>
              <div className="mb-5">
                <span className="text-3xl font-bold text-navy-800">${plan.price}</span>
                <span className="text-gray-400 text-sm">/month</span>
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {buildFeatureList(planKey).map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={14} className="text-green-500 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <BillingButton planKey={planKey} isCurrent={isCurrent} priceId={plan.priceId ?? null} />
            </div>
          )
        })}
      </div>

      {/* ── Manage subscription ───────────────────────────────────────────────── */}
      {sub?.stripeSubscriptionId && (
        <div className="mt-8 p-4 card flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-navy-800">Manage subscription</p>
            <p className="text-xs text-gray-400 mt-0.5">Cancel, update payment method, or view invoices</p>
          </div>
          <BillingButton planKey="MANAGE" isCurrent={false} priceId={null} />
        </div>
      )}
    </div>
  )
}

// ── Usage row component ───────────────────────────────────────────────────────

function UsageRow({ label, used, limit, isFree }: {
  label:  string
  used:   number
  limit:  number | null
  isFree: boolean
}) {
  const isUnlimited = limit === null
  const pct         = isUnlimited ? 0 : Math.min((used / limit!) * 100, 100)
  const isNearLimit = !isUnlimited && pct >= 80

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className={isFree ? 'text-gray-600' : 'text-gray-500'}>{label}</span>
        <span className={isFree ? 'text-gray-700 font-medium' : 'text-gray-500'}>
          {used} / {isUnlimited ? 'Unlimited' : limit}
        </span>
      </div>
      {!isUnlimited ? (
        <div className={`h-1.5 rounded-full ${isFree ? 'bg-amber-200' : 'bg-gray-200'}`}>
          <div
            className={`h-1.5 rounded-full transition-all ${isNearLimit ? 'bg-red-500' : isFree ? 'bg-amber-500' : 'bg-navy-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 rounded-full bg-green-100">
          <div className="h-1.5 w-full rounded-full bg-green-400 opacity-40" />
        </div>
      )}
    </div>
  )
}

// ── Feature list builder — reads from PLAN_LIMITS ─────────────────────────────
// Builds the feature bullet list from structured limits, not hardcoded strings.
// This ensures billing page always matches actual enforcement.

function buildFeatureList(plan: keyof typeof PLAN_LIMITS): string[] {
  const l = PLAN_LIMITS[plan]
  const features: string[] = []

  // Clients
  features.push(l.clients === null ? 'Unlimited clients' : `${l.clients} client${l.clients !== 1 ? 's' : ''}`)

  // QBRs
  features.push(l.qbrsPerMonth === null ? 'Unlimited QBRs' : `${l.qbrsPerMonth} QBRs per month`)

  // Exports
  if (l.exportPackagesPerMonth === null) {
    features.push('Unlimited exports')
  } else {
    features.push(`${l.exportPackagesPerMonth} export${l.exportPackagesPerMonth !== 1 ? 's' : ''} per month`)
  }

  // Export format
  if (plan !== 'FREE') features.push('PDF + PowerPoint export')
  if (plan === 'FREE')  features.push('Browser preview')

  // White-label
  if (l.whiteLabel) {
    features.push('White-label branding')
  } else {
    features.push('QBR Deck platform branding')
  }

  // Analytics
  if (l.analytics === 'full') features.push('Advanced analytics')

  // Team seats
  if (l.teamSeats === null) {
    features.push('Unlimited team members')
  } else if (l.teamSeats === 1) {
    features.push('Single user')
  } else {
    features.push(`Up to ${l.teamSeats} team members`)
  }

  // Priority support
  if (plan === 'GROWTH' || plan === 'AGENCY') features.push('Priority support')

  return features
}
