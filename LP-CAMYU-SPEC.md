# LP アップデート仕様書 — カミュ(CAMYU)ショーケース強化

> 対象: `~/Projects/marquee-tails/lp` のランディングページ
> 目的: 実データ(カミュ)を使い「この写真からこれができるんだ！」とユーザーを惹きつける
> 実装者: Sonnet（このドキュメント単体で実装可能なように書いてある）
> 作成: 2026-07-20

---

## 0. 前提・現状

- 既に `components/ShowcaseFilm.tsx`（"MEET CAMUS" セクション）を実装済み。`app/page.tsx` で `<Hero />` の直後に配置。
- 実アセットは `public/assets/showcase/camus/` に配置済み（`film.mp4`, `film-poster.jpg`, `poster.jpg`, `stills/still-0..5.jpg`）。
- カミュの完成注文: **`cmrp1vz5l0000tsoovucdmajb`**（world=`deepspace`, personality=`timid`）。
- DB接続: `DATABASE_URL="postgresql://postgres:dev@localhost:55432/marquee"`（Docker `marquee-pg`）。スクリプトは `npx tsx scripts/xxx.ts`（`import "dotenv/config"` + `PrismaPg` アダプタ、`scripts/seed-demo.ts` を参照）。
- 画像最適化は `sips`（macOS標準）を使用。`ffmpeg` は `node -e "require('ffmpeg-static')"` のパスから。
- **fal課金に関する鉄則**: 実生成（`VIDEO_PIPELINE_MOCK=0`）はオーナーの明示的OKが出るまで走らせない。本仕様の #1・#4 は fal 課金が発生する（該当箇所に⚠️明記）。

---

## 作業項目サマリ

| # | 項目 | fal課金 | 難易度 |
|---|------|--------|--------|
| 1 | Worlds セクション画像刷新（deepspace=カミュ / storybook=フレブル / noir=ゴールデン） | ⚠️あり（2ワールド分の新規生成） | 中 |
| 2 | アップロード元写真の Before→After 追加 | なし（DL/最適化のみ） | 低 |
| 3 | 「カミュ」→「CAMYU」表記変更（コピー・ポスター・動画） | 一部（#4と統合） | 中 |
| 4 | deepspace 動画 Cut 5 のディズニー感を撮り直し | ⚠️あり（1カット再生成） | 中 |

**推奨実装順**: 2 → 3(a,b) → 1 → 4(+3c を統合) の順。#4 と #3c（動画内の名前）は**1回の再アセンブルでまとめて処理**する（下記 §4 参照）。

---

## 1. Worlds セクション画像刷新

### 要件
`components/Worlds.tsx` の3ワールドカードを、全て**カミュと同等のシネマティック実写クオリティ**に統一する（現状は絵画調イラスト）。

- **Deep Space Explorer** → カミュの実スチルを流用（既に `public/assets/showcase/camus/stills/` にある）。おすすめは `still-5.jpg`（星雲を背にブリッジに立つ全身、いかにも"deep space"）。
- **Storybook Kingdom** → **フレンチ・ブルドッグ**を新規生成（小さな王/騎士）。
- **Noir Detective** → **ゴールデン・レトリバー**を新規生成（トレンチコートの探偵）。

> ⚠️ 要確認（オーナー判断）:
> - 犬種→ワールドの割り当て（上記は提案。フレブル↔ゴールデンの入れ替え可）。
> - 「イラストクオリティ」の解釈 = **カミュと同じ実写シネマ調に統一**と解釈している。もし絵画調イラストを維持したいなら生成プロンプトを変える（下記の STYLE_RULES を外し "painterly illustration, storybook art" 等に）。

### 生成方法（新規2枚）⚠️ fal課金
`lib/stills-pipeline.ts` の生成パターンを流用。特定ペットの同一性は不要（汎用犬種のコンセプト画像）なので**identity参照なしのテキスト→画像**でよい。

- モデル: `fal-ai/nano-banana-pro`（`/edit` ではなく base のテキスト→画像。参照画像不要）。
- `aspect_ratio: "16:9"`、`STYLE_RULES`（`lib/stills-pipeline.ts` からimport）を付与して実写ロックする。
- 1ワールドあたり2〜3枚生成 → 良いものを1枚採用。

**作成する使い捨てスクリプト例** `scripts/gen-world-heroes.ts`（実装後に削除可）:

