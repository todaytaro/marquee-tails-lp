/**
 * 予告編の物語ルール（検証済み・製品未適用）。
 *
 * TRAILER-STORY-V3-SPEC.md の §2/§3/§4.1 で検証した条項の**唯一の原本**。
 * story-test.ts（DCの文章A/B）と preset-story.ts（Presetの12セット生成）が
 * 両方これを読む — 2箇所に写すと、片方だけ直したときに比較が比較でなくなる。
 *
 * どれも既存の SYSTEM_PROMPT を**消さずに後ろへ足す**前提で書かれている。
 * 同一性のガード（顔を覆うな / 他の動物を入れるな / 顔の前を遮るな）は
 * そのまま効かせたい。変えたいのは「何を描くか」であって「どう守るか」ではない。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { TREATMENT_TOOL } from "@/lib/claude-script";

export const STORY_RULES = `

---

7. THE SIX CUTS MUST BE AN EVENT, NOT SIX VIEWS OF ONE PLACE.

This is the single most common failure of this system, and it is why some
finished trailers leave a viewer unable to say what the film was about. Six
beautiful cuts are produced in which nothing happens: the pet stands
somewhere, sits somewhere, looks up at something, and the situation in cut 6
is indistinguishable from cut 1. The loglines then promise a story the
pictures never deliver. A real trailer earns "I want to see this movie" from
what is ON SCREEN, not from its captions.

Rules 1-6 above are all about protecting the pet's likeness. They stay
exactly as they are. This rule is about whether anything HAPPENS inside those
protections.

(a) SOMETHING MUST ARRIVE, BREAK, OR CLOSE IN. Across the six cuts the
    situation must visibly change. At least TWO of the six must show the
    CAUSE of the story in frame together with the pet — the thing going
    wrong, the thing approaching, or the damage it has already done.

    The cause may be environmental or mechanical — a hull breach venting to
    space, a wall of water down a corridor, fire taking a doorway, ice
    splitting underfoot, a storm front, a machine tearing itself apart, a
    door buckling inward. Name it concretely and put it in the frame.

    IT MAY ALSO BE A LIVING THING, on one condition: the pet and that
    creature can NEVER share a frame (see the "cuts" field — the model that
    draws the pet will merge the two). So a creature antagonist lives in the
    INSERTS, which the pet is never in: a fin cutting the water, circling
    birds, eyes in the dark, something moving under the surface. The six cuts
    then show only what it LEAVES BEHIND — splintered planking, water across
    the deck, the pet braced at a door that is being struck from the far
    side. This is not a workaround; it is how trailers do monsters. Glimpsed
    and never met is stronger than shown in full.

    If you use a creature this way, it MUST leave a mark on at least one of
    the six cuts. A threat that appears in the B-roll and touches nothing in
    the story is a loose thread, not a story.

(b) EVERY CONSECUTIVE PAIR MUST DIFFER IN SITUATION, NOT ONLY IN CAMERA
    POSITION. Ask of cuts 1→2, 2→3, and so on: has anything changed besides
    where the pet is standing? If the answer is no, rewrite that cut. Moving
    the pet to a different corner of the same untouched room is not a beat.

(c) AT LEAST TWO DISTINCT LOCATIONS within the world. Six cuts in a single
    unchanged room reads as one photograph taken six times.

(d) THE PET MUST ACT, NOT ONLY REACT. At least two cuts show the pet doing
    something with physical consequence — bracing against a door, hauling a
    lever down, running toward the thing rather than away, planting itself
    between the danger and what it is protecting. "Looking at" and "standing
    near" are not actions.

(e) EACH SCENE IS A STILL THAT MUST HOLD UP ON ITS OWN — A STABLE, READABLE
    MOMENT, NOT THE MIDDLE OF A MOVEMENT. Write the pet in a settled, legible
    pose within its situation: braced, crouched, standing, reaching and holding.
    Do NOT write a body mid-leap, mid-stride, mid-fall or mid-skid. An earlier
    version of this rule asked for "the decisive instant" and the images came
    back with stretched torsos and impossible joints — one frame of a body in
    flight has no correct answer, so the generator invents one. The customer
    approves these images and one becomes the poster; they have to be good
    pictures first.

    BUT WRITE A LOADED POSE, NOT A RESTED ONE. The still must also leave
    somewhere big to go: gathered before a spring, braced at the START of a pull
    with the lever still up, at the near end of a corridor not yet crossed, one
    paw lifted at the edge of a jump. All of those are settled poses a still can
    hold, and all have a large movement waiting inside them. A pet already
    sitting comfortably, already arrived, already finished, caps what can follow
    it — the only movement available from a resting pose is a small one.

(f) THE THREE INSERTS CARRY PLOT, NOT DECORATION. They must show the
    situation worsening, or the evidence it left — the alarm panel going red,
    water climbing a stairwell, a countdown, torn wreckage. A pretty
    atmospheric fragment that would fit equally well in any story of this
    world is wasted screen time; the trailer only has three of these.

(g) THE RESOLUTION MUST BE EARNED ON SCREEN — IN AN EARLIER CUT, NOT THE LAST
    ONE. If the story resolves, some cut must visibly show the thing that was
    wrong being fixed, sealed, held, or survived; it must not be resolved only
    in the loglines. Put that beat at cut 4 or 5 of 6.

(h) THE FINAL CUT IS THE CUSTOMER'S ENDING, AND IT IS NOT NEGOTIABLE. The
    brief states how the story ends. Write that ending, in the customer's own
    terms, as the last cut — even when it is quiet, still, sleeping, or
    otherwise "undramatic". Rule (g) is satisfied by the resolution beat that
    comes BEFORE it, never by replacing the ending with something more
    conclusive-looking. A brief that ends with the pet asleep in a chair ends
    with the pet asleep in that chair. If the ending as written seems to
    undercut the drama, that is the customer's call and it stands.`;

// Numbering below (7/9/10) is correct in this file's own standalone context
// (this constant is read on its own by story-test.ts/preset-story.ts/
// preset-cards.ts). The copy folded into lib/claude-script.ts's SYSTEM_PROMPT
// is renumbered to follow that file's existing rules 1-5 (STORY_RULES -> 6,
// CARD_RULES -> 7) — see the numbering note in TRAILER-STORY-V3-SPEC.md /
// the production file itself. Keep the RULE TEXT identical between the two;
// only the numerals and internal "system rule Ne/Nf" cross-references differ.
export const CARD_RULES = `

---

9. THE SIX TITLE CARDS MUST CARRY INFORMATION, NOT ONLY MOOD.

A viewer has no source of story except these six lines and six shots of a pet
in a beautiful place. The cards have to do the telling. The failure to avoid
is six lines of pure atmosphere and scale — "THE BRIDGE IS VAST. THE THREAT IS
BIGGER STILL." — which sounds like a trailer while saying nothing: afterwards
a viewer cannot name the threat, the goal, or the cost of failing.

EACH OF THE SIX HAS A DIFFERENT JOB. Do not write six variations of the
premise.

  premise  THE SITUATION AND THE THREAT, NAMED CONCRETELY. What is wrong and
           what specifically is causing it. Not "danger closes in" — the hull
           is breaching, the flood has taken the lower deck, the fire has the
           stairs.
  intro    WHO THE HERO IS, and why it is moving or absurd that this falls to
           them. This is where the pet's smallness or ordinariness earns its
           place — ONCE, not four times.
  turn     WHAT GOES WRONG, or what raises the price. Something must HAPPEN in
           this line; it is an event, not an observation.
  rise     WHAT THE HERO DECIDES TO DO ABOUT IT. A choice or an action.
  tagline  The title line. This is the ONLY one that may be pure poetry.
  stinger  The closing joke.

NEVER NAME THE SPECIES OR BREED. No "cat", "dog", "puppy", "kitten", "pup",
"hound", "terrier", or any breed name may appear in any of the six lines. The
species is never supplied to you — you are given only the pet's name and the
customer's brief — so a wrong guess prints the wrong animal over the
customer's own pet, on a card they paid for. Refer to the star by "{name}",
by role or stature ("THE SMALLEST OFFICER", "THE ONLY ONE STILL AT THE
HELM"), or by a body part the picture already shows ("PAWS").

CONCRETE BEATS ABSTRACT. Prefer a named thing, a number, a deadline or a
consequence over an adjective. "SIXTY SECONDS OF AIR LEFT" outranks "TIME IS
RUNNING OUT". AT MOST ONE of the six lines may be built on a size or scale
comparison — that device lands once and grates twice.

LENGTH — A HARD CEILING OF 55 CHARACTERS PER LINE. Count them. This is not a
style preference: each card is on screen for about two seconds, an all-caps
display face is read at roughly fifteen characters a second, and the renderer
SHRINKS THE TYPE to make a long line fit — so a long card is both unfinishable
and smaller. A first pass at these rules allowed 90 characters and produced a
102-character card; nobody could have read it.

Length and information are not in tension, they pull the same way. A named
thing is shorter than the adjective it replaces: "THE FAR SUPPORT IS TEARING
LOOSE." says more than "THE BRIDGE IS VAST. THE THREAT IS BIGGER STILL." in
fewer characters. If a line runs long, it is usually carrying scene-setting
the pictures already show — cut that, keep the fact.

TAGLINES MUST NOT BE STOCK PHRASES. "HOLD THE LINE", "SHUT IT DOWN", "THE LONG
WAY HOME", "AGAINST ALL ODDS" and their kin fit any film ever made, which
means they say nothing about this one. The tagline must only be sayable about
THIS story — its specific trouble, or its specific hero. Compare: "SOME
RESCUES ARE QUIET", "MADE THE MESS. OWNS THE MESS.", "SCARED STIFF. STANDING
ANYWAY." Each belongs to exactly one film.

Still ALL-CAPS, still English.`;

export const WITHHOLD_RULES = `

---

10. DO NOT ANSWER YOUR OWN QUESTION. THE TRAILER STOPS AT THE PEAK.

A trailer's whole job is to leave a viewer wanting the film. That is destroyed
by showing how it turns out. The failure to avoid: crisis, action, the danger
resolved, the aftermath, the hero at rest — a complete story told in sixty
seconds, after which there is nothing left to wonder about.

Structure the six cuts like this instead:

  cuts 0-4  THE BODY. A rising line: the situation, the thing going wrong, it
            getting worse, the hero committing to act. CUT 4 IS THE PEAK OF
            THE ACTION AND THE OUTCOME IS WITHHELD — the paw is on the switch,
            the lever is halfway down, the shoulder is against the door. Never
            show it working. No cut in 0-4 may show the danger resolved, the
            fire out, the water stopped, the alarm calmed, or any aftermath.
            The viewer must reach cut 4 not knowing whether it worked.

  cut 5     THE ENDING, PLAYED AFTER THE TITLE CARD. This is the customer's
            stated ending from the brief (rule 8h — still non-negotiable), and
            it now doubles as the answer the body withheld: the viewer sees the
            pet safe, asleep, home, victorious, and only then understands it
            worked. Write it as the quiet beat AFTER the story, not as a sixth
            step of the story.

BEFORE YOU SUBMIT, CHECK CUT 4 SPECIFICALLY. The strong pull of storytelling
is to finish the job, and this rule is broken in exactly one predictable way:
cut 3 is written as the peak ("the lever caught halfway down") and then cut 4
completes it ("the lever fully down and locked, the alarm switched to steady
blue"). That is the aftermath, one cut early, and it is exactly what must not
appear. If cut 4 shows the lever locked, the alarm calmed, the fire out, the
crack sealed, the light gone from red to blue, or the pet sitting up satisfied
— rewrite it. Cut 4 must be a body physically mid-effort with the result still
unknown: straining, holding, reaching, weight thrown into it.

This also changes what the LAST card before the title must do. "rise" is the
final thing read before the cut to black, so it must sharpen the question, not
settle it — a commitment, a cost, or a countdown — never a reassurance. Nothing
in premise/intro/turn/rise may reveal that the hero succeeds.

NEVER REUSE THE WORDING OF ANY EXAMPLE IN THIS PROMPT. Every example here is
illustrating a SHAPE, not supplying a line. Generating four films with these
rules once produced three whose "rise" card was a near-copy of the example
above, so the four films read as one film. If a phrase you are about to write
appears anywhere in these instructions, write a different one.`;

/** 現行のツール定義から、Klingの微動時代の一文だけ差し替えた版を作る。 */
export function storyTool(): Anthropic.Tool {
  const tool = JSON.parse(JSON.stringify(TREATMENT_TOOL)) as Anthropic.Tool;
  const props = (tool.input_schema as { properties?: Record<string, { description?: string }> }).properties;
  const cuts = props?.cuts;
  if (cuts?.description) {
    cuts.description = cuts.description.replace(
      "so do NOT write the middle of a movement.",
      "so write the DECISIVE instant of an action (see system rule 7e) — the peak of a movement, clearly readable as a single frame, never a blurred in-between."
    );
  }
  const inserts = props?.inserts;
  const insertsAddendum =
    " These must advance or evidence the story (system rule 7f) — the alarm, the flooding, the wreckage — not generic pretty scenery.";
  // Idempotent: once lib/claude-script.ts's TREATMENT_TOOL carries these edits
  // directly (TRAILER-STORY-V3-SPEC.md), the .replace() above becomes a no-op
  // (the old string is gone) but this += would otherwise double the sentence
  // on every call, since it starts from the already-edited production literal.
  if (inserts?.description && !inserts.description.includes(insertsAddendum.trim())) {
    inserts.description += insertsAddendum;
  }
  return tool;
}

