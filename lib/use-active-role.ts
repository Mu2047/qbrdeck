'use client'

import { useEffect, useState } from 'react'
import type { TeamRole } from '@prisma/client'

/**
 * The signed-in user's role in the ACTIVE workspace, for client components
 * that hide controls with `can.*`. Read from GET /api/workspace/active, which
 * resolves the active workspace with the same selectActiveMembership() the
 * API routes use, so the UI and the server always judge the same role.
 *
 * Returns null while loading or on any failure, and callers treat null as
 * "no permission" (fail closed). Purely cosmetic: every action is still
 * authorised server-side.
 */
export function useActiveRole(): TeamRole | null {
  const [role, setRole] = useState<TeamRole | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/workspace/active', { credentials: 'same-origin', cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`active workspace request failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        const active = (data.workspaces ?? []).find((w: { active: boolean }) => w.active)
        if (!cancelled) setRole(active?.role ?? null)
      })
      .catch(() => {
        if (!cancelled) setRole(null)
      })
    return () => { cancelled = true }
  }, [])

  return role
}
