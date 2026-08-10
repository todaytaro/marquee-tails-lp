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
 * 入力の組み合わせで挙動が変わる:
 *   画像のみ            … その画をそのまま動かす
 *   コンセプトのみ       … その世界の見本を一から描く（犬は不特定）
 *   画像 ＋ コンセプト   … **その犬をその世界に入れる**（本命）
 *
 * 使い方:
 *   npm run ad -- <画像> [オプション]
 *   npm run ad -- --name MILO --concept "a deep-sea submarine..."
 *   npm run ad -- ~/Desktop/dog.jpg --name MILO --concept "a deep-sea submarine..."
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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { generateAdAssets, saveAdAssets, AD_PER_SECOND_USD } from "@/lib/ad-studio";

/**
 * `--name` の値を返す。**次の `--flag` までのトークンを全部つなぐ。**
 *
 * `process.argv[i + 1]` だけを見ていると、`npm run ad -- --concept "a deep-sea
 * submarine"` が `"a"` になる。npm がラッパー越しに引数を渡すときに引用符が
 * 落ちることがあり、複数語の値は静かに切り捨てられる — しかも「コンセプトが
 * 短すぎる」という形でしか症状が出ないので気づきにくい。
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith("--")) break;
    parts.push(process.argv[j]);
  }
  return parts.length ? parts.join(" ") : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

async function main() {
  const concept = arg("concept");
  // 画像とコンセプトは**併用できる** — 併用すると「この犬をこの世界に入れる」に
  // なる。以前は concept があると画像を無視していた（片方しか使えなかった）。
  const first = process.argv[2];
  const imagePath = first && !first.startsWith("--") ? first : undefined;
  if (!concept && !imagePath) {
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

  // Klingもポスターも URL を要求するので、ローカル画像は先に上げる。
  let imageUrl: string | undefined;
  if (imagePath) {
    // 併用時はここで上げた画が「着せ替えの元」になる。
    fal.config({ credentials: process.env.FAL_KEY });
    const buf = await readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    imageUrl = await fal.storage.upload(new File([new Uint8Array(buf)], path.basename(imagePath), { type: mime }));
    console.log(`元画像をアップロード (${mb(buf.length)})`);
  }
  if (concept) {
    console.log(
      imagePath
        ? `脚本を書いて、その世界に着せ替え中… (製品と同じ generateTreatment)`
        : `脚本と静止画を生成中… (製品と同じ generateTreatment)`
    );
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
  }
  // 保存は画面版と同じ saveAdAssets に任せる。自前で書き出していた頃は、
  // ここと app/ad-studio に2つの保存処理があった。
  const out = await saveAdAssets(r, { title, concept, dir: arg("out") });

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
