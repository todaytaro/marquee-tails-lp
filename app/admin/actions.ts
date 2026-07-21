"use server";

import { revalidatePath } from "next/cache";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { transitionOrder, TransitionError } from "@/lib/orders";
import { approveVideo } from "@/lib/approvals";
import { kickFilmGeneration, kickShotRerender } from "@/lib/film-pipeline";

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

