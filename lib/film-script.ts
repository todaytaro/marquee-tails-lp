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
 * (blink, ear flick, tail swish, breathing, small weight shifts). Identity is
 * held by the customer's hand-picked, identity-gated start frame — a FRONT-
 * FACING portrait is the only reference the video model ever sees, so it has
 * no idea what the pet's profile looks like and will happily invent one.
 *
 * Root-cause postmortem (first production film): three of the original six
 * entries explicitly commanded yaw ("glancing left and right", "turns its
 * head sharply to look off-camera", "turns its head") and the pet's profile
 * came out looking like a different dog. That's not a wording problem, it's
 * a reference-coverage problem — no amount of clever phrasing fixes a yaw
 * turn when the model has never seen the side of the face. So the rule now
 * is absolute:
 *
 *   NEVER YAW. No "left and right", no "turns its head", no "looks
 *   off-camera", no "glances away". Any motion that rotates the head (or the
 *   camera) around the vertical axis exposes geometry the identity reference
 *   never showed, and the model fills the gap by drifting off-model.
 *
 * Safe subject motion (all keep the face toward the lens): blink / slow
 * blink, ear flick or prick, nostril/nose twitch, breathing / chest rise,
 * whiskers and fur stirring, tail swish or wag, weight shift, one small step
 * toward camera, head TILT (roll) and head RAISE/LOWER (pitch). Roll and
 * pitch keep the face pointed at the camera the whole time — only yaw is
 * banned.
 *
 * Camera does the cinematic work instead: push-in, pull-back, vertical
 * crane, gentle forward drift. Do NOT add an orbit, arc, or "circles around"
 * move here later — moving the camera around the subject changes the viewing
 * angle exactly the same way a head-turn does, and would reintroduce the
 * same identity drift by another route. If a future edit wants more camera
 * variety, add push/pull/crane variants, not rotation around the subject.
 *
 * Indices 0-4 are fixed per-cut beats (parallel to SHOT_FRAMINGS / the arc's
 * first 5 beats). Index 5 (the climax) is NOT a single string — see
 * SHOT_MOTIONS_FINALE_POOL + getShotMotion() below, so every order's ending
 * isn't the same "raises its head proudly" template.
 */
export const SHOT_MOTIONS: string[] = [
  "the pet holds its gaze on the camera and blinks slowly, ears lifting as it breathes, fur stirring slightly; slow cinematic push-in",
  "the pet tilts its head gently to one side, ears twitching and tail swishing behind it, face staying toward the camera; camera drifts slowly forward",
  "the pet's ears prick up and it lifts its chin slightly, eyes widening with alertness, chest rising as it breathes; slow steady push-in",
  "the pet's nostrils flutter as it sniffs the air and lowers its chin a little, whiskers and fur ruffling in the breeze; slow cinematic rise",
  "the pet locks eyes with the camera, blinks once, and lowers its head with quiet determination, ears forward; gentle push-in toward the face",
];

/**
 * Climax (shot index 5) variant pool — fixes "every film ends the same way".
 * SHOT_MOTIONS[5] used to hardcode "raises its head proudly", so every order
 * closed on an identical beat, which reads as a template and undercuts the
 * $249 bespoke Director's Cut promise. All three variants are still
 * yaw-free and face-forward (same rules as above); only the emotional beat
 * and camera move differ.
 */
export const SHOT_MOTIONS_FINALE_POOL: string[] = [
  "the pet lifts its chin high, ears up and tail raised, weight settling into a proud stance; slow upward crane",
  "the pet holds perfectly still, staring straight down the lens as its fur moves in the wind, unblinking and resolute; slow push-in to a hero close-up",
  "the pet's ears rise and its tail begins to wag, a small delighted shift of weight as it keeps its eyes on the camera; camera eases back to reveal the scene",
];

/**
 * Deterministic string hash (djb2-ish rolling sum) — NOT Math.random()/
 * Date.now(). The seed is the order id, and the same order must always pick
 * the same finale variant: app/admin/actions.ts can re-render a single shot
 * (kickShotRerender -> runShotRerender -> generateGatedClip) long after the
 * original run, and if the finale motion changed between takes the
 * re-rendered shot would no longer match the rest of that customer's film.
 * A pure function of the order id guarantees the same pick every time,
 * with no state to persist or resume.
 */
export function stableHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0; // >>>0 keeps it a positive uint32
  }
  return h;
}

