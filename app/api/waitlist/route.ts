import { NextRequest, NextResponse } from "next/server";
import { addToWaitlist } from "@/lib/waitlist";

/**
 * POST /api/waitlist
 * Body (JSON): { email: string; company?: string }
 *   - "company" is a honeypot field. Humans never see it; if it is filled,
 *     we silently pretend success and store nothing.
 * Always responds { ok: true } on success. PII travels in the POST body only.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;

// Naive in-memory rate limit: 5 requests per IP per minute.
// Good enough for a pre-launch page; resets on redeploy/cold start.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map from growing unbounded.
  if (hits.size > 10_000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        hits.delete(key);
      }
    }
  }
  return false;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const { email, company } =
    typeof body === "object" && body !== null
      ? (body as { email?: unknown; company?: unknown })
      : {};

  // Honeypot tripped: pretend everything worked, store nothing.
  if (typeof company === "string" && company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  if (
    typeof email !== "string" ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_RE.test(email.trim())
  ) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  try {
    await addToWaitlist({
      email: email.trim().toLowerCase(),
      ts: new Date().toISOString(),
      ua: request.headers.get("user-agent") ?? "",
    });
  } catch (err) {
    console.error("[waitlist] failed to store signup:", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
