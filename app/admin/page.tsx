import Link from "next/link";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — Marquee Tails",
};

/* ------------------------------------------------------------------ */
/* Helpers (server-side)                                               */
/* ------------------------------------------------------------------ */

function formatAge(date: Date, now: number): string {
  const mins = Math.floor((now - date.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** 48h SLA per business rules: amber past 36h, red past 44h. */
function slaBadge(date: Date, now: number) {
  const hours = (now - date.getTime()) / 3_600_000;
  if (hours > 44) {
    return (
      <span className="rounded-[var(--radius-chip)] border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-red-400">
        48H SLA
      </span>
    );
  }
  if (hours > 36) {
    return (
      <span className="rounded-[var(--radius-chip)] border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-400">
        36H+
      </span>
    );
  }
  return null;
}

function OrderRow({
  order,
  now,
  sla,
}: {
  order: Order;
  now: number;
  sla: boolean;
}) {
  return (
    <li>
      <Link
        href={`/admin/${order.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-gold/5"
      >
        <span className="min-w-28 font-medium text-ivory">
          {order.petName ?? "(no pet name)"}
        </span>
        <span className="min-w-20 text-xs uppercase tracking-wider text-gold/80">
          {order.world ?? "—"}
        </span>
        <span className="min-w-48 text-muted">{order.customerEmail}</span>
        <span className="font-mono text-xs text-muted">
          {order.shopifyOrderId}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {sla && slaBadge(order.updatedAt, now)}
          <span className="text-xs text-muted">
            {formatAge(order.updatedAt, now)}
          </span>
          <span aria-hidden className="text-gold/60">
            →
          </span>
        </span>
      </Link>
    </li>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <h2
          className={`font-display text-2xl tracking-wide ${accent ? "text-gold gold-glow-text" : "text-ivory"}`}
        >
          {title}
        </h2>
        <span className="text-xs text-muted">
          {count} {count === 1 ? "order" : "orders"}
        </span>
      </div>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface">
        {children}
      </div>
    </section>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-4 py-3 text-sm text-muted">{label}</p>;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function AdminDashboardPage() {
  const [reviewQueue, inProduction, recentlyCompleted] = await Promise.all([
    prisma.order.findMany({
      where: { status: OrderStatus.AWAITING_ADMIN_APPROVAL },
      orderBy: { updatedAt: "asc" }, // oldest = most urgent first
    }),
    prisma.order.findMany({
      where: { status: OrderStatus.VIDEO_GENERATING },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.order.findMany({
      where: { status: OrderStatus.COMPLETED },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const now = Date.now();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-display text-4xl tracking-wide text-ivory">
          MARQUEE TAILS — ADMIN
        </h1>
        <p className="mt-1 text-sm text-muted">
          Gate 2 review desk. 48h SLA: rows flag amber at 36h, red at 44h.
        </p>
      </header>

      <div className="space-y-8">
        <Section title="REVIEW QUEUE" count={reviewQueue.length} accent>
          {reviewQueue.length === 0 ? (
            <EmptyRow label="Nothing awaiting review." />
          ) : (
            <ul>
              {reviewQueue.map((order) => (
                <OrderRow key={order.id} order={order} now={now} sla />
              ))}
            </ul>
          )}
        </Section>

        <Section title="IN PRODUCTION" count={inProduction.length}>
          {inProduction.length === 0 ? (
            <EmptyRow label="No videos generating." />
          ) : (
            <ul>
              {inProduction.map((order) => (
                <OrderRow key={order.id} order={order} now={now} sla={false} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="RECENTLY COMPLETED" count={recentlyCompleted.length}>
          {recentlyCompleted.length === 0 ? (
            <EmptyRow label="No completed orders yet." />
          ) : (
            <ul>
              {recentlyCompleted.map((order) => (
                <OrderRow key={order.id} order={order} now={now} sla={false} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
