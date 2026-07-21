# film-pipeline 本番非同期化 実装仕様書（Trigger.dev v4）

> 対象: `~/Projects/marquee-tails/lp`
> 決定（オーナー・2026-07-21）: **Vercel Hobbyのまま**、重い生成は **Trigger.dev v4**（マネージド）にオフロード。
> **この仕様は旧「Vercelネイティブ(after/maxDuration)」案を置き換える**（Hobbyの60秒上限では成立しないため）。

---

## 0. 背景と設計

- Vercel Hobby = 関数60秒上限。film生成（6〜12分・ffmpeg合成含む）は関数内で完走不可。
- 解決: 重い処理を **Trigger.dev v4** のタスクとして**Trigger.dev側のインフラ**で実行（プラットフォーム時間制限なし・ffmpegはビルド拡張で提供）。VercelはWeb/API/トリガーだけ担う＝Hobbyのまま・低負荷。
- v4はGA安定版（`@trigger.dev/sdk`）。無料枠あり。

### 対象（現状すべて detached/after で、Hobbyでは死ぬ or 60秒超）
1. `kickFilmGeneration` → `runFilmGeneration`（Kling6本＋採点＋音楽＋ffmpeg合成）
2. `kickPosterGeneration` → `runPosterGeneration`（nano-banana 4K×3・identityゲート、1〜2分）
3. `kickShotRerender` → `runShotRerender`（1カット再生成＋再アセンブル、ffmpeg）

※ `approveVideo`（Gate2承認: satori印刷＋メール＋Printify）は数十秒で60秒内。**Vercelのまま据え置き**（移行しない）。

---

## 1. 依存とセットアップ

```
npm i @trigger.dev/sdk
npm i -D @trigger.dev/build
```

### `trigger.config.ts`（プロジェクト直下・新規）
```ts
import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, additionalFiles } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "<TRIGGER_PROJECT_REF>", // ← オーナーがダッシュボードで作成後に記入（プレースホルダ）
  dirs: ["./trigger"],
  maxDuration: 1800, // タスク側で上書き可。film生成の上限（30分）
  build: {
    extensions: [
      ffmpeg(),                                   // FFMPEG_PATH / FFPROBE_PATH を注入
      additionalFiles({ files: ["public/fonts/**"] }), // ffmpeg drawtext用フォントを同梱
      // ↓ このプロジェクトは custom generated client (generated/prisma) + PrismaPg adapter。
      //   prismaExtension の schema 指定が必要。実装者は Trigger.dev の prisma 拡張ドキュメントで
      //   custom output path / driver adapter 構成の正しい指定を確認して設定すること（要検証ポイント）。
      prismaExtension({ schema: "prisma/schema.prisma" }),
    ],
  },
});
```
> ⚠️ **要検証（実装者）**: このリポジトリは `generator client { provider = "prisma-client"; output = "../generated/prisma" }`（＝TS版クライアント）＋ `@prisma/adapter-pg`。Trigger.dev の prismaExtension が custom output path と driver-adapter 構成で正しく `prisma generate` するか、Trigger.dev v4ドキュメントで確認。うまく合わない場合の代替: デプロイ前に `prisma generate` を回して `generated/` を `additionalFiles` で同梱する方式。どちらを採ったか報告に明記。

### 環境変数
- **Next側 `.env`（トリガーに必要）**: `TRIGGER_SECRET_KEY`（ダッシュボードのAPIキー）。`.env.example` にコメント追記。
- **Trigger.dev側（ダッシュボードのEnvironment Variables＝オーナー作業）**: `DATABASE_URL`, `FAL_KEY`, 必要なら `PUBLIC_ASSET_BASE` 等（`runFilmGeneration`/`runPosterGeneration` が使うもの）。**`VIDEO_PIPELINE_MOCK` は設定しない**（本番は実生成）。

---

## 2. タスク定義（`./trigger/` 配下・新規3本）

各タスクは payload で `orderId`（＋再生成は `shotIndex`/`mode`/`reason`）を受け取り、**DBからorderを取得して既存のrun関数を呼ぶ**だけ。生成ロジックは再利用（変更しない）。

### `trigger/film.ts`
```ts
import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/generated/prisma/client";
import { runFilmGeneration } from "@/lib/film-pipeline";
import { transitionOrder } from "@/lib/orders";

export const generateFilmTask = task({
  id: "generate-film",
  maxDuration: 1800,
  retries: { maxAttempts: 2 },
  run: async ({ orderId }: { orderId: string }) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await runFilmGeneration(order);
  },
  // 全リトライ失敗後：注文を滞留させず顧客承認前に戻す（旧 .catch と同じ挙動）
  onFailure: async ({ payload }) => {
    await transitionOrder(
      payload.orderId, OrderStatus.VIDEO_GENERATING, OrderStatus.AWAITING_CUSTOMER_APPROVAL,
      "system", {}, "film generation failed — reverted for retry"
    ).catch(() => {});
  },
});
```
> `run` の payload型・`onFailure` フックのシグネチャは v4 の実APIに合わせること（`onFailure`/`catchError`/`handleError` の正確な名称と引数はTrigger.dev v4ドキュメントで確認。ここは概念仕様）。

### `trigger/poster.ts` — `id: "generate-poster"`, `runPosterGeneration` を呼ぶ。ffmpeg/フォント不要。onFailureは**リバートしない**（現行方針＝ポスター失敗はfilmをブロックしない、ログのみ）。

