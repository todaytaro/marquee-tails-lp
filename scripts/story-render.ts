/**
 * story-test.ts の B案（出来事のある絵コンテ）を実際に描く。使い捨て。
 *
 * **1カット1枚だけ。** 製品は1カット3テイク×同一性ゲート（最大3回リロール）で
 * 18〜54枚描くが、ここで知りたいのは「この文章が絵として成立するか」の一点なので
 * 6枚で足りる。約$0.9。
 *
 * LALA の LoRA・基準写真・衣装シートをそのまま再利用する — 学習は走らないし
 * 衣装も変わらない。**変えたのはシーンの文章だけ**なので、既存の絵コンテと
 * 1対1で比較できる。
 *
 * ゲート（scoreIdentity / scoreAnatomy）は通していない。落ちた絵も含めて
 * 素の出力を見たい: 「後ろ足で立つ」「疾走中」が保つかを判定するのは人間で、
 * ゲートに間引かれると何が起きたのか分からなくなる。
 *
 * 使い方: npx tsx --env-file=.env scripts/story-render.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/identity";
import { resolveWorld, SHOT_FRAMINGS } from "@/lib/film-script";
import { generateTakeOnce, expressionDirective } from "@/lib/stills-pipeline";

const ORDER_ID = "cmsovxam4000004l6jwkmopr1"; // LALA

/**
 * story-test.ts の B 出力を**そのまま**貼ったもの。再生成しないのは、
 * オーナーが読んで承認したのがこの6文だから — 走らせるたびに文章が変わると
 * 「絵が悪いのか文章が変わったのか」が切り分けられない。
 */
const SCENES: string[] = [
  "LALA sits alert on the command console's edge, holographic star charts glowing blue and amber around the bridge, a vast ringed planet filling the entire forward viewport behind, a red alert light washing the console in crimson",
  "A shower of sparks bursts from an overhead conduit above the bridge, LALA braced low on the console with one paw slammed flat on a glowing amber panel, the sparks and a thin ribbon of smoke visible in frame beside the planet outside the viewport",
  "LALA mid-stride across a narrow catwalk between two banks of tall consoles, one front paw planted forward on the metal grating, the far bulkhead behind flickering between red alarm light and dim emergency blue",
  "A jagged crack of white light splits across a wall panel near the captain's chair, venting a thin bright stream of escaping vapor, LALA up on hind legs with both front paws braced hard against a lever built into the panel, forcing it down",
  "The alarm light has cut out and the bridge glows calm steady blue, the vented crack now sealed and dark, LALA standing tall on the console with the vast planet hanging peaceful and still in the full viewport behind",
  "LALA curled small in the captain's chair, far too big around him, one paw resting on a folded paper star chart on the seat beside him, the peaceful blue-lit bridge and calm planet visible through the viewport behind",
];

// 製品の STILL_SEED とは別の値。同じ seed を使うと「新しい文章で描いた絵」と
// 「既存注文の絵」が seed 由来で似てしまい、文章の効果が読めない。
const SEED = 771000;

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
  if (!order.loraUrl || !order.loraTriggerWord) throw new Error("この注文には LoRA が無い");
  if (!order.heroSheetUrl) throw new Error("この注文には衣装シートが無い");

  const world = resolveWorld(order);
  const lora = { url: order.loraUrl, triggerWord: order.loraTriggerWord };
  const heroRef = publicUrl(order.heroSheetUrl);
  const description = order.petDescription ?? "the pet in the reference images";
  const expression = expressionDirective(order.personality);

  const outDir = path.join(homedir(), "Downloads", "marquee-tails-story-test");
  await mkdir(outDir, { recursive: true });

  console.log(`pet: ${order.petName} / LoRA: ${lora.triggerWord}`);
  console.log(`衣装: ${world.costume.slice(0, 90)}…`);
  console.log(`出力先: ${outDir}\n`);

  const urls = await Promise.all(
    SCENES.map(async (scene, cut) => {
      const started = Date.now();
      try {
        const url = await generateTakeOnce(
          [heroRef],
          false, // LoRA 経路では refs は使われない（衣装シートが唯一の参照）
          description,
          world.costume,
          scene,
          SHOT_FRAMINGS[cut] ?? SHOT_FRAMINGS[0],
          expression,
          SEED + cut * 100,
          lora,
          heroRef
        );
        console.log(`[cut ${cut}] ${Math.round((Date.now() - started) / 1000)}秒 → ${url}`);
        const res = await fetch(url);
        const file = path.join(outDir, `cut${cut}.png`);
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        return file;
      } catch (e) {
        console.error(`[cut ${cut}] 失敗: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    })
  );

  await writeFile(
    path.join(outDir, "scenes.txt"),
    SCENES.map((s, i) => `[cut ${i}]\n${s}\n`).join("\n")
  );
  console.log(`\n${urls.filter(Boolean).length}/6 枚\n${outDir}`);
}

main().then(() => process.exit(0));
