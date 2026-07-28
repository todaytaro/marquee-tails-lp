/**
 * Film scripts — the shot pools behind every 60-second trailer.
 *
 * Consistency is the moat, so the pipeline locks a single HERO LOOK before
 * any shot: one costume (WORLD_COSTUMES) rendered onto the pet as a hero
 * sheet, then referenced by every shot. Scenes below describe ONLY action +
 * setting — never costume — so the outfit stays identical across cuts.
 *
 * Story legibility comes from trailer text beats (LOGLINES) shown as
 * interstitial cards between shots, plus a tagline on the closing card.
 *
 * 3 worlds × 4 personality arcs × 6 beats = 12 story structures.
 *
 * Director's Cut (custom, $249) orders don't use any of the static maps
 * below — resolveWorld() (bottom of file) routes them to Claude's
 * generatedScript bundle instead. Every pipeline stage should call
 * resolveWorld(order) rather than getCostume/getArc/WORLD_SCORES/getLoglines
 * directly, so the preset/custom branch lives in exactly one place.
 */

import type { Order } from "@/generated/prisma/client";

export type Personality = "brave" | "easygoing" | "playful" | "timid";

export const PERSONALITIES: Personality[] = ["brave", "easygoing", "playful", "timid"];

/** One locked costume per world — identical across every shot of a film. */
export const WORLD_COSTUMES: Record<string, string> = {
  deepspace:
    "wearing a fitted white astronaut suit with orange trim, a small mission patch on the chest, and a clear glass helmet",
  storybook:
    "wearing a deep-blue velvet knight's cloak with silver trim and a small round silver clasp at the throat",
  noir:
    "wearing a tan belted trench coat and a small dark-brown fedora",
};

/** Per-world music prompt for the original score (generated once, reused). */
export const WORLD_SCORES: Record<string, string> = {
  deepspace:
    "Epic cinematic orchestral trailer score, sci-fi space adventure, sweeping strings, deep brass swells, soft wonder-filled opening building to a triumphant heroic climax, no vocals, film trailer structure",
  storybook:
    "Whimsical fantasy orchestral trailer score, storybook adventure, celesta and warm strings, playful woodwinds, gentle magical opening building to a soaring heroic finale, no vocals, film trailer structure",
  noir:
    "Smoky film-noir jazz trailer score, moody upright bass and brushed drums, lonely muted trumpet, rain-on-window atmosphere building to a tense dramatic crescendo, no vocals, cinematic",
};

type WorldMap<T> = Record<string, Record<Personality, T>>;

