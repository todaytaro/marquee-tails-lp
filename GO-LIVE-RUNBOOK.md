# Marquee Tails 本番公開 手順書（Owner Runbook）

> **オーナーが上から順に手を動かす**ためのチェックリスト。
> 作成: 2026-07-21 / **全面改訂: 2026-08-05**
>
> ⚠️ **改訂の理由。** 旧版は「Price を3つ作成: Digital $75 / Feature $129 /
> Collector's $199」「現在LPはウェイトリストのみ」と書いてあった。**どちらも
> 現在の製品ではない。** 製品は2プラン **$99 / $249** で、チェックアウトは
> テストモードで動いており、注文がエンドツーエンドで通っている。旧版のまま
> Phase 4 を実行すると、**間違った価格のPriceを3つStripeに作ることになる。**
>
> この版は、書いた時点で**コードとDNSを実際に照合して**書いている。
> 環境変数の表は `process.env` の全出現箇所から機械的に洗い出したもので、
> 記憶や旧版からの引き写しではない。

---

## 0. 今どこにいるか（2026-08-05 時点で検証済み）

| | 状態 |
|---|---|
| ドメイン `www.marqueetails.com` | ✅ Vercelに載っている |
| 本番DB（Supabase） | ✅ 稼働中。マイグレーション21本すべて適用済み（`prisma migrate status` = up to date） |
| Trigger.dev 本番 | ✅ 5タスク稼働中（`generate-film` / `generate-stills` / `generate-poster` / `train-pet-lora` / `rerender-shot`） |
| Stripe | ⚠️ **テストモード**。決済〜納品までE2Eで通っている |
| メール送信（Resend） | ✅ DKIM (`resend._domainkey`) と SPF (`send.marqueetails.com` → amazonses) 設定済み |
| メール**受信** | ❌ **`marqueetails.com` にMXレコードが無い。`support@` は受信できない**（→ Phase A-1） |
| DMARC | ❌ `_dmarc` にレコードが無い（→ Phase A-2） |
| DNS | Cloudflare（`yew` / `piper.ns.cloudflare.com`）。A-1/A-2 はどちらもここで作業する |
| 法務4ページ | ✅ 角括弧プレースホルダは全て実データに置換済み |
| 管理画面 | ✅ セッション認証で稼働、絵コンテ承認ゲートも稼働 |
| 生成パイプライン | ✅ 全fal呼び出しに時限あり（`lib/fal-deadline.ts`、2026-08-04のハング事故対応） |

**残っているのは Phase A / B / C だけ。**

---

## Phase A — メールの受信とDMARC（**最優先。Stripeより先**）

### A-1. `support@marqueetails.com` を受信できるようにする

**なぜStripeより先か。** このアドレスは法務4ページ全部に載っている
（`/terms` `/privacy` `/refund`、そして**`/tokushoho` = 特商法の法定開示**）。
`/refund` では「再制作・修正・返金の請求はここにメールせよ」と指定した
**唯一の連絡先**になっている。

いまMXが無いので、**顧客がここに送るとバウンスする。**
チャージバック紛争において「顧客が連絡を試みたが到達できなかった」は
そのまま負ける事実で、[CHARGEBACK-DEFENSE-SPEC.md](./CHARGEBACK-DEFENSE-SPEC.md)
が積み上げている証拠の前提（顧客に解決の経路があった）を崩す。

**このドメインのDNSは Cloudflare にある**（`dig NS marqueetails.com` →
`yew.ns.cloudflare.com` / `piper.ns.cloudflare.com`）。なので
**Cloudflare Email Routing** が最短かつ無料。契約も追加費用も要らない。

1. Cloudflare ダッシュボード → `marqueetails.com` を選択 → 左メニュー **Email**
   → **Email Routing**
2. **Enable Email Routing** を押す。→ **必要なMXとSPFのDNSレコードは
   Cloudflareが自動で追加する**（ここが手作業でMXを打つより安全な理由）
3. **Destination address** に、自分が普段使っているアドレス（Gmail等）を登録。
   Cloudflareから確認メールが来るのでリンクを踏む
4. **Routing rules** → Custom address に `support` → 転送先に 3 のアドレス
5. 送信テスト: 別のメールアドレスから `support@marqueetails.com` に送って、
   転送先に届くことを確認

> ⚠️ **既存のSPFを壊さないこと。** 送信側は `send.marqueetails.com` の
> サブドメインにSPFを持っている（`v=spf1 include:amazonses.com ~all`）ので、
> Email Routing がルートに追加するSPFとは**別のレコード**で衝突しない。
> ただし有効化後に必ず両方を確認する:
> ```
> dig +short TXT send.marqueetails.com   # amazonses が残っているか
> dig +short MX marqueetails.com          # Cloudflare の MX が入ったか
> ```
> 送信側が壊れると、絵コンテメールも納品メールも止まる。**受信を直すために
> 送信を壊すのが最悪の結果。**

