-- AlterEnum
ALTER TYPE "IdentityKind" ADD VALUE 'SPOT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IdentityStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "IdentityStatus" ADD VALUE 'MISSED';

-- AlterTable
ALTER TABLE "IdentityCheck" ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "requestedBy" TEXT,
ALTER COLUMN "mime" DROP NOT NULL,
ALTER COLUMN "image" DROP NOT NULL;

