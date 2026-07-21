import { SignJWT, jwtVerify } from "jose";

/**
 * Signed httpOnly session cookie for the single-admin login (app/admin/login).
 * Uses jose (Web Crypto) so this module works both in the Edge middleware
 * (verify) and in Node server actions (sign) — see ADMIN-AUTH-SPEC.md §3.
 *
 * This is separate from ADMIN_API_SECRET, which stays a raw shared-secret
 * header check for /api/admin/* (programmatic clients / e2e — unchanged).
 */

const COOKIE_NAME = "admin_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(key());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, key());
    return true;
  } catch {
    return false;
  }
}

export const ADMIN_COOKIE = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = MAX_AGE_SEC;
