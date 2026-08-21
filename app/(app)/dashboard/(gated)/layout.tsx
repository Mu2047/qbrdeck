import { redirect } from 'next/navigation'
import { getWorkspaceContext } from '@/lib/workspace'
import { shouldInterceptOnboarding, stepToSlug } from '@/lib/onboarding'

// Structural gate for onboarding interception — see P2 onboarding PR 8
// preflight. This is the ONLY place onboarding interception happens:
// middleware.ts stays auth-only, and app/(app)/layout.tsx stays pure client
// chrome. Billing (app/(app)/dashboard/billing/**) is intentionally NOT
// nested under this route group — export quota may be unavailable during
// onboarding, so the wizard must never strand a user away from billing.
//
// Kill switch: ONBOARDING_GATE_ENABLED must equal the exact literal string
// 'true' to enable interception. Any other value — undefined, '', 'false',
// 'TRUE', '1' — disables it. When disabled, this layout returns children
// immediately, before ever calling getWorkspaceContext() or touching the
// database, so a disabled gate is as close to a no-op as this file can be.
export default async function GatedDashboardLayout({ children }: { children: React.ReactNode }) {
  if (process.env.ONBOARDING_GATE_ENABLED !== 'true') {
    return <>{children}</>
  }

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  // Role (ctx.member.role) is never consulted here — only the exact
  // durably-anchored onboardingOwnerUserId identity matters. An invited
  // member holding TeamRole.OWNER must never be intercepted merely because
  // the shared workspace's onboarding row is IN_PROGRESS for its creator.
  if (shouldInterceptOnboarding(ctx.onboarding, ctx.member.userId)) {
    redirect(`/onboarding/${stepToSlug(ctx.onboarding!.currentStep!)}`)
  }

  return <>{children}</>
}
