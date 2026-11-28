-- Confirmation d'encaissement des courses payées à bord.
CREATE TYPE "OnBoardPayment" AS ENUM ('PAID', 'ISSUE');
ALTER TABLE "Ride" ADD COLUMN "onBoardPayment" "OnBoardPayment",
  ADD COLUMN "onBoardPaymentReason" TEXT,
  ADD COLUMN "onBoardPaymentNote" TEXT,
  ADD COLUMN "onBoardPaymentAt" TIMESTAMP(3),
  ADD COLUMN "onBoardPaymentResolvedAt" TIMESTAMP(3),
  ADD COLUMN "onBoardPaymentResolvedBy" TEXT,
  ADD COLUMN "onBoardPaymentResolution" TEXT;
