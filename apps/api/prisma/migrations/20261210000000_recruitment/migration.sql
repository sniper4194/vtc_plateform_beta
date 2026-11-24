-- Parcours de candidature : parrainage, vérifications, tests, décision.
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "Driver" ADD COLUMN "sponsorId" TEXT;

CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerDriverId" TEXT,
    "label" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "issuedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL,
    "otherPlatforms" JSONB,
    "referralCodeId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "cardProValidUntil" TIMESTAMP(3),
    "licenceCheckedAt" TIMESTAMP(3),
    "licenceCheckedBy" TEXT,
    "licencePointsOk" BOOLEAN,
    "licenceNoSuspension" BOOLEAN,
    "honorStatementAt" TIMESTAMP(3),
    "frenchScore" INTEGER,
    "englishLevel" TEXT,
    "ethicsScore" INTEGER,
    "testsBy" TEXT,
    "testsAt" TIMESTAMP(3),
    "interviewNotes" TEXT,
    "interviewAt" TIMESTAMP(3),
    "interviewBy" TEXT,
    "decisionReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "driverId" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE UNIQUE INDEX "Application_driverId_key" ON "Application"("driverId");
CREATE INDEX "Application_status_idx" ON "Application"("status");
CREATE INDEX "Application_phone_idx" ON "Application"("phone");
CREATE INDEX "Application_email_idx" ON "Application"("email");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_ownerDriverId_fkey" FOREIGN KEY ("ownerDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
