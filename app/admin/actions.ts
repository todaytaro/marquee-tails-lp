"use server";

import { revalidatePath } from "next/cache";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { approveVideo } from "@/lib/approvals";
import { kickFilmGeneration, kickShotRerender } from "@/lib/film-pipeline";
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
  adminNote?: string
): Promise<ApproveVideoResult> {
  if (!orderId) {
    return { ok: false, error: "orderId が必要です。" };
  }

  try {
    await approveVideo(orderId, adminNote?.trim() ? adminNote.trim() : undefined);
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

export type RekickGenerationResult = { ok: true } | { ok: false; error: string };

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
 */
export async function rekickGenerationAction(
  orderId: string
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
    } else {
      return {
        ok: false,
        error: `この注文は生成中ではありません（現在: ${order.status}）。ページを更新してください。`,
      };
    }
  } catch (err) {
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
 * B2-SAFETY-NET-SPEC.md §4.3 — the admin has ALREADY issued the $200 refund
 * by hand in the Stripe dashboard (this app never calls Stripe's refund API
 * and never computes the amount — a human reads $200 off the disclosed
 * policy and types it into Stripe directly). This button only RECORDS that
 * it happened: it stamps refundIssuedAt and moves the order to the existing
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
      "B2: $200 refund recorded as issued (Stripe dashboard, manual)"
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
