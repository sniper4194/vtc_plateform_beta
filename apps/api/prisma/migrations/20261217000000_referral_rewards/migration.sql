-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "filleulId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_rideId_key" ON "ReferralReward"("rideId");

-- CreateIndex
CREATE INDEX "ReferralReward_sponsorId_createdAt_idx" ON "ReferralReward"("sponsorId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralReward_filleulId_idx" ON "ReferralReward"("filleulId");

