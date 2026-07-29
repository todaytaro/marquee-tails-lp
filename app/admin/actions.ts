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
 *   - 絵コンテ: 写真解析とアイデンティティ画像がキャッシュ済みならスキップ
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
      const { kickStillsGeneration } = await import("@/lib/stills-pipeline");
      await kickStillsGeneration(order);
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

