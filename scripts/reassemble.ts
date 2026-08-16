/**
 * 既存注文の素材で60秒を組み直す（使い捨て・**fal費用ゼロ**）。
 *
 * 新しい EDL の並び替えと音響（riser の位置・タイトル直前の無音）は、
 * 合成素材の test-assemble.ts しか通っていない。実素材で一度も鳴らしていない。
 * だが確かめるために新しい映画を作る必要はない — **完成済みの注文が
 * filmArtifacts にクリップ・インサート・劇伴を全部持っている。**
 * それを落としてきて新コードで組み直せば、生成は1本も走らない。
 *
 * 通るのは本番と同じ assembleToFiles（assembleForTest は薄いラッパ）。
 * ダウンロードと ffmpeg だけなので、かかるのは時間と帯域だけ。
 *
 * 使い方: npx tsx --env-file=.env scripts/reassemble.ts [orderId]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import { resolveWorld } from "@/lib/film-script";
import { assembleForTest } from "@/lib/film-pipeline";

const DEFAULT_ORDER = "cmsepxxip000004l52t94y6tq"; // CAMYU（納品済みDC。素材が揃っている）

type Artifacts = {
  clipUrls?: string[];
  insertStillUrls?: string[];
  insertClipUrls?: (string | null)[];
  scoreUrl?: string;
};

async function grab(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function main() {
  const orderId = process.argv[2] ?? DEFAULT_ORDER;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const art = (order.filmArtifacts ?? {}) as Artifacts;

  const clips = art.clipUrls ?? order.shotClipUrls;
  if (!clips?.length) throw new Error(`${orderId} にクリップが無い`);
  if (!art.scoreUrl) throw new Error(`${orderId} に劇伴が無い`);

  const dir = path.join(homedir(), "Downloads", "marquee-tails-reassemble", order.petName ?? orderId);
  await mkdir(dir, { recursive: true });
  console.log(`注文: ${order.petName} (${orderId})`);
  console.log(`素材: クリップ${clips.length} / インサート静止画${art.insertStillUrls?.length ?? 0} / インサートクリップ${(art.insertClipUrls ?? []).filter(Boolean).length}`);
  console.log(`出力: ${dir}\n素材を取得中…`);

  const clipPaths = await Promise.all(clips.map((u, i) => grab(u, path.join(dir, `clip${i}.mp4`))));
  const insertStillPaths = await Promise.all(
    (art.insertStillUrls ?? []).map((u, i) => grab(u, path.join(dir, `insert${i}.png`)))
  );
  const insertClipPaths = await Promise.all(
    (art.insertClipUrls ?? []).map((u, i) => (u ? grab(u, path.join(dir, `insertclip${i}.mp4`)) : Promise.resolve(null)))
  );
  const scorePath = await grab(art.scoreUrl, path.join(dir, "score.mp3"));

  // loglines は注文のものをそのまま使う。ここを作り直すと「新しい編集の確認」
  // ではなく「新しい脚本の確認」になってしまう。
  const { loglines } = resolveWorld(order);
  console.log(`\nカード: ${Object.entries(loglines).map(([k, v]) => `${k}=${v ? "有" : "無"}`).join(" ")}`);
  console.log(`（premise と stinger が両方あれば6カード版の EDL、無ければ旧4カード版）\n`);

  console.log("組み立て中… ffmpeg のみ、fal は呼ばない");
  const started = Date.now();
  const { masterPath } = await assembleForTest(dir, order.petName ?? "STAR", clipPaths, insertStillPaths, insertClipPaths, scorePath, loglines);
  console.log(`完了 ${Math.round((Date.now() - started) / 1000)}秒`);
  console.log(masterPath);
}

main().then(() => process.exit(0));
