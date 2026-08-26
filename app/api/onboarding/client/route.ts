import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { lockWorkspaceRow } from '@/lib/workspace-lock'
import { getLimits, isUnderLimit } from '@/lib/limits'

// Field shape intentionally mirrors app/api/clients/route.ts's createSchema
// exactly, rather than importing a shared module — see P2 onboarding
// preflight ("Client validation: Option B"). Drift is caught by
// tests/onboarding-client-schema-parity.test.ts, not by a shared import.
// The generic Client API (app/api/clients/route.ts) is never modified by
// this endpoint's existence.
// clientId is optional — required only when the server-resolved candidate
// set has 2+ members (explicit multi-client selection); see P2 onboarding
// PR 8 preflight, "First Client — 2+ selector". The browser never supplies
// workspaceId/userId/ownerId; a supplied clientId is only ever compared
// against the workspace-scoped candidate set re-queried server-side inside
// the transaction below — it can never select a Client outside this
// workspace or a soft-deleted one.
const attachSchema = z.object({
  mode: z.literal('attach'),
  retryKey: z.string().uuid(),
  clientId: z.string().optional(),
}).strict()

const createSchema = z.object({
  mode: z.literal('create'),
  retryKey: z.string().uuid(),
  name: z.string().min(1),
  industry: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  userCount: z.number().optional(),
  notes: z.string().optional(),
}).strict()

const bodySchema = z.discriminatedUnion('mode', [attachSchema, createSchema])

// Thrown only for the one legitimate concurrency race this endpoint must
// detect: the conditional WorkspaceOnboarding claim lost. Never used to
// mask an unexpected/programming error as a conflict.
class ClaimLostError extends Error {}
// Attach mode's server-resolved candidate set no longer supports a unique
// attach at commit time (count changed between page render and submit).
class AttachCandidateMismatchError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // workspaceId/userId always come from the server-resolved membership,
    // never from the request body — the body carries no workspaceId,
    // userId, ownerId, fromStep, clientId, or existingClientId field at all
    // (bodySchema.strict() on both branches rejects any such key outright).
    const { workspaceId, userId } = membership
    const { retryKey } = parsed.data

    // ── Authenticated, workspace-scoped onboarding read + owner identity ───────
    // Eligibility here is exact onboardingOwnerUserId identity only — never
    // TeamRole. See P2 onboarding preflight, Correction 3.
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Idempotent replay check — BEFORE plan limit, candidate counting, or
    // any create/attach/state-mutating logic. Must succeed even when the
    // winning attempt already consumed the workspace's final plan slot. ─────
    const replayResult = await tryReplay(onboarding, workspaceId, retryKey)
    if (replayResult) return replayResult

    // ── Fresh-path state guard — exact shape only, never "further along" ───────
    const isFreshState =
      onboarding.status === 'IN_PROGRESS' &&
      onboarding.currentStep === 'FIRST_CLIENT' &&
      onboarding.onboardingClientId === null
    if (!isFreshState) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    if (parsed.data.mode === 'attach') {
      return await handleAttach(workspaceId, userId, retryKey, parsed.data.clientId)
    }
    return await handleCreate(workspaceId, userId, retryKey, parsed.data)
  } catch (err: any) {
    console.error('[onboarding-client]', err)
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 })
  }
}

async function tryReplay(
  onboarding: { status: string; currentStep: string | null; onboardingClientId: string | null; clientStepIdempotencyKey: string | null },
  workspaceId: string,
  retryKey: string,
) {
  const isReplay =
    onboarding.status === 'IN_PROGRESS' &&
    onboarding.currentStep === 'FIRST_QBR' &&
    onboarding.onboardingClientId != null &&
    onboarding.clientStepIdempotencyKey === retryKey

  if (!isReplay) return null

  const client = await prisma.client.findFirst({
    where: { id: onboarding.onboardingClientId!, workspaceId, deletedAt: null },
  })
  if (!client) {
    return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
  }
  return NextResponse.json({ id: client.id, name: client.name }, { status: 200 })
}

