-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "cancellationFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "driverCompensationCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flightBufferMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ref" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_driverId_createdAt_idx" ON "Notification"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ride_ref_key" ON "Ride"("ref");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Les références courtes (R-100001, …) commencent à 100001 ; les lignes existantes gardent leur numéro de série.
ALTER SEQUENCE "Ride_ref_seq" RESTART WITH 100001;
