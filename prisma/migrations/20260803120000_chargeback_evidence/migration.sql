-- CHARGEBACK-DEFENSE-SPEC.md §3 — EvidenceEvent, StatusEvent's sibling for
-- non-transition customer actions (downloads, poster picks, re-rolls, the
-- checkout consent line, outbound email receipts). NOT APPLIED by this
-- change — DATABASE_URL points at production Supabase; the owner runs this
-- by hand (e.g. `npx prisma migrate deploy`) when ready.

-- CreateTable
CREATE TABLE "EvidenceEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceEvent_orderId_idx" ON "EvidenceEvent"("orderId");

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
