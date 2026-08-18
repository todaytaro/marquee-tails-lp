# Marquee Tails — 現状の仕様（2026-08-18）

**仕様書が28本ある。ほとんどは「その機能を作ったときの」記録で、いま動いている
ものの説明ではない。** この文書だけが「今どう動いているか」を書いたもので、
個別仕様書と食い違ったらこちらが正。個別仕様書は**なぜそう作ったか**を読むために
残してある（判断の記録としては今も価値がある）。

作業を始める前に、下の「§7 個別仕様書のどこが古いか」を先に見ること。

---

## 1. 売っているもの

| プラン | 価格 | 脚本 | 動画モデル |
|---|---|---|---|
| Preset Worlds | **$159** | 静的（3世界 × 性格） | Kling v3 pro |
| Director's Cut | **$249** | Claude がブリーフから書き下ろす | Seedance 2.0 |

物理アドオン（Printify、納品後に販売）: プリントポスター $59 / キャンバス $99。

**$99 は価格ではない。** `NONREFUNDABLE_FEE_USD = 99` は DC $249 の非返金内訳
（$249 = 企画・絵コンテ $99 + 返金可能な撮影費 $150）。ここを価格と取り違えた事例が
実際にある。

返金: DC は撮影開始前に限り $150 返金・$99 控除。Preset は $59 控除。**全額返金は無い。**
完成した動画の作り直しは**両プランとも受けない**（2026-08-16 決定）。
絵コンテの引き直しは**両プラン2回まで**（`STORYBOARD_REROLL_CAP = 2`）。

売らない地域: EU 27 + 英国 + ノルウェー・スイス・アイスランド。決済で 451 を返す
（`lib/sales-regions.ts`）。理由と開ける条件は `../PRODUCT-FACTS.md`。

---

## 2. 注文の流れ

```
UPLOADING
   │  写真 7〜12枚（HEIC は前段で JPEG に変換）
   ├─ DC のみ ─→ TREATMENT_GENERATING → AWAITING_TREATMENT_APPROVAL
   │              （Gate 0: 顧客が脚本を読む。修正は2回まで）
   ▼
IMAGE_GENERATING          ← LoRA学習 → 絵コンテ18枚
   │  **管理者が先に見る**（承認列。adminRerollCount）
   ▼
AWAITING_CUSTOMER_APPROVAL （Gate 1: 顧客が6カット×3テイクから選ぶ）
   ▼
VIDEO_GENERATING
   ▼
AWAITING_ADMIN_APPROVAL   （Gate 2: 管理者が完成品を見る）
   ▼
COMPLETED                  納品メール → 納品ページ
```

**人間が見るのは3箇所**（DC は Gate 0 を足して3、Preset は2）。
絵コンテは**顧客より先に管理者が見る** — ここを取り違えると「顧客が最初に不良品を見る」
という誤った前提で設計してしまう。

---

## 3. 生成パイプライン

### 3.1 使っているモデル

| 工程 | モデル | 備考 |
|---|---|---|
| LoRA 学習 | `fal-ai/flux-2-trainer-v2` | 1500 steps。約45分。**実測 $9.76** |
| 絵コンテ（B1） | `fal-ai/flux-2/lora/edit` | 6カット × 3テイク = 18枚 |
| ポートレート／衣装シート | `fal-ai/nano-banana-pro/edit` | |
| インサート静止画 | `fal-ai/nano-banana-pro` | text-to-image。**LoRA を通らない** |
| 動画（action あり） | `bytedance/seedance-2.0/image-to-video` | **実測 $5.47 / 8秒** |
| 動画（action なし） | `fal-ai/kling-video/v3/pro/image-to-video` | $0.67 / 8秒 |
| インサート動画 | Kling | 3秒（Seedance の duration enum に 3 が無い） |
| 劇伴 | `fal-ai/stable-audio-25/text-to-audio` | |
| 採点 | `openrouter/router/vision` | |

**モデルはプランで選ばない。`action` の有無で選ぶ。** DC は Claude が各カットに
`action` を書くので Seedance に、Preset は `actions: [null × 6]` なので Kling に落ちる。
条件が1つなので不整合が起こりようがない。

### 3.2 大事な罠

- `B1_IMAGE_SIZE` は**明示的なオブジェクト**で渡す。プリセット名 `landscape_16_9` を
  渡すと黙って 1024×576 に落ちる
- **Seedance に `negative_prompt` は無い**（API に存在しない）。`CLIP_NEGATIVE` が
  効くのは Kling だけ。DC 側の防御は positive prompt の `IDENTITY_CLAUSE` のみ
