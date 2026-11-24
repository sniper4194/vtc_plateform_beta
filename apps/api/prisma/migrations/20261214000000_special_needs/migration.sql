-- Besoins particuliers du voyageur et équipements des véhicules.
ALTER TABLE "Ride" ADD COLUMN "needs" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Vehicle" ADD COLUMN "features" TEXT[] DEFAULT ARRAY[]::TEXT[];
