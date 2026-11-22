-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "trackingSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "notifyPassenger" BOOLEAN NOT NULL DEFAULT true;

