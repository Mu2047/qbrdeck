import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import type Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('Webhook signature failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session        = event.data.object as Stripe.Checkout.Session
        const customerId     = session.customer as string
        const subscriptionId = session.subscription as string
        const workspaceId    = session.metadata?.workspaceId

        const sub     = await stripe.subscriptions.retrieve(subscriptionId)
        const priceId = sub.items.data[0]?.price.id
        const plan    = getPlanFromPriceId(priceId)

        if (workspaceId) {
          // Preferred path — workspaceId in metadata
          await prisma.subscription.upsert({
            where:  { workspaceId },
            update: {
              stripeCustomerId:     customerId,
              stripeSubscriptionId: subscriptionId,
              stripePriceId:        priceId,
              plan,
              status:               sub.status,
              currentPeriodEnd:     new Date(sub.current_period_end * 1000),
            },
            create: {
              workspaceId,
              stripeCustomerId:     customerId,
              stripeSubscriptionId: subscriptionId,
              stripePriceId:        priceId,
              plan,
              status:               sub.status,
              currentPeriodEnd:     new Date(sub.current_period_end * 1000),
            },
          })
        } else {
          // Fallback — look up by stripeCustomerId
          const existing = await prisma.subscription.findUnique({
            where: { stripeCustomerId: customerId },
          })
          if (existing) {
            await prisma.subscription.update({
              where: { stripeCustomerId: customerId },
              data: {
                stripeSubscriptionId: subscriptionId,
                stripePriceId:        priceId,
                plan,
                status:               sub.status,
                currentPeriodEnd:     new Date(sub.current_period_end * 1000),
              },
            })
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub     = event.data.object as Stripe.Subscription
        const priceId = sub.items.data[0]?.price.id
        const plan    = getPlanFromPriceId(priceId)

        await prisma.subscription.update({
          where: { stripeCustomerId: sub.customer as string },
          data: {
            plan,
            status:           sub.status,
            stripePriceId:    priceId,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await prisma.subscription.update({
          where: { stripeCustomerId: sub.customer as string },
          data: {
            plan:                 'FREE',
            status:               'canceled',
            stripeSubscriptionId: null,
            stripePriceId:        null,
          },
        })
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

function getPlanFromPriceId(priceId?: string): 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY' {
  if (priceId === process.env.STRIPE_PRICE_SOLO)   return 'SOLO'
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return 'GROWTH'
  if (priceId === process.env.STRIPE_PRICE_AGENCY) return 'AGENCY'
  return 'FREE'
}