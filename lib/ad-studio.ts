import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { generateStandaloneClip } from "@/lib/film-pipeline";
import { renderPosterPng } from "@/lib/poster-print";
import { generateTreatment } from "@/lib/claude-script";
import { STYLE_RULES, IDENTITY_RULES, EDIT_MODEL } from "@/lib/stills-pipeline";
import { falDeadline, FAL_IMAGE_CAP_MS } from "@/lib/fal-deadline";

/**
 * 広告素材の生成。CLI（scripts/ad-clip.ts）とローカルのスタジオ画面
 * （app/ad-studio）が **両方ここを呼ぶ**。
 *
 * 分けなかった理由は、このツール自体をリポジトリ内に置いた理由と同じ。
 * 入口が2つあって中身が2つあると、片方だけ直った状態が必ず生まれる。
 * 入口は2つでいいが、中身は1つでなければならない。
 *
 * **これは製品ではない。** LoRAを使わないので特定の個体は再現できず、
 * 出てくるのは「この世界観だとこういう画になる」の見本。
 * 「あなたの犬がこうなります」の証明には使えない。
 */

export const AD_PER_SECOND_USD = 0.084; // lib/film-pipeline.ts の記録値

/**
 * 広告の静止画は **9:16**。TikTok / Reels に出すのが目的なので。
 *
 * ここを変えるしかない理由: Kling の image-to-video には縦横比の指定が
 * 無く（入力は start_image_url / duration / cfg_scale / prompt 等のみ）、
 * **出力の比率は開始フレームがそのまま決める**。縦動画が欲しければ、
 * 開始フレームを縦にする以外の方法が無い。
 *
 * ポスターは 2:3 のままで、この 9:16 から中央を切って使う（高さの約16%が
 * 落ちる）。ポスターを 9:16 にするという選択肢もあるが、それは**製品の
 * ポスターの形**であって、広告の都合で動かしていいものではない。
 *
 * **この定数は広告専用。** lib/ad-studio.ts を import しているのは
 * scripts/ad-clip.ts と app/ad-studio の2つだけで、製品の生成経路
 * （stills-pipeline / film-pipeline / poster-pipeline）は一切通らない。
 */
const AD_ASPECT = "9:16";

/**
 * 広告の静止画は **2K**。製品のポスターアートは4Kだが、ここは違う。
 *
 * 4Kで作った 9:16 の生成画をそのまま Kling に渡したら 422 を返された。
 * これまでクリップは全部「アップした写真」（数MB）から作っていたので、
 * **4Kの生成画を動画に渡す組み合わせだけが未検証**で、そこが落ちた。
 *
 * 2K で困らない: 広告は画面で見るもので、印刷しない。ここから作る
 * ポスターは 1800px 前後（16インチ幅で約113dpi）になるが、それは
 * SNS用の画としては十分。**印刷に耐えるポスターが要るのは製品側**で、
 * そちらは 4K のまま何も変わっていない。
 */
const AD_STILL_RESOLUTION = "2K";

export type AdAssets = {
  posterUrl: string;
  stillUrl?: string;
  clipUrl?: string;
  /** コンセプトモードのときだけ、Claudeが書いたもの */
  script?: { costume: string; scene: string; tagline: string; intro: string };
};

export type AdInput = {
  /** 大見出し。ポスターのペット名にあたる */
  title: string;
  /**
   * コンセプト。imageUrl と **組み合わせられる**:
   *   concept のみ         … その世界の見本を一から描く（犬は不特定）
   *   imageUrl のみ        … 渡した画をそのまま動かす
   *   concept + imageUrl   … **渡した犬をその世界に入れる**（本命）
   */
  concept?: string;
  /** 手持ちの画像のURL */
  imageUrl?: string;
  tagline?: string;
  subtitle?: string;
  motion?: string;
  seconds?: number;
  /** true なら動画を作らない（$0.42を使わずに構図と文言を詰められる） */
  posterOnly?: boolean;
};

/**
 * コンセプト → Director's Cut のワンカット。
 *
 * 製品と同じ `generateTreatment` を呼び、cut 1 だけ使う。専用の短い
 * プロンプトを書けば速くて安いが、**製品が作らない世界観を広告が約束する**
 * ことになる。6カット作って1つ使うのはその保証の対価。
 */
async function fromConcept(
  name: string,
  concept: string
): Promise<{ imageUrl: string; script: NonNullable<AdAssets["script"]> }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("コンセプトモードには ANTHROPIC_API_KEY が必要です（.env に追加してください）");
  }
  const r = await generateTreatment({ brief: concept, petName: name });
  if (r.status === "rejected") throw new Error(`ブリーフが却下されました: ${r.reason}`);
  if (r.status !== "ok") throw new Error("脚本の生成に失敗しました");

  const { costume, cuts, loglines } = r.bundle;
  const scene = cuts[0].scene;

  const res = await fal.subscribe("fal-ai/nano-banana-pro", {
    input: {
      prompt:
        `A cinematic film still of a small dog, ${costume}, ${scene}. ` +
        `Framed as a medium hero shot, the dog prominent, its world reading clearly behind it. ` +
        `The dog's face is fully visible, sharp and well lit, with nothing covering it. ` +
        `Blockbuster cinematography, dramatic lighting. ${STYLE_RULES}`,
      num_images: 1,
      resolution: AD_STILL_RESOLUTION,
      aspect_ratio: AD_ASPECT,
      output_format: "png",
    } as never,
    abortSignal: falDeadline(FAL_IMAGE_CAP_MS),
  });
  const url = (res.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("静止画が返りませんでした");
  return {
    imageUrl: url,
    script: { costume, scene, tagline: loglines.tagline, intro: loglines.intro },
  };
}

