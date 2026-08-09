"use server";

import { revalidatePath } from "next/cache";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { approveVideo } from "@/lib/approvals";
import { REFUND_AMOUNT_USD } from "@/lib/safety-net";
import { kickFilmGeneration, kickShotRerender } from "@/lib/film-pipeline";
import { runTreatmentGeneration } from "@/lib/treatment";
import { recordEvidence } from "@/lib/evidence";
import {
  NUM_CUTS,
  TAKES_PER_CUT,
  normalizeStoryboard,
  adminRerollCutTakes,
} from "@/lib/stills-pipeline";
import {
  sendWelcomeUploadEmail,
  sendChooseStillEmail,
  sendDeliveryEmail,
} from "@/lib/mocks";

export type ApproveVideoResult = { ok: true } | { ok: false; error: string };

/**
 * Gate 2 server action for the admin dashboard. Same domain logic as the
 * API route (lib/approvals.approveVideo), but TransitionError comes back as
 * {ok:false, error} so the client form can render it inline.
 */
export async function approveVideoAction(
  orderId: string,
  adminNote?: string,
  // Only consulted when the customer never picked a poster — see approveVideo.
  adminPosterChoice?: string
): Promise<ApproveVideoResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  try {
    await approveVideo(
      orderId,
      adminNote?.trim() ? adminNote.trim() : undefined,
      adminPosterChoice || undefined
    );
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error:
          "この注文はレビュー待ちではありません — すでに承認済みの可能性があります。キューを更新してください。",
      };
    }
    console.error("[approveVideoAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type ApproveStoryboardResult = { ok: true } | { ok: false; error: string };

/**
 * STORYBOARD-ADMIN-GATE-SPEC.md §3.5 — the Gate-1 admin gate this whole spec
 * adds: the ONLY code path left that can move an order IMAGE_GENERATING ->
 * AWAITING_CUSTOMER_APPROVAL, and the ONLY code path left that can send
 * sendChooseStillEmail (the Gate-1 "choose your still" mail) for a fresh
 * storyboard. lib/stills-pipeline.ts#completeStillsGeneration used to do
 * both of those itself the moment generation finished; now it does neither
 * (§3.1) — it just persists storyboardOptions and alerts the owner
 * (sendAdminStoryboardReviewAlert), leaving the order sitting in the review
 * queue (IMAGE_GENERATING + storyboardOptions populated, §2) until a human
 * presses this button.
 *
 * Precondition, checked explicitly (§3.5's "生成途中の注文を承認できてはなら
 * ない" — an order still being generated must never be approvable): the
 * order must actually BE in that queue (status IMAGE_GENERATING) and its
 * storyboard must be COMPLETE — all NUM_CUTS cuts present, each with
 * TAKES_PER_CUT takes. A partially-generated storyboard (a crash mid-run, or
 * this button double-firing before generation catches up) fails this check
 * with a specific reason rather than silently sending a broken pick screen
 * to the customer.
 *
 * Written in the same posture as approveVideoAction above (Gate 2): the
 * TransitionError case reads as "someone else/another click already moved
 * this", never a raw stack trace.
 */
export async function approveStoryboardAction(
  orderId: string
): Promise<ApproveStoryboardResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, error: "注文が見つかりません。" };
  }

  const storyboard = normalizeStoryboard(order.storyboardOptions);
  const isComplete =
    storyboard.length >= NUM_CUTS &&
    storyboard.slice(0, NUM_CUTS).every((cut) => cut.options.length >= TAKES_PER_CUT);
  if (!isComplete) {
    return {
      ok: false,
      error: `絵コンテがまだ揃っていません（${storyboard.length}/${NUM_CUTS}カット）。生成が完了してから承認してください。`,
    };
  }

  let updated;
  try {
    updated = await transitionOrder(
      orderId,
      OrderStatus.IMAGE_GENERATING,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      "admin",
      {},
      "STORYBOARD-ADMIN-GATE-SPEC.md §3.5: admin approved storyboard for customer review"
    );
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error: "この注文は絵コンテ確認待ちではありません — すでに処理済みの可能性があります。ページを更新してください。",
      };
    }
    console.error("[approveStoryboardAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  // Non-fatal, same posture as every other lifecycle-email send in this file
  // (see markRefundIssuedAction): the transition already committed, so a mail
  // failure here must not read as "approval failed" — the admin's
  // ResendEmailButton on this same page covers the retry.
  try {
    await sendChooseStillEmail(updated);
  } catch (e) {
    console.error(
      `[approveStoryboardAction] order=${orderId} approved but the customer Gate-1 email failed — resend from admin`,
      e
    );
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type AdminRerollCutResult = { ok: true } | { ok: false; error: string };

/**
 * STORYBOARD-ADMIN-GATE-SPEC.md §3.3 — admin re-roll of ONE cut's three
 * takes, used from the storyboard review screen while an order still sits in
 * the queue (status IMAGE_GENERATING, storyboardOptions populated). Reuses
 * the same generation machinery as the customer's Gate-1 re-roll
 * (generateGatedTake via adminRerollCutTakes) but is kept on its own action,
 * its own counter, and its own seed band — see adminRerollCutTakes's and
 * adminRerollSeedBase's doc comments in lib/stills-pipeline.ts for the two
 * things that MUST stay separate from the customer's re-roll:
 *
 *   (a) this must never increment storyboardRerollCount — the customer's B2
 *       free-reroll budget — only the separate adminRerollCount column;
 *   (b) its seeds must be structurally unable to collide with a customer
 *       re-roll's seeds for the same cut.
 *
 * The atomic `updateMany` below reserves the adminRerollCount slot BEFORE
 * generating, mirroring reroll-cut/route.ts's guarded reservation for
 * storyboardRerollCount — same double-click-safety shape, even though there
 * is no cap here to race against: two concurrent admin clicks on the same
 * cut must still land in two different, non-colliding seed bands rather than
 * both computing the same pre-increment adminRerollCount.
 */
export async function adminRerollCutAction(
  orderId: string,
  cutIndex: number,
  // Omitted = redraw all three takes. Supplied = redraw just that one and
  // leave the reviewer's other two alone, which is what a cut with a single
  // bad option actually needs.
  takeIndex?: number
): Promise<AdminRerollCutResult> {
  if (!orderId || !Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= NUM_CUTS) {
    return { ok: false, error: "orderId と有効な cutIndex が必要です。" };
  }
  if (
    takeIndex !== undefined &&
    (!Number.isInteger(takeIndex) || takeIndex < 0 || takeIndex >= TAKES_PER_CUT)
  ) {
    return { ok: false, error: "有効な takeIndex が必要です。" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, error: "注文が見つかりません。" };
  }
  if (order.status !== OrderStatus.IMAGE_GENERATING) {
    return {
      ok: false,
      error: "この注文は絵コンテ確認待ちではありません。ページを更新してください。",
    };
  }
  const storyboard = normalizeStoryboard(order.storyboardOptions);
  if (!storyboard[cutIndex]) {
    return { ok: false, error: "このカットの絵コンテがまだありません。" };
  }

  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.IMAGE_GENERATING },
    data: { adminRerollCount: { increment: 1 } },
  });
  if (count !== 1) {
    return {
      ok: false,
      error: "この注文は絵コンテ確認待ちではありません。ページを更新してください。",
    };
  }

  const reserved = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  try {
    await adminRerollCutTakes(reserved, cutIndex, reserved.adminRerollCount, takeIndex);
  } catch (err) {
    // Compensating revert, same reasoning as reroll-cut/route.ts: a re-roll
    // that fails outright delivered nothing, so the counter it reserved
    // should give the slot back rather than silently drift from "how many
    // admin re-rolls actually happened".
    console.error(`[adminRerollCutAction] order=${orderId} cut=${cutIndex}`, err);
    await prisma.order
      .updateMany({
        where: { id: orderId, adminRerollCount: reserved.adminRerollCount },
        data: { adminRerollCount: { decrement: 1 } },
      })
      .catch((revertErr) =>
        console.error(`[adminRerollCutAction] slot refund also failed order=${orderId}`, revertErr)
      );
    return { ok: false, error: "引き直しに失敗しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type RerenderShotResult = { ok: true } | { ok: false; error: string };

/**
 * Gate 2 QC action — send ONE bad shot back to production. Atomically moves
 * the order AWAITING_ADMIN_APPROVAL -> VIDEO_GENERATING (double-click safe:
 * the second click hits a stale status and errors), then kicks the detached
 * single-shot re-render. The rest of the film (5 clips + music) is reused, so
 * this costs ~one clip. When the fixed film is assembled the order returns to
 * AWAITING_ADMIN_APPROVAL for a fresh review.
 */
export async function rerenderShotAction(
  orderId: string,
  shotIndex: number,
  mode: "reanimate" | "reshoot" = "reanimate",
  reason?: string
): Promise<RerenderShotResult> {
  if (!orderId || !Number.isInteger(shotIndex) || shotIndex < 0) {
    return { ok: false, error: "orderId と有効な shotIndex が必要です。" };
  }
  const note = reason?.trim().slice(0, 300) || undefined;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "注文が見つかりません。" };
  if (!order.chosenStills[shotIndex]) {
    return { ok: false, error: `この注文にはショット${shotIndex + 1}がありません。` };
  }

  try {
    const updated = await transitionOrder(
      orderId,
      OrderStatus.AWAITING_ADMIN_APPROVAL,
      OrderStatus.VIDEO_GENERATING,
      "admin",
      {},
      `Gate 2: shot ${shotIndex + 1} rejected — ${mode}${note ? `: ${note}` : ""}`
    );
    await kickShotRerender(updated, shotIndex, { reshoot: mode === "reshoot", reason: note });
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error: "この注文はレビュー待ちではありません — すでに作り直しが走っている可能性があります。ページを更新してください。",
      };
    }
    console.error("[rerenderShotAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type RekickGenerationResult =
  | { ok: true }
  // needsOverwriteConfirm distinguishes "refused, but you may insist" from a
  // plain failure, so the button can offer a confirmation instead of dead-ending.
  | { ok: false; error: string; needsOverwriteConfirm?: boolean };

/**
 * 生成中のまま止まった注文を再キックする（ステータスは変えない）。
 *
 * 生成タスクがクラッシュ（OOM等）で強制終了すると onFailure が走らないため、
 * 注文は IMAGE_GENERATING / VIDEO_GENERATING のまま取り残される。FAILED には
 * ならないので既存の「再実行」（retryFilmAction）では拾えず、顧客側も待ち画面
 * のまま進めない。この操作はその取り残された注文を救う唯一の手段。
 *
 * どちらのパイプラインも再開可能なので再課金は最小限で済む:
 *   - 絵コンテ: LoRA学習済み（loraUrl 保存済み）ならそこはスキップし、
 *     写真解析とアイデンティティ画像も同様にキャッシュ済みならスキップ
 *     （LORA-STORYBOARD-SPEC.md §2.7 — kickLoraTraining 経由なので、
 *     学習タスク自体で止まっていた注文もこの一本の呼び出しで再開できる）
 *   - 動画: filmArtifacts のクリップ・音楽を再利用し、未完了の工程だけやり直す
 *
 * TREATMENT_GENERATING (Director's Cut Gate 0) is a different hazard, not a
 * crashed background task: app/api/orders/submit-photos/route.ts runs
 * generateTreatment() INLINE in the request handler with only a compensating
 * revert-on-throw, so a killed serverless function (double-submit + abort,
 * timeout, mid-flight deploy) skips that revert entirely and stalls the order
 * here with the customer's photos + brief already saved but no treatment.
 * Recovered by re-running runTreatmentGeneration() (lib/treatment.ts, shared
 * with submit-photos) from the ALREADY-STORED customBrief/petName — the
 * customer never re-uploads anything. Guarded below: refuses if treatmentText
 * is already set, since that means this order isn't actually stalled (it's a
 * revise-treatment re-generation in flight, which keeps the prior treatment
 * populated until a NEW one replaces it) — re-running here would risk
 * clobbering something already usable, and this path has no way to recover
 * the original revisionInstruction anyway.
 */
export async function rekickGenerationAction(
  orderId: string,
  // TREATMENT_GENERATING のみ意味を持つ。既存のトリートメントを作り直す
  // 意思表示で、既定は false — 事故で上書きされる側に倒す。
  overwriteExisting = false
): Promise<RekickGenerationResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return { ok: false, error: "注文が見つかりません。" };
    }
    // ステータスガード: 生成中の注文にだけ効く操作。すでに次のゲートへ進んだ
    // 注文で押しても二重生成しないようにする。
    if (order.status === OrderStatus.IMAGE_GENERATING) {
      // kickStillsGeneration ではなく kickLoraTraining から再開する:
      // クラッシュした箇所が学習タスクか絵コンテタスクか、この時点では
      // 分からない。kickLoraTraining の再利用チェック（order.loraUrl が
      // あれば学習をスキップ）が、学習済みなら即座に絵コンテへ進むので、
      // どちらで止まっていても正しく再開できる。
      const { kickLoraTraining } = await import("@/lib/stills-pipeline");
      await kickLoraTraining(order);
    } else if (order.status === OrderStatus.VIDEO_GENERATING) {
      await kickFilmGeneration(order);
    } else if (order.status === OrderStatus.TREATMENT_GENERATING) {
      // 上のdocコメント参照: すでに treatmentText があるなら、この注文は
      // クラッシュで止まっているのではなく revise-treatment の生成中 —
      // 上書き防止のため再実行しない。
      // すでに treatmentText がある注文は2通りある: revise-treatment の
      // 再生成中で無事に進む注文と、中身が壊れているので作り直したい注文
      // （実例: 英語ブリーフに日本語が混ざったトリートメント）。前者を
      // 黙って上書きすると、顧客が今読んでいる文書が足元で入れ替わる。
      // 後者を禁じると admin に打つ手がなくなる。なので禁止ではなく、
      // 呼び出し側に明示的な意思表示を要求する。
      if (order.treatmentText && !overwriteExisting) {
        return {
          ok: false,
          needsOverwriteConfirm: true,
          error:
            "この注文にはすでにトリートメントがあります。顧客が読んでいる可能性があります。作り直す場合は確認のうえ再実行してください。",
        };
      }
      if (!order.customBrief) {
        // 起こらないはず（submit-photos がこの遷移の直前に必ず保存する）が、
        // 念のための防御。
        return { ok: false, error: "この注文にはブリーフが保存されていません。" };
      }

      const result = await runTreatmentGeneration(
        order.id,
        { brief: order.customBrief, petName: order.petName ?? "Your Star" },
        {
          actor: "admin",
          successNote: "admin re-kick: treatment drafted, awaiting customer approval",
          revertNote: "admin re-kick: treatment generation failed — reverted for retry",
        }
      );
      if (result.status === "rejected") {
        return { ok: false, error: `トリートメントが却下されました: ${result.reason}` };
      }
      if (result.status === "error") {
        return {
          ok: false,
          error: "トリートメント生成に失敗しました。もう一度お試しください。",
        };
      }
      // status === "ok" -> 下の共通の revalidate + {ok:true} へ続く。
    } else {
      return {
        ok: false,
        error: `この注文は生成中ではありません（現在: ${order.status}）。ページを更新してください。`,
      };
    }
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error: "この注文はすでに処理が進んでいる可能性があります。ページを更新してください。",
      };
    }
    console.error("[rekickGenerationAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type RetryFilmResult = { ok: true } | { ok: false; error: string };

/**
 * FAILED -> admin retry. Atomically moves the order back to VIDEO_GENERATING
 * and clears failureReason in the same transaction (double-click safe: the
 * second click hits a stale status and errors), then re-kicks the film
 * pipeline — kickFilmGeneration resumes from filmArtifacts, so already-
 * generated clips/music are never re-spent.
 */
export async function retryFilmAction(orderId: string): Promise<RetryFilmResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  try {
    const updated = await transitionOrder(
      orderId,
      OrderStatus.FAILED,
      OrderStatus.VIDEO_GENERATING,
      "admin",
      { failureReason: null },
      "admin retry"
    );
    await kickFilmGeneration(updated);
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error: "この注文はFAILEDではありません — すでに再実行されている可能性があります。キューを更新してください。",
      };
    }
    console.error("[retryFilmAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type MarkRefundIssuedResult = { ok: true } | { ok: false; error: string };

/**
 * B2-SAFETY-NET-SPEC.md §4.3 — the admin has ALREADY issued the
 * REFUND_AMOUNT_USD refund by hand in the Stripe dashboard (this app never
 * calls Stripe's refund API and never computes the amount — a human reads
 * the figure off the disclosed policy and types it into Stripe directly).
 * This button only RECORDS that it happened: it stamps refundIssuedAt and
 * moves the order to the existing
 * CANCELLED terminal state (no new OrderStatus value — a refund is an
 * attribute of an order, not a new stage, per spec §2/§4.3).
 *
 * Guarded by transitionOrder's atomic status check (AWAITING_CUSTOMER_APPROVAL
 * -> CANCELLED, added to lib/orders.ts's ALLOWED_TRANSITIONS for this
 * feature), so a double-click cannot send two confirmation emails or fire
 * the transition twice — the second click hits a stale status and errors,
 * same pattern as every other admin action in this file.
 */
export async function markRefundIssuedAction(orderId: string): Promise<MarkRefundIssuedResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, error: "注文が見つかりません。" };
  }
  // Belt-and-braces: the button only renders when refundRequestedAt is set
  // (see app/admin/[orderId]/page.tsx), but a direct action call should
  // still refuse to record a refund nobody asked for.
  if (!order.refundRequestedAt) {
    return { ok: false, error: "この注文には返金要求がありません。" };
  }

  try {
    const updated = await transitionOrder(
      orderId,
      OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      OrderStatus.CANCELLED,
      "admin",
      { refundIssuedAt: new Date() },
      `B2: $${REFUND_AMOUNT_USD} refund recorded as issued (Stripe dashboard, manual)`
    );
    try {
      const { sendRefundIssuedEmail } = await import("@/lib/mocks");
      await sendRefundIssuedEmail(updated);
    } catch (emailErr) {
      // Never let a confirmation-email failure hide that the refund WAS
      // recorded — same non-fatal posture as every other email side effect
      // in this file.
      console.error(`[markRefundIssuedAction] confirmation email failed (non-fatal) order=${orderId}`, emailErr);
    }
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error: "この注文は返金を記録できる状態ではありません — すでに処理済みか、Gate 1 を通過済みの可能性があります。ページを更新してください。",
      };
    }
    console.error("[markRefundIssuedAction]", err);
    return { ok: false, error: "サーバー側でエラーが発生しました。もう一度お試しください。" };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}

