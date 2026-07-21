# 法務ページ＋購入同意ゲート 実装仕様書

> 対象: `~/Projects/marquee-tails/lp`
> 決定（オーナー・2026-07-21）: **日本の事業者／顧客向けページは英語／特商法表記のみ日本語／受注生産につき原則返金なし＋不良は再制作**
> 位置づけ: 法務ページの**枠と雛形**を作る。決済同意は**Stripeホスト型Checkoutのconsent_collection**で「踏ませる」。

---

## ⚠️ 最重要ルール（実装者は必ず守る）

1. **事実の捏造禁止**: 事業者名・住所・電話番号・代表者名・メールアドレス・法人番号などは**絶対に創作しない**。すべて `[事業者名]` `[住所]` のような**角括弧プレースホルダ**で置く。オーナーが後で実データを入れる。
2. **これは法的助言ではない**: 提供するのは標準的な雛形。各ページのソース冒頭に「`{/* TEMPLATE — 公開前に弁護士レビュー必須。特に特商法の実開示情報と英語圏消費者法の適合性。 */}`」というコメントを入れる。公開ページ本文には「レビュー中」等は出さない（見栄えが悪い）。
3. **ドメイン依存の設定は保留**: `metadataBase`（現状 `marqueetails.com` 仮置き）、`APP_BASE_URL`、Stripe DashboardのToS URL、メール送信ドメインは**ドメイン購入後に確定**。今回は触らない（プレースホルダのまま）。

---

## 1. 作成するページ（4本）

Next.js App Router。ルートグループ `app/(legal)/` を作り、共通レイアウトで統一スタイルにする。URLは以下（グループはURLに出ない）:

| URL | ページ | 言語 |
|---|---|---|
| `/terms` | Terms of Service（利用規約） | 英語 |
| `/privacy` | Privacy Policy（プライバシーポリシー） | 英語 |
| `/refund` | Refund & Cancellation Policy | 英語 |
| `/tokushoho` | 特定商取引法に基づく表記 | **日本語** |

### 共通レイアウト `app/(legal)/layout.tsx`
- Premiere Night デザインシステムに準拠（`bg-night` / `text-ivory` / `text-muted` / `font-display` 見出し）。
- 読み物として `max-w-3xl mx-auto px-5 py-16 sm:py-24`、本文は `text-muted leading-relaxed`、`<h1>` は `font-display uppercase tracking-[0.06em] text-ivory`、`<h2>` セクション見出しは gold 系。
- 各ページ末尾に `Last updated: [DATE]`（プレースホルダ）。
- 上部に控えめな「← Marquee Tails」ホームリンク（`/`）。
- `export const metadata` でページごとの `title` を設定（例 "Terms of Service — Marquee Tails"）。

各ページは**サーバーコンポーネント**（静的で良い）。

---

## 2. 各ページの内容（プロダクト実態に合わせる）

商品実態: AI生成＋人間監修の**受注生産**ペット映画（60秒・6ショット）＋ムービーポスター。物理商品（プリント/キャンバス）はPrintify経由。決済はStripe。写真アップロードあり。顧客は英語圏、事業者は日本。

### `/terms` — Terms of Service（英語・標準ボイラープレート＋下記の商品固有条項）
セクション構成（標準的な英語ToS。各セクションは平易な英語で記述）:
- Acceptance of Terms
- Description of Service（写真からAI生成の映画予告編＋ポスターを制作。made with AI, human-reviewed）
- **Photo submission & your responsibilities**: アップロードする写真について顧客が権利を持ち、第三者の権利を侵害しないことを保証する旨。ペット本人の写真であること
- **License you grant us**: 制作目的で写真を使用・加工する限定ライセンス（下記Privacyと整合）
- **Ownership of the finished film/poster**: 成果物の利用範囲（個人利用。商用利用の可否は要オーナー判断→プレースホルダで「[personal use; commercial use terms TBD]」）
- Made-to-order nature & approvals（Gate 1絵コンテ承認 → Gate 2完成レビューの2段階、承認後の制作物である旨）
- Pricing & payment（Stripe経由、価格はPricing参照）
- **Refunds**: 「See our Refund & Cancellation Policy」で `/refund` に委譲
- Acceptable use / prohibited content（違法・権利侵害コンテンツの禁止）
- **AI disclosure**: 成果物はAI生成を人間が監修・仕上げする旨（正直に）
- Disclaimers & limitation of liability（標準。似姿の完全一致は保証しないが人間QCを通す旨）
- Changes to Terms / Governing law（**準拠法=日本法**、管轄=[事業者所在地の裁判所] プレースホルダ）
- Contact（`[メールアドレス]`）

