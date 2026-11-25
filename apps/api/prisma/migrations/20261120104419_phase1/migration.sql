-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMin" DOUBLE PRECISION NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "driverNetCents" INTEGER NOT NULL,
    "flatRateId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
