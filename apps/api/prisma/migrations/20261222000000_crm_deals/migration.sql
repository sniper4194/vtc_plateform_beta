CREATE TYPE "CrmDealStatus" AS ENUM ('DRAFT','SENT','ACCEPTED','REJECTED','SIGNED');
CREATE TABLE "CrmDeal" (
  "id" TEXT NOT NULL, "ref" SERIAL NOT NULL, "accountId" TEXT NOT NULL,
  "status" "CrmDealStatus" NOT NULL DEFAULT 'DRAFT',
  "issuerName" TEXT NOT NULL, "issuerAddress" TEXT NOT NULL, "issuerSiret" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL, "recipientAddress" TEXT NOT NULL,
  "description" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "unitCents" INTEGER NOT NULL, "vatBps" INTEGER NOT NULL,
  "priceMultiplier" DECIMAL(5,4) NOT NULL, "terms" TEXT NOT NULL, "validUntil" DATE NOT NULL,
  "sentAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "signedAt" TIMESTAMP(3), "contractRef" TEXT,
  "startsOn" DATE, "endsOn" DATE, "renewalOn" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmDeal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmDeal_ref_key" ON "CrmDeal"("ref");
CREATE INDEX "CrmDeal_accountId_createdAt_idx" ON "CrmDeal"("accountId","createdAt");
CREATE INDEX "CrmDeal_status_renewalOn_idx" ON "CrmDeal"("status","renewalOn");