### `trigger/rerender.ts` — `id: "rerender-shot"`, payload `{ orderId, shotIndex, reshoot, reason }` → `runShotRerender(order, shotIndex, { reshoot, reason })`。onFailure は `VIDEO_GENERATING → AWAITING_ADMIN_APPROVAL` に戻す（現行 kickShotRerender の .catch と同じ）。

---

## 3. kick関数の書き換え（`lib/film-pipeline.ts` / `lib/poster-pipeline.ts`）

**前回追加した `after()` を撤去**し、下記の3分岐に。**ローカルの実生成ワークフロー（VIDEO_PIPELINE_MOCK=0でlocalhost直実行）を壊さない**ため、`TRIGGER_SECRET_KEY` の有無で分岐する:

```ts
import { tasks } from "@trigger.dev/sdk";
import type { generateFilmTask } from "@/trigger/film"; // 型のみ（Next側にタスクcoードをバンドルしない）

export async function kickFilmGeneration(order: Order): Promise<void> {
  if (process.env.VIDEO_PIPELINE_MOCK === "1") {
    console.log(`[film:MOCK] kick order=${order.id} — no compute`);
    return;
  }
  // ローカル開発（Trigger.dev未設定）: 従来どおりインラインで実行（常駐Nodeなので完走する）
  if (!process.env.TRIGGER_SECRET_KEY) {
    void runFilmGeneration(order).catch(async (e) => {
      console.error(`[film] local run failed order=${order.id}`, e);
      await transitionOrder(order.id, OrderStatus.VIDEO_GENERATING, OrderStatus.AWAITING_CUSTOMER_APPROVAL,
        "system", {}, "film generation failed — reverted for retry").catch(() => {});
    });
    return;
  }
  // 本番（Vercel）: Trigger.dev にオフロード（即時ハンドルを返す）
  await tasks.trigger<typeof generateFilmTask>("generate-film", { orderId: order.id });
}
```
同じ3分岐パターンを `kickPosterGeneration`（poster-pipeline.ts、ローカルfallbackは現行の detached、onFailureリバートなし）と `kickShotRerender`（film-pipeline.ts、payloadに shotIndex/reshoot/reason、fallback revert先は AWAITING_ADMIN_APPROVAL）にも適用。

> 循環参照回避: タスクファイル(`trigger/*.ts`)は `lib/*-pipeline` の run関数をimport。kick関数は `tasks.trigger` を**文字列id＋型onlyインポート**で呼ぶ（タスク実体をimportしない）ので循環しない。

### ffmpegパス対応（`lib/film-pipeline.ts`）
`ffmpeg()` ヘルパーが使うバイナリを、Trigger.devの拡張が入れる system ffmpeg 優先に:
```ts
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? (ffmpegPath as string);
// spawn(FFMPEG_BIN, ...)
```
ローカルは従来どおり `ffmpeg-static`、Trigger.dev上は `FFMPEG_PATH`。`ffmpeg-static` はdependencyに残す（ローカル用）。

---

## 4. 前回のVercelネイティブ変更を撤去

前タスクで入れた以下を戻す（Hobbyでは無効・誤解を招くため）:
- `app/api/orders/approve-storyboard/route.ts` の `export const maxDuration = 800;` → 削除
- `app/admin/[orderId]/page.tsx` の `export const maxDuration = 800;` → 削除（rerenderはTrigger.devへ移動するため不要）
- `vercel.json` の `functions` メモリ設定 → 削除（重い処理はVercelで走らないため不要）。`vercel.json` が空になるなら削除可
- `lib/*-pipeline.ts` の `after()` import と使用 → §3の分岐に置換（`after` importは消す）

---

## 5. 検証

1. `npx tsc --noEmit` / `npx eslint`（変更ファイル）クリーン。
2. **mock e2e 17/17**（`VIDEO_PIPELINE_MOCK=1` でdevサーバ起動＋スクリプト実行）。kickのMOCK分岐が最初にreturnするので Trigger.dev 未接続でも影響なし。
3. `npx next build` 成功（`@trigger.dev/sdk` の型importがNextビルドを壊さないこと。タスク実体はNextにバンドルされない構成であること）。
4. **限界の明記**: Trigger.devの実行（タスクがクラウドで完走・ffmpeg/フォント/prisma/env）は、**オーナーがTrigger.devアカウント作成→project ref記入→env設定→`npx trigger.dev@latest deploy` した後でしか検証できない**。ローカル/CIで確認できるのは型・ビルド・mock e2e・「kickがtasks.trigger経由になった」ことまで。

---

## 6. スコープ外（オーナー作業）
- Trigger.dev アカウント作成、project ref取得、`trigger.config.ts` に記入
- ダッシュボードで Env（DATABASE_URL / FAL_KEY 等）設定、Next `.env` に `TRIGGER_SECRET_KEY`
- `npx trigger.dev@latest deploy`（タスクのデプロイ）＋ `npx trigger.dev@latest dev`（ローカルでタスク実行テストする場合）
- 無料枠: $5コンピュート枠＋月10,000ラン。5本/日なら概ね無料〜数ドル（長時間実行分の超過は軽微）。fal待ちのポーリング時間も課金対象なので、将来的にfal webhook＋Trigger.devのwaittoken化でコスト最適化余地あり（今回は素直に移植）

---

## 7. 注意
- `approveVideo`（Gate2）はVercel据え置き（60秒内）。もし将来Printify/satoriが重くなったら同様にタスク化を検討。
- ローカルでの実生成テスト（オーナーがCamyu等で確認）は、`TRIGGER_SECRET_KEY` 未設定なら従来どおりインライン実行される（§3のfallback）。Trigger.dev経由でテストしたいときは `trigger.dev dev` を併用。
