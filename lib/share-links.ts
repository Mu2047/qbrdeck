import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Create a new ShareLink for a QBR. Returns the RAW token (only place it exists
 * in plaintext — store only the hash). Caller must have already verified the
 * QBR belongs to `workspaceId`.
 */
export async function createShareLink(opts: {
  qbrId: string
  workspaceId: string
  userId: string | null
  expiresInMs?: number
}): Promise<string> {
  const rawToken  = randomBytes(32).toString('hex')        // 256-bit
  const tokenHash = hashShareToken(rawToken)
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? THIRTY_DAYS_MS))

  await prisma.shareLink.create({
    data: {
      tokenHash,
      qbr:       { connect: { id_workspaceId: { id: opts.qbrId, workspaceId: opts.workspaceId } } },
      workspace: { connect: { id: opts.workspaceId } },
      ...(opts.userId ? { createdBy: { connect: { id: opts.userId } } } : {}),
      expiresAt,
    },
  })

  return rawToken
}

/**
 * Resolve a raw token from the portal URL to a QBR.
 * Tries the new hashed ShareLink first, then falls back to the legacy
 * plaintext qbr.shareToken so existing links keep working.
 * Returns the QBR (with client+workspace) or null if invalid/expired/revoked/archived.
 */
export async function resolveSharedQbr(rawToken: string) {
  const tokenHash = hashShareToken(rawToken)

  // 1. New path: hashed ShareLink
  const link = await prisma.shareLink.findUnique({
    where:   { tokenHash },
    include: {
      qbr: {
        include: { client: { include: { workspace: { include: { subscription: true } } } } },
      },
    },
  })

  if (link) {
    if (link.revokedAt) return null
    if (link.expiresAt && link.expiresAt < new Date()) return null
    if (link.qbr.deletedAt) return null
    if (link.qbr.client.deletedAt) return null
    if (link.qbr.client.workspace.deletedAt) return null

    // Best-effort view tracking (don't block render on failure)
    prisma.shareLink.update({
      where: { id: link.id },
      data:  { lastViewedAt: new Date(), viewCount: { increment: 1 } },
    }).catch(() => {})

    return link.qbr
  }

  // 2. Legacy fallback: plaintext qbr.shareToken (existing links)
  const legacy = await prisma.qBR.findFirst({
    where:   { shareToken: rawToken, deletedAt: null },
    include: { client: { include: { workspace: { include: { subscription: true } } } } },
  })

  if (legacy) {
    if (legacy.client.deletedAt) return null
    if (legacy.client.workspace.deletedAt) return null
    return legacy
  }

  return null
}