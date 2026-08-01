/**
 * Can the LoRA draw the end frame, or does start+end have to go?
 *
 * The film's start+end interpolation exists because single-frame i2v gave
 * dead-air shots — the owner's words were that the dog just stood there with
 * its ears up. Kling gets a second anchor a few seconds later and animates
 * BETWEEN two approved frames instead of inventing motion.
 *
 * That second anchor is currently drawn by nano-banana (film-pipeline.ts's
 * generateEndFrame). Today's bake-off established what nano-banana does when
 * it has to re-draw a dog it has never seen: it grooms it to breed standard.
 * So the honest reading of the current pipeline is that a cut using start+end
 * may open on the customer's dog and close on a stock one. The owner's call
 * was to drop the feature rather than ship that.
 *
 * Before dropping it, this asks whether the end frame can simply be drawn by
 * the same LoRA that draws everything else. It is not obviously fine:
 * flux-2/lora/edit at scale 1.0 refused to apply a costume in the B3 test —
 * it protected the dog so completely that it handed the input back nearly
 * unchanged. An end frame needs the opposite behaviour on one axis (the pose
 * MUST visibly move) while keeping the protection on every other. If the LoRA
 * returns a copy, the two anchors are identical, Kling interpolates between
 * two identical frames, and the shot is static — the exact failure start+end
 * was built to fix, just arrived at from the other side.
 *
 * So there are two ways to fail and only one to pass, and they are easy to
 * tell apart by eye:
 *
 *   pose unchanged  -> LoRA can't do it; drop start+end (the owner's call)
 *   dog changed     -> no better than nano-banana; drop start+end
 *   pose moved,     -> keep start+end, move it onto the LoRA
 *   dog intact
 *
 * Run against a still the LoRA itself produced, so the start frame is exactly
 * what production would hand it.
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/test-endframe.ts --lora <url>
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SCRATCH =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const OUT = path.join(SCRATCH, "endframe");
// A B1 still: the LoRA's own output, costume on, 2048x1152 — the same thing
// the film pipeline would be handed as a start frame in production.
const START_FRAME = path.join(SCRATCH, "b3", "bridge-1-b1.png");

const TRIGGER = "camyudog";
const LORA_EDIT = "fal-ai/flux-2/lora/edit";

const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";

// Verbatim in spirit from film-pipeline.ts#generateEndFrame: the change is
// asserted twice, once as the only permitted difference and once as a demand
// that it be visible, because an edit model handed "identical everything" will
// return the reference unchanged.
const END_POSES = [
  "has sat up tall and lifted one front paw off the ground",
  "has taken a clear stride toward the camera and now fills more of the frame",
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

  const start = await upload(START_FRAME);
  await save(start, "0-start-frame.png");

  for (const [i, pose] of END_POSES.entries()) {
    console.log(`\npose ${i + 1}: ${pose}`);
    const r = await fal.subscribe(LORA_EDIT, {
      input: {
        prompt:
          `The reference image is a frame of a film starring ${TRIGGER}, a small dog. Generate the SAME scene a few seconds later: ` +
          `identical dog, identical costume, identical location, lighting and camera framing. The ONLY change: the dog ${pose}. ` +
          `That change must be OBVIOUS at a glance — this frame must NOT look like a copy of the reference image; the dog's body has ` +
          `clearly moved into the new pose, while its face stays turned the same way and the camera has not moved. ${STYLE_RULES}`,
        image_urls: [start],
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: { width: 2048, height: 1152 },
        output_format: "png",
        seed: 4242 + i,
      },
    });
    await save(firstImage(r.data, `pose${i + 1}`), `${i + 1}-end-lora.png`);
  }

  console.log(`\nimages: ${OUT}`);
  console.log("judge: did the pose actually move, and is it still the same dog?");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