/** Six action/setting beats per arc (NO costume words — costume is locked). */
export const FILM_SCRIPTS: WorldMap<string[]> = {
  deepspace: {
    brave: [
      "standing tall on the starship bridge, chin high, red alert lights pulsing along the walls",
      "at the helm console slamming a glowing control with one paw, star-chart holograms reflecting in its eyes",
      "bracing in the engine bay as sparks rain down, leaning into the danger",
      "gripping the hull on a spacewalk while a storm of asteroids tumbles past in the black",
      "planting a small flag on an alien ridge, twin suns blazing, wind rippling its fur, low heroic angle",
      "at the great viewport as the nebula parts to reveal a new galaxy, bathed in violet light, triumphant",
    ],
    easygoing: [
      "drifting serenely in zero gravity inside the warm-lit cabin, fur floating softly",
      "curled by the porthole watching moons drift past, eyes half closed and content",
      "relaxing in the pilot seat as a snack floats by in zero-g, cozy cockpit glow",
      "tethered and calm on a gentle spacewalk, gazing at a peaceful blue planet below",
      "lying on the warm hull beneath rippling auroras, paws crossed, unbothered",
      "small and calm against the vast glowing nebula through the viewport, quiet wonder",
    ],
    playful: [
      "mid-pounce chasing a floating glove across the zero-gravity cabin",
      "spinning in the captain's chair, ears flying, console buttons lighting up around it",
      "peeking upside-down into frame from the top of the airlock hatch, tongue out",
      "bouncing across the alien desert in low gravity, all four paws off the ground",
      "helmet slightly crooked, nose smudged against the visor, stars reflected around a grin",
      "riding a cargo sled down the loading ramp under the nebula sky, ears streaming back",
    ],
    timid: [
      "peeking around a dim corridor corner, ears low, eyes huge in the emergency light",
      "hiding behind the pilot seat with only eyes and ears showing over the backrest",
      "taking one careful step into the airlock, breath fogging the visor",
      "clinging to the tether on a first spacewalk, wide-eyed, the planet turning below",
      "walking across the pale grey lunar surface under harsh, neutral sunlight, small footprints trailing in the dust behind it, ears lifting with quiet new resolve, Earth hanging small and blue in the black sky above — no fantasy color, no sunset, true photographic moon-mission lighting",
      "standing tall at the viewport facing the great nebula head-on, no longer afraid",
    ],
  },
  storybook: {
    brave: [
      "drawing a tiny sword from a stone in the castle courtyard, banners flying at dawn",
      "galloping across a stone bridge over a river gorge, running full tilt",
      "standing guard on the castle wall at dusk, silhouetted against the watch-fires",
      "facing the dark mouth of an ancient forest cave, standing its ground as fireflies scatter",
      "charging through a storm of autumn leaves in the deep woods, god-rays breaking through",
      "on the castle balcony as fireworks bloom over the kingdom, head held high, triumphant",
    ],
    easygoing: [
      "dozing on a velvet cushion in the royal library, a storybook open beneath one paw",
      "wandering a sunlit wildflower meadow below the castle, petals drifting",
      "sitting by the royal pond watching koi glide under lily pads, golden afternoon",
      "sharing a picnic of tiny cakes with songbirds on a blanket in the orchard",
      "riding a slow wooden cart along a country lane, chin on the rail",
      "watching the sunset gild the whole kingdom from the castle balcony, serene",
    ],
    playful: [
      "mid-leap chasing butterflies over a mossy log in the enchanted forest",
      "tangled happily in a banner in the courtyard, one ear poking out",
      "splashing through the shallow royal fountain, water frozen mid-air",
      "caught mid-tiptoe stealing a tart from the kitchen window, crumbs on its beard",
      "rolling down a grassy hill below the castle in a blur of paws and leaves",
      "leading a parade of ducklings across the drawbridge, delighted",
    ],
    timid: [
      "peeking out from under a library table between hanging tapestries",
      "tiptoeing across the great hall at night, tall armor shadows on the walls",
      "hesitating at the forest edge where the god-rays end and the dark begins, one paw raised",
      "startled by its own reflection in the royal pond, fur puffed",
      "lifting a tiny glowing lantern in the dark woods, ears rising with courage",
      "standing brave at the forest gate at dawn as the kingdom wakes, triumphant",
    ],
  },
  noir: {
    brave: [
      "pushing open the frosted-glass office door, venetian-blind shadows raking across",
      "leaning over a case file under a desk lamp, smoke curling through the light",
      "striding down a rain-slicked alley toward a distant silhouette, unflinching",
      "facing a shadowy figure across a foggy midnight pier, streetlamp halo overhead",
      "chasing a fleeing shadow across wet rooftops, leaping a gap, neon glowing below",
      "standing over the solved case at dawn, first light through the blinds, satisfied",
    ],
    easygoing: [
      "leaning back in the desk chair, paws behind head, rain drumming the window",
      "at the counter of a late-night diner, neon buzzing warm outside",
      "strolling unhurried through the drizzle under a streetlamp, puddles mirroring the lights",
      "listening to a record spin in the dim office, one ear twitching, smoke curling",
      "sharing a fire escape with a stray cat, watching the wet street below",
      "watching rain wash the neon city from the office window, calm",
    ],
    playful: [
      "a fedora three sizes too big sliding over both eyes, one ear holding it up",
      "chasing its own trailing coat belt in a circle, papers swirling off the desk",
      "pouncing on the typewriter keys, ribbon unspooling dramatically",
      "peeking through venetian blinds with exaggerated suspicion at a passing pigeon",
      "sliding across the rain-wet street after a rolling donut, neon streaking",
      "grinning under the streetlamp with the recovered prize, case closed",
    ],
    timid: [
      "peering over the desk edge, only hat and eyes showing above the glowing case file",
      "flinching from a thunderclap, wrapped in the coat behind the coat rack",
      "creeping along the alley wall, hugging the shadows, wide reflecting eyes",
      "hesitating where the pier lamplight ends, breath visible in the cold",
      "finding a glinting locket in a puddle, ears lifting as fear turns to resolve",
      "walking tall out of the fog under the streetlamp, collar up, new confidence",
    ],
  },
};

/**
 * Trailer copy per arc — three escalating beats overlaid on the footage
 * (intro -> turn -> rise) plus a closing tagline. Combined with a "STARRING
 * [name]" beat and a COMING SOON close, this gives the movie-announcement feel.
 */
