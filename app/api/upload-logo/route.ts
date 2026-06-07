import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'

export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth()
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const membership = await getWorkspaceMembership(clerkId)
  if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  if (!can.manageSettings(membership.role))
    return NextResponse.json({ error: 'Only the workspace owner can update the logo' }, { status: 403 })

  const form = await req.formData()
  const file = form.get('logo') as File
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (!file.type.startsWith('image/'))
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
  if (file.size > 2 * 1024 * 1024)
    return NextResponse.json({ error: 'Image must be under 2MB' }, { status: 400 })

  const blob = await put(
    `logos/${membership.workspaceId}-${Date.now()}.${file.name.split('.').pop()}`,
    file,
    { access: 'public' }
  )

  await prisma.workspace.update({
    where: { id: membership.workspaceId },
    data:  { logoUrl: blob.url },
  })

  return NextResponse.json({ url: blob.url })
}