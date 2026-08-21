import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { performQbrExport, ExportQbrNotFoundError, ExportNoSlidesError, ExportLimitError } from '@/lib/qbr-export'

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { qbrId } = await req.json()

    const { buffer, filename, contentType } = await performQbrExport(membership, qbrId, 'pdf')

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (err: any) {
    if (err instanceof ExportQbrNotFoundError) {
      return NextResponse.json({ error: 'QBR not found' }, { status: 404 })
    }
    if (err instanceof ExportNoSlidesError) {
      return NextResponse.json({ error: 'QBR has no generated slides' }, { status: 400 })
    }
    if (err instanceof ExportLimitError) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'exports', plan: err.plan, max: err.max },
        { status: 403 }
      )
    }
    console.error('[export-pdf]', err)
    return NextResponse.json(
      { error: typeof err.message === 'string' ? err.message : 'Export failed' },
      { status: 500 }
    )
  }
}
