import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { TeamRole, OnboardingStatus, OnboardingStep } from '@prisma/client'

export type WorkspaceContext = {
  workspaceId: string
  workspace: {
    id: string
    name: string
    logoUrl: string | null
    slug: string | null
  }
  member: {
    role: TeamRole
    userId: string
  }
  subscription: {
    plan: string
    qbrCount: number
    exportCount: number
    exportedQbrIds: string
    periodStart: Date
    stripeCustomerId: string
    stripeSubscriptionId?: string | null
  } | null
  // Nullable: a workspace may have no onboarding row at all (self-heal failed,
  // or is only attempted on the existing-membership path — never fabricated).
  onboarding: {
    status: OnboardingStatus
    currentStep: OnboardingStep | null
    onboardingOwnerUserId: string | null
  } | null
}

// Shared context-building shape for both the fast existing-membership path
// and the transactional slow path's race-loser branch — kept as one small
// helper so a resolved (userId, role, workspace, onboarding) tuple is always
// mapped into WorkspaceContext identically, regardless of which path
// produced it. Never called by the race-winner's own create branch's normal
// flow differently — same mapping everywhere.
function buildWorkspaceContext(
  userId: string,
  role: TeamRole,
  workspace: {
    id: string
    name: string
    logoUrl: string | null
    slug: string | null
    subscription: {
      plan: string
      qbrCount: number
      exportCount: number
      exportedQbrIds: string
      periodStart: Date
      stripeCustomerId: string
      stripeSubscriptionId: string | null
    } | null
  },
  onboarding: {
    status: OnboardingStatus
    currentStep: OnboardingStep | null
    onboardingOwnerUserId: string | null
  } | null
): WorkspaceContext {
  return {
    workspaceId: workspace.id,
    workspace: {
      id:      workspace.id,
      name:    workspace.name,
      logoUrl: workspace.logoUrl,
      slug:    workspace.slug,
    },
    member: {
      role,
      userId,
    },
    subscription: workspace.subscription
      ? {
          plan:                 workspace.subscription.plan,
          qbrCount:             workspace.subscription.qbrCount,
          exportCount:          workspace.subscription.exportCount,
          exportedQbrIds:       workspace.subscription.exportedQbrIds,
          periodStart:          workspace.subscription.periodStart,
          stripeCustomerId:     workspace.subscription.stripeCustomerId,
          stripeSubscriptionId: workspace.subscription.stripeSubscriptionId,
        }
      : null,
    onboarding: onboarding
      ? {
          status:                onboarding.status,
          currentStep:           onboarding.currentStep,
          onboardingOwnerUserId: onboarding.onboardingOwnerUserId,
        }
      : null,
  }
}

