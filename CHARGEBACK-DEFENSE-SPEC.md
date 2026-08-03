# チャージバック防衛 仕様書 — 争いになったとき5分で証拠を出せる状態にする

> **ステータス: 設計のみ / 未実装。** 実装は別途（Sonnet 等）。作成: 2026-08-02
> オーナー判断: 「ポリシーに何を書いてもカード会社に行かれたら終わり。**自分たちで作れる最大の守りを実装する**。返金額の調整も賛成」

---

## 0. 何を守りと呼ぶか

チャージバックは**カード会社が裁く**。こちらの武器は反論書面に添付する証拠だけで、
提出期限は届いてから**7〜21日**。そのとき効く証拠は決まっている:

1. **購入前の同意** — 顧客が返金条件を見て同意した記録
2. **顧客が制作を指揮した記録** — 承認・選択・リロールの操作履歴（IP・時刻つき）
3. **受領の証明** — 納品物にアクセス／ダウンロードした記録（デジタル商品の紛争ではこれが最強）
4. **即座に取り出せること** — 期限内に、注文1件分の証拠を組み立てる時間をゼロにする

本仕様は 2〜4 を実装し、あわせて返金額を変更する。

---

## 1. 既にあるもの（作り直さないこと）

- **決済画面の同意チェック**: `app/api/checkout/route.ts` が `consent_collection.terms_of_service: "required"` ＋
  `custom_text` で規約・返金ポリシーへの同意文を表示済み。**本番の決済が通っている＝Dashboard の ToS URL 設定も有効**
- **監査ログの背骨**: `StatusEvent`（orderId / from / to / actor / note / createdAt）。
  全状態遷移が `transitionOrder` 経由で記録される
- Gate 1 承認時の `chosenStills` スナップショット、リプレイガード（`approve-storyboard/route.ts`）
- **ダウンロードプロキシ `/api/download`**（本日実装）— 受領記録を取る自然な場所
- 返金フローの時刻記録（`refundRequestedAt` / `refundIssuedAt`）と返金後の制作物引き渡し

## 2. 返金額の変更（オーナー承認済み）

`lib/safety-net.ts`:

```
REFUND_AMOUNT_USD      200 → 150
NONREFUNDABLE_FEE_USD   49 →  99
```

**根拠**: 返金時に顧客はトリートメント＋絵コンテ18枚を実際に受け取る（本日実装済み）。
$249 のうち $99 は「引き渡し済みの制作物＋専用AIモデルの学習」の対価として説明できる。

**波及箇所を全て更新すること。** `grep -rn '\$200\|\$49'` で洗うと最低でも:
`app/admin/actions.ts` / `app/admin/[orderId]/page.tsx` / `MarkRefundIssuedButton.tsx` /
`app/approve/[token]/page.tsx` / `app/api/orders/approve-storyboard/route.ts` /
`app/api/checkout/route.ts`（**custom_text 内の $49 が生値**）/ `app/api/orders/request-refund/route.ts` /
`app/api/orders/revise-treatment/route.ts` / `app/(legal)/refund/page.tsx` / `app/(legal)/tokushoho/page.tsx` /
`components/StoryboardWizard.tsx`。
**可能な限り定数 import に置き換える**（サーバー/クライアントコード）。JSX に埋め込めない箇所（法務ページの日本語文）
は文言を書き換える。**LP・料金表示側にも $49/$200 が無いか必ず全域 grep すること。**

**Preset（$99）の欠陥時全額返金は変えない。** あれは「2回作り直しても直らない**当社の欠陥**」への救済で、
欠陥品に部分返金を拒む構図は紛争で最も負けやすい。DC の非返金費用が成立するのは
「顧客が**自分の意思で**途中離脱し、制作物を受け取る」からであって、両者は別物。下方に揃えないこと。

**`LAWYER-REVIEW-QUESTIONS.md` の Q2-1 を更新**:「$99 に引き上げたい」→「$99/$150 で実装済み。
この水準の防御可能性を確認したい」。

## 3. 証拠イベントテーブル（新規）

`StatusEvent` は遷移専用（from/to 必須）で、ダウンロードやポスター選択は遷移しないため入らない。
**新モデルを足す**:

```prisma
model EvidenceEvent {
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  kind      String   // 下記の kind 一覧
  detail    Json?    // kind ごとの構造化データ（選んだ絵コンテのURL等）
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
  @@index([orderId])
}
```

