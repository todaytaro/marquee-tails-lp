# Printify POD 連携 実装仕様書

> 対象: `~/Projects/marquee-tails/lp`
> 前提: **`STRIPE-INTEGRATION-SPEC.md`の実装完了後に着手すること**（`prisma/schema.prisma`と`lib/mocks.ts`を両方触るため、並行作業は衝突する）。
> 対象は Feature Film($129) / Collector's Edition($199) のみ。Digital Premiere($75)は物理商品が無いため対象外（`lib/mocks.ts`の既存コメント通り）。

---

## 0. 現状（調査済み・2026-07-20）

- `lib/mocks.ts`の`createPodOrder(order)`は今もconsole.logモックのまま。`lib/approvals.ts:55`でGate 2承認完了時に呼ばれている（フック位置は変更不要、関数の中身だけ実装する）。
- **配送先住所を保存するフィールドがスキーマに一つも存在しない**（`prisma/schema.prisma`全体を確認済み）。これが最大のギャップ。
- 印刷用データは既に揃っている: `order.posterPrintUrl`（satoriでタイトル焼き込み済みの1800×2700 print-ready PNG。`lib/poster-print.ts`が生成）。これをそのままPrintifyの`print_areas`画像として使う。
- Printify APIは「事前にproduct作成→publish→order」という2段階に見えるが、**注文作成コール自体に`print_areas`（画像＋blueprint_id＋print_provider_id＋variant_id）をインラインで渡すと裏で自動生成される**（公式ドキュメント: "product creation as a result of Order creation is not limited" — 公開レート制限[200req/30min]の対象外）。よって**別途product作成・publishのAPI呼び出しは不要**。
- 認証: `Authorization: Bearer {token}`、`User-Agent`ヘッダ必須。ベースURL `https://api.printify.com/v1/`。
- Printifyの公式Node SDKは無い（コミュニティ製のみ、更新頻度が低い）。このプロジェクトの他の外部API連携（Klaviyo/Resend/fal）と同じく**生fetchで直接叩く**方針で統一する（新規の重い依存を増やさない）。

---

## 1. Prismaスキーマ変更（Stripeの移行完了後、別マイグレーションとして追加）

Orderモデルに追加:

```prisma
// Shipping — Feature Film / Collector's Edition のみ埋まる(Digitalは物理商品なし)。
// Stripe Checkout の shipping_address_collection から埋める想定(§4参照)。
shippingName       String?
shippingLine1      String?
shippingLine2      String?
shippingCity       String?
shippingRegion     String?  // state/province
shippingPostalCode String?
shippingCountry    String?  // ISO 3166-1 alpha-2 (e.g. "US")

// Printify連携の監査用
podOrderId String? // PrintifyのオーダーID（サポート対応・突合用）
podStatus  String? // Printifyから最後に確認できたステータス(任意のキャッシュ、無くても動く)
```

`npx prisma migrate dev --name pod_shipping`で生成。Stripeのマイグレーションと順序が入れ替わらないよう、必ずStripe側が先にマージされた状態で実行すること。

---

## 2. Printify Blueprint / Variant の事前調査（実装者が最初にやること）

Blueprint ID・Print Provider ID・Variant IDはハードコードできる固定値ではなく、Printifyのカタログから実際に選定する必要がある。実装者は以下を最初に実行して値を確定させる:

```bash
curl -H "Authorization: Bearer $PRINTIFY_API_KEY" -H "User-Agent: marquee-tails" \
  https://api.printify.com/v1/catalog/blueprints.json | jq '.[] | select(.title | test("Poster|Canvas"; "i"))'
```
「Feature Film用: 縦2:3のポスター印刷（フレームなし）」「Collector's用: 16×20ギャラリーキャンバス（額なし、既存business_strategy.mdの通り額装は採用しない）」に合うblueprint_idを選び、続けて
```bash
curl -H "Authorization: Bearer $PRINTIFY_API_KEY" -H "User-Agent: marquee-tails" \
  https://api.printify.com/v1/catalog/blueprints/{blueprint_id}/print_providers.json
curl -H "Authorization: Bearer $PRINTIFY_API_KEY" -H "User-Agent: marquee-tails" \
  https://api.printify.com/v1/catalog/blueprints/{blueprint_id}/print_providers/{print_provider_id}/variants.json
```
でprint_provider_idとvariant_id（サイズが16×20 / ポスターの2:3比率に一致するもの）を確定する。**この調査はオーナーのPrintifyアカウントに実際のPRINTIFY_API_KEYが入ってから行う**（鍵が無ければこのステップはスキップし、env変数名の配線だけ済ませて後回しにしてよい — §3参照）。