// {name} is filled with the pet's name at render time (see getLoglines) — woven
// into the "turn" beat so the trailer names the star mid-story, not only on the
// cards. Authored in caps (the display font is uppercase-only) and kept punchy;
// taglines stay name-free (the closing card shows the name right above them).
export const LOGLINES: WorldMap<{ intro: string; turn: string; rise: string; tagline: string }> = {
  deepspace: {
    brave: { intro: "THE GALAXY CRIED OUT FOR A HERO.", turn: "IT NEVER EXPECTED {name}.", rise: "COURAGE NEVER ASKED YOUR SIZE.", tagline: "TO THE STARS AND BACK" },
    easygoing: { intro: "OUT PAST THE LAST STAR...", turn: "...{name} FOUND THE SLOW LANE.", rise: "THE VIEW IS BETTER SLOW.", tagline: "NO RUSH OUT HERE" },
    playful: { intro: "ZERO GRAVITY. ZERO RULES.", turn: "THEN {name} FLOATED IN.", rise: "NO SNACK IN ORBIT IS SAFE.", tagline: "TROUBLE IN ORBIT" },
    timid: { intro: "SPACE IS VERY, VERY BIG.", turn: "AND {name} IS VERY SMALL.", rise: "BUT COURAGE FINDS THE QUIET ONES.", tagline: "THE LONG WAY HOME" },
  },
  storybook: {
    brave: { intro: "A KINGDOM THAT FORGOT ITS COURAGE...", turn: "...UNTIL {name} STOOD UP.", rise: "LEGENDS COME IN EVERY SIZE.", tagline: "A TAIL OF VALOR" },
    easygoing: { intro: "IN A KINGDOM OF ENDLESS QUESTS...", turn: "...{name} CHOSE THE SCENIC ROUTE.", rise: "EVERY REALM NEEDS A REST.", tagline: "THE GENTLE REIGN" },
    playful: { intro: "EVERY KINGDOM NEEDS A LEGEND.", turn: "THIS ONE GOT {name}.", rise: "LOCK UP THE ROYAL TARTS.", tagline: "ROYAL MISCHIEF" },
    timid: { intro: "THE FOREST WAS DARK AND DEEP...", turn: "...BUT NOT {name}.", rise: "THE SMALLEST STEP IS STILL A STEP.", tagline: "INTO THE WOODS" },
  },
  noir: {
    brave: { intro: "THE CITY NEVER SLEEPS.", turn: "NEITHER DOES {name}.", rise: "EVERY CASE MEETS ITS MATCH.", tagline: "CASE CLOSED" },
    easygoing: { intro: "EVERY CITY HAS ITS SHADOWS...", turn: "...{name} TAKES IT SLOW.", rise: "THE TRUTH CAN WAIT FOR COFFEE.", tagline: "AFTER HOURS" },
    playful: { intro: "A CITY FULL OF MYSTERIES.", turn: "AND {name}: PURE NONSENSE.", rise: "THE ONLY CLUE IS CHAOS.", tagline: "THE USUAL SUSPECT" },
    timid: { intro: "THE STREETS WERE COLD AND CRUEL...", turn: "...UNTIL {name} STEPPED UP.", rise: "BRAVERY WEARS A SMALL COAT.", tagline: "OUT OF THE FOG" },
  },
};

/**
 * Per-shot motion = LIVELY PET BEHAVIOR + a camera move. It must feel like a
 * film, not a static GIF, so the dog actually does something alive every shot
 * (looks around, ears perk, head tilt, sniff, eye contact). Identity is held
 * by the Kling character element (@Element1), NOT by freezing the pet — so we
 * choose motions that are lively but low-morph: head/ear/eye/tail movement and
 * small steps. We deliberately AVOID running, jumping, fast spins and big
 * action, which is what warps the face mid-clip.
 */
export const SHOT_MOTIONS: string[] = [
  "the pet looks around alertly, glancing left and right, ears perking up as it takes in the scene; slow cinematic push-in",
  "the pet tilts its head curiously and its ears twitch, then it takes one small step forward, tail swishing; camera dollies gently alongside",
  "the pet's ears prick and it turns its head sharply to look off-camera, then back toward the lens, alert and lively; slow steady push-in",
  "the pet lifts its nose to sniff the air and turns its head, fur and whiskers ruffling in the breeze; slow cinematic rise",
  "the pet locks eyes with the camera, blinks, and lowers its head with a determined look, ears forward; gentle push-in toward the face",
  "the pet raises its head proudly, ears up and tail high, a small triumphant shift of weight; slow upward crane",
];

/**
 * Per-cut camera framing — the fix for "every shot looks the same". A single
 * face-forward medium framing kept likeness perfect but made all six cuts
 * compositionally identical (only the background changed). This varies distance
 * and angle per cut for a real trailer rhythm, while keeping the face legible
 * enough for the identity gate (cuts 1 & 4 stay tight/face-forward as the
 * strongest likeness anchors; the wide/profile cut 5 is the boldest and leans
 * on the gate to reject any take where the pet stops reading as itself).
 * Parallel to SHOT_MOTIONS and the 6 arc beats.
 */
