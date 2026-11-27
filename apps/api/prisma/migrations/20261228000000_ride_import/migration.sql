-- CreateEnum
CREATE TYPE "ImportedRideStatus" AS ENUM ('PENDING', 'PUBLISHED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "csvMapping" JSONB;

-- CreateTable
CREATE TABLE "RideImport" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedRide" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "reference" TEXT,
    "status" "ImportedRideStatus" NOT NULL DEFAULT 'PENDING',
    "data" JSONB NOT NULL,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pickupAt" TIMESTAMP(3),
    "rideId" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedRide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedRide_rideId_key" ON "ImportedRide"("rideId");

-- CreateIndex
CREATE INDEX "ImportedRide_status_pickupAt_idx" ON "ImportedRide"("status", "pickupAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedRide_partnerId_reference_key" ON "ImportedRide"("partnerId", "reference");

-- AddForeignKey
ALTER TABLE "RideImport" ADD CONSTRAINT "RideImport_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedRide" ADD CONSTRAINT "ImportedRide_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RideImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedRide" ADD CONSTRAINT "ImportedRide_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedRide" ADD CONSTRAINT "ImportedRide_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

