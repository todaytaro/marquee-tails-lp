/**
 * B1 vs B3 — should the dresser be a separate call, if the dresser knows the dog?
 *
 * Where this stands. The LoRA draws camyu; that is settled. What keeps going
 * wrong is putting clothes on him. nano-banana's dressing pass re-draws the
 * dog whenever it re-composes, and re-drawing grooms him into a breed-standard
 * schnauzer — four for four in the framing test, in both directions. But the
 * reason is not "second passes are bad": it is that nano-banana has never seen
 * this dog, so when it must redraw, the only thing it can draw is the average
 * schnauzer. An editor with the LoRA loaded does not have that problem.
 *
 *   B1  flux-2/lora/edit(costume sheet)          — one call, no second pass
 *   B3  flux-2/lora → flux-2/lora/edit(frame, costume sheet), SAME LoRA loaded
 *       on the edit — a second pass whose idea of "this dog" is camyu
 *
 * B3 is the hypothesis that the split was never the problem, only the choice
 * of dresser. If it holds, we get the split's advantages (the identity step
 * and the costume step stop fighting for the same call) without its failure
 * mode. If B1 wins anyway, the second pass is dead weight and we drop it.
 *
 * The costume here is imported from lib/film-script rather than copied, so
 * this measures the outfit the product actually ships. That matters this run:
 * the helmet is gone. It covered the face, which forced every generator to
 * redraw the face through glass — the single most expensive thing you can do
 * to a product whose whole value is "that's my dog". The astronaut read now
 * comes from an open collar ring, and nothing sits over the face.
 *
 * Judge on: is it camyu, is it the SAME suit in all three, is it the shot that
 * was asked for. As always the scores are not the verdict; the owner's eye is.
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-b3.ts --lora <url>
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { WORLD_COSTUMES } from "../lib/film-script";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const OUT = path.join(SCRATCH, "b3");
const REAL_PHOTO = path.join(SCRATCH, "train", "p01.jpg");

const TRIGGER = "camyudog";
const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const LORA_GEN = "fal-ai/flux-2/lora";
const LORA_EDIT = "fal-ai/flux-2/lora/edit";

// The real thing, not a paraphrase — helmet removed, collar ring instead.
const COSTUME = WORLD_COSTUMES.deepspace;

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";
const IDENTITY_RULES =
  "Preserve this exact pet's identity from the reference photos: the same coat colors in the same places, the same fur texture and haircut, the same face structure, eyes, ears and proportions. Do NOT idealize, do NOT groom them differently, do NOT drift toward a generic breed look. No text, no watermark, no humans.";
const COSTUME_RULE =
  "Reproduce the outfit in the costume sheet EXACTLY — the same suit, the same trim in the same places, the same patch, the same collar ring. The costume must be identical in every shot of the film. Take ONLY the costume from that reference; the animal's identity comes from the model, not from the reference.";

const SCENES = [
  {
    id: "bridge",
    scene:
      "standing tall on the starship bridge, chin high, red alert lights pulsing along the walls",
    // The "NOT an extreme close-up" clause earned its place: without it the
    // plain LoRA answered this beat with a nose-first macro shot.
    framing:
      "Framed as a medium hero shot, the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame. The whole head and the chest are inside the frame with room around them — this is NOT an extreme close-up of the face.",
  },
  {
    id: "viewport",
    scene:
      "at the great viewport as the nebula parts to reveal a new galaxy, bathed in violet light, triumphant",
    framing:
      "Framed as a wide shot showing the pet full-body within the setting, the pet's face turned toward the camera and clearly visible.",
  },
  {
    id: "spacewalk",
    scene:
      "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black",
    framing:
      "Framed as a low-angle shot looking up at the pet, heroic and imposing, the pet's face turned toward the camera and clearly visible.",
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
  console.log(`costume: ${COSTUME}\n`);

  // A fresh sheet, because the old one has a helmet. Built once and handed to
  // both arms so the suit is a constant and only the method varies.
  console.log("building the costume sheet (helmet-free)…");
  const realUrl = await upload(REAL_PHOTO);
  const sheetRes = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Dress the pet in this photo ${COSTUME}. Keep the pet itself completely unchanged — same face, same fur, same proportions — and leave the head and face completely bare and unobstructed. Plain neutral studio background, full body visible, even lighting. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: [realUrl],
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "1:1",
      output_format: "png",
      seed: 11,
    },
  });
  const costumeSheet = firstImage(sheetRes.data, "costume sheet");
  await save(costumeSheet, "00-costume-sheet.png");

  for (const s of SCENES) {
    console.log(`\nscene: ${s.id}`);
    // Per-scene seeds: a shared seed would let costume agreement ride on
    // matching noise, and costume agreement across cuts is the thing at stake.
    const seed = 42 + SCENES.indexOf(s);

    // B1 — identity and costume in a single call.
    const b1 = await fal.subscribe(LORA_EDIT, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${COSTUME}, ${s.scene}. ${s.framing} ${COSTUME_RULE} Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        image_urls: [costumeSheet],
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        seed,
      },
    });
    await save(firstImage(b1.data, `${s.id} B1`), `${s.id}-1-b1.png`);

    // B3 step 1 — the dog in the scene, no costume competing for the call.
    const nude = await fal.subscribe(LORA_GEN, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${s.scene}. ${s.framing} Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        seed,
      },
    });
    const nudeUrl = firstImage(nude.data, `${s.id} B3 nude`);
    await save(nudeUrl, `${s.id}-2-b3-nude.png`);

    // B3 step 2 — dress it with the LoRA still loaded. The no-reframe wording
    // is the same one that held nano-banana's framing when it held at all;
    // the difference under test is who is holding the brush, so the
    // instruction has to be the same on both sides.
    const b3 = await fal.subscribe(LORA_EDIT, {
      input: {
        prompt: `The FIRST image is a film still of ${TRIGGER}, a small dog. The SECOND image is the costume sheet. Put that costume onto the dog in the first image: ${COSTUME}. Change ONLY the clothing — the dog stays the same animal, same face, same fur texture and coat length, same pose, and the head and face stay completely bare and unobstructed. Do NOT crop, zoom or re-frame: the output keeps the exact camera framing of the first image, with the dog at the same scale and position and the same background visible on every side. ${COSTUME_RULE} ${STYLE_RULES}`,
        image_urls: [nudeUrl, costumeSheet],
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        seed,
      },
    });
    await save(firstImage(b3.data, `${s.id} B3`), `${s.id}-3-b3-dressed.png`);
  }

  console.log(`\nimages: ${OUT}`);
  console.log("per scene: -1-b1  -2-b3-nude  -3-b3-dressed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
