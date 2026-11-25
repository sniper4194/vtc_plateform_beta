-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('DANGER', 'ACCIDENT', 'BREAKDOWN', 'CLIENT', 'PAYMENT', 'CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rideId" TEXT,
    "kind" "IncidentKind" NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "ackedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "resolution" TEXT,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_status_createdAt_idx" ON "Incident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_driverId_createdAt_idx" ON "Incident"("driverId", "createdAt");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

