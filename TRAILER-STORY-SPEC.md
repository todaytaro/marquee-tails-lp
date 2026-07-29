# 予告編の物語性 仕様書 — 字幕を「格言4枚」から「あらすじ6枚」へ

> **ステータス: 設計のみ / 未実装。** 実装は別途（Sonnet 等）。作成: 2026-07-30
> 前提: `TRAILER-EDIT-SPEC.md`（ビート編集 v2）／`FILM-QUALITY-V3-SPEC.md` §1〜§4 実装済み。
> **スキーマ変更なし**（`generatedScript` Json 内で完結。プリセットは静的データ）。
> **追加生成コストゼロ**（テキストのみの変更。Kling・nano-banana の呼び出し数は不変）。

---

## 0. 背景 — オーナー実写レビュー（v3 §1〜§4 適用後）

> 「めっちゃいい感じだけど、映画の予告を売るという点では、**何の予告なのか
> わからなくてただのPVみたいに見える**。もう少しストーリー性と、それに基づいた
> 字幕（**冒頭とオチ**）を作った方がいい」

画質・カット割り・音は解決した。残ったのは**物語**の問題であり、映像ではなく
**字幕（カード）の書き方と配分**の問題である。

### 0.1 原因1 — あらすじが1行も無い

現在の4枚（`LOGLINES`、例: noir/brave）:

```
THE CITY NEVER SLEEPS.        ← 世界の気分
NEITHER DOES {name}.           ← 語呂合わせ
EVERY CASE MEETS ITS MATCH.    ← 気分
CASE CLOSED                    ← タグライン
```

**「何が起きているのか」「主人公は何をしようとしているのか」「何が邪魔なのか」が
一つも書かれていない。** 4つの格言が並んでいるだけなので、観客は何を期待すれば
よいか分からない → 予告編ではなくPVに見える。

本物の予告編の文法（テキストの背骨）:

```
1. 前提   街の魚が消えはじめた。      ← 何の映画か（★現状これが無い）
2. 登場   一匹の探偵が動き出す。
3. 転機   だが相手は街そのものだった。
4. 危機   彼はまだ、何も知らない。
5. タイトル CASE CLOSED
6. オチ   彼はまだリードを外せない。   ← 最後の一撃（★現状これが無い）
```

### 0.2 原因2 — Claudeへの指示が空欄

`lib/claude-script.ts` の `TREATMENT_TOOL` の `loglines` は
`intro`/`turn`/`rise`/`tagline` すべて **`{ type: "string" }` のみで
`description` が無い**。各カードの**修辞的な役割が一切伝わっていない**ため、
Claudeは「それっぽい詩」を書くしかない。ここは直せば効果が最も大きい。

### 0.3 原因3 — 尺の配分が壊れている

現在のEDL（`EDL_TEMPLATE`）のカード内訳:

| 用途 | カード | 秒数 |
|---|---|---|
| **ブランド表示** | `open`(MARQUEE TAILS PRESENTS) 2.0 ＋ `starring` 2.2 ＋ `comingSoon` 2.0 ＋ `brand`(A MARQUEE TAILS FILM) 1.5 | **7.7s** |
| **物語** | `intro` 2.0 ＋ `turn` 2.0 ＋ `rise` 2.0 ＋ `finale` 3.0 | 9.0s |

**60秒の13%を自社ブランドの連呼に使い、物語とほぼ同じ尺を占めている。**
ここを圧縮すれば、物語カードを増やす原資が**無料で**手に入る。

---

## 1. 対応 — 物語カードを6枚にする

### 1.1 loglines を 4 → 6 フィールドに拡張

| フィールド | 役割 | 状態 |
|---|---|---|
| **`premise`** | **冒頭。この映画で何が起きているのか＝あらすじの1行目** | **新規** |
| `intro` | 主人公の登場（世界＋誰） | 既存 |
| `turn` | 転機・目的（何をしようとするのか） | 既存 |
| `rise` | 危機・障害（何が邪魔をするのか） | 既存 |
| `tagline` | タイトルの決め台詞 | 既存 |
| **`stinger`** | **オチ。タイトル後の最後の一撃（笑い or 余韻）** | **新規** |

**`stinger` が効く理由**: ペットの映画は本質的にコメディ／ハートウォーミングであり、
コメディ予告編は**タイトルカードの後にもう一笑い**入れる文法を持つ。ここが決まると
一気に「本物の予告編」に見える。**オーナーの言う「オチ」はこれ。**

### 1.2 後方互換（必須）

