# 管理画面 認証強化 実装仕様書

> 対象: `~/Projects/marquee-tails/lp`
> 決定（オーナー・2026-07-21）: Option A = **ログインページ＋署名付きhttpOnlyセッションcookie**（単一管理者・`jose`・Edge互換）。重い認証ライブラリは入れない。
> 目的: 現状の「生シークレットをそのままcookie/Basic認証」を、署名付き・期限付き・httpOnlyの本物のセッションに置き換える。

---

## 0. 現状（`middleware.ts`）

`/admin/:path*` と `/api/admin/:path*` を単一の `ADMIN_API_SECRET` で保護。3経路: (1) `x-admin-secret` ヘッダ (2) Basic認証(admin:SECRET) (3) 生シークレットをそのまま `admin_secret` cookie。コード自身が「本物のセッション認証が来るまでの暫定」と明記。

**弱点**: 生シークレットがcookieに乗る／毎リクエストでシークレット送信／ログイン・ログアウト・期限の概念なし。

---

## 1. 方針

- **ブラウザ（`/admin/*`）**: `/admin/login` でパスワード認証 → **署名付きJWTセッションcookie**（httpOnly・secure・SameSite=Lax・7日期限）を発行。未認証は `/admin/login` へリダイレクト。
- **API（`/api/admin/*`）**: 従来どおり `x-admin-secret` ヘッダ（`ADMIN_API_SECRET`）で認証（プログラム/e2e用）。**変更しない**＝e2eを壊さない。
- **署名**: `jose`（Edge互換のJWT。middleware=Edgeでverify、ログインroute=Nodeでsign）。生シークレットはcookieに置かない。
- Basic認証と「生シークレットcookie」経路は**廃止**。

`npm i jose`

---

## 2. 環境変数（`.env` / `.env.example`）

- `ADMIN_PASSWORD` — 管理画面ログインのパスワード（新規）
- `SESSION_SECRET` — JWT署名鍵（新規・十分長いランダム文字列）
- `ADMIN_API_SECRET` — **維持**（`x-admin-secret` ヘッダ用・API/e2e）

`.env.example` にコメント付きで3つとも記載（`ADMIN_PASSWORD`/`SESSION_SECRET` は新規追記。値は空）。オーナーが実値を入れる。

---

## 3. `lib/admin-session.ts`（新規）

`jose` で署名/検証。Edgeとnode両方から使えるように（Web Crypto ベースの jose を使用）:
```ts
import { SignJWT, jwtVerify } from "jose";

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
  try { await jwtVerify(token, key()); return true; } catch { return false; }
}

export const ADMIN_COOKIE = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = MAX_AGE_SEC;
```

---

## 4. ログイン `/admin/login`

- `app/admin/login/page.tsx`: パスワード入力フォーム（Premiere Night配色・日本語UI「管理者ログイン」）。サーバーアクション `loginAction` を呼ぶ。エラー時はインライン表示（「パスワードが違います」）。
- `loginAction`（`app/admin/login/actions.ts` など、`"use server"`）:
  1. 入力パスワードを `process.env.ADMIN_PASSWORD` と比較（できれば `node:crypto` の `timingSafeEqual` で定数時間比較。長さ違いは先に弾く）。
  2. 一致: `createSessionToken()` → cookie `admin_session` を **httpOnly, secure, sameSite:"lax", path:"/", maxAge:ADMIN_COOKIE_MAX_AGE** でセット（`next/headers` の `cookies()`）。`redirect("/admin")`。
  3. 不一致: `{ ok:false, error }` を返す。
- **`/admin/login` は認証ゲートの対象外**にする（§5でmiddleware側に例外を入れる。さもないとリダイレクトループ）。

## 4b. ログアウト
- `app/admin/logout/route.ts`（or actions）: cookie削除 → `redirect("/admin/login")`。
- 管理ダッシュボード（`app/admin/page.tsx` ヘッダ）に小さな「ログアウト」リンク/ボタンを追加。

---

## 5. `middleware.ts` 書き換え

- **matcher は現状維持**（`/admin/:path*`, `/api/admin/:path*`）。middleware関数を `async` に。
- ロジック:
  1. パスが `/admin/login`（およびログイン用アクション/静的資産で必要なもの）なら **そのまま通す**（未認証で入れる）。
  2. `/api/admin/*`: `x-admin-secret === ADMIN_API_SECRET` なら通す、無ければ 401（現状の挙動を維持）。
  3. `/admin/*`: `admin_session` cookie を `verifySessionToken` で検証 → OKなら通す。NGなら **`/admin/login` へ 307 リダイレクト**（元URLを `?from=` に載せてログイン後に戻すのは任意）。
  4. 後方互換で `x-admin-secret` ヘッダが正しければ `/admin/*` も通す（任意・APIツールから画面を叩く場合。残してよい）。
- **Basic認証経路と生シークレットcookie経路は削除**。
- Edge実行: `jose` の `jwtVerify` はEdgeで動く（Web Crypto）。Prisma/Node API は使わない。

> Next 16 は `middleware.ts` を `proxy.ts` に改名する非推奨警告を出すが、**今回のスコープ外**（`middleware.ts` のまま編集。proxy移行は別タスク）。

---

## 6. 検証

1. `npx tsc --noEmit` / `npx eslint`（変更ファイル）クリーン。
2. **mock e2e**: `x-admin-secret` ヘッダ経路は不変なので **21/21 維持**を確認（`DATABASE_URL=... VIDEO_PIPELINE_MOCK=1 BASE_URL=... npx tsx scripts/e2e-state-machine.ts`）。件数を報告。
3. `npx next build` 成功（middleware＋login page＋jose）。
4. ブラウザ（devサーバは `VIDEO_PIPELINE_MOCK=1` かつ **`.env` に `ADMIN_PASSWORD` と `SESSION_SECRET` が要る**。テスト用に一時的に `ADMIN_PASSWORD=test SESSION_SECRET=dev-only-secret-please-change` を `.env` に入れて確認し、**確認後その2行は削除**するか、`.env.example` の値は空のままにする — オーナーの本番値は勝手に作らない）:
   - 未認証で `/admin` にアクセス → `/admin/login` にリダイレクトされる
   - 誤パスワード → エラー表示、cookie未発行
   - 正パスワード → `/admin` に入れる、以後リロードしても維持（cookie）、ログアウトで `/admin/login` に戻る
   - コンソールエラーなし。スクリーンショット（login画面＋認証後の/admin）。

---

## 7. 注意 / スコープ外
- 単一管理者前提（ユーザーDB・複数アカウント・パスワードリセットはやらない）。
- `middleware.ts`→`proxy.ts` 移行は別タスク。
- `ADMIN_API_SECRET` は残す（API/e2e）。オーナーは本番で `ADMIN_PASSWORD`・`SESSION_SECRET` を強い値で設定すること（`.env.example` にその旨コメント）。
- 生成ロジック・注文フローには触れない。
