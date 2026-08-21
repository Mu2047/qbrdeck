import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getWorkspaceContext } from '@/lib/workspace'
import { canInviteMoreMembers } from '@/lib/permissions'
import { shouldInterceptOnboarding, isStepImplemented, slugToStep, stepToSlug } from '@/lib/onboarding'
import { WelcomeScreen } from '../_screens/welcome'
import { WorkspaceNameScreen } from '../_screens/workspace-name'
import { FirstClientScreen } from '../_screens/first-client'
import { FirstQbrScreen } from '../_screens/first-qbr'
import { ReviewQbrScreen } from '../_screens/review-qbr'
import { ExportQbrScreen } from '../_screens/export-qbr'
import { ShareQbrScreen } from '../_screens/share-qbr'
import { CompleteScreen } from '../_screens/complete'

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

  // REVIEW_QBR — read-only. The QBR displayed is exactly
  // WorkspaceOnboarding.onboardingQbrId, resolved server-side; the browser
  // never supplies a qbrId. Malformed/missing anchor state fails open to
  // /dashboard rather than rendering a broken review — see P2 onboarding PR 7
  // preflight, Correction 1.
  if (currentStep === 'REVIEW_QBR') {
    const onboardingRow = await prisma.workspaceOnboarding.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { onboardingClientId: true, onboardingQbrId: true },
    })

    if (!onboardingRow?.onboardingClientId || !onboardingRow?.onboardingQbrId) {
      redirect('/dashboard')
    }

    const anchoredQbr = await prisma.qBR.findFirst({
      where: {
        id:          onboardingRow.onboardingQbrId,
        workspaceId: ctx.workspaceId,
        clientId:    onboardingRow.onboardingClientId,
        deletedAt:   null,
      },
      include: { client: true },
    })

    if (!anchoredQbr) redirect('/dashboard')

    return (
      <ReviewQbrScreen
        clientName={anchoredQbr.client.name}
        quarter={anchoredQbr.quarter}
        year={anchoredQbr.year}
        healthScore={anchoredQbr.healthScore}
        healthStatus={anchoredQbr.healthStatus}
        summary={anchoredQbr.summary}
        slides={(anchoredQbr.slides as any[]) ?? []}
      />
    )
  }

  // EXPORT_QBR / SHARE_QBR — no anchored content needs to reach the client
  // for these two screens (export/share actions resolve the anchored QBR
  // entirely server-side inside their own API routes); only a light presence
  // check + fail-open guard is needed here so a malformed/missing anchor
  // never renders a broken screen.
  if (currentStep === 'EXPORT_QBR') {
    const onboardingRow = await prisma.workspaceOnboarding.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { onboardingClientId: true, onboardingQbrId: true },
    })

    if (!onboardingRow?.onboardingClientId || !onboardingRow?.onboardingQbrId) {
      redirect('/dashboard')
    }

    return <ExportQbrScreen />
  }

  if (currentStep === 'SHARE_QBR') {
    const onboardingRow = await prisma.workspaceOnboarding.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { onboardingClientId: true, onboardingQbrId: true },
    })

    if (!onboardingRow?.onboardingClientId || !onboardingRow?.onboardingQbrId) {
      redirect('/dashboard')
    }

    const anchoredClient = await prisma.client.findFirst({
      where: { id: onboardingRow.onboardingClientId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { contactEmail: true },
    })

    return <ShareQbrScreen prefillEmail={anchoredClient?.contactEmail || null} />
  }

  // COMPLETE — durably distinct from actual completion: status is still
  // IN_PROGRESS and completedAt is still null here. Only Screen 8's Finish
  // action (POST /api/onboarding/finish) may set status = COMPLETED. Invite
  // capacity is derived from the exact same source of truth the real invite
  // endpoint uses (member count vs. plan seat limit), never from plan type
  // alone — see P2 onboarding PR 7 preflight, Correction 3.
  if (currentStep === 'COMPLETE') {
    const plan = ctx.subscription?.plan ?? 'FREE'
    const memberCount = await prisma.workspaceMember.count({
      where: { workspaceId: ctx.workspaceId },
    })

    return <CompleteScreen canInviteTeammate={canInviteMoreMembers(plan, memberCount)} />
  }

  // Unreachable: isStepImplemented above already narrowed currentStep to
  // one of the eight steps handled above for this deployment.
  notFound()
}
