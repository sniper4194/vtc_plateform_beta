-- Photos-preuves du chauffeur sur place (client absent, bagages en excès).
CREATE TYPE "ProofKind" AS ENUM ('NO_SHOW', 'EXCESS_LUGGAGE', 'OTHER');

CREATE TABLE "RideProof" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "kind" "ProofKind" NOT NULL,
    "note" TEXT,
    "mime" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceTakenAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "address" TEXT,
    "distanceToPickupM" INTEGER NOT NULL,
    "flags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RideProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RideProof_rideId_receivedAt_idx" ON "RideProof"("rideId", "receivedAt");

ALTER TABLE "RideProof" ADD CONSTRAINT "RideProof_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RideProof" ADD CONSTRAINT "RideProof_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
