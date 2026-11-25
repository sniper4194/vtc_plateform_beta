-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('REFERENCE', 'SHIFT');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('PENDING', 'VALID', 'REJECTED');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IdentityCheck" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "status" "IdentityStatus" NOT NULL DEFAULT 'PENDING',
    "mime" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "reason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityCheck_driverId_createdAt_idx" ON "IdentityCheck"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityCheck_status_createdAt_idx" ON "IdentityCheck"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "IdentityCheck" ADD CONSTRAINT "IdentityCheck_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

