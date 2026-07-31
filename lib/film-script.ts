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
 * The six trailer text beats (TRAILER-STORY-SPEC.md §1.1) — ONE continuous
 * arc read in order, never six independent aphorisms:
 *
 *   premise  opening card. WHAT IS HAPPENING — the situation/event that sets
 *            the story going (an event, not a mood: "the fish are vanishing",
 *            not "the city never sleeps"). OPTIONAL for backward compat (§1.2)
 *   intro    the hero arrives — the world plus who they are
 *   turn     the turn — what the hero sets out to do
 *   rise     the stakes — what stands in the way
 *   tagline  the title punch, shown with the pet's name
 *   stinger  closing joke/warm beat, shown AFTER the title card. OPTIONAL,
 *            same backward-compat reasoning as premise
 *
 * `premise`/`stinger` are OPTIONAL on this type (not on the preset data below,
 * which always fills all six) because a Director's Cut order's generatedScript
 * predating this feature — or a Claude response that omits them despite the
 * system prompt asking firmly — must still resolve to a valid film: the film
 * pipeline's EDL builder falls back to the pre-existing four-card cut whenever
 * either is missing (lib/film-pipeline.ts's EDL_TEMPLATE_LEGACY), never throws.
 */
export type Loglines = {
  premise?: string;
  intro: string;
  turn: string;
  rise: string;
  tagline: string;
  stinger?: string;
};

// {name} is filled with the pet's name at render time (see getLoglines) — woven
// into "turn" (and sometimes "stinger") so the trailer names the star
// mid-story, not only on the cards. Authored in caps (the display font is
// uppercase-only) and kept punchy; taglines stay name-free (the closing card
// shows the name right above them).
//
// All 12 sets below fill EVERY field (Required<Loglines>, not just the type's
// optional minimum) because presets are static, curated data — there is no
// reason for a preset order to ever fall back to the four-card cut. Each
// `premise` states a concrete situation/event specific to that world (never a
// restatement of mood), and each `stinger` is a joke or warm beat that only
// works because the star is an animal — see TRAILER-STORY-SPEC.md §2.1.
//
// Keep the stingers structurally VARIED, not just textually different: an
// earlier pass had eleven of the twelve opening on "{name} STILL ...", which
// is one joke wearing twelve costumes (and two of them landed on the same
// sleeps-with-the-light-on gag in different worlds). The shapes in use now —
// the ironic "STILL", a deadpan report ("THE PRETZELS WERE NEVER RECOVERED."),
// an imperative ("CHECK THE CROWN FOR CRUMBS."), a flat concession ("BRAVE
// ENOUGH. BY DAYLIGHT.") — should stay mixed when any of these are edited.
export const LOGLINES: WorldMap<Required<Loglines>> = {
  deepspace: {
    brave: {
      premise: "THE LAST OUTPOST HAS GONE DARK.",
      intro: "THE GALAXY CRIED OUT FOR A HERO.",
      turn: "IT NEVER EXPECTED {name}.",
      rise: "COURAGE NEVER ASKED YOUR SIZE.",
      tagline: "TO THE STARS AND BACK",
      stinger: "THE COCKPIT CAME WITH A BOOSTER SEAT.",
    },
    easygoing: {
      premise: "THE ENTIRE FLEET IS RACING FOR THE FRONTIER.",
      intro: "OUT PAST THE LAST STAR...",
      turn: "...{name} FOUND THE SLOW LANE.",
      rise: "THE VIEW IS BETTER SLOW.",
      tagline: "NO RUSH OUT HERE",
      stinger: "ARRIVAL TIME: EVENTUALLY.",
    },
    playful: {
      premise: "THE SPACE STATION'S SUPPLIES KEEP DISAPPEARING.",
      intro: "ZERO GRAVITY. ZERO RULES.",
      turn: "THEN {name} FLOATED IN.",
      rise: "NO SNACK IN ORBIT IS SAFE.",
      tagline: "TROUBLE IN ORBIT",
      stinger: "THE PRETZELS WERE NEVER RECOVERED.",
    },
    timid: {
      premise: "A LITTLE SHIP DRIFTED OFF COURSE, ALONE.",
      intro: "SPACE IS VERY, VERY BIG.",
      turn: "AND {name} IS VERY SMALL.",
      rise: "BUT COURAGE FINDS THE QUIET ONES.",
      tagline: "THE LONG WAY HOME",
      stinger: "THE CABIN LIGHT STAYS ON. NON-NEGOTIABLE.",
    },
  },
  storybook: {
    brave: {
      premise: "A DRAGON HAS TAKEN THE HIGH TOWER.",
      intro: "A KINGDOM THAT FORGOT ITS COURAGE...",
      turn: "...UNTIL {name} STOOD UP.",
      rise: "LEGENDS COME IN EVERY SIZE.",
      tagline: "A TAIL OF VALOR",
      stinger: "THE KINGDOM WOULD LIKE ITS SLIPPER BACK.",
    },
    easygoing: {
      premise: "THE KING HAS CALLED FOR ONE LAST GREAT QUEST.",
      intro: "IN A KINGDOM OF ENDLESS QUESTS...",
      turn: "...{name} CHOSE THE SCENIC ROUTE.",
      rise: "EVERY REALM NEEDS A REST.",
      tagline: "THE GENTLE REIGN",
      stinger: "THE QUEST CAN WAIT UNTIL AFTER THE NAP.",
    },
    playful: {
      premise: "THE ROYAL TARTS KEEP VANISHING BEFORE EVERY FEAST.",
      intro: "EVERY KINGDOM NEEDS A LEGEND.",
      turn: "THIS ONE GOT {name}.",
      rise: "LOCK UP THE ROYAL TARTS.",
      tagline: "ROYAL MISCHIEF",
      stinger: "CHECK THE CROWN FOR CRUMBS.",
    },
    timid: {
      premise: "SOMETHING HAS BEEN WATCHING THE CASTLE GATES AT NIGHT.",
      intro: "THE FOREST WAS DARK AND DEEP...",
      turn: "...BUT NOT {name}.",
      rise: "THE SMALLEST STEP IS STILL A STEP.",
      tagline: "INTO THE WOODS",
      stinger: "BRAVE ENOUGH. BY DAYLIGHT.",
    },
  },
  noir: {
    brave: {
      premise: "SOMETHING IS MISSING FROM THIS CITY.",
      intro: "THE CITY NEVER SLEEPS.",
      turn: "NEITHER DOES {name}.",
      rise: "EVERY CASE MEETS ITS MATCH.",
      tagline: "CASE CLOSED",
      stinger: "{name} STILL CAN'T REACH THE DOORKNOB.",
    },
    easygoing: {
      premise: "A CASE HAS GONE COLD FOR TEN YEARS.",
      intro: "EVERY CITY HAS ITS SHADOWS...",
      turn: "...{name} TAKES IT SLOW.",
      rise: "THE TRUTH CAN WAIT FOR COFFEE.",
      tagline: "AFTER HOURS",
      stinger: "THE COFFEE OUTLASTED THE CASE.",
    },
    playful: {
      premise: "SOMEONE HAS BEEN RANSACKING EVERY TRASH CAN IN TOWN.",
      intro: "A CITY FULL OF MYSTERIES.",
      turn: "AND {name}: PURE NONSENSE.",
      rise: "THE ONLY CLUE IS CHAOS.",
      tagline: "THE USUAL SUSPECT",
      stinger: "NO ARRESTS. NO REMORSE.",
    },
    timid: {
      premise: "A WITNESS WENT MISSING SOMEWHERE IN THE FOG.",
      intro: "THE STREETS WERE COLD AND CRUEL...",
      turn: "...UNTIL {name} STEPPED UP.",
      rise: "BRAVERY WEARS A SMALL COAT.",
      tagline: "OUT OF THE FOG",
      stinger: "{name} STILL FLINCHES AT THUNDER.",
    },
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
 * Start+end frame interpolation targets (FILM-QUALITY-V3-SPEC.md §5.2) — the
 * deliberate counterpart to SHOT_MOTIONS above. Where SHOT_MOTIONS describes
 * small alive-ness WITHIN one still frame, this describes a small, ONE-CHANGE
 * pose delta between the customer-approved START frame and a to-be-generated,
 * identity-gated END frame; the video model's only job for that cut becomes
 * interpolating the two approved stills instead of inventing motion.
 *
 * `null` means "not enrolled" — that cut stays on today's single-frame i2v
 * path unchanged (film-pipeline.ts checks this array and skips end-frame
 * generation entirely for a null entry, spec §5.4 item c).
 *
 * SAME yaw ban as getShotMotion, same reason: the identity reference is a
 * front-facing still, so any pose delta that rotates the head/body around the
 * vertical axis exposes geometry the gate never saw and invites drift. Keep
 * each enabled entry to exactly ONE small change (a step, a stand, a chin
 * lift, a raised paw) — start and end drifting too far apart gives the video
 * model two dissimilar anchors to reconcile, and it morphs between them
 * (visibly "un-dogging" mid-clip) instead of interpolating cleanly.
 *
 * STAGED ROLLOUT (spec §5.4): only the two cuts where real action matters most
 * are enabled at launch —
 *   - cut 2 (index 1): SHOT_FRAMINGS[1] is the one framing actually composed
 *     to SHOW full-body action, so it's the best return on the extra
 *     end-frame spend.
 *   - cut 6 (index 5): the climax — the last thing the audience sees, worth
 *     spending the one extra still on.
 * Widening the rollout (or narrowing it back) is a one-line edit: flip an
 * entry between `null` and a pose string. Do NOT enable all six at once.
 */
/*
 * TUNING, honestly: there are two ways to waste this feature, and the failure
 * modes pull in opposite directions. Too small a delta and the two anchors are
 * near-identical, so the interpolation is a static shot with an extra still's
 * cost attached — which is the whole reason the trailer felt dead before. Too
 * large and the model morphs between mismatched anchors. Where the line sits
 * cannot be reasoned out in advance; it has to be looked at. So the poses
 * below are written to be UNMISTAKABLE at a glance while holding framing and
 * head direction fixed, and the admin page shows the start and end frames side
 * by side (app/admin/[orderId]) so the two can actually be compared before
 * spending on video. Weaken them if morphing appears; strengthen them if the
 * pair looks like the same photograph twice.
 */
export const SHOT_END_POSES: (string | null)[] = [
  null, // cut 1 — opening hero shot: safest framing, stays static
  // Distinct from cut 6's below, on purpose. Both originally ended on a
  // raised front paw, and seeing them side by side in admin the owner spotted
  // it at once — two cuts in the same film resolving into the same gesture
  // reads as the pipeline having one idea, not as two moments. This one moves
  // the whole body through space; cut 6's rises in place.
  "the pet has walked a clear stride closer to the camera and now fills noticeably more of the frame, all four paws planted, head still square to the camera",
  null, // cut 3
  null, // cut 4
  null, // cut 5
  "the pet has risen into a full hero stance — chest lifted and pushed forward, head raised high, one front paw clearly off the ground mid-stride, mouth closed, face still toward the camera",
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

/**
 * Custom (Director's Cut) inserts fallback (FILM-QUALITY-V3-SPEC.md §3.3).
 *
 * Preset orders always get 3 inserts (pickWorldInserts, above, draws from the
 * fixed WORLD_INSERTS pool). Custom orders only get inserts if Claude's
 * generatedScript happened to include an `inserts` array — and since that
 * field was added AFTER inserts already existed in the schema, any custom
 * order scripted before that point (or any run where Claude just omits the
 * field) has `bundle.inserts` empty and resolveWorld had no fallback: the
 * $249 tier — the one that's supposed to feel the most bespoke — ends up
 * with ZERO B-roll while every $-cheaper preset order gets 3.
 *
 * Fix: derive 3 "empty scene" prompts straight from the custom order's OWN
 * cuts instead of a static pool (there is no static pool for custom worlds).
 * `bundle.cuts[].scene` already describes a place ("the starship bridge",
 * "a rain-slicked alley") as part of an action beat — strip the action/pet
 * out of the sentence at the prompt level (the "empty scene, no animals, no
 * people" wrapper below does that) and what's left reads as atmospheric
 * B-roll of the same world, no new Claude call needed.
 *
 * Picks are DETERMINISTIC (same reasoning as pickWorldInserts/getShotMotion):
 * `stableHash(orderId)` chooses a start index into `cuts`, then 3 picks are
 * spread evenly from there (wrapping), so a re-assemble or single-shot
 * re-render of the same order always derives the same 3 insert subjects.
 * generateInsertStill() already folds "no animals/people" into every prompt
 * (see lib/film-pipeline.ts), so no extra dependency is introduced here.
 *
 * Never throws: fewer than 3 cuts returns as many distinct picks as exist
 * (or [] for zero), matching the mandatory "no inserts -> 60s without them"
 * degradation path — a malformed custom script must still produce a film.
 */
export function deriveCustomInserts(cuts: { scene: string }[], orderId: string): string[] {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  const n = Math.min(3, cuts.length);
  const start = stableHash(orderId) % cuts.length;
  // Evenly spaced indices starting at `start`, wrapping around `cuts.length`
  // (e.g. 6 cuts / 3 picks -> offsets 0, 2, 4). Rounded because cuts.length
  // isn't guaranteed to divide evenly by 3 on malformed/legacy data.
  const step = cuts.length / n;
  const indices = Array.from(new Set(Array.from({ length: n }, (_, k) => (start + Math.round(k * step)) % cuts.length)));
  return indices.map((i) => `the setting of: ${cuts[i].scene} — empty scene, no animals, no people`);
}

/** At most this many of the 6 cuts may carry a Claude-authored end pose — see resolveCustomEndPoses. */
const MAX_CUSTOM_END_POSES = 3;

/**
 * Validates + caps a custom order's Claude-authored `endPoses` (spec §5,
 * WorldBundle.endPoses doc above) before resolveWorld hands them to the film
 * pipeline. Mirrors deriveCustomInserts's "never throw, degrade to a safe
 * default" posture, but the default here is SHOT_END_POSES rather than an
 * empty result — an end-pose-less custom order should behave exactly like a
 * preset order (spec's explicit fallback), not like one with zero B-roll.
 *
 * Two independent failure modes are handled, both by falling back rather than
 * throwing (a malformed generatedScript must still produce a film):
 *
 * 1. WRONG SHAPE ENTIRELY — not an array, wrong length, or an entry that
 *    isn't `null`/a non-empty string (e.g. a legacy generatedScript predating
 *    this field, where `endPoses` is simply absent, or a model response that
 *    got the schema wrong despite the forced tool call). No per-entry
 *    salvage is attempted here — a bundle that's the wrong shape at all is
 *    treated as "not provided", same as the field being absent.
 *
 * 2. TOO MANY ENROLLED — the "at most 3 of 6" cap from the schema
 *    description is a prompt-level ask, not a runtime guarantee, so a model
 *    that fills in all 6 must be TRIMMED, not trusted. The trim keeps the
 *    FIRST N (in cut order) and nulls out the rest — deterministic, so
 *    runShotRerender re-assembling this order later (spec §7) always lands
 *    on the same enrolled cuts. It must NOT depend on which entries happen to
 *    look "most important", array iteration order, or anything else that
 *    could vary between the original run and a later re-render.
 */
function resolveCustomEndPoses(bundle: WorldBundle): (string | null)[] {
  const raw = bundle.endPoses;
  const isValidShape =
    Array.isArray(raw) &&
    raw.length === 6 &&
    raw.every((p) => p === null || (typeof p === "string" && p.trim().length > 0));
  if (!isValidShape) return SHOT_END_POSES;

  let enrolledSoFar = 0;
  return raw.map((pose) => {
    if (pose === null) return null;
    enrolledSoFar += 1;
    return enrolledSoFar <= MAX_CUSTOM_END_POSES ? pose.trim() : null;
  });
}

export function getArc(world: string, personality: string | null): string[] {
  const w = FILM_SCRIPTS[world] ?? FILM_SCRIPTS.deepspace;
  return w[(personality as Personality) ?? "easygoing"] ?? w.easygoing;
}

export function getCostume(world: string): string {
  return WORLD_COSTUMES[world] ?? WORLD_COSTUMES.deepspace;
}

/**
 * Replace the `{name}` placeholder with the pet's name, upper-cased to match
 * the trailer's card style (Japanese names are unaffected by upcasing).
 *
 * Shared because it is needed in two places that are easy to forget are
 * related: the loglines, and Claude's `treatmentText`. It was applied only to
 * loglines at first, so a customer opening the approval gate read
 * `タイトルは「{name} AND THE LAST GREAT SPELL」` — a raw template token sitting
 * in the prose they are being asked to sign off. Anything rendering
 * Claude-authored copy should go through this.
 */
export function fillPetName(text: string, petName: string | null | undefined): string {
  const name = (petName ?? "").trim().toUpperCase() || "OUR HERO";
  return text.replace(/\{name\}/g, name);
}

export function getLoglines(world: string, personality: string | null, petName?: string): Required<Loglines> {
  const w = LOGLINES[world] ?? LOGLINES.deepspace;
  const l = w[(personality as Personality) ?? "easygoing"] ?? w.easygoing;
  const fill = (s: string) => fillPetName(s, petName);
  // premise/stinger get the SAME {name} substitution as the other four beats
  // (TRAILER-STORY-SPEC.md §6 item 6) even though none of the 12 preset
  // premises currently use {name} — the mechanism must work uniformly so a
  // future copy edit (or a custom order routed through the same fill logic
  // below in resolveWorld) can rely on it without a second code path.
  return {
    premise: fill(l.premise),
    intro: fill(l.intro),
    turn: fill(l.turn),
    rise: fill(l.rise),
    tagline: fill(l.tagline),
    stinger: fill(l.stinger),
  };
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
  // Trailer text beats; {name} allowed. premise/stinger are OPTIONAL (see
  // Loglines doc) — absent on older generatedScript records, or when Claude's
  // output omits them despite the system prompt asking firmly for both
  // (TRAILER-STORY-SPEC.md §3.1/§3.2). The film pipeline falls back to the
  // pre-existing four-card EDL whenever either is missing; it never throws.
  loglines: Loglines;
  // OPTIONAL — exactly 3 no-pet insert scene prompts (English). Absent on
  // older generatedScript records or when Claude omits the field; the film
  // pipeline treats absence as "no inserts for this order" (spec §4.3), never
  // a hard failure.
  inserts?: string[];
  // OPTIONAL — story-aware end poses for the start+end interpolation feature
  // (spec §5). Parallel to `cuts`, same 6-length, same index alignment:
  // endPoses[i] is the ONE-CHANGE pose delta for cuts[i]'s end frame, or
  // `null` if that cut stays on the ordinary single-frame i2v path. See
  // SHOT_END_POSES above for the full pose-writing rules this must also
  // follow (yaw ban, one obvious change, at most 3 of 6 enrolled).
  //
  // Why this exists at all, when SHOT_END_POSES already covers preset
  // orders: SHOT_END_POSES is two fixed strings applied to EVERY order
  // regardless of story. The production film that validated start+end
  // interpolation was a Director's Cut whose brief ended with the pet
  // falling asleep beside the dragon — but SHOT_END_POSES[5] ("rises into a
  // full hero stance") made the trailer's LAST image the pet standing up out
  // of the ending the customer asked for. The mechanism (identity-gated end
  // frame -> clean interpolation) was proven correct; the poses were
  // story-blind. Only Claude knows what a given cut's beat is FOR, because it
  // wrote the cut — so for custom orders, the end pose has to be authored
  // alongside the cuts themselves rather than pulled from a static table.
  //
  // Absent, or the wrong shape entirely -> resolveWorld falls back to
  // SHOT_END_POSES, same posture as every other optional field on this type
  // (never throw). See resolveWorld's endPoses resolution, below.
  endPoses?: (string | null)[];
  // Admin-only Japanese reading of `loglines`, authored by Claude alongside
  // them (lib/claude-script.ts). NEVER rendered into a film and never shown
  // to a customer — the cards stay English, and Bebas Neue is Latin-only
  // anyway. It exists so the operator, who reads Japanese, can tell whether a
  // card matches the footage it sits between before approving the film. The
  // preset equivalent is the static LOGLINES_JA table in film-script-ja.ts.
  loglinesJa?: Partial<Loglines>;
};

export type ResolvedWorld = {
  costume: string;
  arc: string[];
  score: string;
  // Same premise/stinger-optional shape as WorldBundle.loglines above — the
  // film pipeline is the single place that decides what "absent" means for
  // the EDL (four-card fallback), so this resolver never fills in a fake
  // premise/stinger just to satisfy a stricter type.
  loglines: Loglines;
  // 3 no-pet insert-scene prompts, or [] when unavailable (legacy order, or a
  // custom order whose generatedScript carries no inserts) — the film
  // pipeline's EDL builder drops the insert beats gracefully in that case.
  inserts: string[];
  // Always a full 6-entry (string | null)[], same shape as SHOT_END_POSES —
  // preset orders get SHOT_END_POSES unchanged; custom orders get Claude's
  // own endPoses (validated + capped, see resolveCustomEndPoses) when
  // present, or SHOT_END_POSES as a fallback otherwise. film-pipeline.ts
  // reads this instead of importing SHOT_END_POSES directly so the
  // preset/custom branch stays in this one function.
  endPoses: (string | null)[];
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
    const fill = (s: string) => fillPetName(s, order.petName);
    // premise/stinger are OPTIONAL on WorldBundle (absent on pre-feature
    // generatedScript records, or when Claude's output omits them) — fillOpt
    // preserves "absent" as undefined rather than substituting into an empty
    // string, so the film pipeline's presence check (both fields present ->
    // six-card EDL) sees a real absence, not a blank card.
    const fillOpt = (s: string | undefined) => (s ? fill(s) : undefined);
    return {
      costume: bundle.costume,
      arc: bundle.cuts.map((c) => c.scene),
      score: bundle.score,
      loglines: {
        premise: fillOpt(bundle.loglines.premise),
        intro: fill(bundle.loglines.intro),
        turn: fill(bundle.loglines.turn),
        rise: fill(bundle.loglines.rise),
        tagline: fill(bundle.loglines.tagline),
        stinger: fillOpt(bundle.loglines.stinger),
      },
      // §3.3 fallback: Claude-authored inserts win when present; otherwise
      // derive 3 empty-scene prompts from this order's own cuts rather than
      // leaving the $249 tier with zero B-roll (see deriveCustomInserts).
      inserts: bundle.inserts?.length ? bundle.inserts : deriveCustomInserts(bundle.cuts, order.id),
      // §5 fallback: Claude's own story-aware endPoses win when present and
      // valid (capped to at most 3 enrolled cuts); otherwise fall back to the
      // same static SHOT_END_POSES a preset order uses, so a custom order
      // whose generatedScript predates this field — or a malformed one —
      // still gets the mechanism, just with generic poses instead of
      // story-aware ones (see resolveCustomEndPoses).
      endPoses: resolveCustomEndPoses(bundle),
    };
  }
  const world = order.world ?? "deepspace";
  return {
    costume: getCostume(world),
    arc: getArc(world, order.personality),
    score: WORLD_SCORES[world] ?? WORLD_SCORES.deepspace,
    loglines: getLoglines(world, order.personality, order.petName ?? undefined),
    inserts: pickWorldInserts(world, order.id),
    // Preset orders are untouched by this feature — always the static table.
    endPoses: SHOT_END_POSES,
  };
}