`premise` / `stinger` は**任意フィールド**とする。
- 既存注文（`generatedScript` に両方が無い）→ **従来の4枚構成のEDLで組む**
- プリセットは静的データなので全12種に追記する（§2）
- インサート（`TRAILER-EDIT-SPEC.md` §4.3）と**同じ graceful degradation の作法**に
  従う。絶対に落とさない

### 1.3 EDLの再構成

**カード枚数は増えるが、合計60秒は変わらない**（`TRAILER-EDIT-SPEC.md` §1.3 の
正規化が映像ビートを伸縮して吸収する。ただしカード合計が増えるほど映像が減るので、
§1.4 の圧縮とセットで行うこと)。

新しいカード配置（`premise`/`stinger` がある場合）:

```
premise    2.2s   ← 冒頭。何の映画かを最初に言う
clip0 wide
intro      2.0s
clip0 punch
clip1 wide
starring   2.0s
clip1 punch
insert0
clip2 wide
clip2 punch
turn       2.0s
clip3 wide
insert1
clip3 punch
clip4 wide
rise       2.0s
clip4 punch
insert2
clip5 wide
clip5 punch (climax)
finale     3.0s   ← petName 大 + tagline
stinger    2.2s   ← オチ
brand      1.5s   ← ブランド（1枚に統合）
```

- **`premise` を先頭に置く**（`open` の位置）。観客が最初に受け取る情報を
  「自社名」から「あらすじ」に変える
- **`stinger` は `finale`（タイトル）の後**。タイトル前に置くと単なる字幕になり、
  オチとして機能しない

### 1.4 ブランド表示の圧縮（物語カードの原資）

- `open`（MARQUEE TAILS PRESENTS）を**削除** → その位置は `premise` が使う
- `comingSoon`（COMING SOON）を**削除**（`stinger` と `brand` があれば締まる）
- `brand`（A MARQUEE TAILS FILM）は**残す**（1枚だけ、最後に）
- `starring` は**残す**（2.2 → 2.0s に短縮）。ペットの名前が出るカードは
  **商品価値そのもの**なので削らない

差分: ブランド 7.7s → 3.5s（**4.2s を物語に回す**）。
物語カード 9.0s → 13.4s（premise 2.2 + intro 2.0 + turn 2.0 + rise 2.0 +
finale 3.0 + stinger 2.2）。

---

## 2. プリセットの字幕を書き直す（`lib/film-script.ts`）

`LOGLINES` の **12組すべて**（3ワールド × 4性格）に `premise` と `stinger` を追加し、
既存4枚も**§0.1の役割**に沿って必要に応じて書き直す。

### 2.1 書き方のルール

- **`premise` は「状況・事件」を書く。** 気分ではなく**出来事**。
  - ✗ 「街は眠らない」（気分）
  - ✓ 「街の魚が消えはじめた」（出来事＝何の映画か分かる）
- **`stinger` は落とす。** 主人公が犬猫であることを活かした、
  短く可笑しい／可愛い一撃。タグラインの余韻を壊さない範囲で。
- ALL-CAPS・`{name}` 置換可・**英語**（`FONT_DISPLAY` = Bebas Neue は
  Latin-only。日本語は豆腐になる）— 既存の制約を維持
- **1枚1行が原則**（読み切れる長さ。長すぎるとカード内で改行・縮小が必要になる）

### 2.2 参考例（noir / brave の場合）

```
premise:  "SOMETHING IS MISSING FROM THIS CITY."
intro:    "THE CITY NEVER SLEEPS."
turn:     "NEITHER DOES {name}."
rise:     "EVERY CASE MEETS ITS MATCH."
tagline:  "CASE CLOSED"
stinger:  "{name} STILL CAN'T REACH THE DOORKNOB."
```

12組すべてを**その世界観と性格に合わせて**書くこと（上は形式の例。
コピペで使い回さない）。

---

## 3. Claude への指示を直す（`lib/claude-script.ts`）

### 3.1 ツール定義に役割を書く（最重要）

`TREATMENT_TOOL.input_schema.properties.loglines` の各プロパティに
**`description` を付ける**。§0.1 の役割と、**具体例**を含めること。例:

```
premise: "OPENING CARD — states WHAT IS HAPPENING in this film in one line:
          the situation, event or problem that sets the story going. NOT a mood
          or an aphorism. This is the line that tells the audience what the
          movie is ABOUT. e.g. 'SOMETHING IS MISSING FROM THIS CITY.'"
intro:   "The hero arrives — the world plus who they are. e.g. 'THE CITY NEVER SLEEPS.'"
turn:    "The turn — what the hero sets out to do. e.g. 'NEITHER DOES {name}.'"
rise:    "The stakes — what stands in the way. e.g. 'EVERY CASE MEETS ITS MATCH.'"
tagline: "The title punch, shown with the pet's name. e.g. 'CASE CLOSED'"
stinger: "CLOSING JOKE, shown AFTER the title card — one last laugh or warm beat
          that lands because the star is an animal. e.g. '{name} STILL CAN'T
          REACH THE DOORKNOB.'"
```

