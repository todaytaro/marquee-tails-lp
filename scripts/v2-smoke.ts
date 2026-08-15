/**
 * v2 の一本通し確認（使い捨て）。**製品の関数をそのまま呼ぶ。**
 *
 * デプロイ前に確かめたい未検証点はひとつ:
 * 新しい SHOT_MOTIONS は「絵が既に始めている動きをやり切れ」という**抽象参照**で
 * 書かれている（絵の内容を知らずに機械的に付与されるので、具体的な動作を名指しすると
 * 12本の絵コンテのほとんどと矛盾するため）。動画モデルがこの書き方に応えるかは
 * **測っていない。** 動きを出すのが v2 の目的なので、ここが空振りだと他が全部効いても
 * 目的を達しない。
 *
 * 既存の絵コンテでは検証にならない。旧ルールの絵は「立っている」だけで、
 * やり切るべき動きがそもそも無いため。だから本番プロンプトで**新しい絵コンテを
 * 書かせ**、そのカットを描き、それを動かす。通る鎖は製品と同一:
 *
 *   generateTreatment  (lib/claude-script)   … 新ルール入りの本番プロンプト
 *   generateTakeOnce   (lib/stills-pipeline) … 注文の LoRA + 衣装シート
 *   generateShotClip   (lib/film-pipeline)   … Seedance、end frame なし、SHOT_MOTIONS
 *
 * 費用: 文章 数セント + 静止画 約$0.15/枚 + クリップ 約$2.4/本。
 *
 * 使い方: npx tsx --env-file=.env scripts/v2-smoke.ts [orderId] [cutIndex]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/identity";
import { SHOT_FRAMINGS, getShotMotion } from "@/lib/film-script";
import { generateTakeOnce, expressionDirective } from "@/lib/stills-pipeline";
import { generateShotClipForTest } from "@/lib/film-pipeline";
import { generateTreatment } from "@/lib/claude-script";

const DEFAULT_ORDER = "cmsepxxip000004l52t94y6tq"; // CAMYU（Director's Cut、LALA以外で唯一 LoRA を持つDC注文）

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const orderId = process.argv[2] ?? DEFAULT_ORDER;
  const cut = Number(process.argv[3] ?? 3); // 3 は「行動の頂点」が来やすい位置

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.customBrief) throw new Error(`${orderId} は DC ではない（customBrief が無い）`);
  if (!order.loraUrl || !order.loraTriggerWord) throw new Error(`${orderId} に LoRA が無い`);
  if (!order.heroSheetUrl) throw new Error(`${orderId} に衣装シートが無い`);

  // 注文ごとに分ける。以前は全部を同じ cut3.mp4 に書いていて、2件目の実行が
  // 1件目の結果を上書きした（比較対象が消えた）。
  const outDir = path.join(homedir(), "Downloads", "marquee-tails-v2-smoke", `${order.petName ?? orderId}-full`);
  await mkdir(outDir, { recursive: true });
  console.log(`注文: ${order.petName} (${orderId})\n出力先: ${outDir}\n`);

  // --- 1. 本番プロンプトで絵コンテを書かせる -------------------------------
  console.log("1/3 脚本を生成中（本番の generateTreatment）…");
  const t = await generateTreatment({ brief: order.customBrief, petName: order.petName ?? "the pet" });
  // TreatmentResult は成功/拒否のユニオン。拒否は安全フィルタが働いた場合で、
  // ここで落としておかないと下流が undefined を掴む。
  if (!("bundle" in t)) throw new Error(`treatment rejected: ${t.reason}`);
  const bundle = t.bundle;
  bundle.cuts.forEach((c: { scene: string }, i: number) => console.log(`  [cut ${i}]${i === cut ? " ←" : "  "} ${c.scene}`));
  console.log("\n  --- loglines ---");
  for (const [k, v] of Object.entries(bundle.loglines)) console.log(`  ${k.padEnd(8)} ${v}`);

  const scene = bundle.cuts[cut]?.scene;
  const action = bundle.cuts[cut]?.action;
  if (!scene) throw new Error(`cut ${cut} が無い`);
  console.log(`\n  scene : ${scene}\n  action: ${action ?? "(なし)"}`);

  // --- 2. その絵を描く（注文の LoRA と衣装シートを再利用） -----------------
  console.log(`\n2/3 cut ${cut} を描画中（LoRA: ${order.loraTriggerWord}）…`);
  const still = await generateTakeOnce(
    [publicUrl(order.heroSheetUrl)],
    false,
    order.petDescription ?? "the pet in the reference images",
    bundle.costume,
    scene,
    SHOT_FRAMINGS[cut] ?? SHOT_FRAMINGS[0],
    expressionDirective(order.personality),
    880000 + cut * 100,
    { url: order.loraUrl, triggerWord: order.loraTriggerWord },
    publicUrl(order.heroSheetUrl)
  );
  console.log(`  ${still}`);
  await writeFile(path.join(outDir, `cut${cut}.png`), Buffer.from(await (await fetch(still)).arrayBuffer()));

  // --- 3. 動かす（製品の generateShotClip をそのまま） ---------------------
  // world は resolveWorld のキーではなくアーク解決用。DC は bundle 側が正なので
  // 素材の world を渡す（雰囲気語の選択にしか使われない）。
  const world = order.world ?? "deepspace";
  console.log(`\n3/3 Seedance で動画化中… 7分ほどかかる`);
  console.log(`  motion: ${getShotMotion(cut, order.id)}`);
  const started = Date.now();
  const clip = await generateShotClipForTest(still, world, cut, order.id, 8, undefined, action);
  console.log(`  完了 ${Math.round((Date.now() - started) / 1000)}秒 → ${clip}`);
  await writeFile(path.join(outDir, `cut${cut}.mp4`), Buffer.from(await (await fetch(clip)).arrayBuffer()));

  await writeFile(
    path.join(outDir, "scene.txt"),
    `order: ${order.petName} ${orderId}\ncut: ${cut}\n\nscene:\n${scene}\n\naction:\n${action ?? "(なし)"}\n\nstill: ${still}\nclip:  ${clip}\n`
  );
  console.log(`\n${outDir}`);
}

main().then(() => process.exit(0));
