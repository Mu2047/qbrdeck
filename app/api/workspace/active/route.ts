import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listUserWorkspaces } from '@/lib/workspace'
import { setActiveWorkspaceCookie } from '@/lib/active-workspace'

// Read-only: the workspace switcher's own data source. Never reveals more
// than listUserWorkspaces() already decided the switcher needs — no slug,
// logoUrl, subscription, or onboarding fields.
export async function GET() {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaces = await listUserWorkspaces(clerkId)
  return NextResponse.json({ workspaces })
}

// Switches the active workspace. The requested workspaceId is NEVER trusted
// by itself: it only takes effect if a real WorkspaceMember row already ties
// this exact user to this exact workspace. No membership, Workspace,
// Subscription, or role row is read for any other purpose, and none is ever
// written here — switching changes which existing membership is selected,
// never the memberships themselves.
export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const workspaceId = body?.workspaceId
  if (!workspaceId || typeof workspaceId !== 'string')
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // The one membership check that matters: exactly this user, exactly this
  // workspace. Role is irrelevant here — a Viewer may switch into any
  // workspace they legitimately belong to; this is a selector, not a grant.
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { id: true },
  })
  if (!membership)
    return NextResponse.json({ error: 'You are not a member of that workspace' }, { status: 403 })

  const response = NextResponse.json({ success: true, workspaceId })
  setActiveWorkspaceCookie(response, workspaceId)
  return response
}