```ts
import "dotenv/config";
import { fal } from "@fal-ai/client";
import { STYLE_RULES } from "../lib/stills-pipeline";

// FAL_KEY は .env。VIDEO_PIPELINE_MOCK は無視されるので、このスクリプトは
// 実行=即課金。オーナーOK後にのみ実行。
const MODEL = "fal-ai/nano-banana-pro";

const PROMPTS = {
  storybook: `One cinematic live-action film still. A French Bulldog dressed as a tiny storybook king/knight — a small crimson-and-gold royal robe and a jeweled crown — standing regally on a mossy stone castle balcony overlooking a painterly fairytale kingdom at golden hour. Blockbuster cinematography, dramatic warm light, shallow depth of field, film grain. ${STYLE_RULES}`,
  noir: `One cinematic live-action film still. A Golden Retriever detective in a tiny belted trench coat and fedora, standing in a rain-slicked 1940s cobblestone alley, dramatic film-noir lighting from a single warm streetlamp cutting through mist, moody and atmospheric. Blockbuster cinematography, shallow depth of field, film grain. ${STYLE_RULES}`,
};

async function gen(key: keyof typeof PROMPTS) {
  for (let i = 0; i < 3; i++) {
    const r = await fal.subscribe(MODEL, {
      input: { prompt: PROMPTS[key], aspect_ratio: "16:9" },
    });
    console.log(key, i, (r as any).data?.images?.[0]?.url);
  }
}
async function main() { await gen("storybook"); await gen("noir"); }
main();
```

> 実際の `fal.subscribe` の入力/出力形はプロジェクト内の既存呼び出し（`lib/stills-pipeline.ts:170` 付近 `generateTakeStill`）に合わせること。返却の画像URL取り出し方も既存に倣う。

### 採用画像の配置・最適化
```bash
cd public/assets/showcase/worlds   # 新規ディレクトリ
# 生成URLをDL後:
sips --resampleWidth 1200 storybook-frenchie.png --out ../../world-storybook.jpg -s format jpeg -s formatOptions 82
sips --resampleWidth 1200 noir-golden.png       --out ../../world-noir.jpg      -s format jpeg -s formatOptions 82
```
- deepspace は `public/assets/showcase/camus/stills/still-5.jpg` をそのまま参照するか、`public/assets/world-deepspace.jpg` にコピー。

### Worlds.tsx の編集
`WORLDS` 配列の `image` と `alt` を差し替える:
- `deepspace`: `image: "/assets/showcase/camus/stills/still-5.jpg"`（またはコピー先）、`alt` をカミュ（シュナウザー宇宙飛行士）の説明に。
- `storybook`: `image: "/assets/world-storybook.jpg"`、`alt` をフレブルの王の説明に。
- `noir`: `image: "/assets/world-noir.jpg"`、`alt` をゴールデンの探偵の説明に。
- 現状 `next/image` + `aspect-video` なので構造変更は不要。旧 `world-*.png` は削除してよい。

---

## 2. アップロード元写真の Before→After 追加

### 狙い
「こんな普通のスマホ写真から、あの映画ができる」を見せる。`ShowcaseFilm.tsx` の**フィルムより上**（"MEET CAMUS" 見出しの直下、動画の前）に "From your camera roll" ストリップを追加。

### アセット取得（fal課金なし）
カミュの実アップロード写真（注文 `cmrp1vz5l...` の `uploadedPhotoUrls`）。全6枚のうち日常スナップとして映える**3枚**を推奨採用:

| 推奨 | URL |
|---|---|
| ① 顔アップ（笑顔） | `https://v3b.fal.media/files/b/0aa2a048/WPa3HKfxGVimEfoo7Hmpf_IMG_9291.jpg` |
| ② 海辺の散歩（ボーダー服・全身） | `https://v3b.fal.media/files/b/0aa2a054/tpF4tlmz-0rGyWCX1tchk_IMG_9848.jpeg` |
| ③ 膝上（ぬいぐるみと） | `https://v3b.fal.media/files/b/0aa2a048/SnnjZwb8RG6zYpjBbMqe8_4B0A05C2-2806-488A-B4A1-3B05E6DF4749.JPG` |

（残り3枚: `UxPB6pBttaRpUfpfMBEcH_3E65D42C...`, `VbTTSgiryPd8rrSHCzho7_IMG_7579.jpeg`, `an_jycBevVhi1l9MafqsV_IMG_9296%202.jpeg`。差し替え候補。）