// Single semantic implementation of "resolve an already-existing
// membership into a WorkspaceContext," self-heal included — used by BOTH
// the fast existing-membership path AND, after its locking transaction has
// already committed, the slow path's race-loser branch. A membership found
// by the slow path's locked re-check is not provably the competing
// automatic-bootstrap winner: invite acceptance (see
// app/api/workspace/invite/accept/route.ts) never locks the User row, so it
// can commit a WorkspaceMember for this same user, into an arbitrary
// existing (possibly onboarding-less legacy) workspace, at any point
// between the fast path's initial zero-membership read and the slow path's
// locked re-check. Treating every locked-re-check hit as "must already have
// onboarding" would silently skip the self-heal contract for that case.
// Always called with the GLOBAL prisma client, never a transaction's `tx` —
// the self-heal upsert must run outside any lock-holding transaction: a
// PostgreSQL statement error inside an active transaction aborts that whole
// transaction even if JS catches the exception, which would defeat the
// upsert's own narrow fail-open guarantee.
async function resolveExistingMembership(
  userId: string,
  membership: {
    role: TeamRole
    workspace: {
      id: string
      name: string
      logoUrl: string | null
      slug: string | null
      subscription: {
        plan: string
        qbrCount: number
        exportCount: number
        exportedQbrIds: string
        periodStart: Date
        stripeCustomerId: string
        stripeSubscriptionId: string | null
      } | null
      onboarding: {
        status: OnboardingStatus
        currentStep: OnboardingStep | null
        onboardingOwnerUserId: string | null
      } | null
    }
  }
): Promise<WorkspaceContext> {
  const workspace = membership.workspace

  // Durable self-heal: an existing workspace/member resolved above may
  // predate onboarding entirely (backfill gap), or — for the slow-path
  // race-loser case — belong to an invite-accepted workspace whose
  // onboarding presence was never guaranteed by that path. Narrowly scoped
  // try/catch: an operational DB failure here must not deny the request or
  // fabricate onboarding state — it leaves onboarding null and lets the
  // rest of the already-resolved context through.
  let onboarding = workspace.onboarding
  if (!onboarding) {
    try {
      onboarding = await prisma.workspaceOnboarding.upsert({
        where: { workspaceId: workspace.id },
        update: {},
        create: {
          workspaceId: workspace.id,
          status: 'EXEMPT',
          currentStep: null,
          exemptReason: 'post_backfill_pre_activation_gap',
          onboardingOwnerUserId: null,
        },
      })
    } catch {
      onboarding = null
    }
  }

  return buildWorkspaceContext(userId, membership.role, workspace, onboarding)
}

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const { userId: clerkId } = auth()
  if (!clerkId) return null

  // Auto-create user record on first sign-in
  let user = await prisma.user.findUnique({
    where: { clerkId },
    include: {
      memberships: {
        include: { workspace: { include: { subscription: true, onboarding: true } } },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  })

  if (!user) {
  const { currentUser } = await import('@clerk/nextjs/server')
  const clerkUser = await currentUser()
  if (!clerkUser) return null

  const email = clerkUser.emailAddresses[0]?.emailAddress
  if (!email) return null   // never upsert on an empty email

  user = await prisma.user.upsert({
    where: { email },                 // match the existing row by its unique email
    update: { clerkId },              // reconcile: point the record at the current Clerk identity
    create: {
      clerkId,
      email,
      name: `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() || null,
    },
    include: {
      memberships: {
        include: { workspace: { include: { subscription: true, onboarding: true } } },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  })
}

  if (!user) return null

  if (user.memberships.length > 0) {
    return resolveExistingMembership(user.id, user.memberships[0])
  }

  // Zero memberships observed on the fast-path read above. This alone must
  // NEVER be trusted to mean "bootstrap a workspace": two concurrent
  // first-time requests for the same User can both reach this point having
  // each independently observed zero rows, before either has committed
  // anything (see P2 onboarding — duplicate-workspace concurrency fix; this
  // is exactly the race that produced two Workspaces for one User in
  // Production). The slow path below closes it: lock the existing internal
  // User row (guaranteed already committed by this point — found or
  // upserted above), re-read WorkspaceMember under that lock, and only
  // create a workspace if the locked re-check still finds nothing. A
  // concurrent request that arrives second blocks on the same User row,
  // then — once the first request commits — sees the winning membership
  // and resolves it instead of creating a second workspace.
  const userId = user.id

  // Discriminated result: the transaction below only ever decides "an
  // existing membership already won" vs. "this request created one" — it
  // never itself calls the self-heal-aware resolver, so that resolver's
  // upsert (see resolveExistingMembership) never runs inside the
  // lock-holding transaction.
  const slowPathResult = await prisma.$transaction(async (tx) => {
    // LOCK — must precede the re-check. Parameterized tagged-template raw
    // query — the interpolated value is bound as a query parameter, never
    // concatenated into the SQL string.
    const lockedUser = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `
    if (lockedUser.length === 0) {
      // Unreachable in practice — user is always committed before this
      // branch is reached — but never silently bootstrap without the lock
      // having actually resolved a real row.
      throw new Error('getWorkspaceContext: User row not found while acquiring bootstrap lock')
    }

    // RE-CHECK — must precede any create. Same canonical selection rule as
    // the fast path (earliest joinedAt), on the same tx client.
    const lockedMembership = await tx.workspaceMember.findFirst({
      where: { userId },
      include: { workspace: { include: { subscription: true, onboarding: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    if (lockedMembership) {
      // Lost the bootstrap race — a membership now exists for this user
      // that didn't exist at the fast path's initial read. This is NOT
      // provably the competing automatic-bootstrap winner: invite
      // acceptance never locks the User row, so it can commit a
      // WorkspaceMember for this same user, into an arbitrary existing
      // workspace, at any point up to this exact re-check (see
      // resolveExistingMembership for the full reasoning). Never create a
      // second workspace here, and never run self-heal inside this
      // transaction — just report which membership won; the caller
      // resolves it (self-heal included) after this transaction commits
      // and its lock releases.
      return { kind: 'existing' as const, role: lockedMembership.role, workspace: lockedMembership.workspace }
    }

    // CONDITIONAL CREATE — locked re-check still found zero memberships, so
    // this request genuinely is the first for this User. Workspace + OWNER
    // WorkspaceMember + WorkspaceOnboarding must commit as a single atomic
    // nested write: if the onboarding create fails, the whole
    // workspace.create must fail with it, so we never end up with a
    // workspace that has an OWNER but no onboarding row at all.
    //
    // Enrollment shares the EXACT same activation boundary as dashboard
    // interception (app/(app)/dashboard/(gated)/layout.tsx) — the identical
    // `=== 'true'` literal check, no second env var. While the gate is off,
    // a workspace created here must never receive a live IN_PROGRESS row:
    // that row would silently become interceptable the instant the gate is
    // later enabled, retroactively forcing an onboarding flow on a user who
    // was never shown one at signup (see P2 onboarding PR 9
    // activation-boundary correction). Instead it is created permanently
    // EXEMPT ('pre_activation_gate_disabled') — gate-off enrollment never
    // manufactures onboarding eligibility later.
    const onboardingGateEnabled = process.env.ONBOARDING_GATE_ENABLED === 'true'

    const workspace = await tx.workspace.create({
      data: {
        name: user.name ?? user.email.split('@')[0] ?? 'My Workspace',
        members: {
          create: {
            userId,
            role:   'OWNER',
          },
        },
        onboarding: {
          create: onboardingGateEnabled
            ? {
                status:                'IN_PROGRESS',
                currentStep:           'WELCOME',
                onboardingOwnerUserId: userId,
                startedAt:             new Date(),
              }
            : {
                status:                   'EXEMPT',
                currentStep:              null,
                onboardingOwnerUserId:    null,
                onboardingClientId:       null,
                onboardingQbrId:          null,
                clientStepIdempotencyKey: null,
                qbrStepIdempotencyKey:    null,
                exportSkippedAt:          null,
                shareSkippedAt:           null,
                exemptReason:             'pre_activation_gate_disabled',
                startedAt:                null,
                completedAt:              null,
              },
        },
      },
      include: { subscription: true, onboarding: true },
    })

    return { kind: 'created' as const, workspace }
  })

  if (slowPathResult.kind === 'existing') {
    // Lock has already released (the transaction above committed). Resolve
    // through the exact same self-heal-aware path as the fast path — no
    // additional write occurs when the winning workspace already has its
    // onboarding row, which is the normal competing-bootstrap outcome.
    return resolveExistingMembership(userId, {
      role:      slowPathResult.role,
      workspace: slowPathResult.workspace,
    })
  }

  return buildWorkspaceContext(userId, 'OWNER', slowPathResult.workspace, slowPathResult.workspace.onboarding)
}

export async function getWorkspaceMembership(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    include: {
      memberships: {
        include: { workspace: { include: { subscription: true } } },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  })

  if (!user || user.memberships.length === 0) return null

  const membership = user.memberships[0]
  return {
    userId:      user.id,
    user,
    workspaceId: membership.workspaceId,
    role:        membership.role,
    workspace:   membership.workspace,
    subscription: membership.workspace.subscription,
  }
}