### `/privacy` — Privacy Policy（英語）
収集・処理する実データに正直に基づくこと:
- What we collect: アップロードされた**ペット写真**、メールアドレス、（物理ティアのみ）**配送先住所・氏名**、決済はStripeが処理（カード情報は当社を通らない旨明記）
- How we use it: 映画・ポスター制作、注文連絡、配送
- **Third-party processors（実際に使っているものを列挙）**: fal.ai（画像・動画生成）、Stripe（決済）、Printify（プリント配送）、Klaviyo または Resend（メール）、Vercel（ホスティング/Blob）。各社に処理を委託する旨
- Data retention（写真・成果物の保持期間 → プレースホルダ `[retention period]`）
- International transfer（日本の事業者が海外顧客データを扱う／米国等のプロセッサに転送される旨）
- Your rights（アクセス・削除依頼の連絡先）
- Cookies（最小限。ウェイトリスト/解析があれば記載、なければ「essential only」）
- Contact（`[メールアドレス]`）

### `/refund` — Refund & Cancellation Policy（英語・下記の確定文言を反映）
オーナー決定の立て付けをそのまま条文化:
- **Made-to-order**: 制作（generation）開始後は、顧客都合・気変わりによる返金・キャンセル不可
- **Before we start**: 制作開始前（＝写真提出・絵コンテ生成着手前）のキャンセルは[可否をプレースホルダ `[cancellation window TBD]`]
- **Defects / quality**: 納品物に不備がある場合は**無償で再制作または修正**（似姿が明らかに違う等、人間QC基準に照らして対応）
- **Non-delivery**: 当方の事由で納品できない場合は**全額返金**
- **Physical items（Printify）**: 破損・不良品の到着は再送対応。返品要否はPrintifyの実運用に合わせプレースホルダ
- How to request（`[メールアドレス]`、注文番号）

### `/tokushoho` — 特定商取引法に基づく表記（**日本語**・プレースホルダ多数）
通信販売の必須開示項目を**表形式**で。すべて日本の法的義務なので日本語。実データは全部プレースホルダ:

| 項目 | 記載 |
|---|---|
| 販売事業者名 | `[事業者名 / 屋号]` |
| 運営統括責任者 | `[代表者氏名]` |
| 所在地 | `[住所]`（※個人事業主の住所開示は要検討。バーチャルオフィス等はオーナー判断） |
| 電話番号 | `[電話番号]`（※「請求があれば遅滞なく開示します」の運用可否は弁護士確認） |
| メールアドレス | `[メールアドレス]` |
| 販売価格 | 各商品ページに表示（Digital $75 / Feature $129 / Collector's $199、税の取扱いは `[消費税の内外]` プレースホルダ） |
| 商品代金以外の必要料金 | 送料（物理商品）、決済手数料等 → `[詳細]` |
| 支払方法 | クレジットカード（Stripe） |
| 支払時期 | 注文時に即時決済 |
| 引渡し時期 | デジタル: 絵コンテ承認後48時間以内。物理: Printify制作・発送 `[X〜Y営業日]` |
| 返品・キャンセル | 受注生産のため制作開始後の返品・返金不可。不良品は無償再制作、当方事由の未納品は返金（詳細はRefund Policy参照） |

