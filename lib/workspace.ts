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
    const membership = user.memberships[0]
    const workspace  = membership.workspace

    // Durable self-heal: an existing workspace/member resolved above may
    // predate onboarding entirely (backfill gap). This branch only ever
    // fires for an EXISTING workspace — never for the just-created workspace
    // below, which always gets its onboarding row nested in the same create.
    // Narrowly scoped try/catch: an operational DB failure here must not
    // deny the request or fabricate onboarding state — it leaves onboarding
    // null and lets the rest of the already-resolved context through.
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

    return {
      workspaceId: workspace.id,
      workspace: {
        id:      workspace.id,
        name:    workspace.name,
        logoUrl: workspace.logoUrl,
        slug:    workspace.slug,
      },
      member: {
        role:   membership.role,
        userId: user.id,
      },
      subscription: workspace.subscription
        ? {
            plan:                workspace.subscription.plan,
            qbrCount:            workspace.subscription.qbrCount,
            exportCount:         workspace.subscription.exportCount,
            exportedQbrIds:      workspace.subscription.exportedQbrIds,
            periodStart:         workspace.subscription.periodStart,
            stripeCustomerId:    workspace.subscription.stripeCustomerId,
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

  // No workspace yet — create one. Workspace + OWNER WorkspaceMember +
  // WorkspaceOnboarding(IN_PROGRESS, WELCOME, creator anchor) must commit as
  // a single atomic nested write: if the onboarding create fails, the whole
  // workspace.create must fail with it, so we never end up with a workspace
  // that has an OWNER but no onboarding enrollment.
  const workspace = await prisma.workspace.create({
    data: {
      name: user.name ?? user.email.split('@')[0] ?? 'My Workspace',
      members: {
        create: {
          userId: user.id,
          role:   'OWNER',
        },
      },
      onboarding: {
        create: {
          status:                'IN_PROGRESS',
          currentStep:           'WELCOME',
          onboardingOwnerUserId: user.id,
          startedAt:             new Date(),
        },
      },
    },
    include: { subscription: true, onboarding: true },
  })

  return {
    workspaceId: workspace.id,
    workspace: {
      id:      workspace.id,
      name:    workspace.name,
      logoUrl: workspace.logoUrl,
      slug:    workspace.slug,
    },
    member: {
      role:   'OWNER',
      userId: user.id,
    },
    subscription: null,
    onboarding: workspace.onboarding
      ? {
          status:                workspace.onboarding.status,
          currentStep:           workspace.onboarding.currentStep,
          onboardingOwnerUserId: workspace.onboarding.onboardingOwnerUserId,
        }
      : null,
  }
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