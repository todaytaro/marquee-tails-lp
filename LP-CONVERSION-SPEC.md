# LP コンバージョン改修 仕様書（Waitlist → Open Store + プレミアムHero）

> **ステータス: 設計のみ / 未実装。** 実装は Sonnet が別途行う。
> このドキュメントは「LPをウェイトリスト前提から実販売オープンに切り替え、
> かつ購買効果を最大化する」ための仕様。オーナーは非エンジニアなので、
> 実装者は各変更の意図（なぜそうするか）を壊さないこと。
> 作成: 2026-07-23

---

## 背景・現状の問題

- Phase 9 で Pricing セクションに本物の Buy ボタン（Stripe Checkout 連携）を設置済み。
- しかし Hero の CTA・FAQ・ウェイトリストセクションの文言は**まだ「準備中、ウェイトリストが順番を決める」前提のまま**。
- 結果、「まだ買えない」という上部の文言と「もう買える」下部のボタンが**矛盾**し、訪問者が混乱する。
- **方針: オプション1（完全オープン）**。ウェイトリスト限定は廃止し、誰でも今すぐ注文できる導線に統一する。

---

## Part A — Waitlist → Open Store の切り替え

### A-1. ヒーロー CTA
- 現状 `components/Hero.tsx` の「Join the waitlist」→ **「Start Casting」** 系の購入導線に変更（Part C の Hero 刷新に統合）。
- クリックで `#pricing` へスムーズスクロール（Hero CTA に価格を直書きするかは C-4 参照）。

### A-2. ウェイトリストセクションの撤去/転用
- `components/WaitlistForm.tsx` と「Become a Founding Member」セクションを削除、または
  **「メール登録で launch 割引コードを受け取る」ソフトなリード獲得**に転用（購入はいつでも可能な前提で、割引フックとして残すのは可）。
- 「first 100 become Founding Members」「waitlist casts our first production slots」等の
  **順番待ち・供給制限の文言はすべて削除または書き換え**。

### A-3. FAQ の更新（`components/FAQ.tsx`）
- 「When do you launch, and what do Founding Members get?」→ 「今すぐ注文できます」ベースに書き換え。
- ウェイトリスト・launch待ちを示唆する回答を全て現在形（販売中）に。

### A-4. ヒーロー上部のバッジ
- 「NOW CASTING — WAITLIST OPEN」→ 「NOW CASTING — **ORDERS OPEN**」等。

### A-5. 供給制限の演出は「希少性」として残してよい
- 「We produce just 5 films a day」は**在庫希少性の演出として有効**なので残す。
  ただし「だから今は待って」ではなく「だから早い者勝ち／早く枠を押さえて」の文脈に。

---

## Part B — 購買効果を高める価格の見せ方（★法令注意あり）

### ⚠️ B-0. 法令上の絶対ルール（二重価格表示）
- **一度も販売していない金額を「元の価格（~~$199~~）」として取り消し線で見せるのは NG。**
  景品表示法（日本）・FTC ガイドライン（米国）等の**有利誤認 / 二重価格表示規制**に触れるリスク。
- 取り消し線価格を使いたい場合は、**「今後実際に値上げする予定価格」**としてのみ表示可
  （例: `$75` `↗ $99 after launch`）。**実際に値上げする計画がある場合に限る。**
- 弁護士レビュー（Phase 7）の対象にこの価格表示も含めること。

### B-1. 推奨フレーミング: Launch Pricing + 値上げ予告（米国市場で最も効く）
米国 D2C / ギフト市場では「founding / early access / price goes up」が最も刺さる。
Kickstarter・SaaS ローンチで慣れており、むしろ期待される見せ方。かつ B-0 に抵触しない。

各ティアカードでの表示例（**実際に launch 後値上げする前提で**）:
```
Feature Film
$129   ↗ $159 after launch          ← 将来価格。取り消し線ではなく「今後上がる」提示
🎬 Launch pricing — first 100 films only
✓ Free worldwide shipping included    ← 送料込みは事実なのでOK（Phase 5 で検証済み）
```
- 「first 100 films only」等の希少性は、**実際にその条件で運用する場合のみ**記載。

