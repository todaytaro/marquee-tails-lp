import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin gate — protects /admin (dashboard) and /api/admin (API routes).
 *
 * Three ways in:
 * 1. x-admin-secret header equal to ADMIN_API_SECRET — existing API clients
 *    and e2e tests pass through unchanged (routes still do their own check).
 * 2. HTTP Basic auth, user "admin", password ADMIN_API_SECRET — humans in a
 *    browser get the native login prompt.
 * 3. admin_secret cookie equal to ADMIN_API_SECRET — for environments where
 *    the Basic-auth dialog is unavailable (embedded browsers). Set once via
 *    devtools: document.cookie = "admin_secret=<SECRET>; path=/". Interim
 *    until real session auth ships with the admin app.
 *
 * Edge runtime: header string checks only, no Prisma / Node APIs.
 */
export function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_API_SECRET;

  // Exception: valid shared-secret header passes through unchanged.
  if (secret && req.headers.get("x-admin-secret") === secret) {
    return NextResponse.next();
  }

  // Cookie session (manual, interim).
  if (secret && req.cookies.get("admin_secret")?.value === secret) {
    return NextResponse.next();
  }

  // Otherwise require Basic auth (admin:SECRET). If the secret is not
  // configured at all, fail closed.
  if (secret) {
    const expected = `Basic ${btoa(`admin:${secret}`)}`;
    if (req.headers.get("authorization") === expected) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Marquee Tails Admin"' },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
