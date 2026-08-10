/**
 * 広告素材ツール（CLI）。画像1枚、または名前＋コンセプトから、
 * 5秒のKlingクリップとポスターを作る。
 *
 * 生成そのものは lib/ad-studio.ts にある。このファイルは引数を読んで
 * ファイルに落とすだけ。ローカルのスタジオ画面（app/ad-studio）も同じ
 * 関数を呼ぶので、入口は2つでも中身は1つ。
 *
 * **これは製品ではない。** LoRAを使わないので、犬が「その個体のまま」で
 * ある保証は無い。フックまで。納品品質を見せたいときは完成済みの映画を使う。
 *
 * 使い方:
 *   npm run ad -- <画像> [オプション]
 *   npm run ad -- --name MILO --concept "a deep-sea submarine..."
 *
 *   --title    ポスターの大見出し（既定: ファイル名 / --name）
 *   --name     コンセプトモードのペット名
 *   --concept  世界観の指示
 *   --tagline  上部の小さい一行
 *   --subtitle 名前の下の一行（名前で始めると自動で落とされる）
 *   --motion   Klingに渡すカメラ/動きの指示
 *   --seconds  クリップ長 3〜15（既定 5）
 *   --out      出力先（既定 ~/Downloads/marquee-tails-ads/<日付>-<名前>）
 *   --no-video 動画を作らない
 *
 * コスト: 動画 $0.084/秒（5秒 = $0.42）。ポスターは生成を伴わないので $0。
 * コンセプトモードは Claude 1回＋静止画1枚（数セント）が追加。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { generateAdAssets, AD_PER_SECOND_USD } from "@/lib/ad-studio";

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

async function main() {
  const concept = arg("concept");
  const imagePath = concept ? undefined : process.argv[2];
  if (!concept && (!imagePath || imagePath.startsWith("--"))) {
    console.error(
      "画像か、--name と --concept を指定してください。\n" +
        "  npm run ad -- <画像> [--title ...]\n" +
        '  npm run ad -- --name MILO --concept "a deep-sea submarine..."'
    );
    process.exit(1);
  }
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");

  const seconds = Number(arg("seconds") ?? 5);
  const base = imagePath ? path.basename(imagePath).replace(/\.[^.]+$/, "") : (arg("name") ?? "star");
  const title = arg("title") ?? arg("name") ?? base;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
  const out = arg("out") ?? path.join(process.env.HOME ?? ".", "Downloads", "marquee-tails-ads", `${new Date().toISOString().slice(0, 10)}-${slug}`);
  await mkdir(out, { recursive: true });

  // Klingもポスターも URL を要求するので、ローカル画像は先に上げる。
  let imageUrl: string | undefined;
  if (imagePath) {
    fal.config({ credentials: process.env.FAL_KEY });
    const buf = await readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    imageUrl = await fal.storage.upload(new File([new Uint8Array(buf)], path.basename(imagePath), { type: mime }));
    console.log(`元画像をアップロード (${mb(buf.length)})`);
  } else {
    console.log(`脚本と静止画を生成中… (製品と同じ generateTreatment)`);
  }

  const r = await generateAdAssets({
    title,
    concept,
    imageUrl,
    tagline: arg("tagline"),
    subtitle: arg("subtitle"),
    motion: arg("motion"),
    seconds,
    posterOnly: has("no-video"),
  });

  if (r.script) {
    console.log(`  衣装:  ${r.script.costume.slice(0, 80)}…`);
    console.log(`  cut 1: ${r.script.scene.slice(0, 80)}…`);
    console.log(`  題:    ${r.script.tagline}`);
    await writeFile(
      path.join(out, "concept.txt"),
      `name: ${title}\nconcept: ${concept}\n\ncostume: ${r.script.costume}\n\ncut 1: ${r.script.scene}\n\ntagline: ${r.script.tagline}\nintro: ${r.script.intro}\n`
    );
  }
  if (r.stillUrl) {
    await download(r.stillUrl, path.join(out, "still.png"));
    console.log(`  still.png`);
  }
  console.log(`  poster.png  ${mb(await download(r.posterUrl, path.join(out, "poster.png")))}`);
  if (r.clipUrl) {
    console.log(`  clip.mp4    ${mb(await download(r.clipUrl, path.join(out, "clip.mp4")))}`);
  }

  console.log(`\n${out}`);
  console.log(
    r.clipUrl
      ? `費用の目安: $${(seconds * AD_PER_SECOND_USD).toFixed(2)}（動画のみ。ポスターは生成を伴わない）`
      : `動画はスキップ。`
  );
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
