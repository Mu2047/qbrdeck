import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getWorkspaceMembership } from '@/lib/workspace'

export async function GET() {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const membership = await getWorkspaceMembership(clerkId)
  if (!membership) return NextResponse.json({ companyName: '', logoUrl: null })

  return NextResponse.json({
    companyName: membership.workspace.name ?? '',
    logoUrl:     membership.workspace.logoUrl ?? null,
    role:        membership.role,
    workspaceId: membership.workspaceId,
  })
}