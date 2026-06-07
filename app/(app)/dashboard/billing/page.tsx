import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { PLANS } from '@/lib/stripe'
import { Check, Zap } from 'lucide-react'
import { BillingButton } from './billing-button'
import { getWorkspaceContext } from '@/lib/workspace'

export default async function BillingPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  const currentPlan = (ctx.subscription?.plan ?? 'FREE') as keyof typeof PLANS
  const sub = ctx.subscription
  const qbrUsed    = sub?.qbrCount    ?? 0
  const exportUsed = sub?.exportCount ?? 0

  const FREE_QBR_LIMIT    = 3
  const FREE_EXPORT_LIMIT = 3

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-800">Billing & Plan</h1>
        <p className="text-gray-500 text-sm mt-1">
          Current plan: <span className="font-medium text-navy-800">{PLANS[currentPlan].name}</span>
        </p>
      </div>

      {currentPlan === 'FREE' && (
        <div className="card p-5 mb-8 bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-amber-500" />
            <p className="text-sm font-medium text-amber-800">Free plan usage this month</p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>QBRs generated</span>
                <span>{qbrUsed} / {FREE_QBR_LIMIT}</span>
              </div>
              <div className="h-1.5 bg-amber-200 rounded-full">
                <div className="h-1.5 bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min((qbrUsed / FREE_QBR_LIMIT) * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Exports used</span>
                <span>{exportUsed} / {FREE_EXPORT_LIMIT}</span>
              </div>
              <div className="h-1.5 bg-amber-200 rounded-full">
                <div className="h-1.5 bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min((exportUsed / FREE_EXPORT_LIMIT) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4">
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
            {PLANS.FREE.features.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                <Check size={14} className="text-green-500 flex-shrink-0" />{f}
              </li>
            ))}
          </ul>
          <button disabled className="btn-secondary text-sm py-2 w-full opacity-50 cursor-not-allowed">
            {currentPlan === 'FREE' ? 'Current plan' : 'Free'}
          </button>
        </div>

        {(['SOLO', 'GROWTH', 'AGENCY'] as const).map((planKey) => {
          const plan = PLANS[planKey]
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
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={14} className="text-green-500 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <BillingButton planKey={planKey} isCurrent={isCurrent} priceId={plan.priceId} />
            </div>
          )
        })}
      </div>

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