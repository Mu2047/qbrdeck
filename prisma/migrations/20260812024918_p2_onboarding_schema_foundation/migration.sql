-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('WELCOME', 'WORKSPACE_NAME', 'FIRST_CLIENT', 'FIRST_QBR', 'REVIEW_QBR', 'EXPORT_QBR', 'SHARE_QBR', 'COMPLETE');

-- CreateTable
CREATE TABLE "WorkspaceOnboarding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL,
    "currentStep" "OnboardingStep",
    "onboardingClientId" TEXT,
    "onboardingQbrId" TEXT,
    "clientStepIdempotencyKey" TEXT,
    "qbrStepIdempotencyKey" TEXT,
    "exemptReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceOnboarding_workspaceId_key" ON "WorkspaceOnboarding"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceOnboarding_onboardingClientId_key" ON "WorkspaceOnboarding"("onboardingClientId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceOnboarding_onboardingQbrId_key" ON "WorkspaceOnboarding"("onboardingQbrId");

-- CreateIndex
CREATE INDEX "WorkspaceOnboarding_status_idx" ON "WorkspaceOnboarding"("status");

-- AddForeignKey
ALTER TABLE "WorkspaceOnboarding" ADD CONSTRAINT "WorkspaceOnboarding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceOnboarding" ADD CONSTRAINT "WorkspaceOnboarding_onboardingClientId_fkey" FOREIGN KEY ("onboardingClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceOnboarding" ADD CONSTRAINT "WorkspaceOnboarding_onboardingQbrId_fkey" FOREIGN KEY ("onboardingQbrId") REFERENCES "QBR"("id") ON DELETE SET NULL ON UPDATE CASCADE;
