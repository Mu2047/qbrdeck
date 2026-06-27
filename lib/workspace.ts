import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { TeamRole } from '@prisma/client'

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
}

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const { userId: clerkId } = auth()
  if (!clerkId) return null

  // Auto-create user record on first sign-in
  let user = await prisma.user.findUnique({
    where: { clerkId },
    include: {
      memberships: {
        include: { workspace: { include: { subscription: true } } },
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
        include: { workspace: { include: { subscription: true } } },
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
    }
  }

  // No workspace yet — create one
  const workspace = await prisma.workspace.create({
    data: {
      name: user.name ?? user.email.split('@')[0] ?? 'My Workspace',
      members: {
        create: {
          userId: user.id,
          role:   'OWNER',
        },
      },
    },
    include: { subscription: true },
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