### B-2. 比較アンカー（合法・強力）
- 他ジャンルとの価格比較は嘘にならない範囲で有効:
  - 「A custom pet portrait alone runs $150+. This is a whole film — with a poster.」
- ティア群の近くか Hero 直下に置く。

### B-3. リスク除去（購入不安の解消）
- 返金ポリシー（Phase 7 で確定済み: 不良は無償再制作）を購買文脈の言葉に:
  - 「Not recognizably your pet? We remake it free.」
- Stripe の安全性: 「Secure checkout · Made to order」（既に Pricing 下部にある文言を活用）。

### B-4. 送料無料の訴求
- Feature / Collector's は送料込みで粗利十分（Phase 5 でオーストラリア宛でも黒字確認済み）。
- 「**Free worldwide shipping**」を明示。Digital は物理発送なしなので「Instant digital delivery」。

### B-5. ソーシャルプルーフ（実績が出てから）
- 「Join 100+ pet parents」的な数字・レビュー・UGC 埋め込みは**実データが出てから**追加。
  ローンチ時点で捏造しないこと。プレースホルダとして枠だけ用意するのは可。

### B-6. ティア間の誘導
- 「Feature Film」を Most Popular として視覚的に最も強調（既存の gold-glow は維持）。
- Collector's は「best value / everything included」でアップセル。

---

## Part C — プレミアム・シネマティック Hero 刷新

オーナー提案（フルスクリーン動画 + Framer Motion リビール + ゴールド/グラスCTA + アンミュート）を
ベースに、下記の**4つの修正**を必ず反映する。

### C-1. 背景動画（★ネタバレ回避が最重要）
- **禁止**: 完成版 Camyu フィルム（`film.mp4`）を Hero 背景でそのまま流すこと。
  → before→after のリビールはショーケース（`ShowcaseFilm.tsx`）の決定的瞬間。冒頭で使い切らない。
- **採用**: Hero 専用の「**雰囲気モンタージュ・ループ**」を新規に用意する:
  - 速いカット割り（各世界の断片・マーキー電飾・フィルムグレイン・寄りの目のカット等）で
    「何かすごい映画が始まる」空気だけ作り、**顔の完全な一致は見せ切らない**。
  - 尺 6〜10 秒程度のシームレスループ。
- **技術要件（必須）**:
  - 専用エンコード: **2〜4MB 以内**（現 `film.mp4` は 11MB で重すぎる。Hero には使わない）。
  - `<video muted autoPlay loop playsInline preload="metadata" poster={...}>`
    （iOS autoplay 条件: muted + playsInline 必須）。
  - `poster` に静止画フォールバック（現行 `hero.png` を流用可）。
  - `prefers-reduced-motion: reduce` の場合は**動画を出さず poster 静止画のみ**。
  - Slow connection / データセーバー時も静止画フォールバックを検討（`navigator.connection`）。
  - LCP 対策: 動画は装飾、テキストと CTA は動画ロードを待たず即描画。

### C-2. 暗いグラデーションオーバーレイ
- 下部がより暗い縦グラデ + 中央 radial で文字可読性を確保（既存 Hero のグラデ資産を流用）。
- 既存のレターボックス上下バー（`film-grain` 演出）は**プレミアム感を強めるので維持推奨**。

### C-3. Cinematic Text Reveal（Framer Motion）
- キャッチコピー: オーナー案 "Turn Your Pet Into A Hollywood Hero." は威勢は良いが
  **最大の差別化「顔が本当に本人」が消える**。以下いずれかで likeness フックを残す:
  - 案A（推奨・両立）: メイン "Turn Your Pet Into A Hollywood Hero."
    + サブコピーで "…and it's unmistakably **them** — in every single frame." を残す。
  - 案B: メインを "Your actual pet. A real cinematic trailer." 系に寄せる。
- **ブランド原則**: 「フランチャイズの模倣はしない／オリジナル世界のみ」。"Hollywood" は地名/概念として可だが
  特定作品を想起させる表現は避ける。
- アニメーション: 予告編風に「初期状態 `filter: blur(8px)` + `opacity: 0` + `letterSpacing` わずかに狭い」
  →「`blur(0)` + `opacity: 1` + `letterSpacing` わずかに広がる」へゆっくりフェード。
  - `prefers-reduced-motion: reduce` では**アニメーションを無効化し最終状態を即表示**。
  - blur アニメは低スペック端末でジャンクしやすい → duration 長め・easing 緩やか、必要なら
    blur は初期のみ・transform/opacity 主体に。