`premise` / `stinger` は **`required` に入れない**（後方互換 §1.2）が、
**システムプロンプトで「必ず書くこと」を強く指示する**（新規注文では常に付く状態を
狙い、欠けても壊れない構造にする）。

### 3.2 システムプロンプトに物語の背骨を明示

`SYSTEM_PROMPT` の rule 3（STRUCTURED OUTPUT）付近に、
**「6枚のカードは連続する1つのあらすじであり、独立した格言の羅列ではない」**
ことを明記する。加えて:

- **`premise` は出来事を書く**（気分・雰囲気ではない）
- **6枚を順に読んだとき、観客が「何の映画か」を理解できること**
- 既存の言語ルール（rule 5: loglines は常に英語）は**変更しない**

### 3.3 `parseToolInput` / `mockTreatment`

- `parseToolInput`: `premise`/`stinger` は**あれば採用・無ければ省略**
  （`inserts` と同じ「accepts-if-valid, never throws」の作法）
- `mockTreatment`: 6枚すべてを含める

---

## 4. 触るファイル

| ファイル | 変更 |
|---|---|
| `lib/film-script.ts` | `LOGLINES` 12組に `premise`/`stinger` 追記＋既存4枚の見直し（§2）。`WorldBundle`/`ResolvedWorld` の loglines 型に任意2フィールド追加。`resolveWorld` の `fill()`（`{name}` 置換）を新フィールドにも適用 |
| `lib/claude-script.ts` | ツール定義に全6枚の `description`（§3.1）。`SYSTEM_PROMPT` に物語の背骨（§3.2）。`parseToolInput`・`mockTreatment`（§3.3） |
| `lib/film-pipeline.ts` | `EDL_TEMPLATE` の再構成（§1.3）。`open`/`comingSoon` 削除、`premise`/`stinger` 追加、`starring` 2.0s。カード種別の型と `cardLines()` 相当のテキスト生成を新カードに対応。**`premise`/`stinger` が無い注文は従来構成にフォールバック**（§1.2） |
| `scripts/test-assemble.ts` | 新旧両構成で**60.0秒**を検証（§6） |

**変更しないもの**: スキーマ／状態機械／Gate 1・Gate 2／ポスターパイプライン／
インサート設計／SFX／エンコード設定（v3 §2）／パンチイン（v3 §1）／
`getShotMotion`／言語ルール（loglines は英語）。

---

## 5. 顧客に見える場所への波及（確認のみ）

`treatmentText`（トリートメント承認画面）は**顧客の言語**で書かれる既存仕様。
物語カードが6枚になったことで、トリートメントの記述と実際の予告編の整合性が
上がる。**`treatmentText` の仕様は変更しない**が、システムプロンプトが
「6枚で1つのあらすじ」を要求することで自然に良くなる。

ポスター（`app/approve/[token]/page.tsx` 等）は `loglines.intro` /
`loglines.tagline` を使っている。**`premise` を追加してもポスターの見た目は
変わらない**（intro/tagline は残る）。念のため、ポスター側のコピーが壊れて
いないことを実装後に確認すること。

---

## 6. 検証

**静的**: `tsc` / `eslint` / `next build`。

**ローカル実測**（DB・fal・Trigger.dev 不使用）: `scripts/test-assemble.ts` を更新し、
1. **6枚構成で 60.0000秒**（master / social、±1フレーム）
2. **4枚構成（premise/stinger 欠如）でも 60.0000秒** ← 後方互換の核
3. インサート有り／無しの両方（既存アサーション維持）
4. SFX欠如フォールバック（既存アサーション維持）
5. **カードの出現順**が §1.3 の通りであること（`premise` が先頭、`stinger` が
   `finale` の後、`open`/`comingSoon` が存在しないこと）
6. **`{name}` 置換が `premise`/`stinger` でも効くこと**

**プリセット12組の目視確認**: 実装後、12組を一覧で出力する簡易スクリプトか
コメントで、6枚を順に読んで「何の映画か分かるか」を確認して報告すること
（コピペの使い回しになっていないかの自己チェックを兼ねる）。

---

## 7. やらないこと（将来）

- カード位置を映像内容に合わせて動的に決める（今は固定配置）
- ナレーション音声（TTS）
- カードのモーション（現状は静止。フェードは既存のまま）
- 日本語カード（`FONT_DISPLAY` が Latin-only。ペット名のみ `FONT_NAME` で対応済み）
