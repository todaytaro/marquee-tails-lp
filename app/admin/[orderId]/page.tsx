import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApproveForm } from "./ApproveForm";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ivory">{value}</dd>
    </div>
  );
}

export default async function AdminOrderReviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { statusEvents: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) notFound();

  const awaitingReview = order.status === OrderStatus.AWAITING_ADMIN_APPROVAL;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/admin"
        className="text-xs uppercase tracking-widest text-muted transition-colors hover:text-gold"
      >
        ← Back to queue
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="font-display text-4xl tracking-wide text-ivory">
          {(order.petName ?? "UNNAMED PET").toUpperCase()}
        </h1>
        <span
          className={`rounded-[var(--radius-chip)] border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
            awaitingReview
              ? "border-gold/50 bg-gold/10 text-gold"
              : "border-hairline bg-surface text-muted"
          }`}
        >
          {order.status}
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* -------- Left column: media + approval -------- */}
        <div className="space-y-6">
          {/* Final video */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              FINAL VIDEO
            </h2>
            {order.finalVideoUrl ? (
              /* eslint-disable-next-line jsx-a11y/media-has-caption */
              <video
                controls
                preload="metadata"
                src={order.finalVideoUrl}
                className="w-full rounded-[var(--radius-chip)] border border-hairline bg-night"
              />
            ) : (
              <p className="text-sm text-muted">
                No final video yet — the pipeline has not delivered.
              </p>
            )}
          </section>

          {/* Approve form — Gate 2 */}
          {awaitingReview && (
            <section className="rounded-[var(--radius-card)] border border-gold/30 bg-surface p-4">
              <h2 className="mb-1 font-display text-xl tracking-wide text-gold">
                GATE 2 — APPROVE &amp; DELIVER
              </h2>
              <p className="mb-3 text-xs text-muted">
                Approving completes the order, sends the delivery email and
                places the POD order. This cannot be undone.
              </p>
              <ApproveForm orderId={order.id} />
            </section>
          )}

          {/* Selected concept still */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              APPROVED CONCEPT STILL
            </h2>
            {order.selectedImageUrl ? (
              // Plain <img>: concept URLs are external, avoids remote-domain config.
              <img
                src={order.selectedImageUrl}
                alt={`Concept still approved by the customer for ${order.petName ?? "this order"}`}
                className="w-full max-w-md rounded-[var(--radius-chip)] border border-hairline"
              />
            ) : (
              <p className="text-sm text-muted">
                No still selected yet (pre Gate 1).
              </p>
            )}
          </section>

          {/* Customer reference photos */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              CUSTOMER PHOTOS
              <span className="ml-2 align-middle text-xs font-sans tracking-normal text-muted">
                {order.uploadedPhotoUrls.length} uploaded
              </span>
            </h2>
            {order.uploadedPhotoUrls.length === 0 ? (
              <p className="text-sm text-muted">No photos uploaded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {order.uploadedPhotoUrls.map((url, i) => (
                  // Plain <img>: customer uploads live on external storage.
                  <img
                    key={url}
                    src={url}
                    alt={`Customer reference photo ${i + 1} of ${order.petName ?? "the pet"}`}
                    className="h-24 w-24 rounded-[var(--radius-chip)] border border-hairline object-cover"
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* -------- Right column: metadata + audit trail -------- */}
        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              ORDER
            </h2>
            <dl className="space-y-3">
              <Meta label="Order ID" value={<span className="font-mono text-xs">{order.id}</span>} />
              <Meta
                label="Shopify order"
                value={<span className="font-mono text-xs">{order.shopifyOrderId}</span>}
              />
              <Meta label="Customer" value={order.customerEmail} />
              <Meta
                label="World"
                value={
                  <span className="uppercase tracking-wider text-gold/80">
                    {order.world ?? "—"}
                  </span>
                }
              />
              <Meta label="Created" value={timeFormat.format(order.createdAt)} />
              <Meta label="Updated" value={timeFormat.format(order.updatedAt)} />
              {order.adminNote && <Meta label="Admin note" value={order.adminNote} />}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              AUDIT TRAIL
            </h2>
            {order.statusEvents.length === 0 ? (
              <p className="text-sm text-muted">No transitions recorded.</p>
            ) : (
              <ol className="space-y-3">
                {order.statusEvents.map((event) => (
                  <li
                    key={event.id}
                    className="border-l-2 border-hairline pl-3 text-xs"
                  >
                    <p className="text-ivory">
                      <span className="font-semibold uppercase tracking-wider text-gold/80">
                        {event.actor}
                      </span>{" "}
                      <span className="text-muted">{event.from}</span>
                      {" → "}
                      <span>{event.to}</span>
                    </p>
                    {event.note && <p className="mt-0.5 text-muted">{event.note}</p>}
                    <p className="mt-0.5 text-muted/80">
                      {timeFormat.format(event.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