/**
 * 日常写真 ＋ コンセプト → その犬をその世界に入れる。
 *
 * これが広告として一番効く形で、**製品がやっていることに一番近い**。
 * 製品との違いはLoRAを使わないこと — つまり参照写真1枚ぶんの同一性しか
 * 保てない。似はするが、製品ほど「その個体のまま」ではない。
 *
 * 着せ役は製品と同じ nano-banana/edit（EDIT_MODEL）で、IDENTITY_RULES も
 * 製品から借りる。ここで別のプロンプトを書くと、広告の見え方と製品の
 * 見え方が分かれてしまう。
 */
async function dressPhoto(
  name: string,
  concept: string,
  imageUrl: string
): Promise<{ imageUrl: string; script: NonNullable<AdAssets["script"]> }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("コンセプトモードには ANTHROPIC_API_KEY が必要です（.env に追加してください）");
  }
  const r = await generateTreatment({ brief: concept, petName: name });
  if (r.status === "rejected") throw new Error(`ブリーフが却下されました: ${r.reason}`);
  if (r.status !== "ok") throw new Error("脚本の生成に失敗しました");
  const { costume, cuts, loglines } = r.bundle;
  const scene = cuts[0].scene;

  const res = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt:
        `A cinematic film still of THIS EXACT PET from the reference photo, ${costume}. ${scene} ` +
        `Keep the pet's own coat colours, markings, face shape and proportions exactly as in the reference — ` +
        `only the costume and the world around it change. The face is fully visible and unobstructed. ` +
        `Blockbuster cinematography, dramatic lighting. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: [imageUrl],
      num_images: 1,
      resolution: AD_STILL_RESOLUTION,
      aspect_ratio: AD_ASPECT,
      output_format: "png",
    } as never,
    abortSignal: falDeadline(FAL_IMAGE_CAP_MS),
  });
  const url = (res.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!url) throw new Error("着せ替えた画が返りませんでした");
  return {
    imageUrl: url,
    script: { costume, scene, tagline: loglines.tagline, intro: loglines.intro },
  };
}

export async function generateAdAssets(input: AdInput): Promise<AdAssets> {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const seconds = input.seconds ?? 5;
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
    throw new Error("秒数は 3〜15 の整数（Klingの許容範囲）");
  }

  let imageUrl = input.imageUrl;
  let script: AdAssets["script"];
  if (input.concept && input.imageUrl) {
    // 本命: 渡された犬を、その世界に入れる
    const c = await dressPhoto(input.title, input.concept, input.imageUrl);
    imageUrl = c.imageUrl;
    script = c.script;
  } else if (input.concept) {
    const c = await fromConcept(input.title, input.concept);
    imageUrl = c.imageUrl;
    script = c.script;
  }
  if (!imageUrl) throw new Error("画像かコンセプトのどちらかが必要です");

  // ポスターを先に作る。無料で、しかも失敗すれば $0.42 を使う前に分かる。
  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
  const posterUrl = await renderPosterPng(
    imageUrl,
    {
      petName: input.title,
      // コンセプトモードでは Claude が書いた文言を既定にする。手で上書きも可。
      tagline: input.tagline || script?.intro || "A MARQUEE TAILS ORIGINAL",
      subtitle: input.subtitle || script?.tagline,
    },
    { uploadName: `${slug}-ad-poster.png` }
  );

  if (input.posterOnly) {
    return { posterUrl, stillUrl: script ? imageUrl : undefined, script };
  }

  const clipUrl = await generateStandaloneClip(imageUrl, { seconds, motion: input.motion });
  return { posterUrl, stillUrl: script ? imageUrl : undefined, clipUrl, script };
}

/**
 * 生成物をディスクに落とす。**CLIと画面の両方がこれを呼ぶ。**
 *
 * 画面版を作ったとき、ここを付け忘れた。CLIはファイルに書くのに画面は
 * ブラウザのstateに持つだけで、リロードした瞬間に4分と$0.42が消えた。
 * fal のURLは返り値にしか無く、サーバーログにも残らない（ログに出るのは
 * 引数だけ）ので、取り戻す方法が無かった。
 *
 * 便利な入口を足すときは、既にある入口が持っている性質も一緒に持たせる —
 * でないと「速いが失う」入口を増やしただけになる。
 */
export async function saveAdAssets(
  assets: AdAssets,
  meta: { title: string; concept?: string; dir?: string }
): Promise<string> {
  const slug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
  const dir =
    meta.dir ??
    path.join(process.env.HOME ?? ".", "Downloads", "marquee-tails-ads", `${new Date().toISOString().slice(0, 10)}-${slug}-${Date.now().toString(36).slice(-4)}`);
  await mkdir(dir, { recursive: true });

  const grab = async (url: string, name: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`保存に失敗 ${r.status} ${name}`);
    await writeFile(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
  };

  await grab(assets.posterUrl, "poster.png");
  if (assets.stillUrl) await grab(assets.stillUrl, "still.png");
  if (assets.clipUrl) await grab(assets.clipUrl, "clip.mp4");
  if (assets.script) {
    await writeFile(
      path.join(dir, "concept.txt"),
      `name: ${meta.title}\nconcept: ${meta.concept ?? ""}\n\ncostume: ${assets.script.costume}\n\ncut 1: ${assets.script.scene}\n\ntagline: ${assets.script.tagline}\nintro: ${assets.script.intro}\n`
    );
  }
  return dir;
}
