import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Client-upload token endpoint for pet photos.
 *
 * Vercel rejects any serverless function request body over ~4.5MB before our
 * handler code ever runs, so real phone photos (5 x several MB) can't be
 * POSTed to us directly in production. Instead the browser uploads straight
 * to Vercel Blob (see components/PhotoUploadForm.tsx) using a short-lived
 * client token minted here, then sends us only the resulting URLs
 * (app/api/orders/submit-photos/route.ts).
 *
 * `onBeforeGenerateToken` is the only auth gate in this flow — same
 * token-as-auth model as the rest of the approve-page routes (approveToken
 * matched against the order, no login). We additionally require the order to
 * still be UPLOADING so a finished (or someone else's) order can't be used as
 * free, unbounded storage once its upload window has closed.
 */
export async function POST(req: Request) {
  try {
    // Parsed inside the try so a malformed body answers 400 like every other
    // guard here, rather than surfacing as an unhandled 500.
    const body = (await req.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let payload: { orderId?: string; approveToken?: string };
        try {
          payload = JSON.parse(clientPayload ?? "{}");
        } catch {
          throw new Error("Invalid client payload.");
        }
        const { orderId, approveToken } = payload;
        if (!orderId || !approveToken) {
          throw new Error("orderId and approveToken are required.");
        }

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.approveToken !== approveToken) {
          throw new Error("Order not found.");
        }
        if (order.status !== OrderStatus.UPLOADING) {
          throw new Error("Order is not accepting uploads.");
        }

        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
          ],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // Doesn't fire on localhost, and we deliberately don't depend on it —
      // the client already gets the blob URL back from upload() and POSTs it
      // to submit-photos itself, which independently validates it.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    // A refused token aborts the whole upload with only a generic client-side
    // message, so log the reason — otherwise this is a 400 with no trace.
    console.error("[upload-token] refused", error);
    // Blob's client expects a JSON error body; keep it generic and don't leak
    // which auth check failed (mirrors the other approve-page routes' "same
    // response for not found and bad token" posture).
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Upload token request failed." },
      { status: 400 }
    );
  }
}