**`dig MX marqueetails.com` が応答を返すまでは公開しない。**

> 補足: `ADMIN_ALERT_EMAIL` は別物で、こちらは設定済み。
> 未設定時のフォールバック先が `support@marqueetails.com`
> （[lib/mocks.ts:343](./lib/mocks.ts)）なので、**この環境変数を消すと
> 管理者アラートも受信できないアドレスに飛ぶ。** 消さないこと。

### A-2. DMARC レコードを追加

DKIMとSPFは通っているので認証自体は成立しているが、DMARCが無いと
Gmail/Yahoo の一括送信者ルールで扱いが悪くなる。

DNSに TXT レコードを1本:

| | |
|---|---|
| ホスト名 | `_dmarc` |
| 値 | `v=DMARC1; p=none; rua=mailto:<受信できるアドレス>` |

`p=none` は「監視のみ、拒否しない」。まずこれで始めて、レポートを見てから
`quarantine` → `reject` に上げる。**`rua` は A-1 で受信できるようにした
アドレスにする**（受信できないアドレスを書いても意味がない）。

確認:
```
dig +short TXT _dmarc.marqueetails.com
```

---

## Phase B — Stripe 本番化（参照: [STRIPE-INTEGRATION-SPEC.md](./STRIPE-INTEGRATION-SPEC.md)）

### B-1. Price を **4つ** 作成（3つではない）

現行の製品構成はこれ。**旧版に書いてあった Digital/Feature/Collector's の
3ティアは存在しない。**

| 何 | 金額 | 環境変数 | いつ課金されるか |
|---|---|---|---|
| Preset Worlds | **$99** | `STRIPE_PRICE_PRESET` | 基本プラン |
| Director's Cut | **$249** | `STRIPE_PRICE_CUSTOM` | 基本プラン |
| プリントポスター | **$59** | `STRIPE_PRICE_ADDON_POSTER` | **納品後**の別決済 |
| ギャラリーキャンバス | **$99** | `STRIPE_PRICE_ADDON_CANVAS` | **納品後**の別決済 |

すべて **one-time**（サブスクではない）。ティア名はコード側の enum
（`"preset"` / `"custom"` — [lib/stripe.ts:46](./lib/stripe.ts)）と対応する。

### B-2. キーとwebhook

1. `STRIPE_SECRET_KEY` を**本番キー**（`sk_live_...`）に差し替え → Vercel env
2. **本番モードのWebhookを新規登録**（テストモードのものは本番では動かない）:
   - エンドポイント `https://www.marqueetails.com/api/webhooks/stripe`
   - イベント **`checkout.session.completed`**
   - 署名シークレットを `STRIPE_WEBHOOK_SECRET` に（**テスト用とは別の値**）
3. Price ID 4つも本番モードで作り直したものに差し替え（**テストモードのPrice
   IDは本番では使えない**）

### B-3. ダッシュボード側の設定（コードでは変えられない）

| 場所 | 設定 | なぜ必要か |
|---|---|---|
| Settings → Public business information → **Terms of service** | `https://www.marqueetails.com/terms` | Checkout の規約同意チェックボックスのリンク先。**ここが空だと同意ゲートが機能しない**（[app/api/checkout/route.ts](./app/api/checkout/route.ts) のコメント参照） |
| Settings → **Statement descriptor** | `MARQUEETAILS` | 明細に出る名前。これが会社名や意味不明な文字列だと「見覚えのない請求」としてチャージバックされる。[CHARGEBACK-DEFENSE-SPEC.md](./CHARGEBACK-DEFENSE-SPEC.md) の一番安い防御 |

### B-4. 本番で1件、自分のカードで通す

テストカードではなく**実カードで$99を1件**通して、返金する。確認するのは:

- [ ] 注文が `UPLOADING` で作成される
- [ ] `checkout.consent` の証拠行が記録され、**`$99` の非返金額を含む同意文が
      そのまま入っている**（管理画面の「紛争対応」セクション）
- [ ] アップロード案内メールが届く
- [ ] 明細の表示名が `MARQUEETAILS` になっている
- [ ] Stripeダッシュボードから手動返金できる

---

## Phase C — 公開直前の残作業

### C-1. ショーケースの差し替え（未決）

LPのビフォー画像に **"Illustration — representative example"** の表記が
残っている（[components/ShowcaseFilm.tsx:102](./components/ShowcaseFilm.tsx)、
CSSで大文字に変換されて表示される）。これは「実際の顧客写真ではない」ことを明示するための暫定ラベル。
実写真＋新パイプラインの動画に差し替えるなら、ラベルも一緒に外す。
**差し替えないなら、ラベルは付けたままにする**（外すと事実と違う表示になる）。

