import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeStoryboard } from "@/lib/stills-pipeline";
import { recordEvidence } from "@/lib/evidence";

/**
 * Same-origin download proxy for the customer's deliverables.
 *
 * WHY THIS EXISTS: every asset this product makes lives on fal's CDN, and
 * browsers ignore the `download` attribute on a cross-origin link. So every
 * "Download your film" button on the delivery page has, since it shipped,
 * opened the video in a tab instead of saving it — including the two things
 * a customer actually paid $99–$249 for. The bug is invisible from the code
 * (the attribute is right there) and invisible in testing unless you watch
 * where the file lands. Routing through this origin makes the attribute
 * meaningful again and lets us name the file, which was also being silently
 * discarded.
 *
 * WHAT IT WILL NOT DO: take a URL. An endpoint that fetches whatever you
 * point it at is an open proxy and an SSRF hole — it would happily read
 * internal addresses on our behalf. Callers name an ORDER (by its approve
 * token, which is already this product's only auth) and an ASSET KIND; the
 * URL is looked up server-side, so the set of fetchable things is exactly the
 * set of things we generated for that order and nothing else.
 *
 * The token is the same secret that lets someone view the order at all, so
 * this grants nothing the approve page doesn't already: if you can see the
 * film, you can save the film.
 */

export const dynamic = "force-dynamic";

/** Asset kinds a caller may ask for, mapped to how each is resolved. */
type Kind = "film" | "social" | "poster" | "take";

function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const token = params.get("token");
  const kind = params.get("kind") as Kind | null;
  if (!token || !kind) return bad(400, "Missing token or kind.");

  const order = await prisma.order.findUnique({
    where: { approveToken: token },
    select: {
      id: true,
      petName: true,
      finalVideoUrl: true,
      socialVideoUrl: true,
      posterPrintUrl: true,
      storyboardOptions: true,
    },
  });
  if (!order) return bad(404, "Not found.");

  const slug = (order.petName ?? "your-star").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "your-star";

  let url: string | null = null;
  let filename = "";

  switch (kind) {
    case "film":
      url = order.finalVideoUrl;
      filename = `${slug}-marquee-tails.mp4`;
      break;
    case "social":
      url = order.socialVideoUrl;
      filename = `${slug}-marquee-tails-vertical.mp4`;
      break;
    case "poster":
      // posterPrintUrl, not posterUrl — see PremiereView's comment: posterUrl
      // is the text-free art whose title block is only a CSS overlay, so it
      // is not the poster anyone thinks they are downloading.
      url = order.posterPrintUrl;
      filename = `${slug}-marquee-tails-poster.png`;
      break;
    case "take": {
      const cut = Number(params.get("cut"));
      const take = Number(params.get("take"));
      if (!Number.isInteger(cut) || !Number.isInteger(take) || cut < 0 || take < 0) {
        return bad(400, "Bad cut/take.");
      }
      const storyboard = normalizeStoryboard(order.storyboardOptions);
      url = storyboard[cut]?.options[take]?.preview ?? null;
      filename = `${slug}-scene-${cut + 1}-take-${take + 1}.png`;
      break;
    }
    default:
      return bad(400, "Unknown asset kind.");
  }

  // Null means this order has no such asset — not yet rendered, or never will
  // be. Indistinguishable from a bad kind on purpose; there is nothing useful
  // to tell an unauthenticated caller here.
  if (!url) return bad(404, "Not found.");

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    console.error(`[download] upstream ${upstream.status} for kind=${kind} order-token=${token.slice(0, 8)}…`);
    return bad(502, "The file couldn't be fetched just now. Please try again.");
  }

  // CHARGEBACK-DEFENSE-SPEC.md §3 download.* / §7 proof 3 — recorded ONLY
  // here, after the upstream fetch above has already succeeded: a 404/502
  // never reaches this line, so a failed download can never be logged as a
  // successful one. "Receipt of the deliverable" is the strongest evidence a
  // digital-goods dispute can produce (§0 point 3) — recording a download
  // that didn't actually happen would be worse than not recording at all.
  // Never throws (lib/evidence.ts).
  await recordEvidence(
    order.id,
    `download.${kind}` as const,
    kind === "take" ? { cut: Number(params.get("cut")), take: Number(params.get("take")) } : { filename },
    req
  );

  // Stream rather than buffer: these are 60-second films, and holding one in
  // memory per concurrent download is the kind of thing that works fine until
  // two people click at once.
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // The whole point. `download` on the <a> is advisory and cross-origin
      // browsers drop it; this header is not advisory.
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length") as string }
        : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
