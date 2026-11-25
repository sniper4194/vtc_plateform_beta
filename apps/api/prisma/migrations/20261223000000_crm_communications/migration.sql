CREATE TYPE "CrmMailStatus" AS ENUM ('DRAFT','SENDING','ACCEPTED','UNKNOWN');
CREATE TABLE "CrmEmailPermission" (
  "email" TEXT PRIMARY KEY, "allowed" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "CrmMail" (
  "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "dealId" TEXT, "kind" TEXT NOT NULL,
  "status" "CrmMailStatus" NOT NULL DEFAULT 'DRAFT', "recipient" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "actor" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "CrmMail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CrmMail_accountId_createdAt_idx" ON "CrmMail"("accountId","createdAt");
CREATE TABLE "CrmEmailTemplate" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CrmAppointment" (
  "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "title" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT, "doneAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmAppointment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CrmAppointment_startsAt_doneAt_idx" ON "CrmAppointment"("startsAt","doneAt");
CREATE INDEX "CrmAppointment_accountId_startsAt_idx" ON "CrmAppointment"("accountId","startsAt");
