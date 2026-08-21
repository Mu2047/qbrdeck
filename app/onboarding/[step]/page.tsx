import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getWorkspaceContext } from '@/lib/workspace'
import { shouldInterceptOnboarding, isStepImplemented, slugToStep, stepToSlug } from '@/lib/onboarding'
import { WelcomeScreen } from '../_screens/welcome'
import { WorkspaceNameScreen } from '../_screens/workspace-name'
import { FirstClientScreen } from '../_screens/first-client'
import { FirstQbrScreen } from '../_screens/first-qbr'

// Authorization precedence is load-bearing — see P2 onboarding preflight.
// Order must not change without re-deriving it:
//   1. authenticate (even before the slug is looked at)
//   2. resolve workspace context (lazy-creation is intentional here)
//   3. re-check onboarding eligibility (never TeamRole)
//   4. fail open to /dashboard if the persisted step has no screen yet
//   5. only now validate the requested slug — notFound() if unrecognized
//   6. persisted currentStep is authoritative — redirect if the URL disagrees
//   7. render
export default async function OnboardingStepPage({ params }: { params: { step: string } }) {
  const { userId: clerkId } = auth()
  if (!clerkId) redirect('/sign-in')

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  if (!shouldInterceptOnboarding(ctx.onboarding, ctx.member.userId)) {
    redirect('/dashboard')
  }

  // shouldInterceptOnboarding only returns true when onboarding and
  // onboarding.currentStep are both non-null, so this narrowing is safe.
  const currentStep = ctx.onboarding!.currentStep!

  if (!isStepImplemented(currentStep)) {
    redirect('/dashboard')
  }

  const requestedStep = slugToStep(params.step)
  if (!requestedStep) {
    notFound()
  }

  if (requestedStep !== currentStep) {
    redirect(`/onboarding/${stepToSlug(currentStep)}`)
  }

  if (currentStep === 'WELCOME') return <WelcomeScreen />
  if (currentStep === 'WORKSPACE_NAME') return <WorkspaceNameScreen initialName={ctx.workspace.name} />

  // Read-only lookups for this render — no writes happen here. Idempotency
  // keys are generated client-side, lazily, on first submit — never during
  // server render. See P2 onboarding preflight, Correction 1.
  if (currentStep === 'FIRST_CLIENT') {
    const [onboardingRow, existingClients] = await Promise.all([
      prisma.workspaceOnboarding.findUnique({
        where: { workspaceId: ctx.workspaceId },
        select: { clientStepIdempotencyKey: true },
      }),
      prisma.client.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ])

    return (
      <FirstClientScreen
        persistedKey={onboardingRow?.clientStepIdempotencyKey ?? null}
        existingClientCount={existingClients.length}
        soleExistingClientName={existingClients.length === 1 ? existingClients[0].name : null}
      />
    )
  }

  if (currentStep === 'FIRST_QBR') {
    const onboardingRow = await prisma.workspaceOnboarding.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { qbrStepIdempotencyKey: true },
    })

    return <FirstQbrScreen persistedKey={onboardingRow?.qbrStepIdempotencyKey ?? null} />
  }

  // Unreachable: isStepImplemented above already narrowed currentStep to
  // one of the four steps handled above for this deployment.
  notFound()
}
