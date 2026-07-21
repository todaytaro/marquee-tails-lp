import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-session";

/**
 * Admin gate — protects /admin (dashboard) and /api/admin (API routes).
 *
 * - /admin/login is always let through unauthenticated (no redirect loop).
 * - /api/admin/*: x-admin-secret header equal to ADMIN_API_SECRET, unchanged
 *   from before — existing API clients and e2e tests keep working as-is.
 * - /admin/*: requires a valid admin_session cookie (signed JWT, see
 *   lib/admin-session.ts). Missing/invalid -> 307 redirect to /admin/login.
 *   A correct x-admin-secret header is also accepted here as a back-compat
 *   bypass for API tooling that drives the dashboard directly.
 *
 * Basic auth and the raw-secret cookie paths from the interim version are
 * gone — see ADMIN-AUTH-SPEC.md.
 *
 * Edge runtime: jose's jwtVerify runs on Web Crypto, no Prisma / Node APIs.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login page itself must stay reachable while unauthenticated.
  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_API_SECRET;
  const hasValidApiSecret = Boolean(
    secret && req.headers.get("x-admin-secret") === secret
  );

  if (pathname.startsWith("/api/admin")) {
    if (hasValidApiSecret) {
      return NextResponse.next();
    }
    return new NextResponse("Authentication required.", { status: 401 });
  }

  // /admin/* — session cookie, with the shared-secret header as a bypass.
  if (hasValidApiSecret) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifySessionToken(sessionCookie)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", req.url);
  return NextResponse.redirect(loginUrl, 307);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