---

## 3. `.env.example` 追記

```
# --- Printify POD (Feature Film / Collector's Edition only) ---
# PRINTIFY_API_KEY=""          # Personal Access Token: printify.com/app/account/api
# PRINTIFY_SHOP_ID=""          # GET /v1/shops.json で確認
# PRINTIFY_BLUEPRINT_POSTER="" # Feature Film 用ポスター印刷のblueprint_id
# PRINTIFY_PROVIDER_POSTER=""
# PRINTIFY_VARIANT_POSTER=""
# PRINTIFY_BLUEPRINT_CANVAS="" # Collector's 用 16x20 ギャラリーキャンバスのblueprint_id
# PRINTIFY_PROVIDER_CANVAS=""
# PRINTIFY_VARIANT_CANVAS=""
```

---

## 4. Stripe Checkout側の追従変更（`app/api/checkout/route.ts`への追記・別コミットで実施）

Feature/Collector'sのみ配送先住所を収集する。Stripe実装完了後にこの1点だけ追記する:

```ts
const needsShipping = tier === "feature" || tier === "collector";

const session = await stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [{ price: priceId, quantity: 1 }],
  ...(needsShipping && {
    shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU"] }, // 要オーナー確認: 対応国
  }),
  success_url: `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${process.env.APP_BASE_URL ?? "http://localhost:3100"}/#pricing`,
});
```

対応国リスト(`allowed_countries`)はオーナー確認が必要（暫定でUS/CA/GB/AUを提案 — 英語圏中心の市場想定に合わせた）。

`app/api/webhooks/stripe/route.ts`の`checkout.session.completed`ハンドラで、`session.shipping_details`（Stripeが収集した住所）をOrderの新フィールドにマッピングして保存する:

```ts
const shipping = session.shipping_details;
// ...prisma.order.create の data に追加:
shippingName: shipping?.name ?? null,
shippingLine1: shipping?.address?.line1 ?? null,
shippingLine2: shipping?.address?.line2 ?? null,
shippingCity: shipping?.address?.city ?? null,
shippingRegion: shipping?.address?.state ?? null,
shippingPostalCode: shipping?.address?.postal_code ?? null,
shippingCountry: shipping?.address?.country ?? null,
```

---

## 5. `lib/printify.ts`（新規）

生fetchで直接叩く。既存の`lib/mocks.ts`のKlaviyo呼び出しと同じ流儀（Bearerトークン、JSONボディ、非2xxで例外）。

```ts
import type { Order } from "@/generated/prisma/client";

const PRINTIFY_BASE = "https://api.printify.com/v1";

type TierPrintConfig = {
  blueprintId: string;
  printProviderId: string;
  variantId: string;
};

function configFor(tier: string): TierPrintConfig | null {
  if (tier === "feature") {
    const { PRINTIFY_BLUEPRINT_POSTER, PRINTIFY_PROVIDER_POSTER, PRINTIFY_VARIANT_POSTER } = process.env;
    if (!PRINTIFY_BLUEPRINT_POSTER || !PRINTIFY_PROVIDER_POSTER || !PRINTIFY_VARIANT_POSTER) return null;
    return { blueprintId: PRINTIFY_BLUEPRINT_POSTER, printProviderId: PRINTIFY_PROVIDER_POSTER, variantId: PRINTIFY_VARIANT_POSTER };
  }
  if (tier === "collector") {
    const { PRINTIFY_BLUEPRINT_CANVAS, PRINTIFY_PROVIDER_CANVAS, PRINTIFY_VARIANT_CANVAS } = process.env;
    if (!PRINTIFY_BLUEPRINT_CANVAS || !PRINTIFY_PROVIDER_CANVAS || !PRINTIFY_VARIANT_CANVAS) return null;
    return { blueprintId: PRINTIFY_BLUEPRINT_CANVAS, printProviderId: PRINTIFY_PROVIDER_CANVAS, variantId: PRINTIFY_VARIANT_CANVAS };
  }
  return null; // "digital" or unknown — no physical good
}

/**
 * Submit a print order for the finished poster. Digital-tier orders are a
 * deliberate no-op (no physical good). Missing shipping address or missing
 * Printify config both throw — callers (lib/approvals.ts) must catch and log
 * loudly rather than block delivery, same pattern as the poster-print render.
 */
