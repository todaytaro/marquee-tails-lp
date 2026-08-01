import Link from "next/link";
import { Suspense } from "react";
import { Prisma, OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeStoryboard, NUM_CUTS, TAKES_PER_CUT } from "@/lib/stills-pipeline";
import { RetryFilmButton } from "./RetryFilmButton";
import { AdminSearch } from "./AdminSearch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — Marquee Tails",
};

/* ------------------------------------------------------------------ */
/* Helpers (server-side)                                               */
/* ------------------------------------------------------------------ */

function formatAge(date: Date, now: number): string {
  const mins = Math.floor((now - date.getTime()) / 60_000);
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

/**
 * Japanese label for every OrderStatus — used by StatusOrderRow (progress
 * queue + search results) so raw enum values never leak into the UI.
 */
const STATUS_LABELS: Record<OrderStatus, string> = {
  UPLOADING: "写真アップ待ち",
  TREATMENT_GENERATING: "台本生成中（Director's Cut）",
  AWAITING_TREATMENT_APPROVAL: "Gate0 台本承認待ち（Director's Cut）",
  IMAGE_GENERATING: "スチル生成中",
  AWAITING_CUSTOMER_APPROVAL: "Gate1 顧客承認待ち",
  VIDEO_GENERATING: "制作中",
  AWAITING_ADMIN_APPROVAL: "Gate2 レビュー待ち",
  COMPLETED: "完了",
  FAILED: "失敗",
  CANCELLED: "キャンセル",
};

/** Statuses where a long-running age means the *customer* is stalling. */
const CUSTOMER_STALL_STATUSES: OrderStatus[] = [
  OrderStatus.UPLOADING,
  OrderStatus.AWAITING_CUSTOMER_APPROVAL,
  // Gate 0 is a customer-side wait too: a Director's Cut sitting here is a
  // paying customer who hasn't approved their treatment yet.
  OrderStatus.AWAITING_TREATMENT_APPROVAL,
];

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

/** Amber "滞留" badge — customer-side stall (UPLOADING / AWAITING_CUSTOMER_APPROVAL) past 24h. */
function stallBadge(status: OrderStatus, date: Date, now: number) {
  if (!CUSTOMER_STALL_STATUSES.includes(status)) return null;
  const hours = (now - date.getTime()) / 3_600_000;
  if (hours <= 24) return null;
  return (
    <span className="rounded-[var(--radius-chip)] border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-400">
      滞留
    </span>
  );
}

/**
 * Same completeness test approveStoryboardAction guards on
 * (app/admin/actions.ts): six cuts, three takes each. Anything short of that
 * is genuinely still generating, not waiting on a human.
 */
function hasFullStoryboard(order: Order): boolean {
  const cuts = normalizeStoryboard(order.storyboardOptions);
  return (
    cuts.length >= NUM_CUTS &&
    cuts.slice(0, NUM_CUTS).every((cut) => cut.options.length >= TAKES_PER_CUT)
  );
}

/**
 * The label for a row, which for IMAGE_GENERATING depends on WHICH half of
 * that status the order is in. STORYBOARD-ADMIN-GATE-SPEC.md §2 deliberately
 * added no enum value: an order whose storyboard is finished but not yet
 * approved stays IMAGE_GENERATING, and the presence of storyboardOptions IS
 * the review queue. That keeps the customer's waiting screen correct with no
 * new state, but it leaves this list calling a finished storyboard "スチル生成中"
 * — the one status where the owner is the blocker, shown as the one thing
 * that needs no attention. The alert email is not enough on its own: it is a
 * single message that can be missed, and this list is where the day's work is
 * actually read.
 */
function statusLabel(order: Order): string {
  if (order.status === OrderStatus.IMAGE_GENERATING && hasFullStoryboard(order)) {
    return "絵コンテ確認待ち（あなた）";
  }
  return STATUS_LABELS[order.status];
}

/**
 * Row variant that shows the JP status label (A-1's progress queue, and A-2's
 * search results where orders can be in any status). Unlike OrderRow this
 * doesn't assume a single fixed status per section.
 */
function StatusOrderRow({ order, now }: { order: Order; now: number }) {
  return (
    <li>
      <Link
        href={`/admin/${order.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-gold/5"
      >
        <span className="min-w-28 font-medium text-ivory">
          {order.petName ?? "（名前未設定）"}
        </span>
        <span className="min-w-40 text-xs tracking-wider text-gold/80">
          {statusLabel(order)}
        </span>
        <span className="min-w-48 text-muted">{order.customerEmail}</span>
        <span className="ml-auto flex items-center gap-2">
          {stallBadge(order.status, order.updatedAt, now)}
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
          {order.petName ?? "（名前未設定）"}
        </span>
        <span className="min-w-20 text-xs uppercase tracking-wider text-gold/80">
          {order.world ?? "—"}
        </span>
        <span className="min-w-48 text-muted">{order.customerEmail}</span>
        <span className="font-mono text-xs text-muted">
          {order.stripeSessionId}
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

/**
 * FAILED row: unlike OrderRow this can't be a single full-row <Link> — the
 * retry button needs its own click target (a <button> inside an <a> is
 * invalid HTML and would also trigger navigation). So the name/meta link to
 * the detail page and the retry action sit side by side.
 */
function FailedOrderRow({ order, now }: { order: Order; now: number }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5 text-sm last:border-b-0">
      <Link
        href={`/admin/${order.id}`}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 transition-colors hover:text-gold"
      >
        <span className="min-w-28 font-medium text-ivory">
          {order.petName ?? "（名前未設定）"}
        </span>
        <span className="min-w-20 text-xs uppercase tracking-wider text-gold/80">
          {order.world ?? "—"}
        </span>
        <span className="min-w-48 text-muted">{order.customerEmail}</span>
        {order.failureReason && (
          <span className="min-w-0 flex-1 truncate text-xs text-red-400" title={order.failureReason}>
            {order.failureReason}
          </span>
        )}
        <span className="text-xs text-muted">{formatAge(order.updatedAt, now)}</span>
      </Link>
      <RetryFilmButton orderId={order.id} />
    </li>
  );
}

function Section({
  title,
  count,
  accent,
  danger,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <h2
          className={`font-display text-2xl tracking-wide ${
            danger ? "text-red-400" : accent ? "text-gold gold-glow-text" : "text-ivory"
          }`}
        >
          {title}
        </h2>
        <span className="text-xs text-muted">{count}件</span>
      </div>
      <div
        className={`rounded-[var(--radius-card)] border bg-surface ${
          danger ? "border-red-500/40" : "border-hairline"
        }`}
      >
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

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const [failed, reviewQueue, inProgressQueue, inProduction, recentlyCompleted, searchResults] =
    await Promise.all([
      prisma.order.findMany({
        where: { status: OrderStatus.FAILED },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.order.findMany({
        where: { status: OrderStatus.AWAITING_ADMIN_APPROVAL },
        orderBy: { updatedAt: "asc" }, // oldest = most urgent first
      }),
      prisma.order.findMany({
        where: {
          status: {
            in: [
              OrderStatus.UPLOADING,
              OrderStatus.IMAGE_GENERATING,
              OrderStatus.AWAITING_CUSTOMER_APPROVAL,
              // B1's Gate 0 states. Without these a Director's Cut is
              // invisible to ops for the whole treatment phase — the $249
              // plan, during the one stage where the customer is most likely
              // to stall or churn on revisions.
              OrderStatus.TREATMENT_GENERATING,
              OrderStatus.AWAITING_TREATMENT_APPROVAL,
            ],
          },
        },
        orderBy: { updatedAt: "asc" }, // most-stalled first
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
      query
        ? prisma.order.findMany({
            where: {
              OR: [
                { customerEmail: { contains: query, mode: Prisma.QueryMode.insensitive } },
                { petName: { contains: query, mode: Prisma.QueryMode.insensitive } },
                { id: { contains: query, mode: Prisma.QueryMode.insensitive } },
                { stripeSessionId: { contains: query, mode: Prisma.QueryMode.insensitive } },
              ],
            },
            orderBy: { updatedAt: "desc" },
          })
        : Promise.resolve(null),
    ]);

  // eslint-disable-next-line react-hooks/purity -- server component rendered per-request; wall-clock read is intentional (SLA age badges)
  const now = Date.now();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-ivory">
            MARQUEE TAILS — 管理
          </h1>
          <p className="mt-1 text-sm text-muted">
            Gate 2 レビューデスク。48時間SLA：36時間で黄、44時間で赤のバッジが付きます。
          </p>
        </div>
        <Link
          href="/admin/logout"
          prefetch={false}
          className="mt-1 shrink-0 text-xs uppercase tracking-wider text-muted transition-colors hover:text-gold"
        >
          ログアウト
        </Link>
      </header>

      <div className="mb-8">
        <Suspense fallback={null}>
          <AdminSearch />
        </Suspense>
      </div>

      <div className="space-y-8">
        {searchResults !== null && (
          <Section title="検索結果" count={searchResults.length} accent>
            {searchResults.length === 0 ? (
              <EmptyRow label="該当なし" />
            ) : (
              <ul>
                {searchResults.map((order) => (
                  <StatusOrderRow key={order.id} order={order} now={now} />
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title="失敗（要対応）" count={failed.length} danger>
          {failed.length === 0 ? (
            <EmptyRow label="失敗した注文はありません。" />
          ) : (
            <ul>
              {failed.map((order) => (
                <FailedOrderRow key={order.id} order={order} now={now} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="レビュー待ち" count={reviewQueue.length} accent>
          {reviewQueue.length === 0 ? (
            <EmptyRow label="レビュー待ちの注文はありません。" />
          ) : (
            <ul>
              {reviewQueue.map((order) => (
                <OrderRow key={order.id} order={order} now={now} sla />
              ))}
            </ul>
          )}
        </Section>

        <Section title="顧客・生成待ち（進行中）" count={inProgressQueue.length}>
          {inProgressQueue.length === 0 ? (
            <EmptyRow label="進行中の注文はありません。" />
          ) : (
            <ul>
              {inProgressQueue.map((order) => (
                <StatusOrderRow key={order.id} order={order} now={now} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="制作中" count={inProduction.length}>
          {inProduction.length === 0 ? (
            <EmptyRow label="生成中の動画はありません。" />
          ) : (
            <ul>
              {inProduction.map((order) => (
                <OrderRow key={order.id} order={order} now={now} sla={false} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="完了（直近）" count={recentlyCompleted.length}>
          {recentlyCompleted.length === 0 ? (
            <EmptyRow label="完了した注文はまだありません。" />
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
