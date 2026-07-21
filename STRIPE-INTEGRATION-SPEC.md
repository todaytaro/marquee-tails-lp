# Stripe決済 配線実装仕様書

> 対象: `~/Projects/marquee-tails/lp`
> 位置づけ: **配線のみ**。LPの見た目・CTA・「waitlist」文言は一切変更しない（オーナー決定・2026-07-20）。
> 決済導線（Checkout API + webhook + 注文自動作成）を実装し、いつでも「Buyボタン」を生やせる状態にする。
> Stripeの秘密鍵はまだ`.env`に無い。オーナーが後で自分で入れる（鍵の値自体はこの実装作業では扱わない）。

---

## 0. 現状（調査済み）

- `.env`にSTRIPE系キーは無い。`stripe` npmパッケージも未インストール（最新版 22.3.2 確認済み）。
- `prisma/schema.prisma`のOrderモデルに**決済ティアを記録するフィールドが無い**（`tier`が存在しない）。`lib/mocks.ts:145`のコメント「skip for $49 digital-only tier」は将来のtier概念を前提にしているが未実装。
- `shopifyOrderId String @unique`というフィールドが残っているが、Shopifyは不採用確定（過去の会話でStripeに決定済み）。このフィールド名のまま使うのは誤解を招くため、**`stripeSessionId`にリネームする**（プレローンチで実データ無し、リネームのリスクは低い）。
- 参照箇所（リネーム対象）: `scripts/live-storyboard.ts` / `scripts/seed-demo.ts` / `scripts/e2e-state-machine.ts` / `scripts/test-stills.ts` / `scripts/test-film.ts`
- 現在、実際の顧客が注文(Order行)を作る手段が存在しない（`seed-demo.ts`等の手動シードのみ）。`app/api/orders/submit-photos/route.ts`は**既存のorderId+approveTokenが必須**（UPLOADING状態の行が既に無いと動かない）。この「注文作成の入口」を今回のStripe webhookが埋める。
- 参考実装: `~/Downloads/L-mode/l-mode-app/src/lib/stripe/server.ts`（Stripeクライアントのシングルトン化パターン、env駆動のPrice ID解決、`getPriceId`/`priceIdToTier`の相互変換）。本実装もこのパターンを踏襲する。
- 既存の実webhook実装パターン: `app/api/webhooks/fal/route.ts`（shared-secret認証、冪等性はDBの状態ガードで担保、リプレイ時は200を返す）。
- 価格（`components/PricingTeaser.tsx`で確定済み、変更不要）: Digital Premiere $75 / Feature Film $129 / Collector's Edition $199。

---

## 1. Prismaスキーマ変更

`prisma/schema.prisma`のOrderモデルに対して:

1. `shopifyOrderId String @unique` → **`stripeSessionId String @unique`** にリネーム（Stripe Checkout SessionのIDを保持する）。
2. 新規フィールド追加:
   ```prisma
   tier            String?  // "digital" | "feature" | "collector" — Stripe決済完了時に確定
   amountPaidCents Int?     // 監査用: 実際にStripeで決済された金額（session.amount_total）
   ```
3. `npx prisma migrate dev --name stripe_checkout` でマイグレーション生成（DB: `postgresql://postgres:dev@localhost:55432/marquee`、Docker `marquee-pg`が起動していることを確認してから実行）。

### 影響範囲の追従修正
`shopifyOrderId`を参照している以下のファイルを`stripeSessionId`に一括で追従修正すること（値の中身はプレースホルダのままでよい、フィールド名だけ変える）:
- `scripts/live-storyboard.ts`
- `scripts/seed-demo.ts`
- `scripts/e2e-state-machine.ts`
- `scripts/test-stills.ts`
- `scripts/test-film.ts`

修正後、`npx tsx scripts/e2e-state-machine.ts`（VIDEO_PIPELINE_MOCK=1想定）を実行し、17件のアサーションが通ることを確認する。

---

## 2. `lib/stripe.ts`（新規）

l-mode-appの`src/lib/stripe/server.ts`と同じ設計思想（シングルトンクライアント、未設定時はnullを返しアプリ全体は動き続ける、env駆動のPrice ID解決）。

```ts
import Stripe from "stripe";

let _client: Stripe | null = null;

/**
 * Idempotent client getter. Returns null if STRIPE_SECRET_KEY isn't set —
 * callers must handle that (checkout API returns 503, rest of the app is
 * unaffected since nothing else depends on Stripe yet).
 */
export function getStripeClient(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _client = new Stripe(key, {
    typescript: true,
    appInfo: { name: "marquee-tails", url: process.env.APP_BASE_URL ?? "http://localhost:3100" },
  });
  return _client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type Tier = "digital" | "feature" | "collector";

/** Env var naming: STRIPE_PRICE_DIGITAL / STRIPE_PRICE_FEATURE / STRIPE_PRICE_COLLECTOR. */
export function getPriceId(tier: Tier): string | null {
  switch (tier) {
    case "digital":
      return process.env.STRIPE_PRICE_DIGITAL || null;
    case "feature":
      return process.env.STRIPE_PRICE_FEATURE || null;
    case "collector":
      return process.env.STRIPE_PRICE_COLLECTOR || null;
  }
}

/** Reverse lookup for the webhook: Price ID -> our tier enum. */
export function priceIdToTier(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRICE_DIGITAL) return "digital";
  if (priceId === process.env.STRIPE_PRICE_FEATURE) return "feature";
  if (priceId === process.env.STRIPE_PRICE_COLLECTOR) return "collector";
  return null;
}
```