> ※ 特商法ページは日本語だが、英語サイトからもフッターでリンクする（JP事業者の法的義務のため掲示は必要）。英語話者向けに1行 "Legal notice for Japanese Commercial Transactions Act" と英語ラベルを添えてよい。

---

## 3. フッターにリンク追加 `components/Footer.tsx`

現在フッターは Instagram / TikTok のソーシャルnavのみ。**Legal リンク行を追加**する（ソーシャルの下、コピーライトの上あたり）。既存のスタイル（`text-muted hover:text-gold` のリンク）に合わせる:

```tsx
<nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs">
  <a href="/terms" className="text-muted transition-colors hover:text-gold">Terms of Service</a>
  <a href="/privacy" className="text-muted transition-colors hover:text-gold">Privacy Policy</a>
  <a href="/refund" className="text-muted transition-colors hover:text-gold">Refund &amp; Cancellation</a>
  <a href="/tokushoho" className="text-muted transition-colors hover:text-gold">特定商取引法に基づく表記</a>
</nav>
```
（`href`は内部リンクだが、これらは静的ページなので通常の`<a>`でよい。Next.jsの`<Link>`を使っても可。既存フッターは素の`<a>`なので合わせる。）

---

## 4. 購入同意ゲート（「規約を踏ませる」）

Stripeホスト型Checkoutを使っているので、**独自チェックボックスUIは不要**。Stripeの`consent_collection`で規約同意を必須化する。`app/api/checkout/route.ts`の`stripe.checkout.sessions.create({...})`に以下を追加:

```ts
consent_collection: { terms_of_service: "required" },
```
必要なら購入者向けの一文も:
```ts
custom_text: {
  terms_of_service_acceptance: {
    message: "I agree to the [Marquee Tails Terms of Service](URL) and [Refund Policy](URL).",
  },
},
```
（`consent_collection.terms_of_service: "required"` を使う場合、**Terms of ServiceのURLはStripeダッシュボードの「Public business information」→ Terms of service に設定**する必要がある＝オーナー作業。コードだけでは完結しないので、その旨をコード近くのコメントとこの仕様書に明記。ドメイン確定後に設定する。）

> 現状LPに購入ボタンはまだ無い（ウェイトリスト継続の決定）。この同意ゲートは、将来Buyボタンが/api/checkoutを叩いて決済フローが公開されたときに自動的に効く「配線」。今すぐ画面上に見える変化はない。

---

## 5. 付随して直すもの（軽微）

`app/layout.tsx` の `metadata` / `openGraph` の説明文がまだ「60–90 second」。ユーザー向けSEO/OGコピーなので **"60-second"** に更新（2箇所）。`metadataBase`の`marqueetails.com`は**ドメイン購入後に確定するのでこのタスクでは変更しない**（プレースホルダ扱い）。

---

## 6. 検証

1. `npx tsc --noEmit` / `npx eslint`（新規ファイル）クリーン。
2. dev サーバ（:3100、VIDEO_PIPELINE_MOCK=1 をインラインで付けて起動）で `/terms` `/privacy` `/refund` `/tokushoho` が表示され、フッターのリンクから遷移できることをブラウザで確認（スクリーンショット）。ダークテーマで可読性OK、モバイル(375)で横スクロールなし。
3. `/api/checkout` の変更が既存の503パス（キー未設定時）を壊していないこと（tscとルート単体の目視）。
4. プレースホルダ（`[事業者名]`等）が**実データで埋められていない**こと＝捏造していないことを確認。

---

## 7. スコープ外（オーナー作業・別タスク）

- **ドメイン購入**（レジストラでの購入・支払い）。購入後: `metadataBase`・`APP_BASE_URL`・Stripe DashboardのToS URL・メール送信ドメインを設定
- 特商法・利用規約・プライバシー・返金ポリシーの**実データ記入と弁護士レビュー**
- Stripe DashboardでのTerms of Service URL設定（consent_collectionのリンク先）
- LP購入ボタンの設置（別途決定事項）
