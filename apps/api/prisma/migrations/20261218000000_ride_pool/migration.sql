-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('OPEN', 'TAKEN', 'CANCELLED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "poolOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RidePool" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "fromCompanyId" TEXT NOT NULL,
    "fromDriverId" TEXT NOT NULL,
    "sharePercent" INTEGER NOT NULL DEFAULT 0,
    "status" "PoolStatus" NOT NULL DEFAULT 'OPEN',
    "toCompanyId" TEXT,
    "toDriverId" TEXT,
    "shareCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),

    CONSTRAINT "RidePool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RidePool_status_createdAt_idx" ON "RidePool"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RidePool_rideId_idx" ON "RidePool"("rideId");

-- AddForeignKey
ALTER TABLE "RidePool" ADD CONSTRAINT "RidePool_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePool" ADD CONSTRAINT "RidePool_fromCompanyId_fkey" FOREIGN KEY ("fromCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePool" ADD CONSTRAINT "RidePool_toCompanyId_fkey" FOREIGN KEY ("toCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

