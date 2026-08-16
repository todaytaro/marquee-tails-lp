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
 * 字幕（DRAFT_LOGLINES）は絵コンテとは別の経緯をたどっている。初版は
 * CARD_RULES で「90字まで」を許してしまい、72行中20行が70字超、最長102字になった。
 * カードは2.0秒しか出ず、大文字の表示フォントは秒15字程度、しかも fitFontSize が
 * 長い行ほど小さく縮める — 読み終わらないうえに一番読みにくい字で出る。
 * 上限55字で作り直し、その2版とオーナーの判断から**行ごとに良い方を採った**のが
 * 現在の内容。最長56字・平均44字・性別代名詞ゼロ・タイトルとstingerの重複ゼロ。
 *
 * 手で仕上げた理由: 作り直しのたびに別の定型が出た（"SOME 〜" で始まるタイトルが
 * 6本、noir の stinger が2本同一、短縮のために {name} を HE に置換）。
 * 4性格を Promise.all で並列生成していて互いを知らないのが原因で、これは
 * preset-story.ts では直列化して直したのに preset-cards.ts で再発させたもの。
 * 5回目を回すより、重複と定型は人が一度見て潰すほうが速く確実だった。
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
      "In a corridor leading from the engine bay, the frost has raced ahead along the floor seam and the console lights down the hall are flipping red one by one into the distance; the pet is braced low at the near end of the corridor, haunches gathered and one paw lifted at the edge of a leap, eyes fixed on the spreading line ahead",
      "Back at the engine bay's main coolant valve, its wheel half-frozen shut, the pet rears up on its hind legs with both front paws braced hard against the wheel's rim, the frost cloud still pouring out beside it, muscles bunched with effort",
      "At that same valve, the wheel now turned a further quarter-turn under the pet's braced weight, ice cracking off in shards and the vapor jet visibly thinning to a wisp, the pet still straining with one paw pressed flat against the metal",
      "In the now-quiet engine bay, frost melting to droplets on the walls and the lights steady, the pet lies curled and settled on a folded silver thermal blanket in the corner, eyes closed, breathing slow",
    ],
    easygoing: [
      "a small potted seedling in a cracked glass greenhouse dome sits on a windowsill shelf, the pet paused beside it with one paw braced on the shelf edge, frost creeping across the dome's outer pane",
      "the pet nose to nose with the cracked dome, breath fogging faintly, a thin line of frost spreading further across the glass behind the seedling",
      "the pet crouched low with the folded silver thermal blanket's corner gripped firmly in its teeth, haunches gathered to pull, the greenhouse dome visible ahead through an open hatchway, frost now covering half the glass",
      "the pet rearing up on hind legs against the shelf, both front paws pressed flat against the thermal blanket half-draped over the cracked dome, muscles set, the seedling still exposed at one corner",
      "the pet standing back with the blanket now fully sealed edge to edge over the dome with both paws pressing the last corner down, warm amber light glowing faintly from beneath the covered shelf",
      "the pet curled asleep on a folded jacket beside the softly glowing covered dome, the corridor lights dimmed to a warm night setting",
    ],
    playful: [
      "in the ship's cargo bay, one paw braced against the loose zero-gravity storage canister on its shelf clamp, having just knocked it free, the canister hanging in the instant before it drifts loose",
      "the canister cracked open against a support strut, a cloud of silvery magnetic ball-bearings spilling out and bouncing across the floor in every direction",
      "in the corridor outside cargo bay, crouched low with legs braced wide against the scattered bearings underfoot, one back leg splayed sideways for balance as a bearing rolls into an open floor grate",
      "sparks spitting from the floor grate where a bearing has jammed the mechanism, the pet's two front paws braced hard against the grate's edge, pressing it back down",
      "in the corridor, both front paws pinning the grate flush to the floor, chest pressed low to the deck, sparks reduced to a last few dying flickers beside its face",
      "curled up triumphantly atop the now-sealed floor grate, one silvery bearing clutched between both front paws like a trophy, tail relaxed and eyes bright",
    ],
    timid: [
      "in the ship's cramped comms closet, the pet frozen still, ears low, as a wall-mounted speaker grille sparks and crackles with a garbled distress signal looping over and over",
      "backed against a supply locker in a narrow corridor, one paw lifted off the floor, staring at a service hatch across from it where the metal is bowing inward with a slow groaning dent",
      "in the engine bay, the pet pressed flat behind a support strut as a loose overhead cable whips sparks across the floor in front of the open path forward",
      "close on the pet's paw pressed flat against a recessed wall panel, the comms hatch beside it sealed shut and its warning strip switched from red to steady amber",
      "in the corridor, the pet braced at the buckled hatch threshold, front paw planted just past the bowed metal edge on the far side, body leaning forward into the dark beyond",
      "curled on the pilot's seat cushion on the bridge, eyes closed, the viewport beyond showing calm stars, the ship's console lights glowing soft and steady",
    ],
  },
  storybook: {
    brave: [
      "on the stone bridge over the river gorge, one plank already split and hanging, front paws planted at the very edge as the far support post leans outward over the mist",
      "the bridge's rope line snapped loose in a spray of frayed fiber, the whole span tilting a visible degree further, the pet's weight braced backward against a stone post, haunches dug in and holding",
      "in the wildflower meadow at the gorge's near end, teeth closed around a thick coil of spare rope pulled taut from a supply cart, hind legs dug into the dirt",
      "back on the tilting bridge, the rope now looped hard around a jutting rock, the pet's whole body leaning against the strain with the broken plank half-lifted back into place",
      "shoulder driven into the last loose plank, front paws braced flat against the stone rail, the gap beneath it nearly closed but the post still leaning, outcome unresolved",
      "curled asleep on a cushion of banners in the castle courtyard at dusk, the mended bridge visible small in the distance, eyes closed, breathing slow",
    ],
    easygoing: [
      "the pet paused on the wildflower meadow path at golden late afternoon, one paw lifted at the edge of a step, gaze fixed upward on a paper lantern balloon bobbing on its long ribbon above the flowers",
      "the pet's head tipped back watching the lantern balloon's ribbon slip free of a leaning wooden stake and lift away on the wind, storm-grey clouds massing beyond the treeline",
      "the pet crouched low in the tall grass on the meadow slope, haunches gathered and ears flattened by the wind, the lantern balloon now small and drifting toward the ancient forest tree line",
      "the pet reared up on hind legs against the trunk of an old oak at the forest edge, one forepaw stretched high, catching the trailing ribbon just above the grass",
      "the pet planted firmly with all four paws braced in the grass, the ribbon clamped in its teeth, the balloon straining sideways as the first raindrops begin to streak past",
      "the pet curled up asleep on a cushioned window seat in the royal library, the paper lantern balloon tied safely to the bedpost beside it, candlelight glowing warm over its closed eyes",
    ],
    playful: [
      "in the royal library, front paws braced on a low shelf as a tall stack of leather-bound books teeters at the very top, one paw already knocking the corner volume loose",
      "in the castle courtyard, standing frozen with ears back as a cascade of scrolls and books tumbles past a startled row of ceremonial banner poles, one pole tipping sharply",
      "on the stone bridge over the river gorge, crouched low with paws planted, watching a runaway wooden cart loaded with the fallen books rolling toward the low bridge rail",
      "at the near end of the bridge rail, front legs gathered beneath it and one paw lifted at the edge of a leap, poised to hook the cart's trailing rope before it clears the edge",
      "braced low with all four paws dug in and the rope clenched, body weight thrown backward, the cart's front wheel stopped just short of the bridge's broken edge",
      "curled up asleep on a pile of rescued books in a sunlit meadow clearing, cart resting harmlessly on its side nearby, wildflowers nodding overhead",
    ],
    timid: [
      "in the royal library at dusk, ears back, staring at a tall iron candelabra as its flame gutters and throws a huge shifting shadow across the shelves",
      "backed low between two bookcases, tail tucked, weight braced away, as loose parchment pages skitter across the floor in a draft from a cracked window",
      "at the library's arched doorway, crouched low with one paw lifted at the edge of retreat, eyes wide on the smoke now curling along the ceiling beams from a toppled candle",
      "crouched low at the edge of a thick rug, front paws braced, hauling one corner of it across the floor toward the small spreading flame",
      "standing with both front paws planted firmly on the now-smothered rug, chest heaving, smoke thinning around it, the fire beneath fully out",
      "curled proudly on the windowsill beside the same candelabra, now unlit, moonlight and calm fireflies drifting past the glass outside, eyes closed",
    ],
  },
  noir: {
    brave: [
      "on a rain-slicked rooftop ledge, the pet frozen mid-step as a rooftop water tower's support strut snaps and the wooden tank lurches sideways above the street below",
      "on the fire escape one level down, the pet braced with both front paws planted on the rusted railing as a spray of water bursts from the tank's split seam overhead, already sheeting down the building face",
      "in the narrow alley below, the pet crouched low with legs gathered beneath it at the mouth of a growing river of runoff, a shop awning collapsing under the weight of falling water just behind it",
      "at a service alley junction, the pet with its shoulder driven hard against a rusted valve wheel on a drainage main, muscles bunched, the wheel caught only halfway turned",
      "at the same valve station, the pet still straining with both front paws now hauling the wheel the last of the way, water noticeably slowing to a trickle down the wall beside it",
      "back on the rooftop at first grey light, the pet sitting calmly beside the now-drained, tilted water tower, looking out over the quiet, dripping skyline",
    ],
    easygoing: [
      "a small dog sits at a rooftop ledge above the city, one paw resting on a wilting potted flower box, petals scattering in a rising wind",
      "the pet stands braced along a fire escape past a newsstand awning as the vendor's paper city map is torn loose and sails off into the dark",
      "the pet reaches one paw up a drainpipe toward a single lit window across the gap, the last dry patch of ledge narrowing as rain starts to fall",
      "soaked and bracing against the wind on a narrow ledge, the pet has both front paws clamped down on the corner of the torn map pinned under a loose brick",
      "the pet stands gripping the flattened map through a cracked window into a warm office, water sheeting off its coat onto the floorboards",
      "curled on a leather armchair beside a crackling radiator, the recovered map spread flat and drying on the desk under lamplight, eyes drifting shut",
    ],
    playful: [
      "the small dog nudges a stack of evidence boxes in a cluttered records room, one box already sliding off the top of the pile",
      "the toppled box has burst open on the floor, loose case files fanned everywhere and a single overturned inkwell rolling toward a heating vent",
      "the rolling inkwell tips into the vent and black smoke begins curling up through the grate behind the pet",
      "the pet braces low against the fire bucket's handle, hind legs planted and dug in, the bucket lip catching sparks off the floorboards as it holds against the load",
      "the pet plants both front paws on the bucket's rim, weight gathered forward, water just cresting the lip toward the smoking vent, the outcome still hanging",
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
} as const;