```bash
mkdir -p public/assets/showcase/camus/uploads
# 各URLをDL後、正方形サムネに正規化（ffmpegでcrop → sipsでJPEG）
# 例: 700x700 センタークロップ, JPEG q82, upload-1.jpg / upload-2.jpg / upload-3.jpg
```
- **プライバシー注意**: これはオーナー自身の犬の写真であり、オーナーの明示的な依頼に基づく公開。第三者の個人情報ではない。他人の写真が混ざっていないか採用前に必ず目視確認。

### ShowcaseFilm.tsx への追加マークアップ（イメージ）
"MEET CAMUS" のリード文の下、`<figure>`（動画）の前に:

```tsx
{/* Before: the camera roll */}
<div className="mt-10">
  <p className="text-center text-xs uppercase tracking-[0.25em] text-muted">
    You send us this…
  </p>
  <ul className="mx-auto mt-4 flex max-w-xl list-none items-center justify-center gap-3 sm:gap-4">
    {UPLOADS.map((u) => (
      <li key={u} className="relative">
        <div className="relative size-20 overflow-hidden rounded-chip border border-hairline bg-surface sm:size-28">
          <Image src={u} alt="One of Camus's original everyday photos" fill sizes="112px" className="object-cover" />
        </div>
      </li>
    ))}
  </ul>
  {/* down-arrow → "…we send back a premiere" とつなげて動画へ */}
  <p className="mt-4 text-center font-display text-sm uppercase tracking-[0.2em] text-gold">
    ↓ …we send back a premiere
  </p>
</div>
```
- `UPLOADS = ["/assets/showcase/camus/uploads/upload-1.jpg", ...]`。
- スナップ感を残すため軽い `rotate-[-2deg]` / `rotate-[2deg]` を交互に付けても良い（ポラロイド風）。

---

## 3. 「カミュ」→「CAMYU」表記変更

英語圏販売のため表記を romaji "CAMYU" に統一する。3箇所。

### (a) ShowcaseFilm.tsx のコピー・alt（fal課金なし・即時）
- 見出し "MEET CAMUS" → **"MEET CAMYU"**
- リード文・`figcaption` の "Camus" → "CAMYU"、`"The Long Way Home"` はそのまま。
- 各 `alt` の "Camus" → "CAMYU"。
- ※ ブランド名 "Marquee Tails" は変更しない。

### (b) ポスター画像 poster.jpg の再生成（fal画像生成なし。satoriのみ）
現在の `poster.jpg` はタイトルが日本語「カミュ」。`lib/poster-print.ts` の `renderPosterPng` は `petName` からタイトルを焼くので、**petName="CAMYU" で再レンダー**すれば良い。テキストフリーのアート（`posterUrl`）を使う。

- カミュのテキストフリーアートURL（採用済み）:
  `https://v3b.fal.media/files/b/0aa2f6f1/ITtylxZXdlDhPx79f7SlU_HMBm3C26.png`
- deepspace/timid のコピー: サブタイトル `THE LONG WAY HOME`、上部タグ `SPACE IS VERY, VERY BIG.`（`getLoglines("deepspace","timid","CAMYU")` から取得可）。

使い捨てスクリプト例 `scripts/rerender-camyu-poster.ts`:
```ts
import "dotenv/config";
import { renderPosterPng } from "../lib/poster-print";
async function main() {
  const url = await renderPosterPng(
    "https://v3b.fal.media/files/b/0aa2f6f1/ITtylxZXdlDhPx79f7SlU_HMBm3C26.png",
    { petName: "CAMYU", subtitle: "THE LONG WAY HOME" },  // billing/release はデフォルトでOK
  );
  console.log("poster:", url);  // fal.storage のURL。DLして最適化。
}
main();
```
```bash
# 返却URLをDL → 差し替え
curl -sS -o /tmp/camyu-poster.png "<returned url>"
sips --resampleWidth 1000 /tmp/camyu-poster.png --out public/assets/showcase/camus/poster.jpg -s format jpeg -s formatOptions 82
```
> `renderPosterPng` は内部で fal.storage に**アップロード**するが、これは画像生成課金ではない（satoriレンダーのみ）。ネットワークは使う。

