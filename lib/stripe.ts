import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
  typescript: true,
})

export const PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    clientLimit: 2,
    qbrLimit: 3,
    exportLimit: 3,
    features: ['2 clients', '3 QBRs per month', '3 exports per month', 'Browser preview'],
  },
  SOLO: {
    name: 'Solo',
    price: 49,
    priceId: process.env.STRIPE_PRICE_SOLO,
    clientLimit: 10,
    qbrLimit: 20,
    exportLimit: null,
    features: ['10 clients', '20 QBRs per month', 'Unlimited exports', 'PDF + PPTX export', 'MI Secure Tech branding'],
  },
  GROWTH: {
    name: 'Growth',
    price: 99,
    priceId: process.env.STRIPE_PRICE_GROWTH,
    clientLimit: 50,
    qbrLimit: 999,
    features: ['50 clients', 'Unlimited QBRs', 'PDF + PPTX export', 'White-label branding', 'Priority support', 'Up to 5 team members'],
  },
  AGENCY: {
    name: 'Agency',
    price: 199,
    priceId: process.env.STRIPE_PRICE_AGENCY,
    clientLimit: 999,
    qbrLimit: 999,
    features: ['Unlimited clients', 'Unlimited QBRs', 'PDF + PPTX export', 'White-label branding', 'Custom AI tone', 'Priority support', 'Unlimited team members'],
  },
}

export async function createOrRetrieveCustomer({
  workspaceId,
  email,
  name,
}: {
  workspaceId: string
  email: string
  name?: string
}): Promise<string> {
  const { prisma } = await import('@/lib/prisma')

  const existing = await prisma.subscription.findUnique({ where: { workspaceId } })

  // Don't trust a stored ID blindly — verify it still resolves in Stripe.
  // A stale/deleted/wrong-mode ID here is what caused the billing-portal failure.
  if (existing?.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existing.stripeCustomerId)
      if (!customer.deleted) return existing.stripeCustomerId
      console.warn(`[stripe] Customer ${existing.stripeCustomerId} deleted — recreating for workspace ${workspaceId}`)
    } catch (err: any) {
      if (err?.code !== 'resource_missing') throw err
      console.warn(`[stripe] Customer ${existing.stripeCustomerId} not found — recreating for workspace ${workspaceId}`)
    }
  }

  // Before minting a new customer, check whether this email already has one.
  // This is the gap that let a duplicate customer + fresh FREE row get created
  // for a workspace whose real subscription lived on a different customer.
  const matches = await stripe.customers.list({ email, limit: 5 })
  const reusable = matches.data.find(c => !c.deleted)

  const customer = reusable ?? await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { workspaceId },
  })

  // Backfill metadata if we reused an older customer created before this field existed.
  if (reusable && reusable.metadata?.workspaceId !== workspaceId) {
    await stripe.customers.update(customer.id, { metadata: { workspaceId } })
  }

  await prisma.subscription.upsert({
    where:  { workspaceId },
    create: { workspaceId, stripeCustomerId: customer.id, plan: 'FREE' },
    update: { stripeCustomerId: customer.id },
  })

  return customer.id
}
