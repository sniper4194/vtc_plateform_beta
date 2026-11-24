-- CreateEnum
CREATE TYPE "LostItemStatus" AS ENUM ('OPEN', 'FOUND', 'NOT_FOUND', 'RETURNED', 'CLOSED');

-- CreateTable
CREATE TABLE "LostItem" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT,
    "description" TEXT NOT NULL,
    "status" "LostItemStatus" NOT NULL DEFAULT 'OPEN',
    "driverNote" TEXT,
    "answeredAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostItem_status_createdAt_idx" ON "LostItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LostItem_driverId_status_idx" ON "LostItem"("driverId", "status");

-- AddForeignKey
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

