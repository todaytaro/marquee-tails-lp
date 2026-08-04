import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApproveForm } from "./ApproveForm";
import { RerenderShotButton } from "./RerenderShotButton";
import { StoryboardReviewPanel } from "./StoryboardReviewPanel";
import { RetryFilmButton } from "../RetryFilmButton";
import { RekickGenerationButton } from "../RekickGenerationButton";
import { CopyLinkButton } from "./CopyLinkButton";
import { ResubmitPodButton } from "./ResubmitPodButton";
import { ResendEmailButton } from "./ResendEmailButton";
import { MarkRefundIssuedButton } from "./MarkRefundIssuedButton";
import MoviePosterOverlay from "@/components/MoviePosterOverlay";
import { resolveWorld, fillPetName, type WorldBundle, type Personality } from "@/lib/film-script";
import { LOGLINES_JA } from "@/lib/film-script-ja";
import { STORYBOARD_REROLL_CAP, REFUND_AMOUNT_USD, NONREFUNDABLE_FEE_USD } from "@/lib/safety-net";
import { normalizeStoryboard, NUM_CUTS, TAKES_PER_CUT } from "@/lib/stills-pipeline";
import { buildTimeline, buildEvidenceText } from "@/lib/evidence-text";

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
    include: {
      statusEvents: { orderBy: { createdAt: "asc" } },
      evidenceEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  // CHARGEBACK-DEFENSE-SPEC.md §4 — merge StatusEvent (transitions) and
  // EvidenceEvent (everything else: consent, downloads, picks, re-rolls,
  // emails) into one chronological timeline, and the plain-English text the
  // owner can paste straight into Stripe's dispute-response form. Built from
  // data already on this page — no new API route.
  const evidenceTimeline = buildTimeline(order.statusEvents, order.evidenceEvents);
  const consentEvent = order.evidenceEvents.find((e) => e.kind === "checkout.consent") ?? null;
  const evidenceText = buildEvidenceText(order, evidenceTimeline, consentEvent);

  const awaitingReview = order.status === OrderStatus.AWAITING_ADMIN_APPROVAL;
  const isFailed = order.status === OrderStatus.FAILED;

  // STORYBOARD-ADMIN-GATE-SPEC.md §2 — the Gate-1 admin review queue IS this
  // exact combination: status still IMAGE_GENERATING (no new OrderStatus
  // value was added), storyboardOptions already populated. No separate flag,
  // no separate page — reading these two fields off the same order row is
  // the whole "queue".
  const storyboardForReview = normalizeStoryboard(order.storyboardOptions).map((cut) => ({
    scene: cut.scene,
    // Admin hasn't shown this to the customer yet, so — unlike Gate1View —
    // there is no preview/clean split to respect here (§3.2): pass the clean
    // url straight through.
    options: cut.options.map((o) => o.clean),
  }));
  const isAdminReviewQueue =
    order.status === OrderStatus.IMAGE_GENERATING && storyboardForReview.length > 0;

  // 生成中で止まっている可能性がある状態。タスクがクラッシュで死ぬと onFailure
  // が走らず FAILED にもならないので、ここから再キックできないと救えない。
  // isAdminReviewQueue の間はこの再キック導線を出さない — 生成はもう完了して
  // 人間の確認待ちなので、ここで再キックすると絵コンテを不要に作り直してしまう。
  //
  // TREATMENT_GENERATING (Director's Cut Gate 0) is the same "stuck mid-
  // generation, no recovery path" shape but a different cause: submit-photos
  // runs generateTreatment() inline in the request handler, so a killed
  // serverless function (not a crashed background task) skips its
  // compensating revert and strands the order here instead. Always shown
  // for this status — unlike IMAGE_GENERATING there is no separate "waiting
  // for human review" meaning for TREATMENT_GENERATING to avoid colliding
  // with, and rekickGenerationAction refuses on the first click when
  // treatmentText is already set (that is a revise-treatment regeneration in
  // flight, not a stall) — offering an explicit confirm for the case where the
  // existing treatment is the thing being thrown away.
  //
  // NOT shown for AWAITING_TREATMENT_APPROVAL. A treatment that generated
  // successfully but came out wrong is a quality problem, not a stall, and it
  // has no admin path at all today — the customer's own "request changes"
  // (revise-treatment) is the only way to redraft it, which spends one of
  // their two free revisions on our defect. Gate 1 got an admin review gate
  // for exactly this shape of problem (STORYBOARD-ADMIN-GATE-SPEC.md); Gate 0
  // still shows the customer the treatment before anyone here sees it.
  const stalledStage =
    order.status === OrderStatus.IMAGE_GENERATING && !isAdminReviewQueue
      ? ("stills" as const)
      : order.status === OrderStatus.VIDEO_GENERATING
        ? ("film" as const)
        : order.status === OrderStatus.TREATMENT_GENERATING
          ? ("treatment" as const)
          : null;
  // Poster copy reuses the film's own loglines — no separate authoring, same
  // story as the trailer's title cards (see app/approve/[token]/page.tsx).
  const petName = order.petName ?? "Unnamed Pet";
  const posterLoglines = resolveWorld(order).loglines;
  // Same resolved loglines, but read as the film's cards rather than as poster
  // copy — {name} already substituted, so this is verbatim what appears on
  // screen (see the 字幕 section below).
  const trailerCards = posterLoglines;
  // Japanese reading of those same cards, admin-only. Preset copy is fixed so
  // it maps straight to its world/personality (lib/film-script-ja.ts); a
  // Director's Cut has no preset to look up, so Claude writes the Japanese
  // alongside the cards it invents (loglinesJa). Absent either way is fine —
  // a reading aid, never something the film depends on.
  const cardsJa =
    order.tier === "custom"
      ? ((order.generatedScript as unknown as WorldBundle | null)?.loglinesJa ?? null)
      : LOGLINES_JA[order.world ?? "deepspace"]?.[
          (order.personality ?? "easygoing") as Personality
        ] ?? null;
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
  // start+end interpolation (FILM-QUALITY-V3-SPEC.md §5): pair each generated
  // end frame with the chosen still it was generated FROM. Without seeing the
  // two side by side there is no way to tell the feature's two failure modes
  // apart — an end frame too close to its start interpolates to a static shot,
  // one too far apart morphs mid-clip — and no basis for tuning
  // SHOT_END_POSES either way. A cut with no end frame simply isn't listed
  // (not enrolled, or its frame failed the identity gate and fell back).
  const endFrameUrls = (order.filmArtifacts as { endFrameUrls?: (string | null)[] } | null)?.endFrameUrls ?? [];
  const endFramePairs = endFrameUrls
    .map((endUrl, i) => ({ index: i, endUrl, startUrl: order.chosenStills[i] ?? null }))
    .filter((p): p is { index: number; endUrl: string; startUrl: string } =>
      typeof p.endUrl === "string" && typeof p.startUrl === "string"
    );
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
                    {order.treatmentText
                      ? fillPetName(order.treatmentText, order.petName)
                      : "— not drafted yet —"}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/*
            B2-SAFETY-NET-SPEC.md §3.3/§4.3 — Gate 1 safety net (custom
            only, §7): how many of the 3 free re-rolls this order has spent,
            and whether the customer has asked for the REFUND_AMOUNT_USD
            refund. The refund itself is issued BY A HUMAN in the Stripe
            dashboard — this app never calls Stripe's refund API and never
            computes the figure; MarkRefundIssuedButton only records that it
            already happened.
          */}
          {isCustom && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl tracking-wide text-ivory">
                  Gate 1 セーフティネット
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  リロール {order.storyboardRerollCount}/{STORYBOARD_REROLL_CAP} 回使用
                </span>
              </div>
              {!order.refundRequestedAt ? (
                <p className="text-xs text-muted">返金要求はありません。</p>
              ) : order.refundIssuedAt ? (
                <p className="rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-3 py-2 text-xs text-muted">
                  ${REFUND_AMOUNT_USD}返金済みとして記録済み — {timeFormat.format(order.refundIssuedAt)}
                </p>
              ) : (
                <div className="space-y-3 rounded-[var(--radius-chip)] border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-400">
                    ⚠ 返金要求あり（{timeFormat.format(order.refundRequestedAt)}）—
                    Stripeダッシュボードで${REFUND_AMOUNT_USD}を手動返金してください（${NONREFUNDABLE_FEE_USD}の企画・絵コンテ費は対象外）。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyLinkButton value={order.stripeSessionId} label="Stripeセッションをコピー" />
                    <MarkRefundIssuedButton orderId={order.id} />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* GATE 1 — STORYBOARD-ADMIN-GATE-SPEC.md §3.2. New UI: before this
              feature admin rendered no storyboard at all here (just the B2
              re-roll count above). Shown exactly while this order IS the
              admin review queue (§2) — status still IMAGE_GENERATING,
              storyboardOptions already populated. */}
          {isAdminReviewQueue && (
            <StoryboardReviewPanel
              orderId={order.id}
              storyboard={storyboardForReview}
              numCuts={NUM_CUTS}
              takesPerCut={TAKES_PER_CUT}
            />
          )}

          {/* 生成中 — 進捗が止まっているときの再キック（クラッシュ時の唯一の復旧手段） */}
          {stalledStage && (
            <section className="rounded-[var(--radius-card)] border border-gold/40 bg-gold/5 p-4">
              <h2 className="mb-2 font-display text-xl tracking-wide text-gold-bright">
                生成中
              </h2>
              <p className="mb-3 text-xs text-muted">
                {stalledStage === "treatment" ? (
                  <>
                    通常は数秒〜十数秒でトリートメント承認待ちに進みます。
                    これを大きく超えている場合、写真・ブリーフ提出時にトリートメント生成を
                    呼び出したリクエストが処理の途中で強制終了された可能性があります
                    （その場合ステータスは変わらないまま残ります）。
                    再実行すると、保存済みのブリーフからトリートメントを生成し直します
                    — 顧客が写真やブリーフを再送信する必要はありません。
                    すでにトリートメントがある場合（改訂の再生成中）は再実行できません。
                  </>
                ) : (
                  <>
                    {stalledStage === "stills"
                      ? "通常10分前後で絵コンテ待ちに進みます。"
                      : "通常10〜15分で管理者確認待ちに進みます。"}
                    これを大きく超えている場合、生成タスクがクラッシュして止まっている
                    可能性があります（その場合ステータスは変わらないまま残ります）。
                    再実行すると、キャッシュ済みの素材は再利用され、未完了の工程だけが
                    やり直されます。
                  </>
                )}
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

          {/*
            The trailer's own text, in the order it appears on screen. The
            treatment above is the story we pitched the customer; THIS is what
            the film actually says, and until now there was no way to read it
            before (or after) the film was cut — you could watch the video and
            squint, or nothing. It's the only way to check the cards actually
            match the footage they sit between.
          */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              字幕（トレーラーカード）
            </h2>
            <p className="mb-3 text-xs text-muted">
              完成動画に出るカード文言を、出る順に表示しています。英語固定です（表示フォントBebas Neueがラテン文字専用のため）。
              映像と食い違っていたら、トリートメントを直して再生成します。
            </p>
            <dl className="space-y-2 text-sm">
              {[
                ["① 冒頭（何の映画か）", trailerCards.premise, cardsJa?.premise],
                ["② 登場", trailerCards.intro, cardsJa?.intro],
                ["③ 転機", trailerCards.turn, cardsJa?.turn],
                ["④ 危機", trailerCards.rise, cardsJa?.rise],
                ["⑤ タイトル", `${petName.toUpperCase()} / ${trailerCards.tagline}`, cardsJa?.tagline],
                ["⑥ オチ（タイトル後）", trailerCards.stinger, cardsJa?.stinger],
              ].map(([label, text, ja]) => (
                <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 text-[10px] uppercase tracking-widest text-muted sm:w-44 sm:pt-1">
                    {label}
                  </dt>
                  <dd>
                    <span className="font-display tracking-wide text-gold">
                      {/* premise/stinger are optional — a pre-story-cards order
                          simply has no such card in its film. */}
                      {text || <span className="font-sans text-xs tracking-normal text-muted">— このカードなし（旧構成の注文）—</span>}
                    </span>
                    {/* Reading aid only (lib/film-script-ja.ts) — never shown to
                        the customer and never fed to a model. Absent for a
                        Director's Cut, whose cards Claude writes per order. */}
                    {text && ja && (
                      <span className="mt-0.5 block text-xs text-muted">
                        {fillPetName(ja, order.petName)}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Insert (no-pet B-roll) stills — read-only, trailer-edit-spec §4.5 */}
          {insertStillUrls.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
                インサート（情景カット）
              </h2>
              <p className="mb-3 text-xs text-muted">
                犬が映らない世界観の情景カット。Klingで動画化します（生成に失敗した分だけKen Burnsにフォールバック）。差し替え操作はまだありません（読み取り表示のみ）。
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

          {endFramePairs.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
                始点 → 終点フレーム（start+end 補間）
              </h2>
              <p className="mb-3 text-xs text-muted">
                このカットは2枚のフレームの間を動画モデルに補間させています。
                <strong className="text-ivory">2枚に見て分かる差がなければ動きません</strong>
                （＝静止画のまま）。逆に差が大きすぎるとクリップ途中で別の犬に変形します。
                どちらかが起きていたら SHOT_END_POSES（lib/film-script.ts）のポーズを強める／弱めて調整します。
              </p>
              <div className="space-y-3">
                {endFramePairs.map((pair) => (
                  <div key={pair.index} className="grid grid-cols-2 gap-3">
                    {/* Plain <img>: these live on external storage. */}
                    <figure>
                      <img
                        src={pair.startUrl}
                        alt={`Cut ${pair.index + 1} start frame`}
                        className="aspect-video w-full rounded-[var(--radius-chip)] border border-hairline object-cover"
                      />
                      <figcaption className="mt-1 text-[10px] uppercase tracking-widest text-muted">
                        カット{pair.index + 1} 始点
                      </figcaption>
                    </figure>
                    <figure>
                      <img
                        src={pair.endUrl}
                        alt={`Cut ${pair.index + 1} end frame`}
                        className="aspect-video w-full rounded-[var(--radius-chip)] border border-gold/40 object-cover"
                      />
                      <figcaption className="mt-1 text-[10px] uppercase tracking-widest text-gold">
                        カット{pair.index + 1} 終点
                      </figcaption>
                    </figure>
                  </div>
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
                  ⚠ 顧客がまだポスターを選んでいません。承認すると1案目で確定します（顧客にもその旨を表示済み）。急ぐ理由がなければ、選ぶ時間を残してください。
                </p>
              )}
              {/* Candidates are handed over ONLY when the customer hasn't
                  picked — an admin choice must never overwrite theirs, and
                  they can still pick until this approval commits. */}
              <ApproveForm
                orderId={order.id}
                posterOptions={order.posterUrl ? [] : order.posterOptions}
              />
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

          {/*
            DELIVERY-RATING-SPEC.md §0/§5 — the customer's own post-delivery
            star rating. Placed right beside 紛争対応 on purpose: per §0 this
            is arguably the strongest chargeback evidence this app records,
            stronger than anything written on our side, because it's the
            customer's own stated satisfaction, captured right after
            delivery.
          */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <h2 className="mb-3 font-display text-xl tracking-wide text-ivory">
              納品評価
            </h2>
            {order.ratingStars === null ? (
              <p className="text-sm text-muted">まだ評価はありません。</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-gold">
                  {"★".repeat(order.ratingStars)}
                  {"☆".repeat(5 - order.ratingStars)}
                  <span className="ml-2 text-xs text-muted">
                    （{order.ratingStars}/5）
                  </span>
                </p>
                {order.ratingComment && (
                  <p className="whitespace-pre-wrap text-ivory">
                    {order.ratingComment}
                  </p>
                )}
                {order.ratedAt && (
                  <p className="text-xs text-muted">
                    {timeFormat.format(order.ratedAt)}
                  </p>
                )}
              </div>
            )}
          </section>

          {/*
            CHARGEBACK-DEFENSE-SPEC.md §4 — the whole point of this spec:
            when a chargeback arrives, assemble one order's evidence in five
            minutes, not an afternoon. Consent status first (an order with no
            consent record is a weaker defense, and that fact should never be
            hidden), then the merged StatusEvent+EvidenceEvent timeline, then
            a one-click copy of the plain-English text for Stripe's dispute
            form — assembled server-side from data already on this page (no
            new API route).
          */}
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl tracking-wide text-ivory">
                紛争対応（チャージバック証拠）
              </h2>
              <CopyLinkButton value={evidenceText} label="証拠テキストをコピー" />
            </div>

            {consentEvent ? (
              <p className="mb-3 rounded-[var(--radius-chip)] border border-green-500/50 bg-green-500/10 px-3 py-2 text-xs text-green-400">
                ✓ 決済時の同意記録あり — {timeFormat.format(consentEvent.createdAt)}
              </p>
            ) : (
              <p className="mb-3 rounded-[var(--radius-chip)] border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                ⚠ 同意記録なし — この注文はチャージバック対応が弱い状態です。
              </p>
            )}

            {evidenceTimeline.length === 0 ? (
              <p className="text-sm text-muted">記録された操作はまだありません。</p>
            ) : (
              <ol className="max-h-96 space-y-2 overflow-y-auto pr-1 text-xs">
                {evidenceTimeline.map((entry, i) => (
                  <li key={i} className="border-l-2 border-hairline pl-3">
                    <p className="text-ivory">
                      <span className="font-semibold uppercase tracking-wider text-gold/80">
                        {entry.actor}
                      </span>{" "}
                      <span>{entry.kind}</span>
                      {entry.ip && <span className="text-muted"> · IP {entry.ip}</span>}
                    </p>
                    {entry.detailLine && <p className="mt-0.5 text-muted">{entry.detailLine}</p>}
                    <p className="mt-0.5 text-muted/80">{timeFormat.format(entry.time)}</p>
                  </li>
                ))}
              </ol>
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
