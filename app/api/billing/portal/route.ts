import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { currencyForStripePrice, portalConfigurationForCurrency } from '@/lib/billing/portal-config'

const NO_SUBSCRIPTION     = 'No active subscription'
const PORTAL_UNAVAILABLE  = 'Billing portal is not available right now — contact support'

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.manageBilling(membership.role))
      return NextResponse.json({ error: 'Only the workspace owner can manage billing' }, { status: 403 })

    // The request body and query are never read: customer, currency and
    // portal configuration all come from the active workspace's stored row.
    const sub = await prisma.subscription.findUnique({
      where:  { workspaceId: membership.workspaceId },
      select: { stripeCustomerId: true, stripePriceId: true },
    })

    // `free_<workspaceId>` is a local placeholder, not a Stripe Customer, and a
    // row that never recorded a Price never subscribed. A canceled workspace
    // keeps its last Price (see handleSubscriptionDeleted) and still gets in.
    const customerId = sub?.stripeCustomerId
    if (!customerId || customerId.startsWith('free_') || !sub.stripePriceId)
      return NextResponse.json({ error: NO_SUBSCRIPTION }, { status: 404 })

    let configuration: string
    try {
      configuration = portalConfigurationForCurrency(currencyForStripePrice(sub.stripePriceId))
    } catch (err: any) {
      console.error(`[portal] Refusing portal session for workspace ${membership.workspaceId}: ${err?.message}`)
      return NextResponse.json({ error: PORTAL_UNAVAILABLE }, { status: 503 })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Portal error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
