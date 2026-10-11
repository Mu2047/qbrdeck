// Client-safe helper for the sidebar workspace switcher in app/(app)/layout.tsx.
// Deliberately import-free: lib/workspace.ts pulls in Prisma and Clerk server
// code, so it cannot be used from that client component.

/**
 * Returns the switcher list with `workspaceId` marked as the only active entry,
 * applied after POST /api/workspace/active has succeeded. An id that is not in
 * the list leaves it unchanged, so the selector can never end up with no
 * active workspace.
 */
export function markActiveWorkspace<W extends { workspaceId: string; active: boolean }>(
  workspaces: W[],
  workspaceId: string,
): W[] {
  if (!workspaces.some(w => w.workspaceId === workspaceId)) return workspaces
  return workspaces.map(w => ({ ...w, active: w.workspaceId === workspaceId }))
}