### (c) 動画内の「カミュ」表記 → §4 と統合
`film.mp4` の Cut 2 のネームカード / Cut 4 「AND カミュ IS VERY SMALL」/ クロージングのネームカードに「カミュ」が焼き込まれている（`lib/film-pipeline.ts` の `assemble()` が `order.petName` から生成）。これは **§4 の再アセンブルで一緒に CAMYU 化する**（DBの `petName` を先に "CAMYU" に更新しておけば、再アセンブル時にキャプションが英字フォントで再焼きされる。`assemble()` は `asciiName` 判定で ASCII 名に対応済み）。

---

## 4. deepspace 動画 Cut 5 のディズニー感を撮り直し ⚠️ fal課金

### 対象カットの特定
6カット中、**Cut 5**（≒35〜43秒、キャプション "BUT COURAGE FINDS THE QUIET ONES."、宇宙服のカミュが夕焼けのエイリアン惑星に立つ全身ショット）が明確に**ディズニー/3DCGアニメ調**（毛がツルッと滑らか・目が丸くデフォルメ・背景がマットペイント調）。他5カットは実写を保っている。
- `shotClipUrls` / `chosenStills` のインデックスで **Cut 5 = index 4**。
- ※ 念のためオーナーが実際に視聴して「Cut 5 で合っているか」最終確認してから実行推奨。

### 実行方法
`lib/film-pipeline.ts` の既存 `runShotRerender(order, shotIndex, { reshoot, reason })` を使う。`reshoot: true` = 作画そのものを撮り直し（look）。この関数は**該当カットのみ再生成 → キャッシュ済みの他5カット＋音楽で再アセンブル**する（`order.petName` を読んでキャプションも再焼き）。

**CAMYU化(§3c) と統合した実行手順**:
```ts
// scripts/fix-camus-cut5.ts （オーナーOK後、VIDEO_PIPELINE_MOCK=0 で実行 = 課金）
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runShotRerender } from "../lib/film-pipeline";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const id = "cmrp1vz5l0000tsoovucdmajb";
  // (1) 動画内の名前も CAMYU にするため先に更新
  await prisma.order.update({ where: { id }, data: { petName: "CAMYU" } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  // (2) Cut 5 (index 4) を撮り直し → 自動で再アセンブル
  await runShotRerender(order, 4, { reshoot: true, reason: "Cut 5 drifts into 3D-cartoon (Disney) look; re-shoot for photoreal." });
  console.log("done");
  await prisma.$disconnect();
}
main();
```
> 事前確認: `runShotRerender` のシグネチャ（`{ reshoot, reason }` の正確なキー名）を `lib/film-pipeline.ts:492` で確認してから使う。ステータス遷移（AWAITING_ADMIN_APPROVAL → VIDEO_GENERATING → …）を伴うため、実行前に注文が再レンダー可能な状態か確認（必要なら管理画面のRe-renderボタン経由でも可）。

### 再取得・差し替え（fal課金なし）
撮り直し完了後、更新された `finalVideoUrl` を取得して LP アセットを更新:
```bash
# 新しい finalVideoUrl を DB から取得（scripts/_probe 相当）
curl -sS -o public/assets/showcase/camus/film.mp4 "<new finalVideoUrl>"
FF=$(node -e "process.stdout.write(require('ffmpeg-static'))")
# ポスターフレーム再取得（Cut 5 以外の良い実写フレーム。例 24秒）
"$FF" -y -ss 24 -i public/assets/showcase/camus/film.mp4 -frames:v 1 -q:v 3 /tmp/fp.jpg
sips --resampleWidth 1600 /tmp/fp.jpg --out public/assets/showcase/camus/film-poster.jpg -s format jpeg -s formatOptions 82
```
- Cut 5 のスチル（`stills/still-4.jpg`）も撮り直しで変わる場合は、新しい `chosenStills[4]` を DL して差し替え（ストーリーボード帯の整合のため）。

---

## 5. 検証（各項目共通）

1. `npx tsc --noEmit` と `npx eslint <changed files>` がクリーン。
2. dev サーバ（`marquee-tails-lp` / :3100、既に稼働中のことが多い）でブラウザ確認:
   - Hero → ShowcaseFilm の順、Before写真ストリップ → 動画（自動ミュート再生 + Play with sound）→ 6カット帯 → ポスター。
   - Worlds セクションの3枚が実写シネマ調で統一されている。
   - "CAMYU" 表記が コピー・ポスター・動画内キャプションで一貫。
   - コンソールエラーなし（`read_console_messages`）、動画が `paused:false`。
