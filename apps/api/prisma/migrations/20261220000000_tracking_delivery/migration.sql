CREATE TYPE "TrackingChannel" AS ENUM ('SMS', 'EMAIL');

CREATE TABLE "TrackingDelivery" (
    "rideId" TEXT NOT NULL,
    "channel" "TrackingChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sandbox" BOOLEAN NOT NULL,

    CONSTRAINT "TrackingDelivery_pkey" PRIMARY KEY ("rideId", "channel"),
    CONSTRAINT "TrackingDelivery_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TrackingDelivery_status_nextAttemptAt_idx" ON "TrackingDelivery"("status", "nextAttemptAt");
