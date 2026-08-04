/**
 * Regenerate the three world hero images on the landing page.
 *
 * WHY: `components/Worlds.tsx` showed costumes the product does not make.
 * deepspace had a clear glass helmet, which was removed everywhere because
 * anything over the face forces the generator to redraw it and takes the fur
 * texture and eye shape with it (LORA-STORYBOARD-SPEC.md §1.4). noir had a
 * fedora, removed for the same family of reason — it hid the top-of-head fur
 * that makes a specific dog recognisable. And storybook was never right at
 * all: the LP showed a crimson-and-gold royal robe with a jewelled crown while
 * WORLD_COSTUMES has always specified a deep-blue velvet knight's cloak. That
 * one is a straight product/marketing mismatch, not a consequence of any
 * change made this week.
 *
 * The costume strings are IMPORTED from lib/film-script, never retyped. Hand-
 * copying them into a prompt here is exactly how the LP drifted from the
 * product in the first place; if a costume changes again, this script follows
 * it automatically.
 *
 * NO LoRA. These are world samples, not a specific customer's pet — three
 * different breeds, to suggest "whatever your dog is". A per-pet model would
 * make all three the same animal, which is the opposite of what this section
 * is for. (This is also why the breeds are named per world below: the current
 * LP already pairs deepspace with a schnauzer, storybook with a French
 * Bulldog and noir with a Golden Retriever, and the owner is keeping that.)
 *
 * Usage:
 *   FAL_KEY=... npx tsx scripts/gen-world-heroes.ts
 *
 * Writes to a scratch directory, NOT into public/. Look at them first; copying
 * them over the live assets is a separate, deliberate step.
 */
import { fal } from "@fal-ai/client";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { WORLD_COSTUMES } from "../lib/film-script";

const OUT =
  "/private/tmp/claude-501/-Users-kyokyo-Downloads-pictoflow/705ade85-374f-436d-9a18-91cfbff69023/scratchpad/world-heroes";

// Text-to-image: there is no pet to preserve here, so nothing to anchor an
// edit model to. Same model the film pipeline uses for its no-pet inserts.
const MODEL = "fal-ai/nano-banana-pro";

const STYLE =
  "Strictly photorealistic live-action cinematic photography: real fur texture, natural skin of the nose, true-to-life lighting and lens optics, shallow depth of field, film grain. NOT cartoon, NOT CGI, NOT 3D render, NOT illustration, NOT stylized animation. No text, no watermark, no humans, no other animals.";

// The face must be visible and unobstructed in all three — that is the rule
// the costumes now follow, and the hero images should demonstrate it rather
// than quietly contradict it.
const FACE = "The dog's face is turned toward the camera, fully visible, sharp and well lit, with nothing covering it.";

const WORLDS = [
  {
    key: "deepspace",
    breed: "a miniature schnauzer with a soft shaggy salt-and-pepper coat",
    scene:
      "standing on the bridge of a starship, chin high, a vivid purple-and-red nebula filling the great viewport behind it, red alert lights pulsing along the walls",
    framing: "Framed as a medium hero shot, the dog prominent, the bridge reading clearly behind it",
  },
  {
    key: "storybook",
    breed: "a French Bulldog",
    scene:
      "standing on a mossy stone castle balcony at golden hour, overlooking a painterly fairytale kingdom of rolling hills, a winding river and distant villages",
    framing: "Framed as a medium hero shot, the dog prominent, the kingdom stretching out behind it",
  },
  {
    key: "noir",
    breed: "a Golden Retriever",
    scene:
      "standing in a rain-slicked 1940s cobblestone alley at night, lit by a single warm streetlamp cutting through the mist, dramatic black-and-white film-noir photography",
    framing: "Framed as a medium hero shot, the dog prominent, the alley receding behind it",
  },
];

async function main() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required");
  await mkdir(OUT, { recursive: true });

  for (const w of WORLDS) {
    const costume = WORLD_COSTUMES[w.key];
    if (!costume) throw new Error(`no costume for world ${w.key}`);
    console.log(`\n${w.key}\n  costume: ${costume.slice(0, 90)}…`);

    const r = await fal.subscribe(MODEL, {
      input: {
        prompt:
          `A cinematic film still of ${w.breed}, ${costume}, ${w.scene}. ${w.framing}. ${FACE} ` +
          `Blockbuster cinematography, dramatic lighting. ${STYLE}`,
        num_images: 1,
        resolution: "2K",
        // 16:9 — Worlds.tsx renders these inside `aspect-video` with
        // object-cover, so anything taller gets its top and bottom cropped
        // away. Generated at 4:3 the first time on an unchecked assumption
        // about the card, which would have sliced the storybook cloak and ears.
        aspect_ratio: "16:9",
        output_format: "jpeg",
      },
    });
    const url = (r.data as { images?: { url?: string }[] })?.images?.[0]?.url;
    if (!url) throw new Error(`${w.key}: fal returned no image`);
    const res = await fetch(url);
    const file = path.join(OUT, `world-${w.key}-hero.jpg`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`  saved ${file}`);
  }

  console.log(`\nimages: ${OUT}`);
  console.log("check the costumes against WORLD_COSTUMES before copying into public/assets/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
