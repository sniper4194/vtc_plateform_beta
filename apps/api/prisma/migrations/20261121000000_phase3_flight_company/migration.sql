-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "signText" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accessKeyHash" TEXT,
ADD COLUMN     "accessKeyPrefix" TEXT,
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "suspendedBy" TEXT;

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "flightDelayMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flightEstimatedAt" TIMESTAMP(3),
ADD COLUMN     "flightStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_accessKeyHash_key" ON "Company"("accessKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_rideId_key" ON "Rating"("rideId");

