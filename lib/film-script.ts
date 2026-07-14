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
 */

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
      "pausing alone on the alien ridge at sunset, then slowly straightening up, ears rising",
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
export const LOGLINES: WorldMap<{ intro: string; turn: string; rise: string; tagline: string }> = {
  deepspace: {
    brave: { intro: "THE GALAXY CALLED FOR A HERO.", turn: "SIZE WAS NEVER THE QUESTION.", rise: "THIS IS THEIR FINEST HOUR.", tagline: "TO THE STARS" },
    easygoing: { intro: "OUT PAST THE LAST STAR...", turn: "...SOMEONE FINALLY RELAXED.", rise: "THE VIEW IS BETTER SLOW.", tagline: "NO RUSH OUT HERE" },
    playful: { intro: "ZERO GRAVITY. ZERO RULES.", turn: "MISSION CONTROL LOST CONTROL.", rise: "NO SNACK IS SAFE.", tagline: "TROUBLE IN ORBIT" },
    timid: { intro: "SPACE IS VERY, VERY BIG.", turn: "AND ONE SMALL HEART GREW BRAVE.", rise: "COURAGE FINDS THE QUIET ONES.", tagline: "THE LONG WAY HOME" },
  },
  storybook: {
    brave: { intro: "A KINGDOM THAT FORGOT ITS COURAGE...", turn: "...FOUND IT IN THE SMALLEST KNIGHT.", rise: "LEGENDS COME IN EVERY SIZE.", tagline: "A TAIL OF VALOR" },
    easygoing: { intro: "IN A KINGDOM OF ENDLESS QUESTS...", turn: "...ONE HERO CHOSE THE SCENIC ROUTE.", rise: "EVERY REALM NEEDS A REST.", tagline: "THE GENTLE REIGN" },
    playful: { intro: "EVERY KINGDOM NEEDS A LEGEND.", turn: "THIS ONE GOT A MENACE.", rise: "LOCK UP THE ROYAL TARTS.", tagline: "ROYAL MISCHIEF" },
    timid: { intro: "THE FOREST WAS DARK AND DEEP...", turn: "...BUT NOT AS BRAVE AS THIS ONE.", rise: "THE SMALLEST STEP IS STILL A STEP.", tagline: "INTO THE WOODS" },
  },
  noir: {
    brave: { intro: "THE CITY NEVER SLEEPS.", turn: "NEITHER DOES THE BEST DETECTIVE IN IT.", rise: "EVERY CASE MEETS ITS MATCH.", tagline: "CASE CLOSED" },
    easygoing: { intro: "EVERY CITY HAS ITS SHADOWS...", turn: "...AND ONE GUMSHOE WHO TAKES IT SLOW.", rise: "THE TRUTH CAN WAIT FOR COFFEE.", tagline: "AFTER HOURS" },
    playful: { intro: "A CITY FULL OF MYSTERIES.", turn: "AND A DETECTIVE FULL OF NONSENSE.", rise: "THE ONLY CLUE IS CHAOS.", tagline: "THE USUAL SUSPECT" },
    timid: { intro: "THE STREETS WERE COLD AND CRUEL...", turn: "...UNTIL A SHY HEART STEPPED UP.", rise: "BRAVERY WEARS A SMALL COAT.", tagline: "OUT OF THE FOG" },
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

export function getLoglines(world: string, personality: string | null) {
  const w = LOGLINES[world] ?? LOGLINES.deepspace;
  return w[(personality as Personality) ?? "easygoing"] ?? w.easygoing;
}