export const SHOT_FRAMINGS: string[] = [
  // 1 — opening shot / poster: safest, face-forward medium hero
  "Framed as a medium hero shot, the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame",
  // 2 — full-body three-quarter action: shows costume + movement
  "Framed as a full-body three-quarter action shot showing the whole costumed body in motion, the face still turned toward the camera and in sharp focus",
  // 3 — dramatic low angle: heroic scale
  "Framed as a dramatic low-angle shot looking up at the pet so it towers heroically, its face tilted down toward the camera and well lit",
  // 4 — tight face close-up: maximum variety AND maximum likeness
  "Framed as a tight close-up on the pet's face, the eyes and expression filling the frame in razor-sharp focus",
  // 5 — medium establishing: the world reads, but the pet stays prominent so
  //     identity holds (was a full wide — too small in frame, drifted; the gate
  //     kept scoring it low, so we pulled the pet forward).
  "Framed as a medium establishing shot — the pet prominent with its face large and sharp, the environment suggested behind it rather than dominating the frame",
  // 6 — triumphant low-angle medium-wide: the climax
  "Framed as a triumphant low-angle medium-wide shot, the pet head-high and heroic against the backdrop, its face lit and toward the camera",
];

/** Static title-card copy rendered by the assembly step (never by image models). */
export const TITLE_CARDS = {
  opening: "MARQUEE TAILS PRESENTS",
  starring: "STARRING",
  closing: "A MARQUEE TAILS FILM",
  comingSoon: "COMING SOON",
};

export function getArc(world: string, personality: string | null): string[] {
  const w = FILM_SCRIPTS[world] ?? FILM_SCRIPTS.deepspace;
  return w[(personality as Personality) ?? "easygoing"] ?? w.easygoing;
}

export function getCostume(world: string): string {
  return WORLD_COSTUMES[world] ?? WORLD_COSTUMES.deepspace;
}

export function getLoglines(world: string, personality: string | null, petName?: string) {
  const w = LOGLINES[world] ?? LOGLINES.deepspace;
  const l = w[(personality as Personality) ?? "easygoing"] ?? w.easygoing;
  // Caps to match the trailer style (Japanese names are unaffected by upcasing).
  const name = (petName ?? "").trim().toUpperCase() || "OUR HERO";
  const fill = (s: string) => s.replace(/\{name\}/g, name);
  return { intro: fill(l.intro), turn: fill(l.turn), rise: fill(l.rise), tagline: fill(l.tagline) };
}

/* ------------------------------------------------------------------ */
/* Director's Cut (custom) — world-bundle resolver                     */
/* ------------------------------------------------------------------ */

/**
 * Claude's structured output for a custom (Director's Cut) order — the
 * equivalent of one static world/personality entry above, generated from the
 * customer's free-text brief instead of picked from FILM_SCRIPTS/LOGLINES.
 * Produced by lib/claude-script.ts#generateTreatment and persisted verbatim
 * to Order.generatedScript.
 */
export type WorldBundle = {
  costume: string; // ONE locked costume, worn in every shot (no costume words in scenes)
  score: string; // music prompt for the original score
  cuts: { scene: string }[]; // EXACTLY 6 action/setting beats — NO costume words
  loglines: { intro: string; turn: string; rise: string; tagline: string }; // trailer text beats; {name} allowed
};

export type ResolvedWorld = {
  costume: string;
  arc: string[];
  score: string;
  loglines: { intro: string; turn: string; rise: string; tagline: string };
};

/**
 * Resolves the world data every pipeline stage needs, regardless of whether
 * the order is a preset (static FILM_SCRIPTS/WORLD_COSTUMES/WORLD_SCORES/
 * LOGLINES maps) or a Director's Cut custom order (Claude's generatedScript
 * bundle). Consumers should call this instead of getCostume/getArc/
 * WORLD_SCORES[...]/getLoglines directly, so neither branch has to be
 * special-cased at every call site. SHOT_FRAMINGS/SHOT_MOTIONS are NOT part
 * of this resolution — both paths reuse the same tuned framings/motions
 * (identity safety), never Claude-authored camera direction.
 */
export function resolveWorld(order: Order): ResolvedWorld {
  if (order.tier === "custom" && order.generatedScript) {
    const bundle = order.generatedScript as unknown as WorldBundle;
    // Same upcasing rule as getLoglines above, applied to Claude's loglines.
    const name = (order.petName ?? "").trim().toUpperCase() || "OUR HERO";
    const fill = (s: string) => s.replace(/\{name\}/g, name);
    return {
      costume: bundle.costume,
      arc: bundle.cuts.map((c) => c.scene),
      score: bundle.score,
      loglines: {
        intro: fill(bundle.loglines.intro),
        turn: fill(bundle.loglines.turn),
        rise: fill(bundle.loglines.rise),
        tagline: fill(bundle.loglines.tagline),
      },
    };
  }
  const world = order.world ?? "deepspace";
  return {
    costume: getCostume(world),
    arc: getArc(world, order.personality),
    score: WORLD_SCORES[world] ?? WORLD_SCORES.deepspace,
    loglines: getLoglines(world, order.personality, order.petName ?? undefined),
  };
}
