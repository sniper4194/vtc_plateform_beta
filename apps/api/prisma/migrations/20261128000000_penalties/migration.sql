-- CreateEnum
CREATE TYPE "PenaltyKind" AS ENUM ('GIVE_BACK', 'RESCUE');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "suspendedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DriverPenalty" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "kind" "PenaltyKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sanction" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedBy" TEXT,
    "waiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverPenalty_driverId_createdAt_idx" ON "DriverPenalty"("driverId", "createdAt");

-- AddForeignKey
ALTER TABLE "DriverPenalty" ADD CONSTRAINT "DriverPenalty_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

