/**
 * Preset 12セットの**下書き**（3世界 × 4性格）。2026-08-14 生成。
 *
 * **これはまだ製品データではない。** `lib/film-script.ts` の FILM_SCRIPTS /
 * LOGLINES に貼るのは、オーナーが全文を読んで承認してから。ここに置いてあるのは、
 * 生成のたびに文面が変わってしまい、承認したものが二度と再現できないため —
 * `preset-story.ts` を再実行しても**この文面は戻ってこない。**
 *
 * 出自:
 *   - easygoing / playful / timid … 最初の生成をそのまま採用
 *   - brave … 初回は「無関係な災害の羅列」になった（橋が割れ、旗が燃え、
 *     燭台が倒れ、井戸が崩れる）。PERSONALITY_BRIEF.brave の「breaking, burning,
 *     flooding, or closing in」という**候補の列挙をモデルが全部やった**のが原因。
 *     「1つの事故だけ、それが悪化していく」に書き直して再生成した版がこれ。
 *
 * 既知の未解決点（TRAILER-STORY-V3-SPEC.md §4.1 と同じもの）: 12本中9本は
 * cut 4 で解決を見せてしまっている。プロンプトでは止まらないと結論済みで、
 * EDL の並び替えで対処する。**この下書きを直す必要はない。**
 */

export const DRAFT_FILM_SCRIPTS = {
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
} as const;