3. モバイル(375)/デスクトップ両方で横スクロールが出ない（`scrollWidth === clientWidth`）。
4. `public/assets/showcase/` に巨大PNGを残さない（19MB級のソースは削除、配信はJPEG/mp4のみ）。

---

## 6. コスト・OKゲート（オーナー確認事項）

| 作業 | fal課金 | 概算 |
|------|--------|------|
| #1 Worlds 2犬種の新規生成 | あり | nano-banana-pro × 数枚（~$0.1〜0.3/枚 程度、要確認） |
| #4 Cut 5 撮り直し + 再アセンブル | あり | i2vクリップ1本 + アセンブル（1カット分の動画生成コスト） |
| #2 Before写真 / #3a コピー / #3b ポスター | **なし** | DL・satori・最適化のみ |

**#1 と #4 は実行前にオーナーの明示OKを取ること。** それ以外（#2, #3a, #3b）は先行実装して差し支えない。

---

## 7. 決定事項（2026-07-20 オーナー確認済み）

1. Worlds 犬種割り当て: **Storybook=フレンチブルドッグ / Noir=ゴールデン で確定**。
2. Worlds のスタイル: **「カミュと同じ実写シネマ調」で統一、確定**。
3. Cut 5 撮り直し（§4）: **一旦保留**。今回のスコープから外す。実装しない。
4. Before 写真: **IMG_9291（顔アップ・笑顔）の1枚のみ採用**。§2 の3枚案は不採用 — UPLOADS配列は1枚构成に変更。

### 今回の実装スコープ（更新後・全て完了）
- ✅ #1 Worlds画像刷新 — 完了。`fal-ai/nano-banana-pro`（base, 参照画像なし）でstorybook=フレンチブルドッグの王・noir=ゴールデンレトリバー探偵を各3案生成、採用1枚ずつ選定。deepspaceはカミュの実スチル（`still-5.jpg`）を流用。
  - 配置: `public/assets/world-{deepspace,storybook,noir}-hero.jpg`（新規、LP専用ファイル名）
  - ⚠️注意: 既存の `public/assets/world-*.png` は**モックパイプラインのスタンドイン画像として `lib/stills-pipeline.ts` / `lib/poster-pipeline.ts` / `scripts/seed-demo.ts` から参照されている実ファイル**。上書き・削除禁止（今回、誤って削除しかけたが git checkout で復元し、新アセットは別名 `-hero.jpg` に退避した）。
- ✅ #2 Before写真1枚の追加（fal課金なし）
- ✅ #3(a) コピー「カミュ→CAMYU」（fal課金なし）
- ✅ #3(b) ポスターpetName再レンダー「CAMYU」（fal課金なし・satoriのみ）
- ⛔ #3(c) 動画内キャプションのCAMYU化 — Cut5再撮影とセットの想定だったが、Cut5保留に伴い**今回は動画内の名前は変更しない**（次回、Cut5対応時にまとめて実施）
- ⛔ #4 Cut 5 撮り直し — 保留

---

## 8. 価格改定（2026-07-20 決定・Sonnet実装待ち）

### 背景
オーナーが「Digital Premiereを$75くらいに」と提起 → 実原価（GENERATION-REFERENCE.md: compute ≈$8.6/本、business_strategy.md: 定常COGS想定$16/本）と米国ペット市場の実勢調査（WebSearch実施済み）を踏まえてラダー全体を再設計。

**市場調査で確認した実勢（2026年7月時点）:**
- AI生成ペット肖像（静止画コモディティ）: $18〜55（市場$240M、急拡大中）
- Crown & Paw（D2C最大手）キャンバス: $59.95〜89.95
- 額装キャンバス / 伝統オンライン: $150〜250
- 手描きコミッション旨味ゾーン: $150〜300
- AIペット**動画**サービス（petmovie.ai等）: 月$9.99〜69.99のサブスク＋クレジット制（1本売りの単価は非公開・実質「安価なおもちゃ」ポジション）

→ Marquee Tailsは「静止画1枚」でも「安価なAI動画サブスク」でもなく、**人が監修・同一性ロックした一点物のシネマ映画＋ポスター**。比較対象はCrown & Pawプレミアム帯〜手描きコミッション旨味ゾーン（$150〜300）。「a film, not a picture」の価値訴求（=カミュのショーケースが体現している内容）が価格を正当化する前提。

### 新価格ラダー（確定）