`apiVersion`は明示的にオプションで渡さず、インストールした`stripe`パッケージの型定義が要求するデフォルト/最新のAPIバージョン文字列をそのまま使う（型エラーが出たらそのエラーメッセージが示す文字列をコピーして`apiVersion`に明示指定する）。

---

## 3. `.env.example` に追記（値は空のまま、コメントのみ）

```
# --- Stripe (payment plumbing — not yet wired to any Buy button) ---
# Test-mode keys from the Stripe Dashboard. Create 3 one-time Prices
# (Digital Premiere $75 / Feature Film $129 / Collector's Edition $199)
# and paste their Price IDs below.
# STRIPE_SECRET_KEY=""
# STRIPE_WEBHOOK_SECRET=""
# STRIPE_PRICE_DIGITAL=""
# STRIPE_PRICE_FEATURE=""
# STRIPE_PRICE_COLLECTOR=""
```

---

## 4. `app/api/checkout/route.ts`（新規）

POST専用。ボディ: `{ tier: "digital" | "feature" | "collector" }`

処理:
1. `tier`が3値のいずれでもなければ400。
2. `getStripeClient()`がnullなら503「Payments aren't configured yet.」
3. `getPriceId(tier)`がnullなら500（設定不備。ログに出す）。
4. Stripe Checkout Session作成:
   ```ts
   const session = await stripe.checkout.sessions.create({
     mode: "payment",
     line_items: [{ price: priceId, quantity: 1 }],
     success_url: `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url: `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/#pricing`,
   });
   ```
   - メールアドレスはStripe Checkoutのホスト型ページが標準で収集するので、こちら側にメール入力フォームは不要（`customer_email`は指定しない＝Stripeに任せる）。
5. `{ ok: true, url: session.url }`を返す。

エラー処理は既存の`app/api/orders/approve-storyboard/route.ts`等と同じトーン（`{ ok: false, error }`のJSON、適切なHTTPステータス）で揃える。

---

## 5. `app/api/webhooks/stripe/route.ts`（新規・最重要）

**署名検証が必須。生のリクエストボディが必要**なので、Next.js App RouterのRoute Handlerで`req.text()`を使う（`req.json()`を先に呼ぶと生バイト列が失われ検証が壊れるので絶対に呼ばない）。`app/api/webhooks/fal/route.ts`の冪等性の考え方（リプレイは200を返す）を踏襲する。

```ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient, priceIdToTier } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";

