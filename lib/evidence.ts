import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * CHARGEBACK-DEFENSE-SPEC.md §3 — the closed set of things this app records
 * as chargeback/dispute evidence, one row per action. StatusEvent (lib/
 * orders.ts) already covers every state TRANSITION; these are the customer
 * (or system) actions that never transition anything — a download, a poster
 * pick, a re-roll, the checkout consent line, an outbound email receipt —
 * and so had nowhere else to live.
 */
export type EvidenceKind =
  | "checkout.consent"
  | "photos.submitted"
  | "treatment.approved"
  | "treatment.revision"
  | "storyboard.approved"
  | "poster.chosen"
  | "reroll.requested"
  | "refund.requested"
  | "download.film"
  | "download.social"
  | "download.poster"
  | "download.take"
  | "email.sent"
  | "rating.submitted";

/** First hop of x-forwarded-for — the customer's own IP, not a proxy hop. */
function extractIp(req: Request | undefined): string | null {
  const xff = req?.headers.get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0]?.trim() || null;
}

function extractUserAgent(req: Request | undefined): string | null {
  return req?.headers.get("user-agent") ?? null;
}

/**
 * Records one piece of chargeback-defense evidence for an order.
 *
 * MUST NEVER THROW (§7 proof 2/5): this has the exact same non-fatal posture
 * as this app's email sends (lib/mocks.ts) — losing one evidence row must
 * never break the customer-facing flow it's attached to (a status
 * transition, a download response, an approval). A failed insert is logged
 * with console.error and swallowed here; callers never see it and never
 * need to handle it.
 *
 * `req` should be passed for every customer-operated kind (so IP/UA get
 * captured) and omitted for webhook/system-triggered kinds (checkout.consent,
 * email.sent) that have no customer request to read it from.
 */
export async function recordEvidence(
  orderId: string,
  kind: EvidenceKind,
  detail?: Prisma.InputJsonValue,
  req?: Request
): Promise<void> {
  try {
    await prisma.evidenceEvent.create({
      data: {
        orderId,
        kind,
        detail: detail === undefined ? Prisma.JsonNull : detail,
        ip: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    });
  } catch (err) {
    console.error(`[evidence] failed to record kind=${kind} order=${orderId} (non-fatal)`, err);
  }
}