| ティア | 旧価格 | **新価格** | 内容 | 貢献利益（定常原価ベース概算） |
|---|---|---|---|---|
| Digital Premiere | $49 | **$75** | 60秒シネマトレーラー＋6ショット＋3ワールドから選択＋デジタルポスター＋48h HD納品 | ~$64（粗利85%） |
| **Feature Film** | $99 | **$129** | Digital全部＋シネマポスター印刷・発送＋TikTok/Instagram向けフォーマット。**"Most Popular"バッジ据え置き** | ~$88（粗利68%）＋POD原価 |
| Collector's Edition | $159 | **$199** | 内容を下記の通り**再定義**（拡張トレーラーは外す） | ~$151（粗利76%）＋POD原価 |

間隔比 1 : 1.72 : 2.65（デコイ効果維持、中間$129が「賢い選択」に見えるバランス）。

### Collector's Edition 内容の再定義（重要な変更）

**旧内容（不採用）:**
```
- Extended cut of the trailer   ← 削除（未検証：6→8カット拡張は同一性ドリフト増・QC負荷増・
                                    「エンジン/QC/パイプラインは3ティア共通」という戦略原則にも反する）
- 16×20 gallery canvas
- Full 4K delivery
- Priority production slot
- Everything in Feature Film
```

**新内容（実証済み要素のみ・確定）:**
```
- Everything in Feature Film
- 16×20 gallery canvas of the poster   ← 維持（Printify標準SKU）
- Full 4K delivery                      ← 維持（アップスケール工程は軽い）
- Priority production slot — you skip the queue  ← 維持（キュー順ロジックのみ、リスクなし）
```
拡張トレーラー（+2シーン）は**この改定で完全に削除**。理由: 6→8カットへのショット数変更は同一性スコアリング・QC・アセンブリ全工程に影響する未検証の変更であり、値上げのタイミングで新規リスクを持ち込まない。

**⚠️ ローンチ前にオーナーが直接やること（Sonnetの実装スコープ外）:**
ギャラリーキャンバス16×20を実際に1点発注し、Printify経由の品質・梱包・発送を検証してから正式ローンチする。まだ実施していない。

### Sonnet実装タスク（このファイルを渡して実装させる）

対象ファイル: `components/PricingTeaser.tsx`

1. `tiers`配列を更新:
   - Digital Premiere: `price: "$49"` → `"$75"`
   - Feature Film: `price: "$99"` → `"$129"`
   - Collector's Edition: `price: "$159"` → `"$199"`
   - Collector'sの`items`から `"Extended cut of the trailer"` を削除（他の4項目はそのまま）
2. `components/FAQ.tsx` — 価格に直接言及している箇所は現状なし（確認済み、変更不要）。ただし将来「拡張トレーラー」に言及する追記がFAQに入っていないか実装時に再確認。
3. `components/ShowcaseFilm.tsx` の "Collector's editions, we print it and ship it." は価格非言及のため変更不要。
4. Founding Members訴求文（"Founding Members get 20% off these prices"）は新価格ベースで自動的に整合するため変更不要（％表記のみのため）。
5. 実装後、tsc/lint必須、ブラウザで価格3枚とバッジ位置を目視確認。

### Founding Member 20%オフ（2026-07-20 決定・端数そのまま採用）

「最初の100人まで20%オフ」の仕組み自体は`WaitlistForm.tsx` / `FAQ.tsx` / `Hero.tsx`に**既に実装済み**（すべて"20% off"という％表記のみで、金額をハードコードしていない）。よって新価格ラダーにも自動的にそのまま適用される — **LPコードの変更は不要**。

**確定した実際のFounding Member価格（参考値・端数はそのまま）:**

| ティア | 定価 | Founding Member（20%オフ） |
|---|---|---|
| Digital Premiere | $75 | **$60.00** |
| Feature Film | $129 | **$103.20** |
| Collector's Edition | $199 | **$159.20** |

端数（$103.20 / $159.20）は丸めずそのまま採用。将来Stripe実装時は「20% off」クーポン/プロモコードをそのまま適用すれば良く、ティアごとに固定のFounding Member価格をハードコードする必要はない（実装がシンプルになる）。

**Sonnetへの追加指示: なし。** このセクションはLP実装への影響がないため、確認事項として記録のみ（将来のStripeチェックアウト実装時に「% offクーポンを使う」という前提を引き継ぐこと）。
