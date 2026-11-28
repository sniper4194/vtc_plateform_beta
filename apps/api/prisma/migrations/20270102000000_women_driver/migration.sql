-- CliCab Women : conductrice déclarée puis validée par la tour.
ALTER TABLE "Driver" ADD COLUMN "womanDeclaredAt" TIMESTAMP(3), ADD COLUMN "womanVerifiedAt" TIMESTAMP(3), ADD COLUMN "womanVerifiedBy" TEXT;
