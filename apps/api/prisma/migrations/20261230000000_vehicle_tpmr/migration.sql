-- Véhicule adapté TPMR : validation par la tour.
ALTER TABLE "Vehicle" ADD COLUMN "tpmrVerifiedAt" TIMESTAMP(3), ADD COLUMN "tpmrVerifiedBy" TEXT;