export const DRAFT_LOGLINES = {
  deepspace: {
    brave: {
      premise: "A RUPTURED COOLANT LINE IS FREEZING THE ENGINE BAY SOLID, DECK BY DECK.",
      intro: "NO ONE ELSE IS CLOSE ENOUGH TO REACH THE VALVE. {name} IS.",
      turn: "THE FROST OUTRUNS THE CORRIDOR LIGHTS AND THE VALVE WHEEL SEIZES ICE-BOUND.",
      rise: "{name} THROWS EVERY POUND OF WEIGHT INTO A WHEEL THAT WON'T TURN.",
      tagline: "HOLD THE LINE",
      stinger: "THE SHIP STAYS WARM. {name} STILL HOGS THE ONLY BLANKET.",
    },
    easygoing: {
      premise: "A HAIRLINE CRACK IN THE GREENHOUSE DOME IS LETTING THE COLD OF SPACE IN, PANE BY PANE.",
      intro: "THE LAST SEEDLING ABOARD HAS NO ONE ELSE WATCHING OVER IT.",
      turn: "THE FROST REACHES HALFWAY ACROSS THE GLASS BEFORE {name} EVEN FINDS A BLANKET.",
      rise: "ONE SMALL BODY IS ALL THAT STANDS BETWEEN THE COLD AND THE ONLY GREEN THING LEFT ON BOARD.",
      tagline: "SOME RESCUES ARE QUIET",
      stinger: "{name} SLEEPS ON GUARD DUTY. IT STILL COUNTS.",
    },
    playful: {
      premise: "ONE LOOSE CANISTER IN THE CARGO BAY IS ABOUT TO SPILL SOMETHING ACROSS EVERY DECK.",
      intro: "{name} WAS ONLY LOOKING FOR A SNACK.",
      turn: "NOW A THOUSAND LOOSE BEARINGS HAVE JAMMED THE CORRIDOR'S OWN MACHINERY.",
      rise: "ONE JAMMED GRATE IS SPARKING. {name} DIVES FOR IT ANYWAY.",
      tagline: "MADE THE MESS. OWNS THE MESS.",
      stinger: "{name} STILL GETS TO KEEP ONE BEARING.",
    },
    timid: {
      premise: "A DISTRESS SIGNAL IS LOOPING FROM A DYING HATCH SOMEWHERE ON THIS SHIP.",
      intro: "THE SMALLEST CREW MEMBER ABOARD IS THE ONLY ONE WHO HEARS IT.",
      turn: "THEN THE HATCH ITSELF STARTS TO BUCKLE.",
      rise: "{name} HAS TO CROSS THAT CORRIDOR BEFORE THE SEAL GIVES OUT.",
      tagline: "SMALL, SCARED, AND STILL MOVING",
      stinger: "{name} SLEEPS LIKE THE WHOLE SHIP OWES IT A NAP. IT DOES.",
    },
  },
  storybook: {
    brave: {
      premise: "A GORGE BRIDGE IS TEARING LOOSE AT THE FAR SUPPORT — AND EVERYTHING BEYOND IT DEPENDS ON THE CROSSING.",
      intro: "NO KNIGHT WAS SENT. ONLY {name} WAS NEAR ENOUGH TO HEAR IT GO.",
      turn: "THE ROPE LINE SNAPS. THE WHOLE SPAN LEANS FURTHER OUT OVER THE MIST.",
      rise: "ONE COIL OF ROPE. ONE SHOULDER AGAINST THE LAST PLANK. NO ONE COMING TO HELP.",
      tagline: "THE BRIDGE HOLDS FOR THE BRAVE",
      stinger: "{name} SLEEPS ON A PILE OF ROYAL BANNERS AND HAS EARNED EVERY ONE OF THEM.",
    },
    easygoing: {
      premise: "A WISHING LANTERN SLIPS ITS STAKE — AND THE STORM WANTS IT FIRST.",
      intro: "NO ONE SENT {name} AFTER IT. {name} WENT ANYWAY.",
      turn: "THE WIND TURNS TOWARD THE OLD FOREST, AND THE LANTERN GOES WITH IT.",
      rise: "ONE PAW, ONE REACH, ONE CHANCE BEFORE THE RAIN CLOSES THE SKY.",
      tagline: "WHAT THE WIND TAKES, {name} GOES AND GETS",
      stinger: "THE ROYAL LIBRARY HAS A NEW BEDPOST DECORATION. {name} APPROVES.",
    },
    playful: {
      premise: "ONE CURIOUS PAW TOPPLES THE ROYAL LIBRARY'S TALLEST SHELF.",
      intro: "MEET THE KINGDOM'S SMALLEST KNIGHT — AND ITS CLUMSIEST.",
      turn: "THE FALLEN BOOKS LOAD A CART, AND THE CART FINDS A HILL.",
      rise: "THE BRIDGE'S BROKEN RAIL IS THE ONLY THING LEFT TO STOP IT.",
      tagline: "MADE THE MESS. NOW MAKE IT RIGHT.",
      stinger: "{name} STILL HASN'T FIGURED OUT WHICH SHELF WAS SAFE TO CLIMB.",
    },
    timid: {
      premise: "A DROPPED CANDLE. A LIBRARY OF A THOUSAND YEARS BEGINS TO BURN.",
      intro: "THE SMALLEST KNIGHT IN THE CASTLE IS ALSO THE MOST AFRAID OF FIRE.",
      turn: "THE FLAME CATCHES THE PAGES BEFORE {name} CAN LOOK AWAY.",
      rise: "EVERY INSTINCT SAYS RUN. ONLY ONE CHOICE PUTS IT OUT.",
      tagline: "AFRAID, AND GOING ANYWAY",
      stinger: "{name} STILL WON'T GO NEAR THE CANDLES AT SUPPER.",
    },
  },
  noir: {
    brave: {
      premise: "A ROOFTOP WATER TANK HAS TORN LOOSE, AND THE WHOLE BLOCK BELOW IS ABOUT TO DROWN IN IT.",
      intro: "EVERY OTHER TENANT CALLED IT A LOST CAUSE. {name} CALLED IT TUESDAY.",
      turn: "THE SPLIT SEAM WIDENS, AND THE ALLEY BELOW STARTS TAKING ON WATER FAST.",
      rise: "ONE RUSTED VALVE STANDS BETWEEN THE STREET AND A FLOODED NIGHT.",
      tagline: "SHUT IT DOWN",
      stinger: "{name} STILL WON'T TAKE THE ELEVATOR DOWN FROM THAT ROOF.",
    },
    easygoing: {
      premise: "A LAST DRY MAP OF THE CITY IS TEARING LOOSE OFF THE ROOFTOPS BEFORE THE STORM HITS.",
      intro: "EVERY DETECTIVE IN THIS TOWN HAS GIVEN UP THE CHASE — EXCEPT ONE SMALL ONE.",
      turn: "THE WIND TAKES THE MAP OVER THE EDGE, AND {name} GOES AFTER IT.",
      rise: "ONE LEDGE LEFT BEFORE THE RAIN TAKES IT FOR GOOD.",
      tagline: "THE LONG WAY HOME",
      stinger: "{name} STILL TRACKED MUD ACROSS EVERY CLUE.",
    },
    playful: {
      premise: "ONE STACK OF EVIDENCE BOXES. ONE NOSY DOG. ONE CITY FILE ROOM ABOUT TO CATCH FIRE.",
      intro: "EVERY GOOD DETECTIVE HAS A PARTNER. THIS ONE HAS FOUR PAWS AND NO IMPULSE CONTROL.",
      turn: "AN INKWELL HITS THE VENT AND THE WHOLE ROOM STARTS SMOKING.",
      rise: "{name} GRABS THE ONLY BUCKET IN THE BUILDING AND MAKES A RUN FOR THE FIRE.",
      tagline: "CASE OF THE SELF-INFLICTED EMERGENCY",
      stinger: "THE CAPTAIN STILL DOESN'T KNOW WHO SPILLED THE INK. {name} ISN'T TALKING.",
    },
    timid: {
      premise: "A BURST MAIN IS FLOODING THE LOWER STREETS, AND THE WATER WANTS ONE LOCKED DOOR.",
      intro: "EVERY DETECTIVE IN THIS TOWN IS BIGGER THAN {name}.",
      turn: "THE SANDBAGS GIVE. THE DOOR STARTS TO GO.",
      rise: "SOMEONE HAS TO HOLD IT SHUT BEFORE THE BASEMENT TAKES ON WATER.",
      tagline: "SCARED STIFF. STANDING ANYWAY.",
      stinger: "{name} STILL WON'T GO NEAR THE BATHTUB.",
    },
  },
} as const;
