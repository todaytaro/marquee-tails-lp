/**
 * Likeness bake-off — which way of generating a storyboard take actually looks
 * like the customer's dog?
 *
 * WHY THIS EXISTS
 * The owner put a photo of their schnauzer next to a Gate-1 take and said it
 * doesn't look like them (IDENTITY-FIDELITY-SPEC.md §0). The gating fix that
 * followed made likeness *measurable* — it scores against the real photo now —
 * but measuring harder cannot make the generator better: a stricter gate just
 * re-rolls more and ships the least-bad failure. The generation approach
 * itself has to change, and there are two candidates worth comparing before
 * either is wired into production:
 *
 *   A) EDIT   — nano-banana-pro/edit with the REAL PHOTO as reference #1 and a
 *               costume sheet as #2. Same model the pipeline already uses; the
 *               bet is that anchoring on real pixels beats the current chain of
 *               generated-from-generated references.
 *   B1) LORA+COSTUME IN ONE CALL — flux-2/lora/edit with a per-pet LoRA
 *               (identity) AND a costume reference image (costume) in the SAME
 *               call. fal's endpoint takes `loras` and `image_urls` together.
 *   B2) LORA THEN DRESS — flux-2/lora generates the pet in the scene with no
 *               costume, then nano-banana-pro/edit puts the suit on it. This is
 *               the owner's original proposal: give each problem to the tool
 *               that is demonstrably good at it, since the costume HAS held
 *               perfectly across cuts in production while the face has not.
 *
 * B1 and B2 are both here because the argument between them is empirical, not
 * theoretical. B1 avoids a second pass that could damage a face the LoRA got
 * right; B2 keeps each model doing only what it is good at. Whichever wins,
 * wins on the sheet.
 *
 * CURRENT is included as the control: hero sheet first, real photo last, which
 * is what shipped and what the owner rejected.
 *
 * This script deliberately touches NO production code. It is a bench, not a
 * feature: it calls fal directly, writes files to a scratch dir, and the only
 * pass criterion is the owner looking at the sheet and saying which column
 * looks like their dog. Scores are printed for reference and are explicitly
 * NOT the verdict — the whole reason we are here is that a number said 80-85
 * while a human said "that isn't my dog".
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/compare-identity.ts
 *   FAL_KEY=... npx tsx scripts/compare-identity.ts --lora <existing-lora-url>
 *
 * The second form skips training (~$2, several minutes) and reuses a LoRA from
 * an earlier run, so prompt/scene iteration is cheap.
 */
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SCRATCH = "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/camyu";
const ZIP = path.join(SCRATCH, "camyu-lora.zip");
const TRAIN_DIR = path.join(SCRATCH, "train");
const OUT = path.join(SCRATCH, "compare");

// The trigger word the LoRA is trained on and every B-case prompt must use.
// Rare enough that FLUX has no prior for it, so whatever it means comes from
// the training set rather than from the base model's idea of a schnauzer.
const TRIGGER = "camyudog";

const EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const TRAINER = "fal-ai/flux-2-trainer-v2";
const LORA_EDIT = "fal-ai/flux-2/lora/edit";
const LORA_GEN = "fal-ai/flux-2/lora";

// Verbatim from lib/stills-pipeline.ts so the A/CURRENT arms are the real
// prompts, not a paraphrase — a bake-off against a strawman proves nothing.
const IDENTITY_RULES =
  "Preserve this exact pet's identity from the reference photos: the same coat colors in the same places, the same fur texture and haircut, the same face structure, eyes, ears and proportions. Do NOT idealize, do NOT groom them differently, do NOT drift toward a generic breed look. No text, no watermark, no humans.";
const STYLE_RULES =
  "Strictly photorealistic live-action photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation.";

// Deliberately a costume the training photos never contain, so "the costume
// came from the reference image" and "the dog came from the LoRA" cannot be
// confused for one another.
const COSTUME =
  "wearing a fitted white astronaut suit with orange trim, a small mission patch on the chest, and a clear glass helmet";

