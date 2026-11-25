-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "trackingToken" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "photoConsentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_trackingToken_key" ON "Booking"("trackingToken");

