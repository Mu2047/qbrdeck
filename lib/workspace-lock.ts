import { Prisma } from '@prisma/client'

// Acquires a PostgreSQL row lock on exactly one Workspace, from inside an
// already-open Prisma interactive transaction. Callers use this to
// serialize a read-then-write sequence (e.g. count Clients, then create
// one) against concurrent requests for the same workspace — same pattern
// as the User-row lock in lib/workspace.ts (getWorkspaceContext), applied
// to the Workspace row instead.
//
// Must be called with the transaction's own client (tx), never the outer
// prisma client — the lock is only meaningful for the duration of that
// transaction. Performs no other DB work and starts no transaction of its
// own; the caller owns the transaction boundary.
export async function lockWorkspaceRow(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`
}