export type ResendCustomerEmailResult = { ok: true } | { ok: false; error: string };

/**
 * B-6 — resend the customer-facing lifecycle email for the order's CURRENT
 * status (does not change status; the customer link is the same
 * approveToken-based magic link regardless of how many times it's resent).
 */
export async function resendCustomerEmailAction(
  orderId: string
): Promise<ResendCustomerEmailResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, error: "注文が見つかりません。" };
  }

  try {
    switch (order.status) {
      case OrderStatus.UPLOADING:
        await sendWelcomeUploadEmail(order);
        break;
      case OrderStatus.AWAITING_CUSTOMER_APPROVAL:
        await sendChooseStillEmail(order);
        break;
      case OrderStatus.COMPLETED:
        await sendDeliveryEmail(order);
        break;
      default:
        return {
          ok: false,
          error: "この状態では再送できる案内メールがありません。",
        };
    }
  } catch (err) {
    console.error("[resendCustomerEmailAction]", err);
    return { ok: false, error: "メール送信でエラーが発生しました。" };
  }

  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}


export type ResubmitPodResult = { ok: true; podOrderId: string } | { ok: false; error: string };

/**
 * Re-submit a paid physical add-on to Printify.
 *
 * lib/mocks.ts#createPodOrder deliberately swallows POD failures so a print
 * problem can never block film delivery, and its own comment says the admin
 * must "manually submit the Printify order" when that fires — but there was no
 * way to. The first real add-on purchase proved why that gap matters: a
 * whitespace-corrupted PRINTIFY_API_KEY meant the customer paid, saw "your
 * printed poster is on its way", and nothing was ever sent to the printer.
 * Fixing the key does not rescue the order that already failed; this does.
 *
 * Guards: the add-on must be paid for (addonType + a Stripe session) and not
 * already submitted (podOrderId), so pressing this twice cannot produce two
 * physical prints. Clear the existing podOrderId in Printify first if a
 * genuine re-print is ever needed.
 */