export async function POST(req: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "Stripe not configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await req.text(); // MUST be the raw body — do not req.json() first
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const customerEmail = session.customer_details?.email;
  if (!customerEmail) {
    console.error("[stripe-webhook] no customer email on session", session.id);
    return NextResponse.json({ ok: false, error: "No customer email." }, { status: 400 });
  }

  // Retrieve line items to resolve which Price (=tier) was purchased.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const priceId = lineItems.data[0]?.price?.id;
  const tier = priceId ? priceIdToTier(priceId) : null;
  if (!tier) {
    console.error("[stripe-webhook] could not resolve tier for session", session.id, priceId);
    return NextResponse.json({ ok: false, error: "Unknown price." }, { status: 400 });
  }

  try {
    const order = await prisma.order.create({
      data: {
        stripeSessionId: session.id,
        customerEmail,
        tier,
        amountPaidCents: session.amount_total ?? 0,
        status: OrderStatus.UPLOADING,
      },
    });
    console.log(`[stripe-webhook] order created id=${order.id} tier=${tier} email=${customerEmail}`);
    // Fire-and-forget: email the upload link. Never let an email failure
    // fail the webhook (Stripe would retry and we'd double-create — though
    // the unique stripeSessionId constraint below already guards that).
    try {
      const { sendWelcomeUploadEmail } = await import("@/lib/mocks");
      await sendWelcomeUploadEmail(order);
    } catch (emailErr) {
      console.error("[stripe-webhook] welcome email failed (non-fatal)", emailErr);
    }
  } catch (err: unknown) {
    // Unique constraint on stripeSessionId = replayed webhook for an order
    // we already created. Idempotent no-op, same as the fal webhook pattern.
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      console.warn(`[stripe-webhook] duplicate session, already processed: ${session.id}`);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[stripe-webhook] order creation failed", err);
    return NextResponse.json({ ok: false, error: "Order creation failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

**重要な注意点（実装者は必ず守ること）**:
- `req.text()`を呼ぶ前に`req.json()`や他のボディ読み取りを絶対にしないこと（署名検証が壊れる）。
- Stripe CLIでのローカルwebhookテスト方法をコメントかREADMEに残す: `stripe listen --forward-to localhost:3100/api/webhooks/stripe`（stripe CLIが入っていなければ「オーナーが後で自分でテストする」为提としてスキップしてよい）。
- `prisma.order.create`の一意制約違反(P2002)を「既に処理済みのリプレイ」として200で返す設計は**必須**（Stripeは非2xx応答に対して再送してくるため、正しく冪等にしないと重複注文が生まれる）。

---

## 6. `lib/mocks.ts` に `sendWelcomeUploadEmail` を追加

既存の`sendChooseStillEmail` / `sendDeliveryEmail`と同じ3段フォールバック（Klaviyoイベント → Resend直送 → console.logモック）のパターンをそのまま踏襲する。新しいKlaviyoイベント名は `"Order Paid"` とする。

```ts
export async function sendWelcomeUploadEmail(order: Order): Promise<void> {
  const link = approveUrl(order); // 既存のapproveUrl()ヘルパーをそのまま使う
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (apiKey) {
    await trackKlaviyoEvent(apiKey, "Order Paid", order, {
      order_id: order.id,
      tier: order.tier,
      approve_url: link,
    });
    return;
  }

  const resend = resendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: order.customerEmail,
      subject: `You're in! Let's meet your star`,
      html: `
        <p>Thanks for your order — time to send us the photos that'll become
        your pet's premiere.</p>
        <p><a href="${link}">Upload your pet's photos →</a></p>
        <p style="color:#888;font-size:12px">This is a private link, just for you.</p>
      `,
    });
    if (error) throw new Error(`Resend "welcome" send failed: ${JSON.stringify(error)}`);
    return;
  }

  console.log(
    `[mock:email] welcome/upload mail to=${order.customerEmail} order=${order.id} tier=${order.tier} link=/approve/${order.approveToken} — set KLAVIYO_API_KEY or RESEND_API_KEY to send for real`
  );
}
```
ファイル冒頭のJSDocコメント（3段フォールバックの説明）にこの新関数も一覧に加えて更新すること。

---

## 7. `app/checkout/success/page.tsx`（新規・サーバーコンポーネント）

Webhookの到達タイミングとブラウザのリダイレクトはレースになりうる（Stripeの既知の注意点）。**このページはDBのOrder行の存在に依存しない**。`session_id`クエリパラメータでStripe APIから直接セッションを取得し、確認メッセージを出すだけに留める。

```tsx
import { getStripeClient } from "@/lib/stripe";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const stripe = getStripeClient();
  const session = stripe && session_id
    ? await stripe.checkout.sessions.retrieve(session_id).catch(() => null)
    : null;
  const email = session?.customer_details?.email;

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center px-5 text-center">
      <h1 className="font-display text-3xl uppercase tracking-[0.06em] text-ivory">
        You&rsquo;re in!
      </h1>
      <p className="mt-4 text-muted">
        {email
          ? `We've sent your upload link to ${email}.`
          : "We've sent your upload link to your email."}{" "}
        Check your inbox to send us your pet&rsquo;s photos.
      </p>
    </main>
  );
}
```
既存のPremiere Night配色（`bg-night` / `text-ivory` / `text-muted` / `font-display`）に自然に馴染むよう、他ページのクラス命名に倣うこと。LPのCTA自体は変えないので、このページへの導線（Buyボタン）はまだLP上に存在しない — 直接URLでのみ到達可能なページになる（正しい。今回のスコープは配線のみ）。

---

## 8. 検証

1. `npx tsc --noEmit` / `npx eslint` クリーン。
2. `npx prisma migrate dev --name stripe_checkout` が通ること（Docker `marquee-pg`起動要）。
3. `npx tsx scripts/e2e-state-machine.ts`（`VIDEO_PIPELINE_MOCK=1`）で17アサーション全て通ること（`stripeSessionId`リネームが他のフローを壊していないことの確認）。
4. Stripeキー未設定の状態で `/api/checkout` にPOSTすると503が返ること（`isStripeConfigured()`が正しくfalseパスを通ることの確認 — 実際にキーが無くてもここまでは検証可能）。
5. `/checkout/success`にsession_idなしでアクセスしてもクラッシュしないこと（emailがundefinedの分岐を通る）。
6. ブラウザで`/checkout/success`（session_idなし）を開き、コンソールエラーが無いことをスクリーンショットで確認。

**Stripeキーが無いため、実際のcheckout session作成・webhook受信までは今回検証できない。** オーナーが`.env`にキーを入れた後、`stripe listen`等でエンドツーエンドの動作確認を別途行うこと。

---

## 9. 今回のスコープ外（明示）

- LPの見た目・CTA変更（Buyボタン設置、"No checkout yet" 文言の削除）は**やらない**。
- Founding Member 20%オフのStripeクーポン設定は**やらない**（[LP-CAMYU-SPEC.md](./LP-CAMYU-SPEC.md) §8で「実装時にクーポンを適用するだけ」と記録済み、クーポン自体の作成はStripeダッシュボード側の作業）。
- ギフトフロー（購入者≠受取人）は**やらない**。
- Printify POD連携（`lib/mocks.ts`の`createPodOrder`）は**このタスクの対象外**（別タスク）。
