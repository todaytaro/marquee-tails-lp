/**
 * Can the extra-limb problem be prompted away? Measure it, don't assert it.
 *
 * LORA-STORYBOARD-SPEC.md §4 told the implementer not to try prompting around
 * malformed limbs. That instruction was written from general knowledge about
 * diffusion models and NOT from a measurement on this endpoint, which makes it
 * exactly the kind of claim that has been wrong before in this project. This
 * script settles it.
 *
 * Three arms, same scene, same LoRA, six different seeds each:
 *
 *   A  BASELINE   what §2.2 currently specifies — guidance 2.5, 28 steps,
 *                 acceleration "regular", no anatomy wording
 *   B  PROMPT     baseline plus an explicit anatomy instruction
 *   C  PROMPT+Q   B plus the quality levers: guidance 4.0, 50 steps,
 *                 acceleration "none"
 *
 * C exists because prompt wording is not the only thing that was untested.
 * flux-2/lora/edit has no negative prompt, but it does expose guidance_scale,
 * num_inference_steps and acceleration, and limb breakage is as plausibly a
 * sampling-budget problem as a conditioning problem. If C is clean and B is
 * not, the fix is settings, not words — a completely different §4.
 *
 * The scene is spacewalk on purpose: gripping a hull in freefall is where the
 * breakage actually appeared (b1/spacewalk-b1-2048.png has a hind leg, a
 * second hind leg and a spare furry limb overlapping). Testing on an easy pose
 * would prove nothing.
 *
 * Six seeds per arm because this is a RATE, not a yes/no. One clean image from
 * an arm means nothing; the question is whether 6/6 or 2/6 come back sound.
 * Count by eye on the contact sheet — a VLM asked to count legs is exactly the
 * component §4 proposes building, and it cannot be its own evidence.
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-anatomy.ts --lora <url>
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { WORLD_COSTUMES } from "../lib/film-script";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const OUT = path.join(SCRATCH, "anatomy");
const COSTUME_SHEET = path.join(SCRATCH, "b3", "00-costume-sheet.png");

const TRIGGER = "camyudog";
const LORA_EDIT = "fal-ai/flux-2/lora/edit";
const COSTUME = WORLD_COSTUMES.deepspace;

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";
const COSTUME_RULE =
  "The reference image is the costume sheet. Reproduce that outfit EXACTLY and take ONLY the costume from it; the animal's identity comes from the model, not from the reference.";

const SCENE =
  "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black";
const FRAMING =
  "Framed as a low-angle shot looking up at the pet, heroic and imposing, the pet's face turned toward the camera and clearly visible.";

// The instruction under test. Positive and specific: there is no negative
// prompt on this endpoint, so "no extra limbs" has to be carried by a
// description of what correct looks like.
const ANATOMY =
  "Anatomically correct dog: exactly four legs — two front legs and two hind legs — each attached to the body in the right place, one paw per leg. No extra limbs, no missing limbs, no duplicated or floating paws, no tangled or merged legs. The body under the suit is a single coherent dog.";

const SEEDS = [101, 202, 303, 404, 505, 606];

type Arm = {
  id: string;
  anatomy: boolean;
  guidance_scale: number;
  num_inference_steps: number;
  acceleration: "none" | "regular" | "high";
};

const ARMS: Arm[] = [
  { id: "a-baseline", anatomy: false, guidance_scale: 2.5, num_inference_steps: 28, acceleration: "regular" },
  { id: "b-prompt", anatomy: true, guidance_scale: 2.5, num_inference_steps: 28, acceleration: "regular" },
  { id: "c-prompt-quality", anatomy: true, guidance_scale: 4.0, num_inference_steps: 50, acceleration: "none" },
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
  if (!loraUrl) throw new Error("--lora <url> is required");
  await mkdir(OUT, { recursive: true });

  const costumeSheet = await upload(COSTUME_SHEET);

  for (const arm of ARMS) {
    console.log(`\narm: ${arm.id}  (guidance=${arm.guidance_scale} steps=${arm.num_inference_steps} accel=${arm.acceleration} anatomy=${arm.anatomy})`);
    const prompt =
      `A cinematic live-action film still of ${TRIGGER}, a small dog, ${COSTUME}, ${SCENE}. ${FRAMING} ` +
      (arm.anatomy ? `${ANATOMY} ` : "") +
      `${COSTUME_RULE} Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`;

    for (const seed of SEEDS) {
      const r = await fal.subscribe(LORA_EDIT, {
        input: {
          prompt,
          image_urls: [costumeSheet],
          loras: [{ path: loraUrl, scale: 1.0 }],
          num_images: 1,
          image_size: { width: 2048, height: 1152 },
          output_format: "png",
          seed,
          guidance_scale: arm.guidance_scale,
          num_inference_steps: arm.num_inference_steps,
          acceleration: arm.acceleration,
        },
      });
      await save(firstImage(r.data, `${arm.id} s${seed}`), `${arm.id}-s${seed}.png`);
    }
  }

  console.log(`\nimages: ${OUT}`);
  console.log("count malformed limbs per arm, by eye. 6 samples each.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
