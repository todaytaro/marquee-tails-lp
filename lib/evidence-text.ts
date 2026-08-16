import type { Order, StatusEvent } from "@/generated/prisma/client";
import { REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";

/**
 * CHARGEBACK-DEFENSE-SPEC.md §4 — the admin dashboard's "dispute evidence
 * pack": a merged, chronological timeline of every StatusEvent (state
 * transitions) and EvidenceEvent (everything else — consent, downloads,
 * picks, re-rolls, emails) for one order, plus a plain-English summary the
 * owner can paste straight into Stripe's dispute-response form (§4 —
 * "含めるもの: 注文ID・商品説明・金額・同意記録・顧客の全操作（時刻・IP付き）
 * ・納品とダウンロードの記録・承認済み絵コンテのURL").
 *
 * Deliberately plain data-shaping functions with no Prisma import beyond
 * types: app/admin/[orderId]/page.tsx (a server component) already has the
 * order + both event lists loaded, so this just formats what's already on
 * the page — no new API route needed (per spec).
 */

export type EvidenceEventLite = {
  id: string;
  kind: string;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type TimelineEntry = {
  time: Date;
  actor: string; // "customer" | "admin" | "system"
  kind: string; // e.g. "IMAGE_GENERATING → AWAITING_CUSTOMER_APPROVAL" or "reroll.requested"
  detailLine: string | null; // one-line, human-readable rendering of `detail`/`note`
  ip: string | null;
};

// EvidenceEvent has no `actor` column (CHARGEBACK-DEFENSE-SPEC.md §3's schema
// is intentionally minimal) — these are the kinds a CUSTOMER action produces;
// everything else in the closed EvidenceKind set (checkout.consent, recorded
// from the Stripe webhook; email.sent, recorded by this app's own send
// functions) is a system action.
const CUSTOMER_EVIDENCE_KINDS = new Set([
  "photos.submitted",
  "treatment.approved",
  "treatment.revision",
  "storyboard.approved",
  "poster.chosen",
  "reroll.requested",
  "refund.requested",
  "download.film",
  // Retired kind, kept deliberately: nothing writes it any more (the 9:16 cut
  // is gone — lib/evidence.ts), but rows recorded before that are still in the
  // table and still need to render as customer actions rather than system ones.
  "download.social",
  "download.poster",
  "download.take",
  // Both are things the CUSTOMER does on the premiere page. rating.submitted
  // was missing here when the rating shipped, so every rating rendered as a
  // "system" action — which is exactly backwards for the one evidence row that
  // is the customer's own statement about the delivered product.
  "rating.submitted",
  "share.consent",
]);

function evidenceActor(kind: string): string {
  return CUSTOMER_EVIDENCE_KINDS.has(kind) ? "customer" : "system";
}

/** One-line, human-readable rendering of an EvidenceEvent's JSON `detail`. */
function detailLine(kind: string, detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail !== "object") return String(detail);
  const d = detail as Record<string, unknown>;
  switch (kind) {
    case "checkout.consent":
      return `tier=${d.tier ?? "?"}, consent="${d.consentText ?? ""}"`;
    case "photos.submitted":
      return `${d.count ?? "?"} photo(s)`;
    case "treatment.approved":
      return "approved treatment as written";
    case "treatment.revision":
      return `instruction: "${d.instruction ?? ""}"`;
    case "storyboard.approved":
      return `poster scene = cut ${typeof d.posterCutIndex === "number" ? d.posterCutIndex + 1 : "?"}`;
    case "poster.chosen":
      return `chose ${d.posterUrl ?? "?"}`;
    case "reroll.requested":
      return `cut ${typeof d.cutIndex === "number" ? d.cutIndex + 1 : "?"}, re-roll #${d.rerollNumber ?? "?"}`;
    case "refund.requested":
      return `read: "${d.consentText ?? ""}"`;
    case "download.take":
      return `cut ${typeof d.cut === "number" ? d.cut + 1 : "?"}, take ${typeof d.take === "number" ? d.take + 1 : "?"}`;
    case "share.consent":
      // Reads as a state, not an event: "may post the film, not the photos".
      return `film ${d.film ? "yes" : "no"} / photos ${d.photos ? "yes" : "no"}`;
    case "download.film":
    case "download.social":
    case "download.poster":
      return d.filename ? String(d.filename) : null;
    case "email.sent":
      return `"${d.template ?? "?"}" -> ${d.to ?? "?"}${d.resendMessageId ? ` (Resend id ${d.resendMessageId})` : ""}`;
    default:
      try {
        return JSON.stringify(d);
      } catch {
        return null;
      }
  }
}

export function buildTimeline(
  statusEvents: Pick<StatusEvent, "from" | "to" | "actor" | "note" | "createdAt">[],
  evidenceEvents: EvidenceEventLite[]
): TimelineEntry[] {
  const fromStatus: TimelineEntry[] = statusEvents.map((e) => ({
    time: e.createdAt,
    actor: e.actor,
    kind: `${e.from} → ${e.to}`,
    detailLine: e.note ?? null,
    ip: null,
  }));
  const fromEvidence: TimelineEntry[] = evidenceEvents.map((e) => ({
    time: e.createdAt,
    actor: evidenceActor(e.kind),
    kind: e.kind,
    detailLine: detailLine(e.kind, e.detail),
    ip: e.ip,
  }));
  return [...fromStatus, ...fromEvidence].sort((a, b) => a.time.getTime() - b.time.getTime());
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

/**
 * Plain-English text, ready to paste into Stripe's dispute-response form
 * (§4 — "そのまま貼れる英語のプレーンテキスト"). §7 proof 6: this always
 * includes the consent record (or its absence), the full customer operation
 * timeline, and the download/delivery records — proof that all three appear.
 */
export function buildEvidenceText(
  order: Order,
  timeline: TimelineEntry[],
  consentEvent: EvidenceEventLite | null
): string {
  const lines: string[] = [];
  lines.push("MARQUEE TAILS — CHARGEBACK / DISPUTE EVIDENCE");
  lines.push("");
  lines.push(`Order ID: ${order.id}`);
  lines.push(`Stripe Checkout Session: ${order.stripeSessionId}`);
  lines.push(`Customer: ${order.customerEmail}`);
  lines.push(
    `Product: made-to-order AI-generated pet movie trailer + digital poster (${order.tier === "custom" ? "Director's Cut, $249" : "Preset Worlds, $159"}), tier=${order.tier ?? "unknown"}`
  );
  lines.push(
    `Amount charged: ${order.amountPaidCents != null ? `$${(order.amountPaidCents / 100).toFixed(2)}` : "unknown"}`
  );
  lines.push(`Order status: ${order.status}`);
  lines.push("");

  lines.push("PRE-PURCHASE CONSENT");
  if (consentEvent) {
    const d = (consentEvent.detail ?? {}) as Record<string, unknown>;
    lines.push(`Accepted at checkout, ${dateFmt.format(consentEvent.createdAt)}.`);
    if (d.consentText) lines.push(`Consent text shown and accepted: "${d.consentText}"`);
  } else {
    lines.push(
      "NO CONSENT RECORD ON FILE for this order (pre-dates consent recording, or the record failed to write)."
    );
  }
  lines.push("");

  lines.push("CUSTOMER OPERATION TIMELINE (chronological; IP shown where captured)");
  if (timeline.length === 0) {
    lines.push("No recorded events.");
  } else {
    for (const entry of timeline) {
      const ipPart = entry.ip ? `, IP ${entry.ip}` : "";
      const detailPart = entry.detailLine ? ` — ${entry.detailLine}` : "";
      lines.push(`${dateFmt.format(entry.time)} [${entry.actor}] ${entry.kind}${detailPart}${ipPart}`);
    }
  }
  lines.push("");

  if (order.chosenStills.length > 0) {
    lines.push("APPROVED STORYBOARD (Gate 1, one still per cut, customer-selected):");
    order.chosenStills.forEach((url, i) => lines.push(`  Cut ${i + 1}: ${url}`));
    lines.push("");
  }

  if (order.refundRequestedAt) {
    lines.push(
      `This order's customer requested the Director's Cut pre-production safety-net refund ($${REFUND_AMOUNT_USD} of the $249 price; the $${NONREFUNDABLE_FEE_USD} concept & storyboard fee is disclosed as non-refundable before purchase) on ${dateFmt.format(order.refundRequestedAt)}.`
    );
    if (order.refundIssuedAt) {
      lines.push(`That refund was issued on ${dateFmt.format(order.refundIssuedAt)}.`);
    }
    lines.push("");
  }

  lines.push(
    "Every step above required the customer to actively use a private, tokenized link emailed only to them; nothing in this order proceeded without an explicit customer action."
  );

  return lines.join("\n");
}