### C-2. `PUBLIC_ASSET_BASE`

[lib/identity.ts:56](./lib/identity.ts) のフォールバックが
`https://marquee-tails-lp.vercel.app` のまま。VLMに画像URLを渡すときの
ベースなので、Vercel env に `PUBLIC_ASSET_BASE=https://www.marqueetails.com`
を入れて、旧Vercelドメインに依存しない状態にしておく。

### C-3. 弁護士レビュー

[LAWYER-REVIEW-QUESTIONS.md](./LAWYER-REVIEW-QUESTIONS.md) の
**priority-A**（Q2-1〜Q2-4 の非返金額、Q1-1 の返品特約表示、
Q3-2/Q3-3 のEU/UK撤回権）。金額と表示に直結するので、これだけは公開前。

### C-4. 未回答の判断

- **finale カードのタグライン重複**: Director's Cut で Claude が
  `CAMYU: INTO THE TRENCH` のような名前入りタグラインを書くと、カードが
  既に上に名前を出しているので**名前が2回出る**。プリセットのタグラインは
  全て名前なし（`CASE CLOSED` など）でこの前提を守っている。
  [lib/claude-script.ts:157](./lib/claude-script.ts) のスキーマ説明に
  「名前を含めるな」を1文足せば直る。

---

## 環境変数の置き場所（コードから機械的に洗い出したもの）

**2箇所に分かれる。混同注意。**

### Vercel（プロジェクト設定 → Environment Variables）

| 変数 | 用途 | 無いとどうなるか |
|---|---|---|
| `DATABASE_URL` | 本番Postgres | 全滅 |
| `APP_BASE_URL` | `https://www.marqueetails.com` | 顧客向けリンクが localhost になる |
| `VIDEO_PIPELINE_MOCK` | **`0`**（または未設定） | `1` だと生成せず素通り |
| `FAL_KEY` | 画像・動画・音楽生成 | 生成不可 |
| `ANTHROPIC_API_KEY` | Director's Cut の脚本生成 | DCの注文が進まない |
| `TRIGGER_SECRET_KEY` | 本番の `tr_prod_...` | 重い生成がオフロードされない |
| `STRIPE_SECRET_KEY` | `sk_live_...` | チェックアウトが503 |
| `STRIPE_WEBHOOK_SECRET` | 本番モードの署名 | 決済しても注文が作られない |
| `STRIPE_PRICE_PRESET` / `_CUSTOM` | 基本2プラン | そのプランが500 |
| `STRIPE_PRICE_ADDON_POSTER` / `_CANVAS` | 納品後アドオン | アドオン購入不可 |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | メール送信 | **静かに送られない**（下記参照） |
| `ADMIN_ALERT_EMAIL` | 絵コンテ確認アラートの宛先 | `support@` にフォールバック（**A-1未完なら届かない**） |
| `ADMIN_PASSWORD` / `SESSION_SECRET` / `ADMIN_API_SECRET` | 管理画面認証 | 管理画面に入れない／誰でも入れる |
| `BLOB_READ_WRITE_TOKEN` | ウェイトリスト保存 | ウェイトリストが保存されない |
| `PHOTOS_READ_WRITE_TOKEN` | 顧客写真アップロード | **写真がアップロードできない** |
| `PRINTIFY_API_KEY` / `PRINTIFY_SHOP_ID` | 物理商品の発注 | アドオンが発注されない |
| `PUBLIC_ASSET_BASE` | VLMに渡す画像のベースURL | 旧Vercelドメインにフォールバック（C-2） |

任意: `KLAVIYO_API_KEY` / `KLAVIYO_LIST_ID`（Resendの代わりに使う場合）、
`ANTHROPIC_MODEL`、`KLING_MODEL`、`FFMPEG_PATH`。

### Trigger.dev（ダッシュボード → Environment Variables → **Production**）

| 変数 | なぜタスク側にも必要か |
|---|---|
| `DATABASE_URL` | タスクが直接DBを読み書きする |
| `FAL_KEY` | 生成そのもの |
| `ANTHROPIC_API_KEY` | 脚本生成がタスク内から走る場合 |
| **`APP_BASE_URL`** | **Gate 1メールの承認リンク。無いと `approveUrl` が例外を投げる** |
| **`RESEND_API_KEY` / `RESEND_FROM_EMAIL`** | **Gate 1メールはタスクの内側から送られる** |
| `ADMIN_ALERT_EMAIL` | 絵コンテ確認アラートもタスク内から送られる |

`VIDEO_PIPELINE_MOCK` は**入れない**（本番は実生成）。

