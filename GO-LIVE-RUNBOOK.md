# Marquee Tails 本番公開 手順書（Owner Runbook）

> これは**オーナーが上から順に手を動かす**ためのチェックリスト。コード側は概ね完成済み。
> 残りはほぼ全て「アカウント・キー・デプロイ・法務」の設定作業。**依存関係順**に並べてある。
> 各ステップに「どこで何を」「どの環境変数に入れるか」「参照spec」を明記。
> 作成: 2026-07-21

---

## 環境変数の置き場所（全体像）

2箇所に分かれる。混同注意。

| 置き場所 | 何のため | 入れるもの |
|---|---|---|
| **Vercel**（プロジェクト設定 → Environment Variables） | Next.jsアプリ本体の実行 | `DATABASE_URL`, `APP_BASE_URL`, `VIDEO_PIPELINE_MOCK=0`, `FAL_KEY`, `TRIGGER_SECRET_KEY`, `ADMIN_API_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `STRIPE_*`, `PRINTIFY_*`, `KLAVIYO_API_KEY` or `RESEND_*`, `BLOB_READ_WRITE_TOKEN` |
| **Trigger.dev**（ダッシュボード → Environment Variables → Production） | 重い生成タスクの実行 | `DATABASE_URL`, `FAL_KEY`（タスクが使うもののみ。`VIDEO_PIPELINE_MOCK`は入れない＝本番は実生成） |

---

## Phase 1 — ドメイン購入（多くの設定の起点）

1. レジストラ（お名前.com / Cloudflare / Vercel Domains 等）で独自ドメインを購入。
2. 決めたドメイン（例 `marqueetails.com`）は後続の以下すべてで使う:
   - Vercel `APP_BASE_URL=https://<domain>`
   - `app/layout.tsx` の `metadataBase`（現状 `marqueetails.com` 仮置き → 実ドメインに）
   - Stripe の success/cancel URL・Terms of service URL
   - メール送信ドメイン（Resendの場合）

---

## Phase 2 — 本番データベース

1. **Neon** または **Supabase** / **Vercel Postgres** で本番Postgresを作成、接続文字列を取得。
2. ローカルからマイグレーション適用:
   ```
   DATABASE_URL="<本番接続文字列>" npx prisma migrate deploy
   ```
   （`migrate dev` ではなく **`migrate deploy`**。既存の全マイグレーションが本番DBに流れる。）
3. `DATABASE_URL`（本番）を **Vercel** と **Trigger.dev** の両方のenvに設定。

> ⚠️ 現在のローカル `.env` の `DATABASE_URL`（Docker `localhost:55432`）は開発専用。本番では上書きになる。

---

## Phase 3 — デプロイ（Vercel + Trigger.dev）

Vercel Hobbyで可（重い生成はTrigger.devが担うため、Proは不要）。

### 3-1. Vercel
1. GitHubリポジトリをVercelに接続、プロジェクト作成。
2. Vercel env に最低限: `DATABASE_URL`, `APP_BASE_URL`, `VIDEO_PIPELINE_MOCK=0`, `FAL_KEY`, `ADMIN_API_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`（＋後続PhaseでStripe/Trigger/Printify/メールを追加）。
3. デプロイ。ドメインをVercelプロジェクトに割り当て。

### 3-2. Trigger.dev（参照: [FILM-ASYNC-SPEC.md](./FILM-ASYNC-SPEC.md)）
1. ダッシュボード → Environment Variables → **Production** に `DATABASE_URL`（本番）と `FAL_KEY` を設定。
2. ローカルから本番デプロイ:
   ```
   npx trigger.dev@latest deploy
   ```
3. `TRIGGER_SECRET_KEY`（本番用のprod key）を **Vercel** env に設定（これが入ると生成がTrigger.devにオフロードされる）。

---

## Phase 4 — 決済（Stripe）（参照: [STRIPE-INTEGRATION-SPEC.md](./STRIPE-INTEGRATION-SPEC.md)）

1. Stripeアカウント作成、まず**テストモード**で通してから本番。
2. **Price を3つ作成**（一回課金・商品）: Digital $75 / Feature $129 / Collector's $199 → 各Price IDを:
   - Vercel env `STRIPE_PRICE_DIGITAL` / `STRIPE_PRICE_FEATURE` / `STRIPE_PRICE_COLLECTOR`
3. `STRIPE_SECRET_KEY` を Vercel env に。
4. **Webhook登録**: Stripe → Developers → Webhooks → エンドポイント `https://<domain>/api/webhooks/stripe`、イベント `checkout.session.completed`。署名シークレットを `STRIPE_WEBHOOK_SECRET` に。
5. **Terms of service URL**: Stripe → Settings → Public business information → Terms of service = `https://<domain>/terms`（Checkoutの規約同意チェックのリンク先。参照: [LEGAL-PAGES-SPEC.md](./LEGAL-PAGES-SPEC.md) §4）。
6. **Founding Members 20%オフ**: Coupon（20% off）+ Promotion code を作成、利用上限100に設定（[LP-CAMYU-SPEC.md](./LP-CAMYU-SPEC.md) §8。端数そのまま=$60/$103.20/$159.20）。Checkout Sessionで `allow_promotion_codes: true` を足すか、Founding用の別導線にするかは運用で決める。
7. `stripe listen --forward-to <domain>/api/webhooks/stripe` でE2E確認（テスト決済→注文がUPLOADINGで作成される→アップロード案内メール）。

