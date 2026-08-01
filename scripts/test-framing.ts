/**
 * Can the dressing pass be told to keep its hands off the framing?
 *
 * The bake-off (scripts/compare-identity.ts) established that LoRA-then-dress
 * wins on likeness: the trained LoRA draws the actual dog, and nano-banana can
 * put a costume on it without destroying the face. One defect blocked shipping
 * it — nano-banana re-composes. On the bridge scene it threw away the
 * requested medium hero shot and pushed in to a face close-up; on viewport it
 * left the wide alone. Unreliable framing is disqualifying for a storyboard,
 * because the shot list IS the product: a trailer needs its wides to stay wide.
 *
 * So this asks one question and nothing else: does an explicit prohibition fix
 * it? Three dressing prompts run against the same LoRA image —
 *
 *   V0  the bake-off's wording, unchanged. The control.
 *   V1  V0 plus an explicit ban on cropping, zooming and re-framing.
 *   V2  V1 plus the shot size named out loud, on the theory that a model told
 *       what the shot IS defends it better than one told what not to do.
 *
 * Two scenes: bridge, where framing broke, and spacewalk, where it held. A fix
 * that only works on the broken one is luck, not a fix.
 *
 * The LoRA step also moves to 2048x1152 here (the bake-off used the
 * landscape_16_9 preset, which is 1024x576 — my mistake, not a model limit;
 * flux-2/lora takes explicit width/height up to 2048). That doubles as a check
 * that the identity survives at the larger size.
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-framing.ts --lora <url>
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const OUT = path.join(SCRATCH, "framing");
const COSTUME_SHEET = path.join(SCRATCH, "compare", "00-costume-sheet.png");

const TRIGGER = "camyudog";
const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const LORA_GEN = "fal-ai/flux-2/lora";

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";
const COSTUME =
  "wearing a fitted white astronaut suit with orange trim, a small mission patch on the chest, and a clear glass helmet";

const SCENES = [
  {
    id: "bridge",
    scene:
      "standing tall on the starship bridge, chin high, red alert lights pulsing along the walls",
    framing:
      "Framed as a medium hero shot, the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame",
    // The shot size, in the words V2 hands to the dressing pass.
    shot: "a medium hero shot showing the head and chest",
  },
  {
    id: "spacewalk",
    scene:
      "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black",
    framing: "Framed as a low-angle shot looking up at the pet, heroic and imposing",
    shot: "a low-angle full-body shot looking up at the subject",
  },
];

const KEEP_FRAMING =
  "Do NOT crop, do NOT zoom, do NOT pan and do NOT re-frame. The output must have the exact same camera framing as the first image: the dog occupies the same portion of the frame, at the same scale, in the same position, and the same amount of background is visible on every side.";

function variants(shot: string) {
  const base = `Put the costume from the SECOND reference image onto the dog in the FIRST image: ${COSTUME}. Change ONLY the clothing. The dog itself must stay pixel-for-pixel the same animal — identical face, fur texture, coat length, markings, proportions and pose. Do not re-draw or re-groom the dog. Keep the scene and lighting of the first image.`;
  return [
    { id: "v0-control", prompt: `${base} ${STYLE_RULES}` },
    { id: "v1-ban", prompt: `${base} ${KEEP_FRAMING} ${STYLE_RULES}` },
    {
      id: "v2-ban-named",
      prompt: `${base} ${KEEP_FRAMING} The first image is ${shot}; the output must remain ${shot}. ${STYLE_RULES}`,
    },
  ];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function upload(file: string): Promise<string> {
  const buf = await readFile(file);
  return fal.storage.upload(new File([new Blob([new Uint8Array(buf)])], path.basename(file)));
}

async function save(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  await writeFile(path.join(OUT, name), Buffer.from(await res.arrayBuffer()));
  console.log(`  saved ${name}`);
}

function firstImage(data: unknown, label: string): string {
  const url = (data as { images?: { url?: string }[] } | undefined)?.images?.[0]?.url;
  if (!url) throw new Error(`${label}: fal returned no image`);
  return url;
}

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  const loraUrl = arg("--lora");
  if (!loraUrl) throw new Error("--lora <url> is required (reuse the trained LoRA, do not retrain)");
  await mkdir(OUT, { recursive: true });

  const costumeSheet = await upload(COSTUME_SHEET);

  for (const s of SCENES) {
    console.log(`\nscene: ${s.id}`);

    // Same seed as the bake-off so the starting frame is the one whose framing
    // we already looked at — only the size changes.
    const gen = await fal.subscribe(LORA_GEN, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${s.scene}. ${s.framing}. Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        seed: 42,
      },
    });
    const nudeUrl = firstImage(gen.data, `${s.id} lora`);
    await save(nudeUrl, `${s.id}-0-source-2048.png`);

    for (const v of variants(s.shot)) {
      const r = await fal.subscribe(EDIT_MODEL, {
        input: {
          prompt: v.prompt,
          image_urls: [nudeUrl, costumeSheet],
          num_images: 1,
          resolution: "2K",
          aspect_ratio: "16:9",
          output_format: "png",
          seed: 42,
        },
      });
      await save(firstImage(r.data, `${s.id} ${v.id}`), `${s.id}-${v.id}.png`);
    }
  }

  console.log(`\nimages: ${OUT}`);
  console.log("compare each -v0/-v1/-v2 against its own -0-source: did the framing survive?");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