### C-4. CTA
- メイン: オーナー案「START CASTING - $129」。
  - **論点**: 3ティア（$75/$129/$199）があるため、冒頭で中位 $129 固定は sticker shock 懸念。
  - **推奨**:
    - 第一候補: 「**Start Casting →**」（価格を出さず `#pricing` へスクロール）。
    - 第二候補: 「**Start Casting — from $75**」（下限提示で心理的ハードルを下げる）。
    - $129 を出すなら「一番人気を推す」意図として許容だが上記リスクを理解した上で。
  - デザイン: ゴールド系（既存 `btn-marquee` / `--gold`）またはグラスモーフィズム
    （`backdrop-blur` + 半透明白 + 細い枠）。既存トークンと調和させる。
- サブ CTA: 「See a real premiere」→ ショーケース（`#showcase`）へ（リビールはここで見せる）。

### C-5. Unmute / Experience ボタン
- 画面右下 or 中央下部に「🎧 Sound On / Experience the Magic」的な小さく洗練されたボタン。
- React state（`const [muted, setMuted] = useState(true)`）で背景動画の `muted` をトグル。
- 注意: 背景動画に音声を入れる場合、**アンミュート時に Hero 動画が音を出す**ことになる。
  ショーケースのフィルム音声との二重再生を避ける設計（Hero でアンミュートしたら showcase 側は停止、等）。
  もし Hero 背景がモンタージュで音を持たないなら、このボタンは「ショーケースへ誘導して音付き再生」に転用も可。

### C-6. 依存関係
- **framer-motion は未インストール**。React 19 環境のため、現行の推奨パッケージ名は **`motion`**
  （インポートは `import { motion } from "motion/react"`）。
  実装時に `npm i motion` で追加。旧 `framer-motion` を使う場合は React 19 互換を確認すること。
- 既存スタック: Next.js 16 (App Router) / React 19 / Tailwind v4。Hero は Client Component 化が必要
  （`"use client"` — state とアニメーションのため）。

---

## 実装対象ファイル（想定）

| ファイル | 変更内容 |
|---|---|
| `components/Hero.tsx` | Part C 全体（Client 化・背景動画・Framer Motion リビール・CTA・Unmute） |
| `components/PricingTeaser.tsx` | Part B（launch pricing 表記・送料無料・比較アンカー・リスク除去文言） |
| `components/WaitlistForm.tsx` | Part A-2（削除 or 割引リード獲得に転用） |
| `components/FAQ.tsx` | Part A-3（販売中ベースに書き換え） |
| `app/page.tsx` | ウェイトリストセクションの撤去/差し替え、セクション順序の見直し |
| `public/assets/hero-loop.mp4`（新規） | Part C-1 の Hero 専用圧縮モンタージュ（2〜4MB） |

---

## 未確定・オーナー判断が必要な項目

1. **実際に launch 後に値上げするか？**（B-1 の取り消し/値上げ表記の可否を左右。しないなら Launch Pricing 表記のみ）
2. **Hero CTA に価格を出すか**（C-4: 出さない / from $75 / $129 固定）
3. **Hero キャッチコピー**（C-3: 案A "Hollywood Hero"+likenessサブ / 案B likeness前面）
4. **Hero 背景モンタージュ素材の用意**（誰がどう作るか。既存カットの寄せ集めで生成するか）
5. **ウェイトリストフォームを完全撤去か、割引リード獲得に転用か**（A-2）

---

## 公開前チェック（この改修分）
- [ ] 二重価格表示が B-0 に抵触していない（弁護士レビュー対象）
- [ ] Hero 背景がリビールをネタバレしていない
- [ ] Hero 動画が 2〜4MB 以内・モバイル autoplay 条件を満たす・poster フォールバックあり
- [ ] `prefers-reduced-motion` で動画/アニメーションが無効化される
- [ ] 「ウェイトリスト／順番待ち／launch待ち」文言が全ページから消えている
- [ ] Buy ボタン → Stripe Checkout が全ティアで動作（既存機能のリグレッション確認）
