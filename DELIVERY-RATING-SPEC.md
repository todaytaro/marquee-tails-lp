# 納品時レビュー（星5＋任意コメント） — DELIVERY-RATING-SPEC

> 2026-08-04 / オーナー指示: 「最後に顧客に送る商品のダウンロードのところに評価欄入れたい。星５までの入力と任意でコメントみたいな」

---

## 0. これは何のための機能か（二つある）

**1. 単純にレビューが欲しい。** ローンチ前で顧客がゼロなので、最初の実顧客の声は
LP の social proof としても、品質判断の材料としても価値が高い。

**2. これはチャージバック証拠として、たぶん今ある中で一番強い。**
「納品物が説明と違った（not as described）」という異議申立てに対して、
**その顧客本人が納品直後に星4を付けた記録**は、こちらが何を書いたかではなく
**顧客自身が満足を表明した**という事実になる。CHARGEBACK-DEFENSE-SPEC.md §0 の
証拠4分類のうち「3. 納品物の受領」の一段上に来る。
だから `EvidenceEvent` に `rating.submitted` として**追記型で**記録する
（列は上書きされうるが、証拠行は消えない）。

**やらないこと:** メール送信しない。ステータス遷移させない。
アドオン購入を評価の入力条件にしない。LP に載せない（載せるかは別の判断）。

---

## 1. データモデル

`prisma/schema.prisma` の `Order` に3列追加する。別モデルにしない ——
1注文 = 1納品 = 1評価で、多重度が増えないため。

```prisma
  // --- 納品評価（DELIVERY-RATING-SPEC.md）---
  ratingStars   Int?      // 1-5。null = まだ評価していない
  ratingComment String?   // 任意の自由記述（最大2000字、空文字はnullで保存）
  ratedAt       DateTime? // 最終送信時刻。顧客は星を変更できるので「最初」ではない
```

マイグレーションは**手書き**で
`prisma/migrations/20260804170000_delivery_rating/migration.sql` を作る。
既存ファイル（例: `20260801210000_storyboard_admin_gate`）と同じ体裁 ——
冒頭コメントに「NOT APPLIED BY THIS CHANGE、ローカル .env の DATABASE_URL は
本番 Supabase を指すのでこのリポジトリは prisma migrate を実行しない」を必ず書く。
適用はオーナーが `npx prisma migrate deploy` で行う。

`lib/evidence.ts` の `EvidenceKind` に `"rating.submitted"` を追加。

---

## 2. 検証ロジックは純関数に切り出す

`lib/rating.ts`（新規）:

```ts
export type RatingInput = { stars?: unknown; comment?: unknown };
export type RatingParsed = { stars: number; comment: string | null };
/** 不正なら throw。API ルートはこれを呼ぶだけにする。 */
export function parseRating(input: RatingInput): RatingParsed
```

規則:
- `stars` は**整数の 1〜5** のみ。`0` / `6` / `4.5` / `"4"` / `null` / 未指定は全て拒否。
  （`"4"` を通すかは実装判断だが、通すなら明示的に `Number()` した上で整数チェック。
  暗黙の型強制で `true` が `1` になるような経路は塞ぐ）
- `comment` は文字列以外なら拒否。`trim()` し、空文字は `null`。
  **2000字で切り捨てるのではなく拒否**（黙って本文を削ると、顧客は送ったつもりの
  文章が消える。treatmentText で同じことをやって痛い目に遭っている）。

理由: これを純関数にするのは、テストを API キーもネットワークも DB も無しで
書けるようにするため。`scripts/test-treatment-parse.ts` と同じ立て付け。

---

## 3. API ルート

`app/api/orders/rate/route.ts` — `app/api/orders/choose-poster/route.ts` を
そのまま雛形にする（同じ認証・同じレスポンス形）。

`POST { orderId, approveToken, stars, comment? }`

ガード:
1. `approveToken` 一致。**不一致と存在しないは同じ 404 を返す**（どちらか漏らさない）。
2. `parseRating` を通す（400）。
3. **`status === COMPLETED` のときだけ受け付ける。** それ以外は 409。
   受け取っていない映画を評価させる意味がなく、納品前の評価は証拠としても使えない。
