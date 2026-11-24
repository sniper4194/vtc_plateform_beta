-- Lignes orphelines éventuelles (bases de test) avant de poser les contraintes
DELETE FROM "ReferralReward" WHERE "rideId" NOT IN (SELECT id FROM "Ride") OR "sponsorId" NOT IN (SELECT id FROM "Driver") OR "filleulId" NOT IN (SELECT id FROM "Driver");

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_filleulId_fkey" FOREIGN KEY ("filleulId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

