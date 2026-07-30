import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApproveForm } from "./ApproveForm";
import { RerenderShotButton } from "./RerenderShotButton";
import { RetryFilmButton } from "../RetryFilmButton";
import { RekickGenerationButton } from "../RekickGenerationButton";
import { CopyLinkButton } from "./CopyLinkButton";
import { ResubmitPodButton } from "./ResubmitPodButton";
import { ResendEmailButton } from "./ResendEmailButton";
import MoviePosterOverlay from "@/components/MoviePosterOverlay";
import { resolveWorld, type WorldBundle } from "@/lib/film-script";

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

// Mirror of lib/film-pipeline CLIP_IDENTITY_THRESHOLD — any shot below this is
// flagged as drift ("this cut may not read as the customer's pet").
const DRIFT_THRESHOLD = 75;
const STRONG_THRESHOLD = 85;

/** Traffic-light classes for an identity score (null = not scored yet). */
function scoreClasses(score: number | null): string {
  if (score === null) return "border-hairline bg-surface text-muted";
  if (score >= STRONG_THRESHOLD) return "border-green-500/50 bg-green-500/10 text-green-400";
  if (score >= DRIFT_THRESHOLD) return "border-amber-500/50 bg-amber-500/10 text-amber-400";
  return "border-red-500/50 bg-red-500/10 text-red-400";
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
  const isFailed = order.status === OrderStatus.FAILED;
  // 生成中で止まっている可能性がある状態。タスクがクラッシュで死ぬと onFailure
  // が走らず FAILED にもならないので、ここから再キックできないと救えない。
  const stalledStage =
    order.status === OrderStatus.IMAGE_GENERATING
      ? ("stills" as const)
      : order.status === OrderStatus.VIDEO_GENERATING
        ? ("film" as const)
        : null;
  // Poster copy reuses the film's own loglines — no separate authoring, same
  // story as the trailer's title cards (see app/approve/[token]/page.tsx).
  const petName = order.petName ?? "Unnamed Pet";
  const posterLoglines = resolveWorld(order).loglines;
  const posterTagline = posterLoglines.intro;
  const posterSubtitle = posterLoglines.tagline;
  const isCustom = order.tier === "custom";
  // Same defensive read as app/approve/[token]/page.tsx: pull costume
  // straight off the raw generatedScript Json rather than through
  // resolveWorld(), whose non-custom fallback would otherwise hand back a
  // made-up preset costume for a custom order with no treatment drafted yet.
  // null here just means "nothing to show" (legacy row or still drafting).
  const generatedScriptBundle = order.generatedScript as unknown as WorldBundle | null;
  const costume =
    typeof generatedScriptBundle?.costume === "string" ? generatedScriptBundle.costume : null;

  // Per-shot identity audit — zip the customer's chosen stills with the video
  // identity gate's clip scores + clips (see lib/film-pipeline).
  const shots = order.chosenStills.map((still, i) => ({
    still,
    score: order.shotIdentityScores[i] ?? null,
    clip: order.shotClipUrls[i] ?? null,
  }));

  // Insert (no-pet B-roll) stills — read-only Gate-2 view (trailer-edit-spec
  // §4.5). Not scored/gated (no pet in frame — see lib/film-pipeline.ts'
  // identity-isolation comment); simply cached in filmArtifacts, which is
  // kept after completion so this still renders after Gate 2 approval too.
  const insertStillUrls = (order.filmArtifacts as { insertStillUrls?: string[] } | null)?.insertStillUrls ?? [];
  const scored = shots
    .map((s) => s.score)
    .filter((s): s is number => s !== null);
  const lowestScore = scored.length ? Math.min(...scored) : null;
  const hasDrift = lowestScore !== null && lowestScore < DRIFT_THRESHOLD;

  // B-6 — customer-facing magic link (same one sent by email); admin can
  // copy it directly when a customer says they never received the mail.
  const customerLink = new URL(
    `/approve/${order.approveToken}`,
    process.env.APP_BASE_URL ?? "http://localhost:3100"
  ).toString();

  // A-3 — physical shipping only exists for Feature Film / Collector's
  // Edition orders; digital-only orders have none of these fields set.
  const hasShipping = Boolean(
    order.shippingName ||
      order.shippingLine1 ||
      order.shippingCity ||
      order.shippingRegion ||
      order.shippingPostalCode ||
      order.shippingCountry
  );
  const hasPod = Boolean(order.podOrderId || order.podStatus);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/admin"
        className="text-xs uppercase tracking-widest text-muted transition-colors hover:text-gold"
      >
        ← キュー一覧へ
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="font-display text-4xl tracking-wide text-ivory">
          {(order.petName ?? "UNNAMED PET").toUpperCase()}
        </h1>
        <span
          className={`rounded-[var(--radius-chip)] border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
            isFailed
              ? "border-red-500/50 bg-red-500/10 text-red-400"
              : awaitingReview
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
          {/* Director's Cut (custom, B1) — brief & treatment, read-only support view */}
          {isCustom && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl tracking-wide text-ivory">
                  Director&apos;s Cut — brief &amp; treatment
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  {order.treatmentRevisionCount} revision{order.treatmentRevisionCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted">Customer brief</p>
                  <p className="mt-1 whitespace-pre-wrap text-ivory">
                    {order.customBrief ?? "—"}
                  </p>
                </div>
                {/* Support needs to see the costume the customer actually
                    approved at Gate 0 (WARDROBE-VISIBILITY-SPEC.md §3.4) —
                    read-only, no controls, same "don't show an empty box"
                    guard as the customer-facing approval page. */}
                {costume && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted">
                      Costume (worn in every shot)
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-ivory">{costume}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted">Current treatment</p>
                  <p className="mt-1 whitespace-pre-wrap text-ivory">
                    {order.treatmentText ?? "— not drafted yet —"}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* 生成中 — 進捗が止まっているときの再キック（クラッシュ時の唯一の復旧手段） */}
          {stalledStage && (
            <section className="rounded-[var(--radius-card)] border border-gold/40 bg-gold/5 p-4">
              <h2 className="mb-2 font-display text-xl tracking-wide text-gold-bright">
                生成中
              </h2>
              <p className="mb-3 text-xs text-muted">
                {stalledStage === "stills"
                  ? "通常10分前後で絵コンテ待ちに進みます。"
                  : "通常10〜15分で管理者確認待ちに進みます。"}
                これを大きく超えている場合、生成タスクがクラッシュして止まっている
                可能性があります（その場合ステータスは変わらないまま残ります）。
                再実行すると、キャッシュ済みの素材は再利用され、未完了の工程だけが
                やり直されます。
              </p>
              <RekickGenerationButton orderId={order.id} stage={stalledStage} />
            </section>
          )}

          {/* FAILED — film generation failed after retries; admin retry */}
          {isFailed && (
            <section className="rounded-[var(--radius-card)] border border-red-500/40 bg-red-500/5 p-4">
              <h2 className="mb-2 font-display text-xl tracking-wide text-red-400">
                失敗（要対応）
              </h2>
              <p className="mb-3 text-sm text-red-400/90">
                {order.failureReason ?? "エラー詳細は記録されていません。"}
              </p>
              <p className="mb-3 text-xs text-muted">
                film生成がリトライ後も失敗しました。再実行すると、キャッシュ済みの素材（クリップ・音楽）は再利用され、未完了の工程だけがやり直されます。
              </p>
              <RetryFilmButton orderId={order.id} />
            </section>
          )}

          {/* Final video */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              完成動画
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
                完成動画はまだありません（パイプライン未納品）。
              </p>
            )}
          </section>

          {/* Storyboard likeness — per-shot identity audit (video gate) */}
          {shots.length > 0 && (
            <section
              className={`rounded-[var(--radius-card)] border p-4 ${
                hasDrift ? "border-red-500/40 bg-red-500/5" : "border-hairline bg-surface"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl tracking-wide text-ivory">
                  絵コンテ似顔スコア
                </h2>
                {lowestScore !== null ? (
                  <span
                    className={`rounded-[var(--radius-chip)] border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${scoreClasses(
                      lowestScore
                    )}`}
                  >
                    {hasDrift ? "⚠ ドリフト検知" : "OK"} · 最低 {lowestScore}
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-widest text-muted">
                    未採点
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-muted">
                各ショットの動画クリップをポートレートと照合した採点（0–100・同一性と実写度）。
                黄 &lt; {STRONG_THRESHOLD}、赤 &lt; {DRIFT_THRESHOLD} ＝「うちの子じゃない」の恐れ。
                承認前に ▶ クリップで確認を。
              </p>
              <ol className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {shots.map((shot, i) => (
                  <li key={i} className="space-y-1.5">
                    <div className="relative overflow-hidden rounded-[var(--radius-chip)] border border-hairline">
                      {/* Plain <img>: chosen stills live on external storage. */}
                      <img
                        src={shot.still}
                        alt={`Chosen still for scene ${i + 1} of ${order.petName ?? "the pet"}`}
                        className="aspect-video w-full object-cover"
                      />
                      <span className="absolute left-1 top-1 rounded bg-night/70 px-1 py-0.5 text-[9px] font-semibold tracking-wider text-ivory">
                        {i + 1}
                      </span>
                    </div>
                    <div
                      className={`rounded-[var(--radius-chip)] border px-1 py-0.5 text-center text-[11px] font-semibold ${scoreClasses(
                        shot.score
                      )}`}
                    >
                      {shot.score ?? "—"}
                    </div>
                    {shot.clip && (
                      <a
                        href={shot.clip}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-center text-[10px] uppercase tracking-wider text-muted underline decoration-hairline underline-offset-2 transition-colors hover:text-gold"
                      >
                        ▶ クリップ
                      </a>
                    )}
                    {awaitingReview && shot.clip && (
                      <RerenderShotButton orderId={order.id} shotIndex={i} />
                    )}
                  </li>
                ))}
              </ol>
              {awaitingReview && (
                <p className="mt-3 text-[11px] text-muted">
                  ↻ このカットを修正＝そのショットだけ作り直します（他の5本と音楽は再利用）。
                  理由を書いてからレベルを選択：
                  再アニメ（クリップ1本分）＝動きの問題・同じスチルで再抽選／
                  撮り直し（スチル1枚＋クリップ1本分）＝作画・画風の問題（「CGっぽい」等）・
                  理由がスチルの撮り直しに反映。組み立て直しが終わるとここに戻ってきます。
                </p>
              )}
            </section>
          )}

          {/* Insert (no-pet B-roll) stills — read-only, trailer-edit-spec §4.5 */}
          {insertStillUrls.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
                インサート（情景カット）
              </h2>
              <p className="mb-3 text-xs text-muted">
                犬が映らない世界観の情景カット（Ken Burnsで動画化）。差し替え操作はまだありません（読み取り表示のみ）。
              </p>
              <div className="grid grid-cols-3 gap-3">
                {insertStillUrls.map((url, i) => (
                  // Plain <img>: insert stills live on external storage.
                  <img
                    key={`${i}-${url}`}
                    src={url}
                    alt={`Insert scene ${i + 1} for ${order.petName ?? "this order"}`}
                    className="aspect-video w-full rounded-[var(--radius-chip)] border border-hairline object-cover"
                  />
                ))}
              </div>
            </section>
          )}

          {/* Single-shot re-render in progress */}
          {order.status === OrderStatus.VIDEO_GENERATING && order.finalVideoUrl && (
            <section className="rounded-[var(--radius-card)] border border-gold/30 bg-surface p-4">
              <p className="text-sm text-gold">
                ↻ 差し戻したショットを作り直し中 — まもなくレビューに戻ります。数分後にページを更新してください。
              </p>
            </section>
          )}

          {/* Poster — the hero product */}
          {order.posterOptions.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl tracking-wide text-ivory">
                  ポスター
                </h2>
                {order.posterUrl ? (
                  <span className="rounded-[var(--radius-chip)] border border-green-500/50 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-green-400">
                    顧客選択済み
                  </span>
                ) : (
                  <span className="rounded-[var(--radius-chip)] border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-400">
                    顧客の選択待ち
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-muted">
                3案から顧客が1枚選びます（撮影中の顧客ページで選択）。選ばれた1枚が印刷・納品されます。
              </p>
              <div className="grid grid-cols-3 gap-3">
                {order.posterOptions.map((url, i) => {
                  const isChosen = order.posterUrl === url;
                  return (
                    <a
                      key={`${i}-${url}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className={`relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-chip)] border ${
                        isChosen ? "border-gold ring-2 ring-gold" : "border-hairline opacity-70"
                      }`}
                    >
                      <MoviePosterOverlay
                        src={url}
                        petName={petName}
                        tagline={posterTagline}
                        subtitle={posterSubtitle}
                      />
                      {isChosen && (
                        <span className="absolute right-1.5 top-1.5 rounded bg-gold px-1.5 py-0.5 text-[10px] font-semibold text-night">
                          ★ 選択
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
              {order.posterPrintUrl && (
                <a
                  href={order.posterPrintUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-green-500/50 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-400 transition-colors hover:bg-green-500/20"
                >
                  ⬇ 印刷用ファイル（POD納品用・タイトル焼き込み済み）
                </a>
              )}
            </section>
          )}

          {/* Approve form — Gate 2 */}
          {awaitingReview && (
            <section className="rounded-[var(--radius-card)] border border-gold/30 bg-surface p-4">
              <h2 className="mb-1 font-display text-xl tracking-wide text-gold">
                GATE 2 — 承認して納品
              </h2>
              <p className="mb-3 text-xs text-muted">
                承認すると注文が完了し、納品メール送信とポスター（POD）発注が実行されます。取り消しはできません。
              </p>
              {order.posterOptions.length > 0 && !order.posterUrl && (
                <p className="mb-3 rounded-[var(--radius-chip)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  ⚠ 顧客がまだポスターを選んでいません。承認するとポスター未確定のまま完了します。
                </p>
              )}
              <ApproveForm orderId={order.id} />
            </section>
          )}

          {/* Selected concept still */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              承認済みスチル（カット1）
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
                スチル未選択（Gate 1 前）。
              </p>
            )}
          </section>

          {/* Customer reference photos */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              顧客の写真
              <span className="ml-2 align-middle text-xs font-sans tracking-normal text-muted">
                {order.uploadedPhotoUrls.length}枚
              </span>
            </h2>
            {order.uploadedPhotoUrls.length === 0 ? (
              <p className="text-sm text-muted">写真はまだありません。</p>
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
              注文情報
            </h2>
            <dl className="space-y-3">
              <Meta label="注文ID" value={<span className="font-mono text-xs">{order.id}</span>} />
              <Meta
                label="Stripeセッション"
                value={<span className="font-mono text-xs">{order.stripeSessionId}</span>}
              />
              <Meta label="顧客" value={order.customerEmail} />
              <Meta
                label="世界観"
                value={
                  <span className="uppercase tracking-wider text-gold/80">
                    {order.world ?? "—"}
                  </span>
                }
              />
              <Meta label="作成" value={timeFormat.format(order.createdAt)} />
              <Meta label="更新" value={timeFormat.format(order.updatedAt)} />
              {order.adminNote && <Meta label="管理メモ" value={order.adminNote} />}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              顧客用リンク
            </h2>
            <p className="mb-2 break-all font-mono text-xs text-muted">
              {customerLink}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <CopyLinkButton value={customerLink} label="リンクをコピー" />
              <ResendEmailButton orderId={order.id} />
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              配送 / POD
            </h2>
            {!hasShipping && !hasPod ? (
              <p className="text-sm text-muted">
                物理商品なし（デジタル納品のみ）
              </p>
            ) : (
              <dl className="space-y-3">
                {hasShipping ? (
                  <Meta
                    label="お届け先"
                    value={
                      <>
                        {order.shippingName && <span>{order.shippingName}</span>}
                        <br />
                        {order.shippingPostalCode && <span>〒{order.shippingPostalCode} </span>}
                        {order.shippingCountry && <span>{order.shippingCountry}</span>}
                        <br />
                        {order.shippingRegion && <span>{order.shippingRegion} </span>}
                        {order.shippingCity && <span>{order.shippingCity}</span>}
                        <br />
                        {order.shippingLine1 && <span>{order.shippingLine1}</span>}
                        {order.shippingLine2 && (
                          <>
                            <br />
                            <span>{order.shippingLine2}</span>
                          </>
                        )}
                      </>
                    }
                  />
                ) : (
                  <Meta label="お届け先" value="未設定" />
                )}
                <Meta
                  label="Printify注文ID"
                  value={
                    order.podOrderId ? (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">{order.podOrderId}</span>
                        <CopyLinkButton value={order.podOrderId} />
                      </span>
                    ) : (
                      // Paid but never submitted — POD failures are swallowed
                      // so they can't block film delivery, so this is the only
                      // place the gap is visible, and the only way to close it.
                      <ResubmitPodButton orderId={order.id} />
                    )
                  }
                />
                <Meta label="POD ステータス" value={order.podStatus ?? "—"} />
              </dl>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              監査ログ
            </h2>
            {order.statusEvents.length === 0 ? (
              <p className="text-sm text-muted">遷移の記録はありません。</p>
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
