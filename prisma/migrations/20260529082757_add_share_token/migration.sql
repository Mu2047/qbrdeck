/*
  Warnings:

  - A unique constraint covering the columns `[shareToken]` on the table `QBR` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "QBR" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QBR_shareToken_key" ON "QBR"("shareToken");