- `USE_END_FRAMES = false`（v2）。始点終点の補間は動きを殺していたので切った
- `public/` の資産（fonts / sfx / brand）は **`trigger.config.ts` の `additionalFiles`
  に書かないとタスクから見えない**。ロゴを足したときに書き忘れ、文字だけのカードが
  本番納品された（2026-08-16）

---

## 4. 品質ゲート — **2026-08-17 に自動再試行を全廃した**

| | 以前 | **現在** |
|---|---|---|
| 絵コンテ 同一性 | 50点未満なら最大3回まで再生成 | **再試行なし・採点もしない** |
| 絵コンテ 解剖 | 同上 | **なし** |
| クリップ 同一性 | 50点未満なら最大2回 | **再試行なし。採点は残す** |

**なぜ外したか**: 閾値が50/100 で「別の種ではない」ことしか見ておらず、品質の保証に
なっていなかった。そして絵コンテも完成品も人間が必ず見る。同じ材料を同じ費用で
人間が判断できるなら、機械が先に金を使う理由がない。DC のクリップ再試行は
1回 $5.47。

**クリップの採点だけ残している**のは、Gate 2 の drift 表に表示されるため。
絵コンテの採点は表示先が無かった（`StoryboardReviewPanel` に欄が無い）。

**品質は現在オーナーの目に依存している。** 出荷量を増やす施策は、この一点に
乗る負荷も増やす。

---

## 5. 予告編の作り（60.000秒ちょうど）

カード6枚 + 本編クリップ6本（各wide/punchで2ビート） + インサート3本。
`buildEdl` が整数フレームで 60.000 秒を保証し、端数は最後の非カードビートが吸う。

順序:
`premise → clip0 → intro → clip0 → clip1 → starring → clip1 → insert0 → clip2 ×2 →
turn → insert1 → clip3 ×2 → rise → finale(タイトル) → clip4 → insert2 → clip4 →
clip5 → stinger → clip5 → brand(MTロゴ)`

劇伴は60秒通しで鳴る（無音の窓は廃止）。riser は `finale` カードに当てる。

---

## 6. 2026-08-17〜18 に入った機能

すべて **Director's Cut のみ**、**次に脚本が生成される注文から**効く
（既存注文は `generatedScript` を保存済みなので変わらない）。

- **仲間の犬**（`cuts[].crew`）— 最大2カットの背景に他の犬。上限は
  `capCrewCuts` が**コードで**切る（プロンプトの上限指定は無視された実績がある）
- **生き物の敵**（規則7a）— 飼い犬とは決して同じ画に入れられないので、
  インサートに気配だけ置き、6カットは痕跡だけ描く
- Preset の B-roll に生き物（各世界5本中3本。連続3本選択なので**必ず1本以上入る**）

**未検証**: 背景の犬が**8秒で保つか**（4秒でしか確認していない）。
崩れたら `CREW_CLAUSE` を疑う。

---

## 7. 個別仕様書のどこが古いか

| 仕様書 | 古い箇所 |
|---|---|
| `PRICING-PRODUCT-V2-SPEC.md` | 価格・返金。2026-08-16 に改定 |
| `B2-SAFETY-NET-SPEC.md` | 絵コンテ引き直しが DC 専用と書いてある。**現在は両プラン** |
| `LORA-STORYBOARD-SPEC.md` §4.2 | 同一性・解剖ゲートと再試行。**全廃済み** |
| `MOTION-V2-SPEC.md` | クリップ再試行の記述。絵コンテ原価 $12.4（下記） |
| `TRAILER-STORY-V3-SPEC.md` | 規則7a「敵は環境か機械のみ」。**生き物も可になった** |
| `FILM-QUALITY-V3-SPEC.md` §4.2 | インサート「動物一切禁止」。**人間と犬の顔のみ禁止** |
| `TRAILER-STORY-SPEC.md` | V3 に置き換わっている |
| `GO-LIVE-RUNBOOK.md` | 残高の実測値は生きている。手順はデプロイ手順の確認を |

### 未解決の食い違い

**絵コンテ18枚の原価が2つある。** `MOTION-V2-SPEC.md` は **$12.4**（Preset $59 控除の
根拠として使われている）、`../PRODUCT-FACTS.md` は **$2.61**。

$12.4 は nano-banana-pro で18枚描いていた頃の値で、**LoRA 経路（flux-2/lora/edit）に
移った後の実測が $2.61** という可能性が高い。ただし**確認していない。**

効くのは Preset の $59 控除の妥当性。1注文の開始前と絵コンテ完了時に fal 残高を
取れば確定する（`GO-LIVE-RUNBOOK.md` §fal の残高にコマンドがある）。
**それまでは、どちらの数字も単独で引用しないこと。**
