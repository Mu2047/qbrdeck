import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
  typescript: true,
})

// Plan prices and Stripe Price IDs live in lib/billing/regional-prices.ts;
// plan limits and features live in lib/limits.ts. This module owns only the
// Stripe client and customer lookup.

// Generic on purpose: the checkout route returns err.message to the client,
// so no customer or workspace IDs go in it.
export const CUSTOMER_OWNERSHIP_CONFLICT = 'Billing account ownership conflict — contact support'

// Rows created before checkout (generate-qbr, onboarding, export) store a
// `free_<workspaceId>` placeholder, never a real Stripe Customer.
function isPlaceholderCustomerId(id: string): boolean {
  return id.startsWith('free_')
}

// ONE WORKSPACE = ONE STRIPE CUSTOMER. `workspaceId` must come from the
// authenticated server-side membership, never from the request.
//
// - A customer stored on this workspace's Subscription row is reused if it
//   still exists. Missing metadata.workspaceId is accepted (legacy customers);
//   a DIFFERENT metadata.workspaceId fails closed.
// - Email alone never establishes ownership. An email match is only recovered
//   when exactly one candidate carries metadata.workspaceId === workspaceId
//   and no other workspace's row stores it; otherwise a new customer is created.
// - Existing customers' metadata is never rewritten.
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
  const storedId = existing?.stripeCustomerId

  // Don't trust a stored ID blindly — verify it still resolves in Stripe.
  // A stale/deleted/wrong-mode ID here is what caused the billing-portal failure.
  if (storedId && !isPlaceholderCustomerId(storedId)) {
    try {
      const customer = await stripe.customers.retrieve(storedId)
      if (!customer.deleted) {
        const owner = customer.metadata?.workspaceId
        if (owner && owner !== workspaceId) {
          console.error(`[stripe] Stored customer metadata names another workspace — refusing reuse for workspace ${workspaceId}`)
          throw new Error(CUSTOMER_OWNERSHIP_CONFLICT)
        }
        return storedId
      }
      console.warn(`[stripe] Stored customer deleted — recreating for workspace ${workspaceId}`)
    } catch (err: any) {
      if (err?.code !== 'resource_missing') throw err
      console.warn(`[stripe] Stored customer not found — recreating for workspace ${workspaceId}`)
    }
  }

  // Drift recovery: the workspace's own customer may exist in Stripe while the
  // local row is missing or stale. Only a candidate tagged with THIS workspace
  // qualifies; an untagged or foreign-tagged email match is ignored.
  const matches = await stripe.customers.list({ email, limit: 100 })
  const owned = matches.data.filter(c => !c.deleted && c.metadata?.workspaceId === workspaceId)
  if (owned.length > 1) {
    console.error(`[stripe] Multiple customers tagged for workspace ${workspaceId} — refusing to pick one`)
    throw new Error(CUSTOMER_OWNERSHIP_CONFLICT)
  }

  let customerId: string
  if (owned.length === 1) {
    const holder = await prisma.subscription.findUnique({
      where:  { stripeCustomerId: owned[0].id },
      select: { workspaceId: true },
    })
    if (holder && holder.workspaceId !== workspaceId) {
      console.error(`[stripe] Tagged customer is stored on another workspace — refusing reuse for workspace ${workspaceId}`)
      throw new Error(CUSTOMER_OWNERSHIP_CONFLICT)
    }
    customerId = owned[0].id
  } else {
    const created = await stripe.customers.create({
      email,
      name: name ?? undefined,
      metadata: { workspaceId },
    })
    customerId = created.id
  }

  await prisma.subscription.upsert({
    where:  { workspaceId },
    create: { workspaceId, stripeCustomerId: customerId, plan: 'FREE' },
    update: { stripeCustomerId: customerId },
  })

  return customerId
}
