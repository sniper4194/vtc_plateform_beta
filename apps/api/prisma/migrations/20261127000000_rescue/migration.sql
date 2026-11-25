-- CreateEnum
CREATE TYPE "RescueStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "rescueOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rescueRevokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RescueRequest" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT,
    "rescuerId" TEXT,
    "reason" TEXT NOT NULL,
    "bonusCents" INTEGER NOT NULL DEFAULT 0,
    "status" "RescueStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RescueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RescueRequest_status_expiresAt_idx" ON "RescueRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RescueRequest_requesterId_createdAt_idx" ON "RescueRequest"("requesterId", "createdAt");

-- AddForeignKey
ALTER TABLE "RescueRequest" ADD CONSTRAINT "RescueRequest_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueRequest" ADD CONSTRAINT "RescueRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueRequest" ADD CONSTRAINT "RescueRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueRequest" ADD CONSTRAINT "RescueRequest_rescuerId_fkey" FOREIGN KEY ("rescuerId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une seule demande ouverte par mission.
CREATE UNIQUE INDEX "RescueRequest_one_open_per_ride" ON "RescueRequest"("rideId") WHERE "status" = 'OPEN';