export async function resubmitPodOrderAction(orderId: string): Promise<ResubmitPodResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return { ok: false, error: "注文が見つかりません。" };
    }
    if (!order.addonType || !order.addonStripeSessionId) {
      return { ok: false, error: "この注文には支払い済みの物理アドオンがありません。" };
    }
    if (order.podOrderId) {
      return {
        ok: false,
        error: `すでにPrintifyへ発注済みです（${order.podOrderId}）。再印刷が必要な場合はPrintify側で対応してください。`,
      };
    }

    // createPrintifyOrder throws with an actionable message (missing shipping
    // address, bad key, Printify 4xx) — surface it instead of the log-only
    // treatment createPodOrder gives it, since an admin is watching this time.
    const { createPrintifyOrder } = await import("@/lib/printify");
    const result = await createPrintifyOrder(order);
    if (!result) {
      return { ok: false, error: "Printifyが未設定です（PRINTIFY_* の環境変数を確認してください）。" };
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { podOrderId: result.printifyOrderId },
    });
    console.log(`[pod] re-submitted by admin order=${orderId} printifyOrderId=${result.printifyOrderId}`);
    revalidatePath(`/admin/${orderId}`);
    return { ok: true, podOrderId: result.printifyOrderId };
  } catch (err) {
    console.error("[resubmitPodOrderAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Printifyへの発注でエラーが発生しました。",
    };
  }
}