export async function createPrintifyOrder(order: Order): Promise<{ printifyOrderId: string } | null> {
  const config = configFor(order.tier ?? "");
  if (!config) return null; // digital tier, or Printify not configured yet

  const apiKey = process.env.PRINTIFY_API_KEY;
  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!apiKey || !shopId) throw new Error("Printify not configured (PRINTIFY_API_KEY/PRINTIFY_SHOP_ID missing)");

  if (!order.posterPrintUrl) throw new Error(`Order ${order.id} has no posterPrintUrl to print`);
  if (!order.shippingLine1 || !order.shippingCity || !order.shippingCountry) {
    throw new Error(`Order ${order.id} is missing a shipping address`);
  }

  const [firstName, ...rest] = (order.shippingName ?? "Customer").split(" ");
  const lastName = rest.join(" ") || "-";

  const res = await fetch(`${PRINTIFY_BASE}/shops/${shopId}/orders.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "marquee-tails",
    },
    body: JSON.stringify({
      external_id: order.id, // reconciliation
      label: `Marquee Tails — ${order.petName ?? order.id}`,
      line_items: [
        {
          print_provider_id: Number(config.printProviderId),
          blueprint_id: Number(config.blueprintId),
          variant_id: Number(config.variantId),
          quantity: 1,
          print_areas: {
            front: order.posterPrintUrl,
          },
        },
      ],
      shipping_method: 1, // standard — confirm against the print provider's shipping_methods.json if orders fail
      send_shipping_notification: true,
      address_to: {
        first_name: firstName,
        last_name: lastName,
        email: order.customerEmail,
        address1: order.shippingLine1,
        address2: order.shippingLine2 ?? "",
        city: order.shippingCity,
        region: order.shippingRegion ?? "",
        country: order.shippingCountry,
        zip: order.shippingPostalCode ?? "",
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Printify order failed: ${res.status} ${res.statusText} ${detail}`.trim());
  }
  const data = (await res.json()) as { id: string };
  return { printifyOrderId: data.id };
}
```

**要確認事項（実装者は`print_areas`のキー名をPrintifyの実際のブループリントのprint_areasレスポンス — §2で調査した`variants.json`のレスポンス — と突き合わせて確認すること**。ブループリントによって`front`ではなく別のプレースホルダ名（例: `default`）を要求する場合がある。

---

## 6. `lib/mocks.ts` の `createPodOrder` を実装に置き換え

```ts
export async function createPodOrder(order: Order): Promise<void> {
  if (order.tier === "digital" || !order.tier) {
    console.log(`[pod] skip — order=${order.id} tier=${order.tier ?? "unknown"} has no physical good`);
    return;
  }
  try {
    const { createPrintifyOrder } = await import("./printify");
    const result = await createPrintifyOrder(order);
    if (result) {
      const { prisma } = await import("./db");
      await prisma.order.update({ where: { id: order.id }, data: { podOrderId: result.printifyOrderId } });
      console.log(`[pod] Printify order created order=${order.id} printifyOrderId=${result.printifyOrderId}`);
    } else {
      console.log(`[pod] Printify not configured yet — order=${order.id} tier=${order.tier} not submitted (set PRINTIFY_API_KEY etc.)`);
    }
  } catch (err) {
    // Never let a POD failure block delivery — same pattern as poster-print
    // rendering in lib/approvals.ts. Admin needs to see this in logs and
    // manually submit the Printify order if it ever fires in production.
    console.error(`[pod] Printify order FAILED order=${order.id} — manual follow-up needed`, err);
  }
}
```
呼び出し元`lib/approvals.ts:55`は変更不要（既にtry/catchで囲われているか確認し、囲われていなければ同ファイル内の`posterPrintUrl`レンダリング部分と同じtry/catchパターンで包む）。

---

## 7. 検証

1. `npx tsc --noEmit` / `npx eslint` クリーン。
2. `npx prisma migrate dev --name pod_shipping` 成功。
3. `PRINTIFY_API_KEY`未設定の状態でGate 2承認（mock e2e）を流し、`createPodOrder`が例外を投げずログだけ出して完了まで到達すること（`scripts/e2e-state-machine.ts`のCOMPLETED遷移が引き続き通ること）。
4. 実際のPrintify APIコールは鍵が無いためこの実装フェーズでは検証不可。オーナーが鍵とBlueprint/Variant IDを揃えた後、実オーダーを1件試すこと（§2の手動カタログ調査もその時点で実施）。

---

## 8. 今回のスコープ外（明示）

- Blueprint/Variant IDの最終確定（オーナーが実キーで§2を実施してから）。
- 対応国リスト(`allowed_countries`)の最終決定。
- 返品・破損時のフロー（管理画面に何も無い。将来の別タスク）。
- ギフト配送（購入者≠受取人の住所指定）は`shipping_address_collection`だけでは足りず別途フォームが要る — スコープ外。
