# FAILEDステート＋管理者リトライ 実装仕様書

> 対象: `~/Projects/marquee-tails/lp`
> 目的: film生成が（Trigger.devのリトライ後も）失敗したとき、注文を宙ぶらりん/顧客差し戻しにせず、**FAILEDとして管理画面に可視化し、管理者がワンクリックで再実行**できるようにする。

---

## 0. 現状と問題

`OrderStatus` = UPLOADING / IMAGE_GENERATING / AWAITING_CUSTOMER_APPROVAL / VIDEO_GENERATING / AWAITING_ADMIN_APPROVAL / COMPLETED（FAILEDなし）。

film生成失敗時、現在は `AWAITING_CUSTOMER_APPROVAL` に差し戻す（Trigger.dev `trigger/film.ts` の onFailure、およびローカルinline fallback の `.catch`）。**支払い済み・承認済みの顧客をGate1に戻すのは不適切**で、管理者も失敗に気づけない。

## 1. スコープ（何をFAILEDにするか）

- ✅ **film生成（VIDEO_GENERATING）の失敗 → FAILED**（本タスクの主眼。決済・承認後の高コスト工程）
- ⛔ stills生成（IMAGE_GENERATING）失敗 → 現状維持（`UPLOADING` に戻す＝顧客が写真を出し直せる。妥当なので変更しない）
- ⛔ rerender失敗 → 現状維持（`AWAITING_ADMIN_APPROVAL` に戻す＝元の完成動画は無傷。妥当なので変更しない）
- ⛔ poster生成失敗 → 現状維持（非ブロッキング・ログのみ。filmは届く）

---

## 2. スキーマ変更（Prisma）

`prisma/schema.prisma`:
1. `enum OrderStatus` に `FAILED` を追加（COMPLETEDの後など末尾でよい。コメント: `// film generation failed after retries — awaiting admin retry`）。
2. `Order` に失敗理由フィールド追加:
   ```prisma
   failureReason String? // set when status=FAILED; cleared on retry
   ```
3. `npx prisma migrate dev --name failed_state`（Docker `marquee-pg` 起動確認: `docker ps | grep marquee-pg`。無ければSTOPして報告）。マイグレーション後 `npx prisma generate`。

---

## 3. 状態機械（`lib/orders.ts`）

`ALLOWED_TRANSITIONS` に追加:
- `VIDEO_GENERATING` の遷移先に **`FAILED`** を追加（現状 `[AWAITING_ADMIN_APPROVAL, AWAITING_CUSTOMER_APPROVAL]` → `[..., FAILED]`）。
- `FAILED` の遷移先: **`[VIDEO_GENERATING]`**（管理者リトライ）。
- `FAILED` のキーを `ALLOWED_TRANSITIONS` に追加（`Record<OrderStatus, ...>` は全キー必須）。

`transitionOrder` の `extraData` の `Pick<Order, ...>` に **`failureReason`** を追加（FAILEDへ遷移する際に理由を、リトライ時に `null` クリアを、同一トランザクションで原子的に書けるように）。

---

## 4. Trigger.dev タスク＋ローカルfallback の失敗ハンドラ変更

**`trigger/film.ts` の `onFailure`**: 現在 `VIDEO_GENERATING → AWAITING_CUSTOMER_APPROVAL` を、**`VIDEO_GENERATING → FAILED`** に変更。`failureReason` にエラー要約（`String(error).slice(0, 500)` 程度）を格納:
```ts
onFailure: async ({ payload, error }) => {
  await transitionOrder(
    payload.orderId, OrderStatus.VIDEO_GENERATING, OrderStatus.FAILED,
    "system", { failureReason: String(error).slice(0, 500) },
    "film generation failed after retries"
  ).catch((e) => console.error(...));
},
```
**`lib/film-pipeline.ts` の `kickFilmGeneration` のローカルinline fallback** の `.catch` も同様に `FAILED` へ（TRIGGER_SECRET_KEY未設定パス）。

（`trigger/poster.ts`・`trigger/rerender.ts` は変更しない。§1参照。）

---

## 5. 管理者リトライ（server action）

`app/admin/actions.ts` に `retryFilmAction(orderId)` を追加（既存 `rerenderShotAction` と同じ作法。TransitionErrorは `{ok:false,error}` で返す）:
1. `transitionOrder(orderId, FAILED, VIDEO_GENERATING, "admin", { failureReason: null }, "admin retry")`（原子的にステータス復帰＋理由クリア）。
2. 復帰したorderを取得し `kickFilmGeneration(order)` を呼ぶ（filmArtifactsキャッシュから未完了ステップだけ再開＝安い）。
3. `revalidatePath("/admin")` と `revalidatePath("/admin/${orderId}")`。

---

## 6. 管理画面UI（`app/admin/page.tsx`）

- 最上部（レビュー待ちより上）に **「失敗（要対応）」セクション** を追加:
  ```ts
  prisma.order.findMany({ where: { status: OrderStatus.FAILED }, orderBy: { updatedAt: "asc" } })
  ```
- 各FAILED注文に `failureReason` を赤系で表示し、**「再実行」ボタン**（`retryFilmAction` を呼ぶクライアントコンポーネント。既存 `RerenderShotButton.tsx` / `ApproveForm.tsx` のパターンに倣う。押下中は disabled、失敗時はエラーをインライン表示）。
- 空なら既存 `EmptyRow` で「失敗した注文はありません。」。
- セクションは `accent` 相当で目立たせる（レビュー待ちと同格〜より上）。
- `app/admin/[orderId]/page.tsx` の詳細ページでも、statusがFAILEDなら `failureReason` と再実行ボタンを出す（既存の再レンダーUIの近く）。日本語UI（管理画面は日本語方針）。

---

## 7. 検証

1. `npx tsc --noEmit` / `npx eslint`（変更ファイル）クリーン。
2. `npx prisma migrate dev --name failed_state` 成功。
3. **mock e2e**: 既存17件が維持されること。加えて、状態機械レベルで FAILED 経路のアサーションを追加すること（MOCKでは生成が実行されず失敗を自然発生させにくいので、`transitionOrder` を直接使って «VIDEO_GENERATING→FAILED→VIDEO_GENERATING» が許可され、不正遷移（例 FAILED→COMPLETED）が `TransitionError` になることを検証）。既存アサーションは弱めないこと。合計件数を報告。
4. `npx next build` 成功（admin配下の変更含む）。
5. ブラウザで `/admin` を開き、FAILEDセクションのレイアウト（該当注文が無ければ空表示）とコンソールエラー無しを確認（devサーバは `VIDEO_PIPELINE_MOCK=1` インライン起動）。手動でFAILED注文を1件作って（`transitionOrder` を使う使い捨てスクリプト or Prisma Studioで status=FAILED に）再実行ボタンの表示だけ目視できれば尚良い（任意）。

---

## 8. 注意 / スコープ外
- 自動リトライ回数の上限管理やアラート通知は今回スコープ外（Trigger.dev側のmaxAttempts:2 → 失敗でFAILED、その後は管理者手動リトライ）。
- 生成ロジック本体（runFilmGeneration等）は不変。
- 管理画面認証の強化は別タスク（#3）。
