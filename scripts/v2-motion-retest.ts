/**
 * SHOT_MOTIONS の書き直しだけを検証する（使い捨て）。
 *
 * v2-smoke.ts は毎回 generateTreatment から通すので、絵コンテの文章が実行ごとに
 * 変わる。それでは「動くようになったのは文面のおかげか、たまたま良い絵が出たのか」を
 * 切り分けられない。**既に生成済みの静止画をそのまま渡し、変えるのは SHOT_MOTIONS
 * だけにする。**
 *
 * 使い方: npx tsx --env-file=.env scripts/v2-motion-retest.ts <stillUrl> <orderId> <cutIndex> [label]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { prisma } from "@/lib/db";
import { getShotMotion } from "@/lib/film-script";
import { generateShotClipForTest } from "@/lib/film-pipeline";

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const [stillUrl, orderId, cutArg, label] = process.argv.slice(2);
  if (!stillUrl || !orderId) throw new Error("usage: <stillUrl> <orderId> <cutIndex> [label]");
  const cut = Number(cutArg ?? 3);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  // 出力は注文ごとに分ける。v2-smoke.ts は全部を同じ cut3.mp4 に書いていて、
  // 2件目が1件目を上書きした。
  const outDir = path.join(homedir(), "Downloads", "marquee-tails-v2-smoke", `${order.petName ?? orderId}-${label ?? "retest"}`);
  await mkdir(outDir, { recursive: true });

  console.log(`still : ${stillUrl}`);
  console.log(`motion: ${getShotMotion(cut, order.id)}\n`);

  const started = Date.now();
  const clip = await generateShotClipForTest(stillUrl, order.world ?? "deepspace", cut, order.id, 8, undefined, process.argv[6]);
  console.log(`完了 ${Math.round((Date.now() - started) / 1000)}秒 → ${clip}`);

  const file = path.join(outDir, `cut${cut}.mp4`);
  await writeFile(file, Buffer.from(await (await fetch(clip)).arrayBuffer()));
  await writeFile(path.join(outDir, "motion.txt"), `${getShotMotion(cut, order.id)}\n\nstill: ${stillUrl}\nclip:  ${clip}\n`);
  console.log(file);
}

main().then(() => process.exit(0));
