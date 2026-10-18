import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
  typescript: true,
})

// Plan prices and Stripe Price IDs live in lib/billing/regional-prices.ts;
// plan limits and features live in lib/limits.ts. This module owns only the
// Stripe client and customer lookup.

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
