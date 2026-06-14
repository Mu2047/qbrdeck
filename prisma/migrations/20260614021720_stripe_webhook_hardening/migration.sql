-- CreateEnum
CREATE TYPE "BrandingMode" AS ENUM ('PLATFORM_BRANDED', 'WHITE_LABEL');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('PDF', 'PPTX');

-- CreateEnum
CREATE TYPE "StripeEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "QBR" ADD COLUMN     "exportTemplateVersion" TEXT,
ADD COLUMN     "generatorVersion" TEXT,
ADD COLUMN     "healthScore" INTEGER,
ADD COLUMN     "healthScoreVersion" TEXT,
ADD COLUMN     "healthStatus" TEXT,
ADD COLUMN     "rawMetrics" JSONB,
ADD COLUMN     "scoreBreakdown" JSONB,
ADD COLUMN     "snapshot" JSONB;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "pastDueAt" TIMESTAMP(3),
ADD COLUMN     "stripeCurrentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stripeCurrentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "stripeStatus" TEXT;

-- CreateTable
CREATE TABLE "ExportEvent" (
    "id" TEXT NOT NULL,
    "qbrId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "exportedByUserId" TEXT,
    "exportType" "ExportType" NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportPackageId" TEXT,
    "isRedownload" BOOLEAN NOT NULL DEFAULT false,
    "consumedExportCredit" BOOLEAN NOT NULL DEFAULT false,
    "brandingMode" "BrandingMode" NOT NULL,
    "planAtExport" "Plan" NOT NULL,
    "clientNameAtExport" TEXT NOT NULL,
    "mspNameAtExport" TEXT,
    "healthScoreAtExport" INTEGER,
    "healthStatusAtExport" TEXT,
    "healthScoreVersionAtExport" TEXT,
    "templateVersion" TEXT,

    CONSTRAINT "ExportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "StripeEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportEvent_qbrId_idx" ON "ExportEvent"("qbrId");

-- CreateIndex
CREATE INDEX "ExportEvent_workspaceId_idx" ON "ExportEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "ExportEvent_clientId_idx" ON "ExportEvent"("clientId");

-- CreateIndex
CREATE INDEX "ExportEvent_exportPackageId_idx" ON "ExportEvent"("exportPackageId");

-- CreateIndex
CREATE INDEX "ExportEvent_exportedAt_idx" ON "ExportEvent"("exportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_stripeEventId_key" ON "StripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeEvent_stripeEventId_idx" ON "StripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeEvent_status_idx" ON "StripeEvent"("status");

-- CreateIndex
CREATE INDEX "StripeEvent_eventType_idx" ON "StripeEvent"("eventType");

-- CreateIndex
CREATE INDEX "StripeEvent_receivedAt_idx" ON "StripeEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "QBR_createdAt_idx" ON "QBR"("createdAt");

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_qbrId_fkey" FOREIGN KEY ("qbrId") REFERENCES "QBR"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_exportedByUserId_fkey" FOREIGN KEY ("exportedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
