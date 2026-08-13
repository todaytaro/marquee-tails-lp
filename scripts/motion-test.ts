/**
 * 動きの比較テスト（使い捨て・製品コードには一切触れない）。
 *
 * 承認済みの静止画1枚を3つの動画モデルに同じプロンプトで渡し、
 * 「大きく動かしたとき、どれが一番その子のまま保つか」を見る。
 *
 * いまの製品は動きを意図的に抑えている（lib/film-script.ts の SHOT_MOTIONS が
 * 瞬き・呼吸しか指示していない）。理由は最初の本番映画で首の横回転（ヨー）を
 * 指示した3カットの横顔が別の犬になったから — 正面顔しか参照が無い以上、
 * 横顔は必ず捏造される。だからこのテストは**あえてヨーを含む大きな動き**を
 * 指示する。崩れるならそこで崩れる。
 *
 * 3モデルで条件が揃わない点（これ自体が結果の一部）:
 *   Kling      … negative_prompt と cfg_scale あり、end frame あり
 *   HappyHorse … prompt だけ。negative も cfg も end frame も無い
 *   Seedance   … prompt + end frame。negative も cfg も無い
 * end frame は3モデルとも使わない（揃う条件で比べるため）。Kling だけは
 * 製品と同じ negative + cfg で回す — 比べたいのは「各モデルが本番設定で
 * 出せる最良」であって、機能を削ぎ落とした素の性能ではないため。
 *
 * 使い方: npx tsx --env-file=.env scripts/motion-test.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fal } from "@fal-ai/client";
import { falDeadline } from "@/lib/fal-deadline";

/** LALA cut 1（艦長席）。承認済み＝顧客が「これは自分の犬だ」と認めた画。 */
const STILL_URL = "https://v3b.fal.media/files/b/0aa5efd1/LbfhZHOWcqIQG50FybF3A_AqjaVfhv.png";

const SECONDS = 8;

const PROMPT =
  "The small dog springs up from the oversized captain's chair, leaps down to the bridge floor and lands squarely on all four paws, " +
  "then trots briskly toward the camera across the deck — ears flapping, tail whipping side to side, loose fur bouncing with each stride — " +
  "skids to a stop in the foreground, whips its head around to look off to the left at the alarm, then snaps back to face the camera and barks. " +
  "Handheld camera pushes in and arcs slightly with the movement. Cinematic live-action, dramatic red alert lighting, shallow depth of field, " +
  "film grain, visible continuous motion throughout. It remains the same individual dog for every frame — identical face, coat markings, " +
  "tail length and ear shape, same costume — physically real and alive, never morphing into a different dog.";

/**
 * 製品の CLIP_NEGATIVE から `ears changing` と `tail changing` の2語だけ抜いたもの。
 * 意図は「別の犬の耳・尻尾に変わるな」だが、文字通り読むと尻尾を振る・耳が動くも
 * 該当してしまい、今回いちばん見たい動きを潰す。形状を縛る `wrong tail length` /
 * `wrong ear shape` は残す。
 */
const NEGATIVE =
  "blur, distort, low quality, deformed face, extra limbs, warped anatomy, morphing, changing costume, different dog, " +
  "wrong tongue color, wrong tail length, wrong ear shape, cartoon, cel shading, 3d render, cgi, plastic sheen, " +
  "illustration, stylized animation, text, watermark";

type Model = { label: string; endpoint: string; input: Record<string, unknown>; note: string };

const MODELS: Model[] = [
  {
    label: "kling-v3-pro",
    endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    note: "現行。negative + cfg 0.55 あり（製品と同条件）",
    input: {
      start_image_url: STILL_URL,
      duration: String(SECONDS),
      generate_audio: false,
      cfg_scale: 0.55,
      negative_prompt: NEGATIVE,
      prompt: PROMPT,
    },
  },
  {
    label: "happyhorse-1.0",
    endpoint: "alibaba/happy-horse/image-to-video",
    note: "prompt のみ。negative / cfg / end frame すべて無し",
    input: {
      image_url: STILL_URL,
      prompt: PROMPT,
      resolution: "1080p",
      duration: SECONDS, // このエンドポイントだけ数値 enum（Kling は文字列）
    },
  },
  {
    label: "seedance-2.0",
    endpoint: "bytedance/seedance-2.0/image-to-video",
    note: "prompt + end frame 可。negative / cfg 無し。音声は既定 true なので切る",
    input: {
      image_url: STILL_URL,
      prompt: PROMPT,
      resolution: "1080p",
      duration: String(SECONDS),
      generate_audio: false,
    },
  },
];

const CAP_MS = 20 * 60 * 1000;

async function run(m: Model, outDir: string) {
  const started = Date.now();
  console.log(`[${m.label}] 送信 → ${m.endpoint}`);
  try {
    const r = await fal.subscribe(m.endpoint, {
      input: m.input as never,
      abortSignal: falDeadline(CAP_MS),
    });
    const d = r.data as { video?: { url?: string }; videos?: { url?: string }[] };
    const url = d.video?.url ?? d.videos?.[0]?.url;
    if (!url) throw new Error(`no video url: ${JSON.stringify(r.data).slice(0, 300)}`);
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`[${m.label}] 完了 ${secs}秒 → ${url}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const file = path.join(outDir, `${m.label}.mp4`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`[${m.label}] 保存 ${file}`);
    return { label: m.label, url, file, secs, error: null as string | null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${m.label}] 失敗: ${msg}`);
    return { label: m.label, url: null, file: null, secs: 0, error: msg };
  }
}

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  fal.config({ credentials: process.env.FAL_KEY });

  const outDir = path.join(homedir(), "Downloads", "marquee-tails-motion-test");
  await mkdir(outDir, { recursive: true });

  console.log(`元画像: ${STILL_URL}`);
  console.log(`長さ: ${SECONDS}秒 / 出力先: ${outDir}\n`);

  // 3本を同時に投げる。fal のキューは並列を受け付けるので、直列にすると
  // 待ち時間が3倍になるだけで結果は変わらない。
  const results = await Promise.all(MODELS.map((m) => run(m, outDir)));

  console.log("\n--- 結果 ---");
  for (const r of results) {
    console.log(r.error ? `✗ ${r.label}: ${r.error}` : `✓ ${r.label}  ${r.secs}秒  ${r.file}`);
  }
  await writeFile(
    path.join(outDir, "prompt.txt"),
    `still: ${STILL_URL}\nseconds: ${SECONDS}\n\nprompt:\n${PROMPT}\n\nkling negative:\n${NEGATIVE}\n`
  );
  console.log(`\n${outDir}`);
}

main().then(() => process.exit(0));
