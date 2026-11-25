CREATE TYPE "SupportStatus" AS ENUM ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED');
CREATE TYPE "SupportPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TABLE "SupportTicket" (
"id" TEXT PRIMARY KEY,"ref" SERIAL NOT NULL UNIQUE,"title" TEXT NOT NULL,"description" TEXT NOT NULL,"source" TEXT NOT NULL,"category" TEXT NOT NULL,"priority" "SupportPriority" NOT NULL,"status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
"rideId" TEXT,"driverId" TEXT,"partnerId" TEXT,"incidentId" TEXT,"accountId" TEXT,"assigneeId" TEXT,
"firstResponseDueAt" TIMESTAMP(3) NOT NULL,"resolutionDueAt" TIMESTAMP(3) NOT NULL,"firstResponseAt" TIMESTAMP(3),"resolvedAt" TIMESTAMP(3),"closedAt" TIMESTAMP(3),"resolution" TEXT,"satisfaction" INTEGER,"version" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "SupportTicket_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT "SupportTicket_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT "SupportTicket_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT "SupportTicket_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT "SupportTicket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT "SupportTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE);
CREATE INDEX "SupportTicket_status_resolutionDueAt_idx" ON "SupportTicket"("status","resolutionDueAt");
CREATE INDEX "SupportTicket_rideId_idx" ON "SupportTicket"("rideId");
CREATE TABLE "SupportEvent" ("id" TEXT PRIMARY KEY,"ticketId" TEXT NOT NULL,"kind" TEXT NOT NULL,"note" TEXT NOT NULL,"actor" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "SupportEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "SupportEvent_ticketId_createdAt_idx" ON "SupportEvent"("ticketId","createdAt");
CREATE TABLE "SupportMoney" ("id" TEXT PRIMARY KEY,"ticketId" TEXT NOT NULL UNIQUE,"kind" TEXT NOT NULL,"amountCents" INTEGER NOT NULL,"reason" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"requestedBy" TEXT NOT NULL,"requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"decidedBy" TEXT,"decidedAt" TIMESTAMP(3),"decisionReason" TEXT,CONSTRAINT "SupportMoney_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE);
