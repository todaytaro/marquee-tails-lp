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
    wrong, the thing approaching, or the damage it has already done. Because
    no other animal and no person may share the frame (rule 3), the
    antagonist must be environmental or mechanical: a hull breach venting to
    space, a wall of water down a corridor, fire taking a doorway, ice
    splitting underfoot, a storm front, a machine tearing itself apart, a
    door buckling inward. Name it concretely and put it in the frame.

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

(e) DECISIVE MOMENT, NOT A SMEAR. This SUPERSEDES the earlier instruction not
    to write the middle of a movement, which existed because the old video
    model could only produce tiny motion safely. Each cut is still ONE still
    frame, so write the peak instant of an action the way a press photographer
    freezes it — mid-stride with the front paw planted, braced with the weight
    visibly thrown onto one side, the lever caught at the bottom of its travel.
    A dynamic, clearly readable frame is wanted. A blurred, ambiguous
    in-between is not. The pet's face must still be unobstructed and turned
    toward the camera.

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
  if (inserts?.description) {
    inserts.description +=
      " These must advance or evidence the story (system rule 7f) — the alarm, the flooding, the wreckage — not generic pretty scenery.";
  }
  return tool;
}