4. 再送信は許可（顧客が星を変えられる）。列は上書きし、`ratedAt` を更新する。

処理:
- `ratingStars` / `ratingComment` / `ratedAt` を更新
- `recordEvidence(orderId, "rating.submitted", { stars, hasComment, previousStars }, req)`
  — `previousStars` を入れるのは、上書きの履歴が証拠行の側に残るようにするため。
  `req` を渡すので IP と UA が付く（顧客操作なので付けるのが正しい）。
- `{ ok: true }`

---

## 4. UI（顧客側）

`components/DeliveryRating.tsx`（新規、`"use client"`）。

Props: `{ orderId, approveToken, petName, initialStars, initialComment }`

挙動:
- **既定は星5個が1行だけ。** コメント欄は最初から出さない。
  星を押した時点で初めてコメント欄と送信ボタンが現れる（progressive disclosure）。
  理由は下の配置と直結する ——「1行」ならアドオン導線を押し下げない。
- **星を押した瞬間に星だけ先に送信する。** コメントを書かずに離脱しても
  評価は残る。コメントは「Send」で追送信（同じエンドポイントに星＋コメント）。
- 送信済み状態（`initialStars` が非 null、または送信成功後）は
  付けた星とお礼を表示し、押し直せる余地を残す（"change" 相当）。
- エラーは**インラインの一行**。トーストライブラリは入れない。
  星は楽観的に光らせ、失敗したら戻す（`PosterPicker.tsx` と同じ作法）。
- アクセシビリティ: 本物の `<button>`、`aria-label="4 stars"`、キーボードで押せること。

文言は**英語のみ**。顧客は英語圏で、日本語が顧客画面に出るのは
このプロジェクトで既に3回やっている事故。
- 見出し: `How was {petName}'s premiere?`
- 補助: `One tap. It helps more than you'd think.`
- placeholder: `Anything you want to tell us? (optional)`
- ボタン: `Send`
- 送信後: `Thank you — noted.`

見た目は既存に合わせる（`border-gold/40` / `text-muted` / `btn-marquee` /
`rounded-[var(--radius-card)]` / 見出しは `font-display`）。新しい色を作らない。

### 配置

`app/approve/[token]/page.tsx` の `PremiereView` 内、
**ダウンロードボタンの塊（`{videoUrl && (...)}` の share コピーまで）の直後、
`<AddonUpsell>` の直前。** `videoUrl` があるときだけ描画する。

なぜここか: 見終わって落とした直後が一番答えてもらえる瞬間。
そのうえで初期状態を星1行に抑えているので、その下のアドオン購入導線
（実売上）を画面外に押し出さない。

---

## 5. UI（admin側）

- `app/admin/[orderId]/page.tsx` — 星・コメント・`ratedAt` を注文詳細に表示。
  紛争対応（チャージバック証拠）セクションの近くが自然。
- `app/admin/page.tsx` — 一覧に `★4` 程度の小さな表示。
  評価が付いた注文を1件ずつ開かずに把握できるようにする。
  評価がある注文だけ表示（無い注文に `★-` を並べない）。

admin の文言は日本語でよい（既存に合わせる）。

---

## 6. テスト

`scripts/test-rating-validate.ts` — `parseRating` の純関数テスト。
API キー・ネットワーク・DB を一切使わない。`scripts/test-treatment-parse.ts` と同じ形。

最低限これらを含める:
`5` / `1` が通る、`0` / `6` / `-1` / `4.5` / `NaN` / `undefined` / `null` /
`true` / `"4"`（方針を決めて明示）/ 2001字コメントが拒否される /
空白のみのコメントが `null` になる / 2000字ちょうどが通る。

---

## 7. 検証（実装者が実行して結果を報告する）

```
npx tsc --noEmit
npx next lint
npx next build
npx tsx scripts/test-rating-validate.ts
```

`npx prisma migrate deploy` は**実行しない**（本番DBに当たる。オーナーが自分で叩く）。
`prisma generate` は新しい列を型に出すために必要なので実行してよい。