async function handleAttach(workspaceId: string, userId: string, retryKey: string, requestedClientId?: string) {
  try {
    const client = await prisma.$transaction(async (tx) => {
      // Server-resolved and re-fetched fresh at commit time — a browser-
      // supplied clientId (only present for explicit 2+ selection) is never
      // trusted on its own; it is only ever matched against this exact
      // workspace-scoped, non-deleted candidate set queried right here.
      const candidates = await tx.client.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true, name: true },
      })

      let existingClient: { id: string; name: string }
      if (candidates.length === 0) {
        // No attachable candidate at all — attach mode should never be
        // reachable in this shape, but never silently succeed regardless.
        throw new AttachCandidateMismatchError()
      } else if (candidates.length === 1) {
        const onlyCandidate = candidates[0]
        // clientId may be omitted for backward compatibility in the
        // unique-candidate case, but a *supplied* mismatching id must never
        // be silently ignored in favor of the sole candidate.
        if (requestedClientId != null && requestedClientId !== onlyCandidate.id) {
          throw new AttachCandidateMismatchError()
        }
        existingClient = onlyCandidate
      } else {
        // 2+ candidates — explicit selection is required, and the supplied
        // id must match one of THIS workspace's non-deleted candidates.
        if (requestedClientId == null) throw new AttachCandidateMismatchError()
        const matched = candidates.find(c => c.id === requestedClientId)
        if (!matched) throw new AttachCandidateMismatchError()
        existingClient = matched
      }

      const claim = await tx.workspaceOnboarding.updateMany({
        where: {
          workspaceId,
          status: 'IN_PROGRESS',
          currentStep: 'FIRST_CLIENT',
          onboardingOwnerUserId: userId,
          onboardingClientId: null,
        },
        data: {
          onboardingClientId: existingClient.id,
          clientStepIdempotencyKey: retryKey,
          currentStep: 'FIRST_QBR',
        },
      })
      if (claim.count !== 1) throw new ClaimLostError()

      return existingClient
    })

    return NextResponse.json({ id: client.id, name: client.name }, { status: 200 })
  } catch (err) {
    if (err instanceof AttachCandidateMismatchError) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }
    if (err instanceof ClaimLostError) {
      return await classifyClientConflict(workspaceId, userId, retryKey)
    }
    throw err
  }
}

async function handleCreate(
  workspaceId: string,
  userId: string,
  retryKey: string,
  fields: { name: string; industry?: string; contactName?: string; contactEmail?: string; userCount?: number; notes?: string },
) {
  try {
    // ── Concurrency-safe capacity check + create ────────────────────────────
    // Locks the same Workspace row as the normal POST /api/clients path (see
    // lib/workspace-lock.ts) so the two Client-creation paths serialize their
    // capacity decisions against each other, not just against themselves.
    // The count/limit check is now the sole authoritative decision for
    // create mode, performed under the lock — there is no separate
    // pre-transaction check to keep in sync with it.
    const result = await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, workspaceId)

      // Re-read the plan fresh under the lock, same as the normal route —
      // a workspace may not yet have a Subscription row at all, hence the
      // FREE fallback below.
      const subscription = await tx.subscription.findUnique({
        where:  { workspaceId },
        select: { plan: true },
      })
      const limits = getLimits(subscription?.plan ?? 'FREE')

      // Soft-deleted Clients do not consume active Client capacity.
      const clientCount = await tx.client.count({
        where: { workspaceId, deletedAt: null },
      })

      if (!isUnderLimit(clientCount, limits.clients)) {
        return { kind: 'limit_reached' } as const
      }

      const created = await tx.client.create({
        data: {
          name: fields.name,
          industry: fields.industry,
          contactName: fields.contactName,
          contactEmail: fields.contactEmail,
          userCount: fields.userCount,
          notes: fields.notes,
          workspaceId,
          createdById: userId,
        },
      })

      const claim = await tx.workspaceOnboarding.updateMany({
        where: {
          workspaceId,
          status: 'IN_PROGRESS',
          currentStep: 'FIRST_CLIENT',
          onboardingOwnerUserId: userId,
          onboardingClientId: null,
        },
        data: {
          onboardingClientId: created.id,
          clientStepIdempotencyKey: retryKey,
          currentStep: 'FIRST_QBR',
        },
      })
      // Prisma rolls back the whole transaction on throw — including the
      // candidate Client just created above. No manual delete anywhere.
      if (claim.count !== 1) throw new ClaimLostError()

      return { kind: 'created', client: created } as const
    })

    if (result.kind === 'limit_reached') {
      return NextResponse.json({ error: 'CLIENT_LIMIT_REACHED' }, { status: 403 })
    }

    return NextResponse.json({ id: result.client.id, name: result.client.name }, { status: 201 })
  } catch (err) {
    if (err instanceof ClaimLostError) {
      return await classifyClientConflict(workspaceId, userId, retryKey)
    }
    throw err
  }
}

// Re-read after a lost claim (post-rollback) and classify: an exact
// matching retry result is a successful idempotent replay; anything else
// is a genuine conflict, never silently treated as success.
async function classifyClientConflict(workspaceId: string, userId: string, retryKey: string) {
  const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
  if (!onboarding) {
    return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
  }
  if (onboarding.onboardingOwnerUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (
    onboarding.status === 'IN_PROGRESS' &&
    onboarding.currentStep === 'FIRST_QBR' &&
    onboarding.onboardingClientId != null &&
    onboarding.clientStepIdempotencyKey === retryKey
  ) {
    const client = await prisma.client.findFirst({
      where: { id: onboarding.onboardingClientId, workspaceId, deletedAt: null },
    })
    if (client) {
      return NextResponse.json({ id: client.id, name: client.name }, { status: 200 })
    }
  }
  return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
}