export type CreateGiftOrderResult =
  | { ok: true; orderId: string; approveUrl: string }
  | { ok: false; error: string };

/**
 * 無償枠（クリエイター向けシーディング）を1件発行する。
 *
 * これがあるまで、注文を作れるのは Stripe の webhook だけだった
 * （アプリ全体で `prisma.order.create` は1箇所）。無償で誰かに配るには
 * 決済を通らない入口が要る。
 *
 * **パイプラインには一切触っていない。** 作られる注文は通常の注文と同じ
 * `UPLOADING` から始まり、写真提出・トリートメント・絵コンテ・納品まで
 * 完全に同じ経路を通る。分岐を作らないのが安全側で、無償枠だけ別の道を
 * 通ると、そこだけテストされないコードになる。
 *
 * `stripeSessionId` は必須かつユニークなので `gift_<orderId>` を入れる。
 * 実在する Stripe のセッションと衝突しない形にしてあり、値を見れば
 * 決済を通っていないことが分かる。
 *
 * `giftedTo` は必須にしている。誰に配ったか分からない無償枠は、後から
 * 「同意記録を失った有料注文」と見分けがつかなくなる（schema参照）。
 */
export async function createGiftOrderAction(input: {
  email: string;
  tier: "preset" | "custom";
  giftedTo: string;
}): Promise<CreateGiftOrderResult> {
  const email = input.email?.trim();
  const giftedTo = input.giftedTo?.trim();

  // メールは配信先そのもの。ここが空や不正だと、生成だけ走って誰にも届かない。
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "有効なメールアドレスを入力してください。" };
  }
  if (!giftedTo) {
    return { ok: false, error: "配布先（クリエイター名/ハンドル）は必須です。" };
  }
  if (input.tier !== "preset" && input.tier !== "custom") {
    return { ok: false, error: "プランが不正です。" };
  }

  try {
    const order = await prisma.order.create({
      data: {
        // 一意制約を満たしつつ、決済を通っていないことが値から分かる形。
        stripeSessionId: `gift_${crypto.randomUUID()}`,
        customerEmail: email,
        tier: input.tier,
        amountPaidCents: 0,
        giftedTo,
        status: OrderStatus.UPLOADING,
      },
    });

    // この注文に checkout.consent が無い理由を、記録として残す。
    // 「証拠が無い」ことが意味を持つ設計なので、無い理由も残す必要がある。
    await recordEvidence(order.id, "order.gifted", { giftedTo, tier: input.tier });

    // 有料注文とまったく同じ案内メール。無償枠だけ別の文面にすると、
    // 相手が受け取る体験が本番と違ってしまい、検証にならない。
    // 送信失敗で発行自体を失敗させない — リンクは下で返すので手渡しできる。
    try {
      const { sendWelcomeUploadEmail } = await import("@/lib/mocks");
      await sendWelcomeUploadEmail(order);
    } catch (err) {
      console.error(`[gift] welcome email failed order=${order.id} (発行は成功)`, err);
    }

    const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
    console.log(`[gift] issued order=${order.id} tier=${input.tier} to=${giftedTo} <${email}>`);
    revalidatePath("/admin");
    return { ok: true, orderId: order.id, approveUrl: `${base}/approve/${order.approveToken}` };
  } catch (err) {
    console.error("[createGiftOrderAction]", err);
    return { ok: false, error: "無償枠の発行に失敗しました。もう一度お試しください。" };
  }
}
