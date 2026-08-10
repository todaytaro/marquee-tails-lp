/**
 * 広告素材ツール: 画像1枚 → 5秒のKlingクリップ ＋ 同じ画のポスター。
 *
 * リポジトリ内に置いてあるのは、**ポスターを製品と完全に同じにするため**。
 * `renderPosterPng` を呼ぶので、タイポグラフィ・ビリングブロック・グラデーション
 * は納品物と1ピクセルも変わらない。別サイトに複製すると、その瞬間から
 * 広告のポスターと納品のポスターがズレ始める（LPの世界観画像が製品と
 * 食い違っていたのと同じ事故）。
 *
 * **これは製品ではない。** LoRAを使わないので、犬が「その個体のまま」で
 * ある保証は無い。5秒なら崩れきる前に終わるが、
 * 「これがあなたに届くものです」と言える画ではない。フックまで。
 * 実際の納品品質を見せたいときは完成済みの映画を使うこと。
 *
 * 入力は2通り:
 *   A. 画像1枚を渡す        … その画を動かす
 *   B. 名前とコンセプト      … Director's Cut のワンカット版を丸ごと作る
 *
 * Bは製品と同じ `generateTreatment` を呼ぶ。専用の短いプロンプトを別に
 * 書けば速くて安いが、**製品が作らない世界観を広告が約束する**ことになる。
 * 6カット生成してcut1だけ使うのは無駄に見えて、「広告に出る世界は、注文
 * したら実際に出てくる世界」を保証するための必要経費。
 *
 * 使い方:
 *   npx tsx --env-file=.env scripts/ad-clip.ts <画像> [オプション]
 *   npx tsx --env-file=.env scripts/ad-clip.ts --name MILO --concept "..."
 *
 *   --title    ポスターの大見出し（既定: ファイル名）
 *   --tagline  上部の小さい一行
 *   --subtitle 名前の下の一行（名前で始めると自動で落とされる）
 *   --motion   Klingに渡すカメラ/動きの指示
 *   --seconds  クリップ長 3〜15（既定 5）
 *   --out      出力先（既定 ~/Downloads/marquee-tails-ads/<日付>-<名前>）
 *   --no-video 動画を作らない（画像モードなら$0）
 *   --name     コンセプトモードのペット名（--concept と併用）
 *   --concept  世界観の指示。例 "a deep-sea submarine in an unmapped trench"
 *
 * 例:
 *   npx tsx --env-file=.env scripts/ad-clip.ts ~/Desktop/dog.jpg \
 *     --title "MILO" --subtitle "THE LONG WAY HOME" \
 *     --motion "Slow dolly-in, dust motes drifting through warm light"
 *
 * コスト:
 *   画像モード      動画 $0.084/秒（5秒 = $0.42）＋ ポスター $0
 *   コンセプトモード 上記 ＋ Claude 1回 ＋ 静止画1枚（数セント）
 *
 * コンセプトモードは ANTHROPIC_API_KEY が要る（.env に無ければ動かない）。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { generateStandaloneClip } from "@/lib/film-pipeline";
import { renderPosterPng } from "@/lib/poster-print";
import { generateTreatment } from "@/lib/claude-script";
import { STYLE_RULES } from "@/lib/stills-pipeline";
import { falDeadline, FAL_IMAGE_CAP_MS } from "@/lib/fal-deadline";

const PER_SECOND_USD = 0.084; // lib/film-pipeline.ts の記録値

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function download(url: string, dest: string): Promise<number> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status} ${url.slice(0, 60)}`);
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, b);
  return b.length;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/**
 * コンセプト → Director's Cut のワンカット。
 *
 * LoRAが無いので特定の個体は再現できない。ここで作られるのは「この世界観
 * だとこういう画になる」の見本であって、誰かの犬ではない。
 */
