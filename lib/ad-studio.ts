import { fal } from "@fal-ai/client";
import { generateStandaloneClip } from "@/lib/film-pipeline";
import { renderPosterPng } from "@/lib/poster-print";
import { generateTreatment } from "@/lib/claude-script";
import { STYLE_RULES } from "@/lib/stills-pipeline";
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
  /** コンセプト。指定すると Claude が世界観を書き、静止画を生成する */
  concept?: string;
  /** 既にある画像のURL。concept を使わない場合に必須 */
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
      resolution: "4K",
      aspect_ratio: "2:3", // ポスターと同じ比率で撮っておく
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

export async function generateAdAssets(input: AdInput): Promise<AdAssets> {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const seconds = input.seconds ?? 5;
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
    throw new Error("秒数は 3〜15 の整数（Klingの許容範囲）");
  }

  let imageUrl = input.imageUrl;
  let script: AdAssets["script"];
  if (input.concept) {
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
