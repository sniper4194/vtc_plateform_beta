-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "driverCapCents" INTEGER NOT NULL DEFAULT 0;


-- Les missions existantes n'ont pas d'échelle de prix : leur plafond est leur rémunération actuelle.
UPDATE "Ride" SET "driverCapCents" = "driverNetCents";
