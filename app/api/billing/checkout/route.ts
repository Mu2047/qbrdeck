import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripe, createOrRetrieveCustomer } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import {
  parseCheckoutRequest,
  hasLivePaidSubscription,
  EXISTING_SUBSCRIPTION_MESSAGE,
} from '@/lib/billing/checkout-request'

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.manageBilling(membership.role))
      return NextResponse.json({ error: 'Only the workspace owner can manage billing' }, { status: 403 })

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)

    // Server-controlled price only: the body names a plan/region/currency (or,
    // for the transition release, an exact configured USD priceId) and the
    // Stripe Price is resolved from server config — see lib/billing/checkout-request.ts.
    const parsed = parseCheckoutRequest(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const { price } = parsed

    // A live subscription must never get a second, parallel one through
    // Checkout. Checked before any Stripe call.
    const existing = await prisma.subscription.findUnique({
      where:  { workspaceId: membership.workspaceId },
      select: { plan: true, status: true, stripeStatus: true, stripeSubscriptionId: true },
    })
    if (hasLivePaidSubscription(existing))
      return NextResponse.json({ error: EXISTING_SUBSCRIPTION_MESSAGE, code: 'SUBSCRIPTION_EXISTS' }, { status: 409 })

    const customerId = await createOrRetrieveCustomer({
      workspaceId: membership.workspaceId,
      email: user.email,
      name: user.name ?? undefined,
    })

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: price.stripePriceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`,
      allow_promotion_codes: true,
      // plan/region/currency are an audit trail only — the webhook derives the
      // plan from the subscription's Stripe Price, never from metadata.
      metadata: {
        workspaceId: membership.workspaceId,
        plan:        price.plan,
        region:      price.region,
        currency:    price.currency,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
