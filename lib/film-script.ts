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

/**
 * One locked costume per world — identical across every shot of a film.
 *
 * NOTHING GOES OVER THE FACE. A helmet, visor, mask or goggles forces every
 * generator to re-draw the face through it, and the reflections, distortion
 * and edges take the fur texture and eye shape down with them — the exact
 * signal the customer is paying to recognize. deepspace used to specify a
 * clear glass helmet; the astronaut read now comes from an open locking
 * collar ring instead, which says "spacesuit" without covering anything.
 *
 * LORA-STORYBOARD-SPEC.md §1.6(a)/§3: B1 (the LoRA take generator) holds the
 * SAME costume across cuts less reliably than the old nano-banana chain did —
 * "the same general kind of outfit" instead of "the identical outfit". The
 * deepspace collar specifically wobbled between a rigid metal ring and soft
 * fabric, and the suit occasionally grew a flag patch or an extra
 * harness/strap the reference never showed. §3's fix (prompt-only, no gating
 * yet) is to name every wobbling element explicitly and forbid additions —
 * each string below now states its material/count where that matters and
 * closes with an explicit "nothing else" clause.
 */
export const WORLD_COSTUMES: Record<string, string> = {
  deepspace:
    "wearing a fitted white astronaut suit with orange trim, a small mission patch on the chest, and a rigid open metal collar ring — not soft fabric or cloth — at the neck where a helmet would lock on, head bare and fully visible. No national flag patch, no extra chest harness, no additional straps or belts beyond what is described here.",
  storybook:
    "wearing a deep-blue velvet knight's cloak with silver trim and exactly one small round silver clasp at the throat. No additional emblems, sashes, medallions or armor pieces beyond what is described here.",
  noir:
    "wearing a tan belted trench coat with the collar turned up and exactly one belt at the waist, head bare and fully visible. No additional scarf, harness or accessories beyond what is described here.",
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

/**
 * Six action/setting beats per arc (NO costume words — costume is locked).
 *
 * THREE RULES, all learned from real storyboards the owner rejected.
 *
 * 1. WRITE THE DECISIVE INSTANT, NOT THE BLUR. These beats generate a single
 *    frame; the video model animates from that frame afterwards. This rule
 *    used to ban any hint of motion at all ("mid-pounce", "sliding across",
 *    "spinning", "in a blur of paws") because asking an image model for the
 *    true middle of a movement is where diffusion produces contorted,
 *    unreadable bodies — at the one stage that cannot animate anything.
 *    TRAILER-STORY-V3-SPEC.md §2(e) explicitly overwrites that ban: the
 *    Director's Cut trailer this rule produced never depicted an event
 *    happening — six shots of standing, sitting, looking, standing, standing,
 *    sleeping — because nothing here asked for one. A beat may now name the
 *    decisive, photojournalistic peak of an action already underway — not
 *    "sliding after a rolling donut" but "one paw on the donut it has finally
 *    cornered" (that example was always compliant); now also things like
 *    "caught mid-run, front paws off the ground" or "rears up on its hind
 *    legs, both front paws braced against the wheel's rim". What's still
 *    banned is the blurred, transitional middle (spinning, sliding, a blur of
 *    paws) — diffusion still can't resolve that — the peak itself must be a
 *    held, readable pose. The energy survives; the anatomy does too, and the
 *    video stage still has somewhere to go.
 *
 * 2. NOTHING BETWEEN THE CAMERA AND THE FACE. Same principle as
 *    WORLD_COSTUMES' no-helmet rule, applied to the scene: venetian blinds,
 *    fabric wrapped over the pet, frosted glass. Anything crossing the face
 *    costs the fur texture and eye shape, which is the whole product. A beat
 *    that wants blinds opens them; a beat that wants an oversized coat lets it
 *    pool on the floor rather than swallow the animal.
 *
 * 3. NO SECOND ANIMAL IN FRAME. The pet is drawn by a LoRA trained to make
 *    one specific animal THE animal in the picture; put a pigeon or a cat
 *    beside it and the model has two candidates for that role, and blends
 *    them. This is the same failure as LORA-STORYBOARD-SPEC.md §1.3's — a
 *    generator resolving an ambiguity about which creature it is drawing —
 *    just introduced by the scene instead of by the reference images. A beat
 *    that wants another creature puts it far off, outside glass, or implied
 *    (a parade the pet is imagining); it never shares the pet's space.
 *
 * The noir/playful arc broke all three at once and produced takes where the
 * dog could not be located in the frame at all. The anatomy gate does not
 * catch any of it — it counts legs, and a heap of fabric has none to
 * miscount, while a dog-cat hybrid has exactly four.
 */
export const FILM_SCRIPTS: WorldMap<string[]> = {
  deepspace: {
    brave: [
      "In the engine bay, a coolant conduit has ruptured overhead, spraying a fan of glittering frozen vapor across the room as warning lights flick on along the walls; the small dog stands frozen mid-step, ears up, staring at the spreading white cloud",
      "In the same engine bay, the vapor has thickened into a rolling frost bank creeping across the floor plates and climbing a support strut, ice already crusting a nearby control box; the pet backs half a stride away, one paw lifted off the frosted deck",
      "In a corridor leading from the engine bay, the frost has raced ahead along the floor seam and the console lights down the hall are flipping red one by one into the distance; the pet is caught mid-run, front paws off the ground, chasing the spreading line",
      "Back at the engine bay's main coolant valve, its wheel half-frozen shut, the pet rears up on its hind legs with both front paws braced hard against the wheel's rim, the frost cloud still pouring out beside it, muscles bunched with effort",
      "At that same valve, the wheel now turned a further quarter-turn under the pet's braced weight, ice cracking off in shards and the vapor jet visibly thinning to a wisp, the pet still straining with one paw pressed flat against the metal",
      "In the now-quiet engine bay, frost melting to droplets on the walls and the lights steady, the pet lies curled and settled on a folded silver thermal blanket in the corner, eyes closed, breathing slow",
    ],
    easygoing: [
      "a small potted seedling in a cracked glass greenhouse dome sits on a windowsill shelf, the pet paused beside it with one paw braced on the shelf edge, frost creeping across the dome's outer pane",
      "the pet nose to nose with the cracked dome, breath fogging faintly, a thin line of frost spreading further across the glass behind the seedling",
      "the pet dragging a folded silver thermal blanket across the corridor floor by its corner, the greenhouse dome visible ahead through an open hatchway, frost now covering half the glass",
      "the pet rearing up on hind legs against the shelf, both front paws pressed flat against the thermal blanket half-draped over the cracked dome, muscles set, the seedling still exposed at one corner",
      "the pet standing back with the blanket now fully sealed edge to edge over the dome with both paws pressing the last corner down, warm amber light glowing faintly from beneath the covered shelf",
      "the pet curled asleep on a folded jacket beside the softly glowing covered dome, the corridor lights dimmed to a warm night setting",
    ],
    playful: [
      "in the ship's cargo bay, one paw batting a loose zero-gravity storage canister off its shelf clamp, the canister already tipping free in midair",
      "the canister cracked open against a support strut, a cloud of silvery magnetic ball-bearings spilling out and bouncing across the floor in every direction",
      "in the corridor outside cargo bay, skidding on the scattered bearings underfoot, one back leg thrown out sideways for balance as a bearing rolls into an open floor grate",
      "sparks spitting from the floor grate where a bearing has jammed the mechanism, the pet's two front paws braced hard against the grate's edge, pressing it back down",
      "in the corridor, both front paws pinning the grate flush to the floor, chest pressed low to the deck, sparks reduced to a last few dying flickers beside its face",
      "curled up triumphantly atop the now-sealed floor grate, one silvery bearing clutched between both front paws like a trophy, tail relaxed and eyes bright",
    ],
    timid: [
      "in the ship's cramped comms closet, the pet frozen still, ears low, as a wall-mounted speaker grille sparks and crackles with a garbled distress signal looping over and over",
      "backed against a supply locker in a narrow corridor, one paw lifted off the floor, staring at a service hatch across from it where the metal is bowing inward with a slow groaning dent",
      "in the engine bay, the pet pressed flat behind a support strut as a loose overhead cable whips sparks across the floor in front of the open path forward",
      "close on the pet's paw pressed flat against a recessed wall panel, the comms hatch beside it sealed shut and its warning strip switched from red to steady amber",
      "in the corridor, the pet mid-step over the bowed and now-buckled hatch threshold, one front paw planted past it on the far side, body leaning forward into the dark beyond",
      "curled on the pilot's seat cushion on the bridge, eyes closed, the viewport beyond showing calm stars, the ship's console lights glowing soft and steady",
    ],
  },
  storybook: {
    brave: [
      "on the stone bridge over the river gorge, one plank already split and hanging, front paws planted at the very edge as the far support post leans outward over the mist",
      "the bridge's rope line snapping loose in a spray of frayed fiber, the whole span tilting a visible degree further, the pet's weight thrown backward bracing against a stone post",
      "in the wildflower meadow at the gorge's near end, teeth closed around a thick coil of spare rope pulled taut from a supply cart, hind legs dug into the dirt",
      "back on the tilting bridge, the rope now looped hard around a jutting rock, the pet's whole body leaning against the strain with the broken plank half-lifted back into place",
      "shoulder driven into the last loose plank, front paws braced flat against the stone rail, the gap beneath it nearly closed but the post still leaning, outcome unresolved",
      "curled asleep on a cushion of banners in the castle courtyard at dusk, the mended bridge visible small in the distance, eyes closed, breathing slow",
    ],
    easygoing: [
      "the pet trotting along a wildflower meadow path at golden late afternoon, a paper lantern balloon on a long ribbon bobbing above the flowers, one paw lifted mid-stride toward it",
      "the pet's head tipped back watching the lantern balloon's ribbon slip free of a leaning wooden stake and lift away on the wind, storm-grey clouds massing beyond the treeline",
      "the pet bounding uphill through tall grass on a meadow slope, ears flattened by the wind, the lantern balloon now small and drifting toward the ancient forest tree line",
      "the pet reared up on hind legs against the trunk of an old oak at the forest edge, one forepaw stretched high, catching the trailing ribbon just above the grass",
      "the pet planted firmly with all four paws braced in the grass, the ribbon clamped in its teeth, the balloon straining sideways as the first raindrops begin to streak past",
      "the pet curled up asleep on a cushioned window seat in the royal library, the paper lantern balloon tied safely to the bedpost beside it, candlelight glowing warm over its closed eyes",
    ],
    playful: [
      "in the royal library, front paws braced on a low shelf as a tall stack of leather-bound books teeters at the very top, one paw already knocking the corner volume loose",
      "in the castle courtyard, standing frozen with ears back as a cascade of scrolls and books tumbles past a startled row of ceremonial banner poles, one pole tipping sharply",
      "on the stone bridge over the river gorge, watching a runaway wooden cart loaded with the fallen books rolling toward the low bridge rail, wheels caught mid-turn",
      "sprinting along the bridge rail with front legs stretched full length, one paw reaching to hook the cart's trailing rope before it clears the edge",
      "braced low with all four paws dug in and the rope clenched, body weight thrown backward, the cart's front wheel stopped just short of the bridge's broken edge",
      "curled up asleep on a pile of rescued books in a sunlit meadow clearing, cart resting harmlessly on its side nearby, wildflowers nodding overhead",
    ],
    timid: [
      "in the royal library at dusk, ears back, staring at a tall iron candelabra as its flame gutters and throws a huge shifting shadow across the shelves",
      "backing away between two bookcases, tail tucked low, as loose parchment pages skitter across the floor in a draft from a cracked window",
      "at the library's arched doorway, one paw lifted mid-retreat, eyes wide on the smoke now curling along the ceiling beams from a toppled candle",
      "crouched low at the edge of a thick rug, front paws braced, hauling one corner of it across the floor toward the small spreading flame",
      "standing with both front paws planted firmly on the now-smothered rug, chest heaving, smoke thinning around it, the fire beneath fully out",
      "curled proudly on the windowsill beside the same candelabra, now unlit, moonlight and calm fireflies drifting past the glass outside, eyes closed",
    ],
  },
  noir: {
    brave: [
      "on a rain-slicked rooftop ledge, the pet frozen mid-step as a rooftop water tower's support strut snaps and the wooden tank lurches sideways above the street below",
      "on the fire escape one level down, the pet braced with both front paws planted on the rusted railing as a spray of water bursts from the tank's split seam overhead, already sheeting down the building face",
      "in the narrow alley below, the pet running full stride along a growing river of runoff, a shop awning collapsing under the weight of falling water just behind it",
      "at a service alley junction, the pet with its shoulder driven hard against a rusted valve wheel on a drainage main, muscles bunched, the wheel caught only halfway turned",
      "at the same valve station, the pet still straining with both front paws now hauling the wheel the last of the way, water noticeably slowing to a trickle down the wall beside it",
      "back on the rooftop at first grey light, the pet sitting calmly beside the now-drained, tilted water tower, looking out over the quiet, dripping skyline",
    ],
    easygoing: [
      "a small dog sits at a rooftop ledge above the city, one paw resting on a wilting potted flower box, petals scattering in a rising wind",
      "the pet trots along a fire escape past a newsstand awning as the vendor's paper city map is torn loose and sails off into the dark",
      "the pet stretches one paw up a drainpipe toward a single lit window across the gap, the last dry patch of ledge narrowing as rain starts to fall",
      "soaked and bracing against the wind on a narrow ledge, the pet has both front paws clamped down on the corner of the torn map pinned under a loose brick",
      "the pet hauls the flattened map through a cracked window into a warm office, water sheeting off its coat onto the floorboards",
      "curled on a leather armchair beside a crackling radiator, the recovered map spread flat and drying on the desk under lamplight, eyes drifting shut",
    ],
    playful: [
      "the small dog nudges a stack of evidence boxes in a cluttered records room, one box already sliding off the top of the pile",
      "the toppled box has burst open on the floor, loose case files fanned everywhere and a single overturned inkwell rolling toward a heating vent",
      "the rolling inkwell tips into the vent and black smoke begins curling up through the grate behind the pet",
      "the pet drags a fire bucket by its handle across the office floor, muscles braced, the bucket lip scraping sparks off the floorboards",
      "the pet plants both front paws on the bucket's rim, body weight thrown forward, water arcing toward the smoking vent, the outcome still hanging",
      "the pet slumped happily across the now-empty bucket in a puddle of soapy water, case files stacked neatly and dry beside it, streetlight through the blinds striping the floor",
    ],
    timid: [
      "the small dog frozen at the mouth of a narrow alley, ears pinned back, as a cracked water main sends a black flood surging over broken cobblestones toward a storm drain",
      "the pet backed against a brick wall, one paw lifted off the ground, staring at the rising water now lapping at a stack of sandbags leaning half-collapsed against a basement door",
      "the pet crouched low behind a toppled trash can as the flood pushes it scraping across the wet pavement, the basement door beyond it bowing inward under the pressure",
      "the pet's paws planted wide in the shallow water, head down, shoulder braced hard against the buckling basement door with the flood swirling around its legs",
      "the pet standing upright with both front paws pressed flat against the now-sealed door, the water behind it visibly settled and calm around a jammed wooden brace",
      "the pet curled on a folded newspaper in the dry doorway, eyes closed, chin resting on its own paws as steam rises faintly off the quiet street beyond",
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
// into "intro" (every one of the 12 sets) and usually "rise" too, so the
// trailer names the star early and again as it acts, not only on the cards.
// "turn" and "stinger" name the pet only occasionally now — CARD_RULES
// (TRAILER-STORY-V3-SPEC.md §3) reassigned "turn" to state what got worse
// (an event, often nobody's fault yet) rather than what the pet did about it,
// so the name naturally lands where the pet is introduced or acts, not where
// the situation itself is deteriorating. Authored in caps (the display font is
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
// sleeps-with-the-light-on gag in different worlds). The current set (the
// TRAILER-STORY-V3-SPEC.md draft, hand-deduped per preset-story-draft.ts's own
// header) leans a different direction and needs watching for a different kind
// of sameness: 7 of the 12 are now a two-clause deadpan report ("CREW OF ONE.
// NAP EARNED.", "FILES DRY. DETECTIVE SOAKED. INK: UNSOLVED."). The other
// shapes in the mix — an imperative/label ("MISSION: KEEP ONE LANTERN OUT OF
// THE RAIN."), a parallel repetition ("{name} DOESN'T READ. {name} REACTS."),
// a concession trailing off a resolved beat ("THE WATER LOST. {name} STILL
// AVOIDS THE BATHTUB.") — keep the deadpan-report majority from being all 12.
// {name} itself is no longer a fixture of the stinger either: only 4 of the 12
// use it at all (vs. every "turn" in the old data), so whether the pet is
// named here is now a per-line choice, not a structural habit to preserve.
export const LOGLINES: WorldMap<Required<Loglines>> = {
  deepspace: {
    brave: {
      premise: "A RUPTURED COOLANT LINE IS FLOODING THE SHIP WITH FROST.",
      intro: "NO ENGINEER ABOARD. JUST {name}, ON PATROL.",
      turn: "THE FROST OUTRUNS {name}, RACING DOWN THE HALL.",
      rise: "{name} PLANTS BOTH PAWS ON THE FROZEN VALVE WHEEL.",
      tagline: "SMALL PAWS. LAST VALVE. WHOLE SHIP.",
      stinger: "CREW OF ONE. NAP EARNED.",
    },
    easygoing: {
      premise: "A CRACKED DOME. ONE SEEDLING. THE FROST IS SPREADING.",
      intro: "{name} WAS NEVER MEANT TO KEEP ANYTHING ALIVE OUT HERE.",
      turn: "THE FROST TAKES HALF THE GLASS BEFORE HELP ARRIVES.",
      rise: "{name} DRAGS THE LAST WARM BLANKET DOWN THE CORRIDOR.",
      tagline: "SOME RESCUES ARE QUIET",
      stinger: "GREENHOUSE: SAVED. NAP: MANDATORY.",
    },
    playful: {
      premise: "MAGNETIC BEARINGS FLOOD THE CARGO BAY FLOOR.",
      intro: "{name} JUST WANTED ONE CANISTER OFF THE SHELF.",
      turn: "A BEARING DROPS INTO THE DECK GRATE — SPARKS FLY.",
      rise: "{name} THROWS ALL FOUR PAWS AT THE JAMMED GRATE.",
      tagline: "MADE THE MESS. OWNS THE MESS.",
      stinger: "SOUVENIR SECURED. LESSON: NOT LEARNED.",
    },
    timid: {
      premise: "A LOOPING SIGNAL. A HATCH BENDING IN. NO CREW LEFT.",
      intro: "{name} WAS NEVER MEANT TO ANSWER A DISTRESS CALL.",
      turn: "A LOOSE CABLE WHIPS SPARKS ACROSS THE ONLY WAY OUT.",
      rise: "ONE PAW ON THE PANEL. SEAL IT, OR CROSS?",
      tagline: "SMALL, SCARED, AND STILL MOVING",
      stinger: "SIGNAL SILENCED. NAP SCHEDULE RESUMED.",
    },
  },
  storybook: {
    brave: {
      premise: "THE GORGE BRIDGE IS FAILING. ITS FAR SUPPORT LEANS.",
      intro: "NO KNIGHT STANDS HERE. ONLY {name}, PAWS AT THE EDGE.",
      turn: "THE ROPE LINE SNAPS. THE WHOLE SPAN TILTS FURTHER.",
      rise: "{name} HAULS THE SPARE ROPE. WILL IT HOLD?",
      tagline: "HELD TOGETHER BY TEETH AND WILL",
      stinger: "THE BRIDGE MENDED. {name} SLEEPS ON THE BANNERS.",
    },
    easygoing: {
      premise: "A LANTERN SLIPS ITS STAKE, BOUND FOR THE STORM.",
      intro: "{name} WAS ONLY OUT FOR AN EVENING STROLL.",
      turn: "THE WIND TAKES IT TOWARD THE OLD FOREST.",
      rise: "{name} CHASES THE RIBBON UPHILL, PAWS AND ALL.",
      tagline: "WHAT THE WIND TAKES, {name} GOES AND GETS",
      stinger: "MISSION: KEEP ONE LANTERN OUT OF THE RAIN.",
    },
    playful: {
      premise: "THE LIBRARY'S TALLEST STACK IS ABOUT TO FALL.",
      intro: "{name} JUST WANTED TO SEE THE TOP SHELF.",
      turn: "BOOKS, SCROLLS AND A RUNAWAY CART HEAD FOR THE GORGE.",
      rise: "ONE ROPE. ONE JUMP. NO SECOND CHANCE ON THAT RAIL.",
      tagline: "KNOCKED IT LOOSE. CHASING IT DOWN.",
      stinger: "{name} DOESN'T READ. {name} REACTS.",
    },
    timid: {
      premise: "A TOPPLED CANDLE HAS SET THE LIBRARY SMOLDERING.",
      intro: "{name}, WHO FLINCHES AT SHADOWS, IS THE ONLY ONE AWAKE.",
      turn: "SMOKE CREEPS ALONG THE BEAMS. PAGES SCATTER.",
      rise: "PAWS SHAKING, {name} TURNS BACK TOWARD THE FLAME.",
      tagline: "THE BRAVEST PAWS ARE THE TREMBLING ONES",
      stinger: "THE CANDELABRA STAYS UNLIT. {name} INSISTS.",
    },
  },
  noir: {
    brave: {
      premise: "A ROOFTOP TANK IS TEARING LOOSE ABOVE THE STREET.",
      intro: "{name} WAS JUST CROSSING THE LEDGE.",
      turn: "THE SEAM SPLITS. THE WHOLE BLOCK BEGINS TO FLOOD.",
      rise: "ONE VALVE MIGHT STOP IT. IF IT TURNS IN TIME.",
      tagline: "THE NIGHT SHIFT IS FOUR PAWS DEEP",
      stinger: "CASE CLOSED. COLLAR SOAKED. NOT SORRY.",
    },
    easygoing: {
      premise: "THE CITY'S ONLY MAP JUST TORE LOOSE IN THE WIND.",
      intro: "{name} NEVER TAKES A CASE. THIS ONE FOUND THEM.",
      turn: "RAIN HITS. THE LAST DRY LEDGE IS SHRINKING FAST.",
      rise: "{name} PINS IT DOWN. GETTING IT HOME IS HARDER.",
      tagline: "SOAKED THROUGH BEFORE IT'S DONE",
      stinger: "ONE MAP RECOVERED. ONE ARMCHAIR CLAIMED.",
    },
    playful: {
      premise: "A RECORDS ROOM. A SPILLED INKWELL. A SMOKING VENT.",
      intro: "{name} NEVER CRACKED A CASE. TONIGHT ONE OPENS.",
      turn: "THE INKWELL HITS THE VENT. SMOKE FILLS THE ROOM.",
      rise: "{name} GRABS THE BUCKET. THE FLOOR SPARKS.",
      tagline: "THE PARTNER WITH NO IMPULSE CONTROL",
      stinger: "FILES DRY. DETECTIVE SOAKED. INK: UNSOLVED.",
    },
    timid: {
      premise: "A CRACKED MAIN IS FLOODING THE ALLEY, DOOR BY DOOR.",
      intro: "{name} NEVER LIKED PUDDLES. TONIGHT, NO CHOICE.",
      turn: "THE SANDBAGS GIVE. THE BASEMENT DOOR STARTS TO BOW.",
      rise: "{name} STOPS SHAKING LONG ENOUGH TO LEAN IN.",
      tagline: "SCARED STIFF. STANDING ANYWAY.",
      stinger: "THE WATER LOST. {name} STILL AVOIDS THE BATHTUB.",
    },
  },
};

/**
 * Per-shot motion = CONTINUE the action the still already froze, + a camera
 * move. MOTION-V2-SPEC.md §1/§3.2: the video model behind this is now
 * `bytedance/seedance-2.0/image-to-video` — v1 (Kling) could only be trusted
 * with small alive-ness cues (blink, ear flick, a breath) because it drifted
 * off-model the moment the pet moved much, and it had three braking
 * mechanisms working alongside this prompt text (negative_prompt, cfg_scale,
 * an approved end frame holding where the motion had to land) to keep it
 * there. Seedance's endpoint has none of those three — no negative_prompt or
 * cfg_scale, and MOTION-V2 drops the end frame too — so the text below is now
 * the only lever, and it's being asked to do far more with it.
 *
 * WHY THESE DESCRIBE A CONTINUATION, NOT A NEW MOVEMENT: `generateShotClip`
 * (lib/film-pipeline.ts) concatenates `getShotMotion(i, orderId)` into the
 * video prompt next to the approved still — mechanically, for whichever
 * world/personality landed on cut i, with no idea what that still shows. That
 * was harmless when the ask was just "blink, breathe" — any still can do
 * that. TRAILER-STORY-V3-SPEC.md §2(e) changed what the stills look like: the
 * FILM_SCRIPTS beats now write a decisive action already underway (a pet
 * braced against a valve wheel, mid-leap over a gap, hauling a rope taut). A
 * fixed string that names ITS OWN new movement — "breaks into a run", "rears
 * up and slams its paws down" — will contradict most of the twelve stills it
 * gets bolted onto and fight the pose the model is meant to be animating
 * from, and a fought pose is exactly where identity drift comes from. So each
 * entry below describes a GENERIC continuation — the strain the frame is
 * already showing breaking through, the stride already underway landing, the
 * weight already committed transferring — never naming which specific
 * locomotion produced it. That's what makes SHOT_MOTIONS[3], for instance,
 * equally plausible as the next second of a pet rearing against a coolant
 * valve (deepspace/brave), a pet hauling a rug toward a flame
 * (storybook/timid), or a pet with its shoulder driven into a basement door
 * (noir/timid) — three different worlds, three different personalities, same
 * cut index, same generic prompt bolted on underneath.
 *
 * THE YAW BAN, WHY IT EXISTED, AND WHY IT'S LIFTED:
 * The identity reference the video model ever sees is the customer's
 * hand-picked, identity-gated start frame — a single FRONT-FACING portrait.
 * It has never seen the pet's profile. The first production film's
 * SHOT_MOTIONS asked for yaw three times ("glancing left and right", "turns
 * its head sharply to look off-camera", "turns its head") and got back a
 * profile that read as a different dog. That was never a wording problem —
 * it's a reference-coverage problem, and no amount of clever phrasing fixes a
 * turn into geometry the reference never showed. The rule that followed was
 * absolute: never rotate the head or camera around the vertical axis.
 *
 * MOTION-V2-SPEC.md §2/§3.2 tested exactly that failure before lifting the
 * ban, not a softer version of it: the same approved start frame, told to
 * leap off a chair, run at the camera, whip its head left (yaw), then bark —
 * the specific move that broke the first film, done on purpose. Seedance
 * held the costume and the face through it (fur color drifted slightly
 * warmer, and the owner reviewed all three candidate models by watching the
 * actual video, not just stills, before choosing this one). That is n=1 —
 * one dog, one prompt, one run (scripts/motion-test.ts) — not a guarantee it
 * holds across every breed and every cut. So yaw is allowed again below, but
 * the backstop hasn't moved: lib/film-pipeline.ts's `scoreClip` identity gate
 * still rejects any take that drifts off-model, same as it always has.
 * Lifting the prompt-level ban doesn't mean the pipeline now trusts the model
 * on faith — it means the gate, not the prompt, is what's carrying that risk.
 *
 * Constraints that DID survive the rewrite:
 *  - the pet's face must still end the shot toward the camera and
 *    unobstructed. A head turn (yaw) mid-shot is fine; a shot that stays a
 *    profile or a back the whole way through is not.
 *  - camera motion is still push-in / pull-back / crane only, never an orbit
 *    or "circles around" move — moving the camera around the subject changes
 *    the viewing angle exactly the way a head-turn does, and would
 *    reintroduce the same identity risk by another route. If a future edit
 *    wants more camera variety, add push/pull/crane variants, not rotation
 *    around the subject.
 *
 * Indices 0-4 are fixed per-cut beats (parallel to SHOT_FRAMINGS / the arc's
 * first 5 beats). Index 5 (the climax) is NOT a single string — see
 * SHOT_MOTIONS_FINALE_POOL + getShotMotion() below, so every order's ending
 * isn't the same template.
 */
export const SHOT_MOTIONS: string[] = [
  "whatever the still has already set in motion breaks free of its held instant, the pet committing to it fully with its weight following all the way through; slow cinematic push-in",
  "the pet's weight checks for a beat and then drives forward through whatever brace or pause the frame has caught it in, committing harder the second time; camera drifts slowly forward",
  "whatever ground the pet is already covering keeps unwinding at full speed, the motion carrying through until its legs find solid footing again; slow steady push-in",
  "the strain already gripping the frame reaches its peak and breaks through, muscle and weight transferring fully into whatever is being pushed, pulled, or held; slow cinematic rise",
  "the pet pushes on past the hardest point of whatever the frame already has it doing, weight and strain still transferring through with the outcome not yet decided; gentle push-in toward the face",
];

/**
 * Climax (shot index 5) variant pool — fixes "every film ends the same way".
 * SHOT_MOTIONS[5] used to hardcode "raises its head proudly", so every order
 * closed on an identical beat, which reads as a template and undercuts the
 * $249 bespoke Director's Cut promise.
 *
 * Unlike indices 0-4, cut 6's actual content is NOT varied across the 12
 * FILM_SCRIPTS arcs — TRAILER-STORY-V3-SPEC.md §2(h) makes the last cut the
 * customer's own ending, non-negotiable, and in the current data all twelve
 * are some form of curled up, settled, or resting (asleep on a blanket,
 * slumped over an empty bucket, sitting calmly by a drained tank). So these
 * three variants don't reach for big new movement the way 0-4 do — continuing
 * INTO stillness is the correct continuation of what's actually in the frame
 * here, not a leftover of the old blink-and-breathe era. All three still end
 * face-forward and unobstructed (yaw mid-shot remains allowed, same rules as
 * above, just not needed for a beat that's already settling); only the
 * specific settling gesture and camera move differ. If a future arc ever ends
 * on an active (not resting) climax, these three will need a matching
 * "unresolved energy" counterpart rather than being stretched to cover it.
 */
export const SHOT_MOTIONS_FINALE_POOL: string[] = [
  "whatever repose the frame has already settled into deepens further, its breathing slowing and its weight sinking fully into the surface beneath it as the last tension leaves its body; slow upward crane",
  "the pet allows one small contented movement to finish — a tail giving a single unhurried thump, or a paw curling a fraction tighter — before settling fully still; slow push-in to a hero close-up",
  "whatever alertness is still left in the frame eases out of the pet's body, ears and whiskers relaxing as it lets go of the last of the scene's tension; camera eases back to reveal the scene",
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
 * CURRENTLY DORMANT UNDER MOTION-V2 — READ BEFORE TOUCHING. MOTION-V2-SPEC.md
 * §3.1 turns end frames off for v2 (`USE_END_FRAMES = false` in
 * lib/film-pipeline.ts): Seedance supports `end_image_url` same as Kling did,
 * but pinning the last frame is most of what was suppressing motion in the
 * first place, and the whole point of v2 is to stop suppressing it. So this
 * array is not consumed while that switch is off — nothing below drives any
 * running order right now. It stays here, un-deleted, because the mechanism
 * (identity-gated end frame -> clean interpolation) is sound and may come
 * back for cuts where a pinned landing turns out to matter more than the
 * extra motion; whoever flips `USE_END_FRAMES` back on needs everything below
 * to still be correct.
 *
 * THE YAW RULE HERE IS NOT getShotMotion's, EVEN THOUGH IT READS THE SAME:
 * this array predates MOTION-V2 and inherited its "never rotate the head
 * around the vertical axis" language from the same postmortem documented
 * above SHOT_MOTIONS (a front-facing-only identity reference invents a
 * profile the moment something asks for one). getShotMotion lifted that ban
 * for the video model because Seedance was tested against yaw specifically
 * and held (see above). That test says nothing about THIS array's case: an
 * end pose isn't a video-model instruction, it's a still-image generation
 * target that then goes through the SAME identity gate as every other
 * approved still — no yaw allowance was ever tested against a GATED STILL,
 * only against a video model given a front-facing start frame. So the ban
 * below stays in force on its own evidence, not by inertia: keep each
 * enabled entry to exactly ONE small change (a step, a stand, a chin lift, a
 * raised paw) that rotates neither the head nor the body around the vertical
 * axis — start and end drifting too far apart (in pose OR in angle) gives the
 * video model two dissimilar anchors to reconcile, and it morphs between them
 * (visibly "un-dogging" mid-clip) instead of interpolating cleanly.
 *
 * STAGED ROLLOUT (spec §5.4): only the two cuts where real action matters most
 * were enabled at launch —
 *   - cut 2 (index 1): SHOT_FRAMINGS[1] is the one framing actually composed
 *     to SHOW full-body action, so it's the best return on the extra
 *     end-frame spend.
 *   - cut 6 (index 5): the climax — the last thing the audience sees, worth
 *     spending the one extra still on.
 * Widening the rollout (or narrowing it back) would be a one-line edit: flip
 * an entry between `null` and a pose string. Do NOT enable all six at once —
 * and while `USE_END_FRAMES` is off, none of this has any effect either way.
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
  // 1 — opening shot / poster: safest, face-forward medium hero.
  // LORA-STORYBOARD-SPEC.md §1.5/§2.3: under B1 (the LoRA take generator),
  // "medium hero shot" alone came back as an extreme nose-to-lens close-up —
  // the ONLY of the six framings that needed a negation added, since cut 4
  // below is already an INTENTIONAL close-up and needs no such guard.
  "Framed as a medium hero shot — this is NOT an extreme close-up of the face — the pet's face large, sharp and turned toward the camera, head and chest filling much of the frame",
  // 2 — full-body three-quarter action: shows costume + movement
  "Framed as a full-body three-quarter action shot showing the whole costumed body in motion, the face still turned toward the camera and in sharp focus",
  // 3 — dramatic low angle: heroic scale
  "Framed as a dramatic low-angle shot looking up at the pet so it towers heroically, its face tilted down toward the camera and well lit",
  // 4 — tight face close-up: maximum variety AND maximum likeness
  "Framed as a tight close-up on the pet's face, the eyes and expression filling the frame in razor-sharp focus",
  // 5 — medium establishing: the world reads, but the pet stays prominent so
  //     identity holds (was a full wide — too small in frame, drifted; the gate
  //     kept scoring it low, so we pulled the pet forward). LORA-STORYBOARD-
  //     SPEC.md §2.3: this was the one entry of the six missing the explicit
  //     "toward the camera" face direction the other five already state —
  //     added here to match, not because this framing behaved differently in
  //     testing (the production SHOT_FRAMINGS text, unlike the simplified
  //     framing string the §1.5 bake-off script used, always had it on 5/6).
  "Framed as a medium establishing shot — the pet prominent with its face large, sharp and turned toward the camera, the environment suggested behind it rather than dominating the frame",
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

/**
 * Drop a leading "<PET NAME>:" from a tagline.
 *
 * WHY: the `finale` title card renders the pet's name on its own line and the
 * tagline underneath it (cardLinesFor in lib/film-pipeline.ts). Every PRESET
 * tagline is written to fit that — "CASE CLOSED", "THE LONG WAY HOME", "A TAIL
 * OF VALOR", none of them name the pet, because the card already did. That
 * convention lived only in the data, never in Claude's instructions, so the
 * first Director's Cut order to reach delivery produced
 * `CAMYU: INTO THE TRENCH` and the finished film's last card read:
 *
 *     CAMYU
 *     CAMYU: INTO THE TRENCH
 *
 * The schema description now tells Claude not to include the name, but a
 * softly-worded instruction is not a guarantee — this codebase spent today
 * watching the model write tool-call scaffolding into prose it had been asked
 * not to. So the render path enforces it too, and doing it here rather than at
 * parse time fixes orders that are ALREADY stored.
 *
 * Deliberately narrow: only a name at the very START, followed by a separator.
 * A name doing real work mid-sentence ("THE WORLD ACCORDING TO CAMYU") is left
 * alone. If stripping would leave nothing — a tagline that is only the name —
 * the original is kept, because a blank final card is worse than a repeated
 * one.
 */
export function stripLeadingPetName(tagline: string, petName: string | null | undefined): string {
  const name = (petName ?? "").trim();
  if (!name) return tagline;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Separators seen in practice plus the dashes a model reaches for: colon,
  // hyphen, en dash, em dash. Case-insensitive because the loglines are
  // upper-cased by fillPetName while `petName` is whatever the customer typed.
  const stripped = tagline.replace(new RegExp(`^\\s*${escaped}\\s*[:\\-–—]\\s*`, "i"), "").trim();
  return stripped || tagline;
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
