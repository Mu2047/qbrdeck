import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getWorkspaceMembership } from '@/lib/workspace'

export async function GET() {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ subscription: null })

  const membership = await getWorkspaceMembership(clerkId)
  if (!membership?.subscription) return NextResponse.json({ subscription: null })

  const sub = membership.subscription

  return NextResponse.json({
    subscription: {
      status:      'active',
      plan:        sub.plan,
      renewsAt:    null,
      qbrCount:    sub.qbrCount,
      exportCount: sub.exportCount,
    },
  })
}