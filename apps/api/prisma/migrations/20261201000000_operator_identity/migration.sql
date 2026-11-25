-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "proCardNumber" TEXT,
ADD COLUMN     "revtcNumber" TEXT,
ADD COLUMN     "siret" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "collector" BOOLEAN NOT NULL DEFAULT false;