/**
 * Resolves the camera/motion direction for one shot. Indices 0-4 are the
 * fixed SHOT_MOTIONS beats; index 5 (the climax) is picked from
 * SHOT_MOTIONS_FINALE_POOL by a stable hash of `seed` (the order id) so the
 * ending varies between orders but never between an order's original render
 * and any later single-shot re-render of it.
 */
export function getShotMotion(shotIndex: number, seed: string): string {
  if (shotIndex >= 5) {
    const pool = SHOT_MOTIONS_FINALE_POOL;
    return pool[stableHash(seed) % pool.length];
  }
  return SHOT_MOTIONS[shotIndex] ?? SHOT_MOTIONS[0];
}

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

/**
 * Insert cuts (trailer-edit-spec §4) — world-flavored, NO-PET scene-only
 * fragments used as silent B-roll (a rain-lit sign, a lantern in fog, a
 * whiskey glass). Because no animal appears, there is no likeness risk and
 * these never touch the identity gate (lib/film-pipeline.ts keeps them in a
 * separate array from clipUrls/shotClipUrls — see pickWorldInserts below).
 * 5 atmospheric options per world; pickWorldInserts chooses 3 deterministically.
 */
export const WORLD_INSERTS: Record<string, string[]> = {
  deepspace: [
    "a starship viewport streaked with drifting nebula dust and distant starlight, cinematic still, no animals, no people",
    "a softly blinking control console in a dim ship corridor, red alert light pulsing along the walls, no animals, no people",
    "a spacesuit glove resting on a frost-rimed airlock hatch wheel, cold blue light, no animals, no people",
    "a star-chart hologram slowly rotating above an empty console, particles drifting through the beam, no animals, no people",
    "the curved hull of a ship reflecting a distant nebula, tiny running lights along its length, no animals, no people",
  ],
  storybook: [
    "an empty castle courtyard at dawn, banners stirring in the breeze, long golden shadows, no animals, no people",
    "a single lantern glowing at the mouth of an ancient forest, fireflies drifting past, no animals, no people",
    "a stone bridge over a misty river gorge, autumn leaves tumbling in the wind, no animals, no people",
    "a windowsill in the royal library, an open storybook lit by candlelight, dust motes in the beam, no animals, no people",
    "fireworks blooming over a sleeping kingdom skyline, seen from the castle wall, no animals, no people",
  ],
  noir: [
    "a neon sign flickering above a rain-slicked city street, puddles mirroring the glow, no animals, no people",
    "a vending machine humming alone in a dim alley, its light spilling onto wet pavement, no animals, no people",
    "a rain-soaked crosswalk gleaming under a streetlamp, empty at midnight, no animals, no people",
    "a close-up of a whiskey glass catching lamplight on a desk, smoke curling past, no animals, no people",
    "the taillights of a car receding down a foggy street, red streaks on wet asphalt, no animals, no people",
  ],
};

/**
 * Deterministically pick 3 of a world's 5 insert prompts from stableHash(orderId)
 * — same reasoning as getShotMotion's finale pick: a re-assemble of the same
 * order (or a single-shot re-render, which reuses cached insertStillUrls but
 * still calls resolveWorld) must land on the same 3 subjects every time.
 * Offsets 0/1/2 from a rotating base give 3 distinct picks whenever the pool
 * has >=3 entries (all WORLD_INSERTS pools have 5).
 */
export function pickWorldInserts(world: string, orderId: string): string[] {
  const pool = WORLD_INSERTS[world] ?? WORLD_INSERTS.deepspace;
  const base = stableHash(orderId) % pool.length;
  return [0, 1, 2].map((k) => pool[(base + k) % pool.length]);
}

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
  // OPTIONAL — exactly 3 no-pet insert scene prompts (English). Absent on
  // older generatedScript records or when Claude omits the field; the film
  // pipeline treats absence as "no inserts for this order" (spec §4.3), never
  // a hard failure.
  inserts?: string[];
};

export type ResolvedWorld = {
  costume: string;
  arc: string[];
  score: string;
  loglines: { intro: string; turn: string; rise: string; tagline: string };
  // 3 no-pet insert-scene prompts, or [] when unavailable (legacy order, or a
  // custom order whose generatedScript carries no inserts) — the film
  // pipeline's EDL builder drops the insert beats gracefully in that case.
  inserts: string[];
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
      inserts: bundle.inserts ?? [],
    };
  }
  const world = order.world ?? "deepspace";
  return {
    costume: getCostume(world),
    arc: getArc(world, order.personality),
    score: WORLD_SCORES[world] ?? WORLD_SCORES.deepspace,
    loglines: getLoglines(world, order.personality, order.petName ?? undefined),
    inserts: pickWorldInserts(world, order.id),
  };
}
