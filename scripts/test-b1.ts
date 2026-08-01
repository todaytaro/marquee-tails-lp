/**
 * Can B1 carry the whole storyboard on its own?
 *
 * The framing test settled the question the bake-off left open. nano-banana's
 * dressing pass re-draws the dog whenever it re-composes, and re-drawing means
 * grooming it into a breed-standard schnauzer — four for four, in both
 * directions: hold the framing and the likeness holds, change the framing and
 * the likeness dies. Prompting against it did not work; V1 and V2 each held
 * once and failed once. So the second pass is the failure mode, not a step
 * that happens to have a bug.
 *
 * B1 has no second pass: flux-2/lora/edit takes the trained LoRA (identity)
 * and the costume sheet (costume) in a single call. If it holds up, the whole
 * class of defect disappears and the per-cut cost halves.
 *
 * What is actually in doubt is the costume, not the dog. Dressing with
 * nano-banana was never the weak link — the suit has held across cuts in
 * production all along. Asking a LoRA to honour a costume reference across
 * three different scenes is the untested claim, and a trailer where the suit
 * changes between cuts is as broken as one where the dog does. So this runs
 * all three scenes at 2048x1152 and the question to ask of the output is:
 *
 *   1. is it still camyu at this size?
 *   2. is it the SAME SUIT in all three? (same white/orange trim, same patch,
 *      same collar) — the one that decides whether B1 can ship
 *   3. does it obey the requested shot size? (bridge asked for a medium hero
 *      shot and the plain LoRA gave a nose-first close-up; B1 gets the same
 *      instruction, so the same failure would show here)
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-b1.ts --lora <url>
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const OUT = path.join(SCRATCH, "b1");
const COSTUME_SHEET = path.join(SCRATCH, "compare", "00-costume-sheet.png");

const TRIGGER = "camyudog";
const LORA_EDIT = "fal-ai/flux-2/lora/edit";

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";
const COSTUME =
  "wearing a fitted white astronaut suit with orange trim, a small mission patch on the chest, and a clear glass helmet";

// Named separately from the scene text because this is the claim under test:
// the costume must come from the sheet and be identical in every cut.
const COSTUME_RULE =
  "The reference image is the costume sheet for this film. Reproduce the outfit in it EXACTLY — the same white suit, the same orange trim in the same places, the same mission patch, the same helmet and collar ring. The costume must be identical in every shot of the film. Take ONLY the costume from the reference; the animal's identity comes from the model, not from the reference.";

const SCENES = [
  {
    id: "bridge",
    scene:
      "standing tall on the starship bridge, chin high, red alert lights pulsing along the walls",
    framing:
      "Framed as a medium hero shot, the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame. The whole head and the chest are inside the frame with room around them — this is NOT an extreme close-up of the face.",
  },
  {
    id: "viewport",
    scene:
      "at the great viewport as the nebula parts to reveal a new galaxy, bathed in violet light, triumphant",
    framing: "Framed as a wide shot showing the pet full-body within the setting",
  },
  {
    id: "spacewalk",
    scene:
      "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black",
    framing: "Framed as a low-angle shot looking up at the pet, heroic and imposing",
  },
];

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
    const r = await fal.subscribe(LORA_EDIT, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${COSTUME}, ${s.scene}. ${s.framing} ${COSTUME_RULE} Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        image_urls: [costumeSheet],
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        // Per-scene seeds: identical seeds across scenes would make any
        // costume agreement partly an artifact of the noise, and costume
        // agreement is the thing being measured.
        seed: 42 + SCENES.indexOf(s),
      },
    });
    await save(firstImage(r.data, s.id), `${s.id}-b1-2048.png`);
  }

  console.log(`\nimages: ${OUT}`);
  console.log("check: same dog as the real photo, SAME SUIT in all three, requested shot size.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