// The pet description the VLM would produce, written by hand here so the
// comparison doesn't also depend on a VLM call varying between runs.
const DESCRIPTION =
  "a small miniature schnauzer with a soft shaggy overgrown salt-and-pepper coat, a rounded face, large dark round eyes, a cream-white beard and eyebrows, dark charcoal body fur and cream legs";

const SCENES = [
  {
    id: "bridge",
    scene: "standing tall on the starship bridge, chin high, red alert lights pulsing along the walls",
    framing: "Framed as a medium hero shot, the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame",
  },
  {
    id: "viewport",
    scene: "at the great viewport as the nebula parts to reveal a new galaxy, bathed in violet light, triumphant",
    framing: "Framed as a wide shot showing the pet full-body within the setting",
  },
  {
    id: "spacewalk",
    scene: "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black",
    framing: "Framed as a low-angle shot looking up at the pet, heroic and imposing",
  },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function upload(file: string): Promise<string> {
  const buf = await readFile(file);
  const blob = new Blob([new Uint8Array(buf)]);
  return fal.storage.upload(new File([blob], path.basename(file)));
}

async function save(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  await writeFile(path.join(OUT, name), Buffer.from(await res.arrayBuffer()));
  console.log(`  saved ${name}`);
}

/** VLM likeness score, real photo vs candidate — printed, never decisive. */
async function score(realUrl: string, candidateUrl: string): Promise<number> {
  try {
    const r = await fal.subscribe("openrouter/router/vision", {
      input: {
        model: "google/gemini-2.5-flash",
        image_urls: [realUrl, candidateUrl],
        prompt:
          "Image 1 is a real photo of a pet. Image 2 is an AI render of the same pet in costume. How confidently is the render the SAME INDIVIDUAL animal — same face structure, same coat colors in the same places, same grooming/coat length, same eye size and shape? Ignore costume, background and pose. Reply with ONLY an integer 0-100.",
      },
    });
    const txt = String((r.data as { output?: string; text?: string })?.output ?? (r.data as { text?: string })?.text ?? "");
    const n = parseInt(txt.replace(/[^0-9]/g, "").slice(0, 3), 10);
    return Number.isFinite(n) ? Math.min(100, n) : -1;
  } catch {
    return -1;
  }
}

/**
 * Pull the first image URL out of a fal response, naming the arm in the error.
 * A silent undefined here would poison a whole column of the comparison sheet
 * and only surface as a confusing failure three calls later.
 */
function firstImage(data: unknown, arm: string): string {
  const url = (data as { images?: { url?: string }[] } | undefined)?.images?.[0]?.url;
  if (!url) throw new Error(`${arm}: fal returned no image (${JSON.stringify(data).slice(0, 300)})`);
  return url;
}

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  await mkdir(OUT, { recursive: true });

  // ---- references -------------------------------------------------------
  console.log("uploading reference photos…");
  const realPhotos = ["p01.jpg", "p03.jpg", "p06.jpg"].map((f) => path.join(TRAIN_DIR, f));
  const realUrls = await Promise.all(realPhotos.map(upload));
  const realUrl = realUrls[0];
  console.log(`  real photo (identity anchor): ${realUrl}`);

  // The costume sheet. Generated once from a real photo so all three arms are
  // handed the SAME costume — the variable under test is the face, not the suit.
  console.log("building the costume reference sheet…");
  const heroRes = await fal.subscribe(EDIT_MODEL, {
    input: {
      prompt: `Dress the pet in this photo ${COSTUME}. Keep the pet itself completely unchanged — same face, same fur, same proportions. Plain neutral studio background, full body visible, even lighting. ${STYLE_RULES} ${IDENTITY_RULES}`,
      image_urls: [realUrl],
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "1:1",
      output_format: "png",
      seed: 11,
    },
  });
  const costumeSheet = (heroRes.data as { images?: { url?: string }[] })?.images?.[0]?.url;
  if (!costumeSheet) throw new Error("costume sheet generation returned no image");
  await save(costumeSheet, "00-costume-sheet.png");

  // ---- B) train the LoRA ------------------------------------------------
  let loraUrl = arg("--lora");
  if (loraUrl) {
    console.log(`reusing LoRA: ${loraUrl}`);
  } else {
    console.log("training LoRA (several minutes, ~$2)…");
    const zipUrl = await upload(ZIP);
    const t = await fal.subscribe(TRAINER, {
      input: {
        image_data_url: zipUrl,
        // Every image is the same dog, so one caption carrying the trigger is
        // the whole supervision signal. "photo of camyudog, a small dog" and
        // nothing about breed — naming the breed would invite the base model's
        // schnauzer prior back in, which is the exact drift being fought.
        default_caption: `photo of ${TRIGGER}, a small dog`,
        steps: 1500,
      },
      logs: true,
      onQueueUpdate: (u) => {
        if (u.status === "IN_PROGRESS") process.stdout.write(".");
      },
    });
    console.log();
    const d = t.data as { diffusers_lora_file?: { url?: string }; lora_file?: { url?: string } };
    loraUrl = d.diffusers_lora_file?.url ?? d.lora_file?.url;
    if (!loraUrl) throw new Error(`trainer returned no LoRA file: ${JSON.stringify(t.data).slice(0, 400)}`);
    console.log(`  LoRA: ${loraUrl}`);
    console.log(`  (re-run with --lora "${loraUrl}" to skip training next time)`);
  }

  // ---- the three arms ---------------------------------------------------
  const results: { scene: string; arm: string; url: string; score: number }[] = [];

  for (const s of SCENES) {
    console.log(`\nscene: ${s.id}`);

    // CURRENT — what shipped: costume sheet first (declared definitive), real
    // photo last. The control.
    const cur = await fal.subscribe(EDIT_MODEL, {
      input: {
        prompt: `The FIRST reference image is the definitive look of this character — match its costume, fur colors and markings, tail and face EXACTLY. This exact pet (${DESCRIPTION}), ${COSTUME}, ${s.scene}. ${s.framing}. One cinematic live-action film still, unmistakably the same individual pet, same outfit as the reference, blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES} ${IDENTITY_RULES}`,
        image_urls: [costumeSheet, realUrl],
        num_images: 1,
        resolution: "2K",
        aspect_ratio: "16:9",
        output_format: "png",
        seed: 42,
      },
    });
    const curUrl = firstImage(cur.data, "CURRENT");
    await save(curUrl, `${s.id}-1-current.png`);
    results.push({ scene: s.id, arm: "CURRENT", url: curUrl, score: await score(realUrl, curUrl) });

    // A) EDIT — real photo first and named as the identity anchor, costume
    // sheet demoted to costume-only. Same wording the pipeline now uses.
    const a = await fal.subscribe(EDIT_MODEL, {
      input: {
        prompt: `The FIRST reference image is a real photo of this individual pet — its definitive REAL-WORLD look: match its exact face, fur colors and markings, proportions, and current grooming/coat length. The SECOND reference image is the film's costume reference sheet — match ONLY the costume/outfit shown in it exactly; it is not the identity anchor, ignore any difference in its fur styling. This exact pet (${DESCRIPTION}), ${COSTUME}, ${s.scene}. ${s.framing}. One cinematic live-action film still, unmistakably the same individual pet, same outfit as the reference, blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES} ${IDENTITY_RULES}`,
        image_urls: [realUrl, costumeSheet],
        num_images: 1,
        resolution: "2K",
        aspect_ratio: "16:9",
        output_format: "png",
        seed: 42,
      },
    });
    const aUrl = firstImage(a.data, "A/EDIT");
    await save(aUrl, `${s.id}-2-edit.png`);
    results.push({ scene: s.id, arm: "A/EDIT", url: aUrl, score: await score(realUrl, aUrl) });

    // B) LORA — identity from the trained weights, costume from the reference
    // image, both in one call. No IDENTITY_RULES here on purpose: those rules
    // exist to talk a general model out of drifting, and this model has been
    // taught the individual instead. Leaving them in would be arguing with a
    // model that already agrees.
    const b = await fal.subscribe(LORA_EDIT, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${COSTUME}, ${s.scene}. ${s.framing}. Match the costume in the reference image exactly. Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        image_urls: [costumeSheet],
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: "landscape_16_9",
        output_format: "png",
        seed: 42,
      },
    });
    const bUrl = firstImage(b.data, "B1/1CALL");
    await save(bUrl, `${s.id}-3-lora-onecall.png`);
    results.push({ scene: s.id, arm: "B1/1CALL", url: bUrl, score: await score(realUrl, bUrl) });

    // B2) LORA THEN DRESS — the owner's original split. Step 1: the LoRA draws
    // the dog in the scene with NO costume, so nothing competes with identity.
    const b2a = await fal.subscribe(LORA_GEN, {
      input: {
        prompt: `A cinematic live-action film still of ${TRIGGER}, a small dog, ${s.scene}. ${s.framing}. Blockbuster cinematography, dramatic lighting, shallow depth of field, film grain. ${STYLE_RULES}`,
        loras: [{ path: loraUrl, scale: 1.0 }],
        num_images: 1,
        image_size: "landscape_16_9",
        output_format: "png",
        seed: 42,
      },
    });
    const b2NudeUrl = firstImage(b2a.data, "B2a/NUDE");
    await save(b2NudeUrl, `${s.id}-4a-lora-nocostume.png`);
    // Saved and scored on its own: this is the number that says how good the
    // LoRA's face is BEFORE any costume pass, and comparing it to 4b below is
    // the whole point — it measures exactly how much the dressing step costs
    // in likeness, which is the risk B1 was designed to dodge.
    const b2NudeScore = await score(realUrl, b2NudeUrl);
    results.push({ scene: s.id, arm: "B2a/NUDE", url: b2NudeUrl, score: b2NudeScore });

    // Step 2: nano-banana dresses it. Told to change the outfit and nothing
    // else — the dog in image 1 is already correct and must survive intact.
    const b2b = await fal.subscribe(EDIT_MODEL, {
      input: {
        prompt: `Put the costume from the SECOND reference image onto the dog in the FIRST image: ${COSTUME}. Change ONLY the clothing. The dog itself must stay pixel-for-pixel the same animal — identical face, fur texture, coat length, markings, proportions and pose. Do not re-draw or re-groom the dog. Keep the scene and lighting of the first image. ${STYLE_RULES}`,
        image_urls: [b2NudeUrl, costumeSheet],
        num_images: 1,
        resolution: "2K",
        aspect_ratio: "16:9",
        output_format: "png",
        seed: 42,
      },
    });
    const b2Url = firstImage(b2b.data, "B2/DRESSED");
    await save(b2Url, `${s.id}-4b-lora-dressed.png`);
    results.push({ scene: s.id, arm: "B2/DRESSED", url: b2Url, score: await score(realUrl, b2Url) });
  }

  // ---- report -----------------------------------------------------------
  console.log("\n=== likeness scores (reference only — the eye decides) ===");
  for (const s of SCENES) {
    const row = results.filter((r) => r.scene === s.id);
    console.log(`${s.id.padEnd(12)} ${row.map((r) => `${r.arm}=${r.score}`).join("  ")}`);
  }
  const avg = (arm: string) => {
    const v = results.filter((r) => r.arm === arm && r.score >= 0).map((r) => r.score);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : -1;
  };
  console.log(
    `\naverage      CURRENT=${avg("CURRENT")}  A/EDIT=${avg("A/EDIT")}  ` +
      `B1/1CALL=${avg("B1/1CALL")}  B2a/NUDE=${avg("B2a/NUDE")}  B2/DRESSED=${avg("B2/DRESSED")}`
  );
  // The single most useful number in the run: how much likeness the dressing
  // pass destroys. If it is ~0, the owner's two-step split is safe and each
  // model can do only what it is good at. If it is large, B1's one-call
  // approach is the one worth shipping.
  const nude = avg("B2a/NUDE");
  const dressed = avg("B2/DRESSED");
  if (nude >= 0 && dressed >= 0) {
    console.log(`\ncost of the dressing pass: ${nude} -> ${dressed} (${dressed - nude >= 0 ? "+" : ""}${dressed - nude})`);
  }
  console.log(`\nimages: ${OUT}`);
  console.log("per scene: -1-current  -2-edit  -3-lora-onecall  -4a-lora-nocostume  -4b-lora-dressed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