マイグレーションは**SQLファイル生成のみ、適用しない**（オーナーが手で流す）。

### ヘルパー `lib/evidence.ts`

`recordEvidence(orderId, kind, detail?, req?)`:
- `req`（NextRequest）から IP（`x-forwarded-for` の先頭）と User-Agent を抜く
- **絶対に throw しない**（記録の失敗が業務フローを壊してはならない。メール送信と同じ非致命姿勢。
  失敗は console.error）

### 記録ポイントと kind

| kind | 場所 | detail に入れるもの |
|---|---|---|
| `checkout.consent` | Stripe webhook（注文作成時） | session.consent の内容、同意文のバージョン（tier で分岐した文面のどちらか） |
| `photos.submitted` | submit-photos | 枚数、URL一覧 |
| `treatment.approved` / `treatment.revision` | approve-treatment / revise-treatment | 承認/修正時のテキスト |
| `storyboard.approved` | approve-storyboard | chosenStills、posterCutIndex |
| `poster.chosen` | choose-poster | 選んだURL |
| `reroll.requested` | reroll-cut | cutIndex、何回目か |
| `refund.requested` | request-refund | **同意した文言**（「$150返金・$99非返金を受け入れる」パネルの文面） |
| `download.film` / `download.social` / `download.poster` / `download.take` | `/api/download` | kind、cut/take、**upstream が 200 を返した後にのみ記録** |
| `email.sent` | lib/mocks.ts の各送信関数 | テンプレート名、宛先、**Resend の message id**（`resend.emails.send` の戻り `data.id` を拾う） |

顧客操作系（webhook 以外）は必ず `req` を渡して IP/UA を取ること。

## 4. admin の証拠パック

`app/admin/[orderId]/page.tsx` に新セクション **「紛争対応（チャージバック証拠）」**:

- **同意の状態**: checkout.consent の有無＋時刻を先頭に表示（無い注文は「同意記録なし」と目立たせる —
  これが無い注文は防御が弱いという事実を隠さない）
- **時系列**: StatusEvent と EvidenceEvent をマージして時刻順に表示（actor / kind / IP）
- **「証拠テキストをコピー」ボタン**: Stripe の異議申立てフォームに**そのまま貼れる英語のプレーンテキスト**を
  組み立てる。含めるもの: 注文ID・商品説明（made-to-order である旨）・金額・同意記録・
  顧客の全操作（時刻・IP付き）・納品とダウンロードの記録・承認済み絵コンテのURL。
  クライアントコンポーネントでページ上のデータから組み立てれば十分（新APIは不要）

## 5. コードでは解決しないもの（オーナーへの報告事項として残す）

実装対象ではないが、報告書に含めること:

1. **Statement descriptor**（明細の表記）を Stripe Dashboard で `MARQUEETAILS` 等の認識可能な文字列に。
   「身に覚えのない請求」が異議申立ての最多理由で、これは表記だけで防げる
2. Dashboard の ToS URL が**本番ドメインの /terms** を指しているか確認（今は動いているが、ドメイン変更時に切れる）
3. Stripe **Radar** の標準ルール有効化、レシートメールの有効化

## 6. 制約

- DBに接続しない。マイグレーションはSQLファイルのみ
- コミット・push しない
- `lib/safety-net.ts` は**定数2つの値のみ**変更。適格性ロジック・B2セマンティクス・リロール上限は不変
- 状態機械・動画パイプライン・Stripe/Printify の処理フローは不変
- 法務ページは**金額の文言置換のみ**。構造の書き換えは弁護士レビュー待ちなのでしない
- `scripts/test-*.ts` は触らない・実行しない

## 7. 検証（実装者が `file:line` で証明すること）

1. 顧客向け表示・メール・法務ページのどこにも旧金額（$200返金/$49非返金）が残っていない（grep 全域）
2. `recordEvidence` がどの呼び出し経路でも throw し得ない
3. `/api/download` の記録が **upstream 成功後**にのみ書かれる（404/502 では記録されない）
4. `refund.requested` の detail に顧客が見た同意文言が入っている
5. EvidenceEvent の書き込み失敗が、注文の状態遷移・メール送信・ダウンロード応答のどれも失敗させない
6. 証拠パックのコピー文面に、同意・操作履歴・ダウンロード記録の3種が全部含まれる

`tsc` / `eslint` / `next build` 通過。
