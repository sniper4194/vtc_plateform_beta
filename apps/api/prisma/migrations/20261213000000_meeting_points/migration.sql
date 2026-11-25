-- Points de rendez-vous photographiés par les chauffeurs, validés par l'équipe, montrés au voyageur.
CREATE TYPE "MeetingPointStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "MeetingPoint" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "mime" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "status" "MeetingPointStatus" NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingPoint_status_idx" ON "MeetingPoint"("status");
