CREATE TYPE "CrmStage" AS ENUM ('PROSPECT','CONTACTED','OFFER','NEGOTIATION','WON','LOST');
CREATE TYPE "CrmKind" AS ENUM ('HOTEL','COMPANY','AGENCY','CONCIERGE','OTHER');
CREATE TYPE "CrmInteractionKind" AS ENUM ('CALL','EMAIL','MEETING','NOTE');
CREATE TABLE "CrmAccount" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "kind" "CrmKind" NOT NULL DEFAULT 'OTHER',
  "stage" "CrmStage" NOT NULL DEFAULT 'PROSPECT',
  "contactName" TEXT, "email" TEXT, "phone" TEXT,
  "nextAction" TEXT, "nextActionAt" TIMESTAMP(3),
  "partnerId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmAccount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmAccount_partnerId_key" ON "CrmAccount"("partnerId");
CREATE INDEX "CrmAccount_stage_nextActionAt_idx" ON "CrmAccount"("stage","nextActionAt");
CREATE TABLE "CrmInteraction" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "kind" "CrmInteractionKind" NOT NULL, "note" TEXT NOT NULL, "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmInteraction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CrmInteraction_accountId_createdAt_idx" ON "CrmInteraction"("accountId","createdAt");
