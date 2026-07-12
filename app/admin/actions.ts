"use server";

import { revalidatePath } from "next/cache";
import { TransitionError } from "@/lib/orders";
import { approveVideo } from "@/lib/approvals";

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
    return { ok: false, error: "orderId is required." };
  }

  try {
    await approveVideo(orderId, adminNote?.trim() ? adminNote.trim() : undefined);
  } catch (err) {
    if (err instanceof TransitionError) {
      return {
        ok: false,
        error:
          "Order is not awaiting admin approval — it may have been approved already. Refresh the queue.",
      };
    }
    console.error("[approveVideoAction]", err);
    return { ok: false, error: "Something went wrong on our end. Try again." };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${orderId}`);
  return { ok: true };
}