async function fromConcept(name: string, concept: string): Promise<{
  imageUrl: string; tagline: string; intro: string; scene: string; costume: string;
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("コンセプトモードには ANTHROPIC_API_KEY が必要です（.env に追加してください）");
  }
  console.log(`脚本を生成中… (製品と同じ generateTreatment)`);
  const r = await generateTreatment({ brief: concept, petName: name });
  if (r.status === "rejected") throw new Error(`ブリーフが却下されました: ${r.reason}`);
  if (r.status !== "ok") throw new Error("脚本の生成に失敗しました");

  const { costume, cuts, loglines } = r.bundle;
  const scene = cuts[0].scene;
  console.log(`  衣装:  ${costume.slice(0, 80)}…`);
  console.log(`  cut 1: ${scene.slice(0, 80)}…`);
  console.log(`  題:    ${loglines.tagline}`);

  console.log(`\n静止画を生成中…`);
  const res = await fal.subscribe("fal-ai/nano-banana-pro", {
    input: {
      prompt:
        `A cinematic film still of a small dog, ${costume}, ${scene}. ` +
        `Framed as a medium hero shot, the dog prominent, its world reading clearly behind it. ` +
        `The dog's face is fully visible, sharp and well lit, with nothing covering it. ` +
        `Blockbuster cinematography, dramatic lighting. ${STYLE_RULES}`,
      num_images: 1,
      resolution: "4K",
      aspect_ratio: "2:3", // ポスターと同じ比率で撮っておく
      output_format: "png",
    } as never,
    abortSignal: falDeadline(FAL_IMAGE_CAP_MS),
  });
  const url = (res.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("静止画が返りませんでした");
  return { imageUrl: url, tagline: loglines.tagline, intro: loglines.intro, scene, costume };
}

async function main() {
  const concept = arg("concept");
  const imagePath = concept ? undefined : process.argv[2];
  if (!concept && (!imagePath || imagePath.startsWith("--"))) {
    console.error(
      "画像か、--name と --concept を指定してください。\n" +
        "  npx tsx --env-file=.env scripts/ad-clip.ts <画像> [--title ...]\n" +
        '  npx tsx --env-file=.env scripts/ad-clip.ts --name MILO --concept "a deep-sea submarine..."'
    );
    process.exit(1);
  }
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");

  const seconds = Number(arg("seconds") ?? 5);
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
    throw new Error("--seconds は 3〜15 の整数（Klingの許容範囲）");
  }
  const base = imagePath ? path.basename(imagePath).replace(/\.[^.]+$/, "") : (arg("name") ?? "star");
  const title = arg("title") ?? arg("name") ?? base;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
  const stamp = new Date().toISOString().slice(0, 10);
  const out = arg("out") ?? path.join(process.env.HOME ?? ".", "Downloads", "marquee-tails-ads", `${stamp}-${slug}`);
  await mkdir(out, { recursive: true });

  fal.config({ credentials: process.env.FAL_KEY });

  let imageUrl: string;
  let autoTagline: string | undefined;
  let autoIntro: string | undefined;
  if (concept) {
    const c = await fromConcept(title, concept);
    imageUrl = c.imageUrl;
    autoTagline = c.tagline;
    autoIntro = c.intro;
    await writeFile(
      path.join(out, "concept.txt"),
      `name: ${title}\nconcept: ${concept}\n\ncostume: ${c.costume}\n\ncut 1: ${c.scene}\n\ntagline: ${c.tagline}\nintro: ${c.intro}\n`
    );
    await download(imageUrl, path.join(out, "still.png"));
    console.log(`  still.png`);
  } else {
    // Klingもポスターも URL を要求するので、まずアップロードする。
    const buf = await readFile(imagePath!);
    const ext = path.extname(imagePath!).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    imageUrl = await fal.storage.upload(new File([new Uint8Array(buf)], path.basename(imagePath!), { type: mime }));
    console.log(`元画像をアップロード (${mb(buf.length)})`);
  }

  // ポスターを先に作る。無料で、しかも失敗すれば $0.42 を使う前に分かる。
  console.log(`\nポスターを描画中…`);
  const posterUrl = await renderPosterPng(
    imageUrl,
    {
      petName: title,
      // コンセプトモードでは Claude が書いた文言を既定にする。手で上書きも可。
      tagline: arg("tagline") ?? autoIntro ?? "A MARQUEE TAILS ORIGINAL",
      subtitle: arg("subtitle") ?? autoTagline,
    },
    { uploadName: `${slug}-ad-poster.png` }
  );
  const posterBytes = await download(posterUrl, path.join(out, "poster.png"));
  console.log(`  poster.png  ${mb(posterBytes)}`);

  if (has("no-video")) {
    console.log(`\n${out}\n動画はスキップ（--no-video）。費用 $0。`);
    return;
  }

  console.log(`\n${seconds}秒クリップを生成中… (Kling、LoRAなし)`);
  const t0 = Date.now();
  const clipUrl = await generateStandaloneClip(imageUrl, { seconds, motion: arg("motion") });
  const clipBytes = await download(clipUrl, path.join(out, "clip.mp4"));
  console.log(`  clip.mp4    ${mb(clipBytes)}  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);

  console.log(`\n${out}`);
  console.log(`費用の目安: $${(seconds * PER_SECOND_USD).toFixed(2)}（動画のみ。ポスターは生成を伴わない）`);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