> **メール系をTrigger.dev側にも入れる理由（実際に踏んだ）。** 旧版のこの表は
> 「Trigger.devには `DATABASE_URL` と `FAL_KEY` だけ」と書いていた。**間違い。**
> Gate 1の「絵コンテできました」メールは `lib/stills-pipeline.ts` の
> `completeStillsGeneration` から送られる — つまり**タスクの内側**。
> Vercel側にだけ入れても届かない。ウェルカムメールと返金メールはVercel側の
> ルートから送られるので、そちらが届いていても判定材料にならない。
>
> 失敗の仕方が2通りあり、どちらも気づきにくい:
> - `RESEND_API_KEY` が無い → モックのブランチに落ちて `console.log` するだけ。
>   **エラーにならず、メールも飛ばない**
> - `APP_BASE_URL` が無い → `approveUrl` が例外を投げる（localhostのリンクを
>   顧客に送らないためのガード）
>
> 初回の本番LoRA注文が後者で落ちた。**切り分け方:** Trigger.dev の Runs で
> `generate-stills` が **Failed** なら `APP_BASE_URL`、**Completed なのに未着**
> なら `RESEND_API_KEY`。

---

## デプロイの手順（**2つある。片方だけでは反映されない**）

```bash
git push                            # Vercel が自動でビルド・デプロイ
npx trigger.dev@4.5.9 deploy        # Trigger.dev は手動
```

**`lib/` を触ったら必ず両方。** Trigger.dev のタスクは `lib/` をバンドルするので、
`git push` だけでは生成パイプラインの変更が本番のタスクに載らない。

**バージョンは `@4.5.9` で固定**（`@latest` ではない）。`@trigger.dev/sdk` が
4.5.9 なので、CLIをずらすとデプロイが壊れる。

**Trigger.dev はローカルのファイルからビルドする**（gitからではない）。
つまり未コミットの変更もデプロイされる。逆に、pushしただけでは載らない。

---

## 運用上の注意（ローンチ後に効くもの）

### fal の残高

生成はすべて fal の残高を消費する。**尽きると注文が止まる。**

```bash
curl -s -H "Authorization: Key $FAL_KEY" https://rest.alpha.fal.ai/billing/user_balance
```

**実測できているのは1箇所だけ:** 本編クリップ6本（Kling）で **$5.66**
（2026-08-04、残高 24.42734844 → 18.76340134）。

**1注文あたりの総額は測っていない。** 絵コンテ18枚・ポスター3枚・インサート
6点・LoRA学習を含む全体を推定で書くこともできるが、この手順書には
**測った数字しか置かない** —
[LORA-STORYBOARD-SPEC.md](./LORA-STORYBOARD-SPEC.md) §2.1 で、LoRA学習時間を
測らずに「数分〜15分」と書いたせいでタスクのタイムアウトを短く設定し、
45分の学習を強制終了して再学習させた事故がある。同じことを金額で繰り返さない。

総額が必要になったら、1注文の開始前と納品後に上のコマンドで残高を取って差を見る。

### 生成が止まった注文の救出

タスクがクラッシュ / タイムアウトすると、**`onFailure` が走らないので
ステータスが `*_GENERATING` のまま取り残される**（`FAILED` にならない）。

管理画面の注文詳細に金枠の「**生成中**」セクションが出るので、そこの
**↻ 再キック**を押す。キャッシュ済みの素材（LoRA・絵コンテ・クリップ・音楽）は
再利用され、未完了の工程だけやり直す。

### 返金

このアプリは **Stripeの返金APIを一度も呼ばない**。返金は必ず
**Stripeダッシュボードから手動**で行い、そのあと管理画面の
「返金を実行済みにする」を押して記録する（金額の計算もアプリはしない —
[lib/safety-net.ts](./lib/safety-net.ts) の定数が表示するだけ）。

---

## 公開前 最終チェック

- [ ] `dig MX marqueetails.com` が応答する（A-1）
- [ ] `dig +short TXT _dmarc.marqueetails.com` が応答する（A-2）
- [ ] `support@marqueetails.com` に自分でメールを送って**受信できる**
- [ ] 本番カードで1件決済 → 注文が `UPLOADING` で作成 → 案内メール受信
- [ ] 明細の表示名が `MARQUEETAILS`
- [ ] 写真アップロード → 絵コンテ生成 → **管理画面に「絵コンテ確認待ち（あなた）」で出る**
- [ ] 絵コンテ承認 → 顧客にGate 1メール → 顧客が承認
- [ ] 動画生成 → Gate 2 → 管理画面で承認 → 納品メール
- [ ] 納品ページで**動画・ポスターがダウンロードできる**（ブラウザで開くのではなく保存される）
- [ ] 納品ページの**星評価**が押せて、管理画面に出る
- [ ] アドオン購入 → Printify発注
- [ ] 生成失敗時: 管理画面の「生成中」or「失敗（要対応）」から再実行できる
- [ ] Stripeダッシュボードから手動返金 → 管理画面で記録できる
