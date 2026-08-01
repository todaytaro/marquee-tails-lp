/**
 * B4 — swap the dresser for Kling, change nothing else.
 *
 * Where the dressing step stands. nano-banana re-draws the dog whenever it
 * re-composes, and re-drawing grooms him to breed standard. flux-2/lora/edit
 * with the LoRA at scale 1.0 has the opposite failure: it protects the dog so
 * completely that it ignores the costume and hands back a naked dog, three
 * times out of three. Neither is a prompt problem — both were told clearly.
 *
 * kling-image/o3/image-to-image is worth a run because it fixes the part of
 * the instruction that has been mush all along. Every other editor here takes
 * an ordered array and a prompt that says "the FIRST reference image" and
 * hopes the model kept count. Kling addresses references positionally in the
 * prompt itself — @Image1, @Image2 — so "keep this frame, take the outfit
 * from that sheet" stops being a sentence the model has to parse into an
 * array index. It also goes to 4K, where flux tops out at 2048.
 *
 * The design point of this script: it does NOT regenerate the source frames.
 * It re-uploads the exact stills B3 produced and dresses those. Same dog, same
 * pose, same framing, same costume sheet — the only variable in the whole
 * comparison is who applies the costume. Look at b3/<scene>-3-b3-dressed.png
 * next to b4/<scene>-kling.png and the difference is attributable.
 *
 * KNOWN AND NOT UNDER TEST: the body is wrong in all of these. camyu's
 * training set is 4 head-and-chest shots, 2 near-duplicates and 2 full-body
 * shots in which he is wearing clothes — the LoRA has never seen his
 * undressed body, so every generator invents one. That is a training-data
 * defect and no choice of dresser fixes it. Judge the COSTUME here: is it
 * applied at all, is it the outfit from the sheet, and did the frame survive.
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-b4-kling.ts
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { WORLD_COSTUMES } from "../lib/film-script";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const SRC = path.join(SCRATCH, "b3");
const OUT = path.join(SCRATCH, "b4");

const KLING_EDIT = "fal-ai/kling-image/o3/image-to-image";
const COSTUME = WORLD_COSTUMES.deepspace;

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";

const SCENES = ["bridge", "viewport", "spacewalk"];

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
  if (!url) throw new Error(`${label}: kling returned no image`);
  return url;
}

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  await mkdir(OUT, { recursive: true });
  console.log(`costume: ${COSTUME}\n`);

  const costumeSheet = await upload(path.join(SRC, "00-costume-sheet.png"));

  for (const scene of SCENES) {
    console.log(`scene: ${scene}`);
    const frame = await upload(path.join(SRC, `${scene}-2-b3-nude.png`));

    const r = await fal.subscribe(KLING_EDIT, {
      input: {
        image_urls: [frame, costumeSheet],
        prompt:
          `@Image1 is a cinematic film still of a small dog. @Image2 is this film's costume sheet. ` +
          `Output @Image1 unchanged except that the dog is now ${COSTUME}, wearing the exact outfit shown in @Image2 — the same suit, the same orange trim in the same places, the same mission patch, the same collar ring. ` +
          `Change ONLY the clothing. The dog stays the same animal: identical face, fur texture, coat length, markings, proportions and pose, and the head and face stay completely bare and unobstructed. ` +
          `Keep the camera framing of @Image1 exactly — same scale, same position in frame, same background visible on every side. Do not crop, zoom or re-frame. ` +
          `Take ONLY the costume from @Image2; ignore its background, its pose and its lighting. ${STYLE_RULES}`,
        num_images: 1,
        resolution: "2K",
        aspect_ratio: "16:9",
        output_format: "png",
      },
    });
    await save(firstImage(r.data, scene), `${scene}-kling.png`);
  }

  console.log(`\nimages: ${OUT}`);
  console.log("compare against b3/<scene>-3-b3-dressed.png — same source, different dresser.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