---

## Phase 5 — 物理商品（Printify）（参照: [POD-INTEGRATION-SPEC.md](./POD-INTEGRATION-SPEC.md)）

1. Printifyアカウント + APIキー取得 → Vercel env `PRINTIFY_*`（specの変数名に合わせる）。
2. **Blueprint / Variant ID の特定**（spec §2・キー未取得のため未実装のまま）: ポスタープリント & 16×20キャンバスの実商品IDを調べて設定。
3. **ローンチ前にキャンバス1点テスト発注**（Collector's検証・破損/品質/納期の確認。決定事項）。
4. Feature/Collector'sのみ物理配送。Digitalは対象外（コードで分岐済み）。

---

## Phase 6 — メール（参照: `lib/mocks.ts` の3段フォールバック）

どちらか片方でよい:
- **Klaviyo**: `KLAVIYO_API_KEY` を設定 → イベント "Storyboard Ready" / "Film Delivered" / "Order Paid" に対して Klaviyo Flow を組んで送信。
- **Resend**: `RESEND_API_KEY` + `RESEND_FROM_EMAIL`（**認証済みドメイン**必須。Phase 1のドメインでSPF/DKIM設定）。
両方未設定だと `console.log` モックのまま（本番では送られない）。

---

## Phase 7 — 法務（参照: [LEGAL-PAGES-SPEC.md](./LEGAL-PAGES-SPEC.md)）

1. `/terms` `/privacy` `/refund` `/tokushoho` の **角括弧プレースホルダに実データ記入**（`[事業者名]` `[住所]` `[電話番号]` `[代表者氏名]` `[メールアドレス]` `[DATE]` など）。特に**特商法は実名・住所開示が法的義務**。
2. **弁護士レビュー**（特に特商法の実開示と、英語圏顧客向け消費者法の適合性）。
3. 返金ポリシーは「**受注生産につき、注文後の顧客都合による返金・キャンセルは原則不可／不良は無償再制作／当方事由の未納品は全額返金**」（前払いモデルAで確定）。個別のキャンセル要望は運用でStripeダッシュボードから手動対応。

---

## Phase 8 — 管理者認証の本番値（参照: [ADMIN-AUTH-SPEC.md](./ADMIN-AUTH-SPEC.md)）

Vercel env に:
- `ADMIN_PASSWORD` = 強いパスワード（`/admin/login` のログイン）
- `SESSION_SECRET` = `openssl rand -base64 32` 等のランダム長文字列
- `ADMIN_API_SECRET` = API/e2e用の共有シークレット（強い値に）

---

## Phase 9 — スイッチ・オン（販売開始を決めたら）

現在LPは**ウェイトリストのみ**（「No checkout yet」表記）。実販売を開始する判断をしたら:

1. **Buyボタンを設置**: `components/PricingTeaser.tsx` の各ティアのCTAを `/api/checkout`（`{tier}` をPOST → 返る `url` にリダイレクト）に接続。
2. **「No checkout yet — the waitlist casts our first production slots.」文言を削除/差し替え**。
3. （任意・ローンチ後の転換率テスト）**ティーザー→アンロック funnel** の検討（business_strategy.md の元プラン。今は未実装。パーソナライズ・プレビューで転換率を上げる実験）。
4. フッターの Instagram / TikTok リンク（現在 `href="#"`）を実URLに。

### 公開前 最終チェック
- [ ] テスト決済 → 注文がUPLOADINGで作成 → アップロード案内メール受信
- [ ] 写真アップロード → 絵コンテ生成（Trigger.devのRunsに出る）→ Gate1
- [ ] Gate1承認 → 動画生成（Trigger.dev）→ Gate2（管理画面ログインできる）
- [ ] 管理画面で承認 → 納品メール ＋（Feature/Collector'sなら）Printify発注
- [ ] 失敗時: FAILEDに落ちて管理画面「失敗（要対応）」に出る → 再実行できる
- [ ] 返金が必要なケース（不良・未納品等）はStripeダッシュボードから手動返金

---

## 補足: このセッションで完成しているコード

LP刷新(CAMYUショーケース) / 価格$75·$129·$199 / Stripe配線(前払いモデルA) / POD配線 / メール3段 / 法務ページ+同意ゲート / film非同期化(Trigger.dev) / FAILEDステート+再実行 / 管理画面セッション認証。
残りの「未実装コード」は Phase 9 のBuyボタン設置とティーザーfunnel（任意）くらい。
