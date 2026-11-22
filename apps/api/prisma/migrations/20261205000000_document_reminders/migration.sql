-- CreateTable
CREATE TABLE "DocumentReminder" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReminder_documentId_threshold_key" ON "DocumentReminder"("documentId", "threshold");

-- AddForeignKey
ALTER TABLE "DocumentReminder" ADD CONSTRAINT "DocumentReminder_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

