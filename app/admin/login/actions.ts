"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, createSessionToken } from "@/lib/admin-session";

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Constant-time string compare (length-safe: mismatched lengths short-circuit
 * before touching timingSafeEqual, which throws on unequal-length buffers). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Single-admin login (ADMIN-AUTH-SPEC.md §4). Compares the submitted password
 * against ADMIN_PASSWORD in constant time; on success signs a session JWT
 * (lib/admin-session) and sets it as an httpOnly cookie, then redirects to
 * /admin. On failure returns {ok:false} for the form to render inline —
 * never throws, so no cookie is ever set on a bad password.
 */
export async function loginAction(password: string): Promise<LoginResult> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error("[loginAction] ADMIN_PASSWORD is not set");
    return { ok: false, error: "サーバー側の設定エラーです。管理者に連絡してください。" };
  }

  if (!password || !safeEqual(password, expected)) {
    return { ok: false, error: "パスワードが違います。" };
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });

  redirect("/admin");
}
