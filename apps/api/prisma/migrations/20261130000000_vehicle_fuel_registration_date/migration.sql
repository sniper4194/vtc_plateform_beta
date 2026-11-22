-- CreateEnum
CREATE TYPE "VehicleFuel" AS ENUM ('THERMAL', 'HYBRID', 'ELECTRIC');

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "firstRegistrationYear",
ADD COLUMN     "firstRegistrationAt" TIMESTAMP(3),
ADD COLUMN     "fuel" "VehicleFuel";

