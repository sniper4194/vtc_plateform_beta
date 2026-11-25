-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "hostedAddress" TEXT,
ADD COLUMN     "hostedCodeHash" TEXT,
ADD COLUMN     "hostedEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hostedLat" DOUBLE PRECISION,
ADD COLUMN     "hostedLng" DOUBLE PRECISION,
ADD COLUMN     "hostedPlaceLabel" TEXT,
ADD COLUMN     "hostedSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Partner_hostedSlug_key" ON "Partner"("hostedSlug");

