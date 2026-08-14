/**
 * 絵コンテの「出来事」テスト（使い捨て・文章だけ・画は作らない）。
 *
 * MOTION-V2-SPEC.md の課題 A。いまの絵コンテは6カットとも「犬がどこかに
 * いる」だけで、脅威も変化も一度も映らない。文字（loglines）だけが物語を
 * 語り、絵はそれを裏切る — だから見終わって「なんの映画か分からない」。
 *
 * 原因はプロンプトにある。`cuts` への指示は同一性を守る制約ばかりで、
 * 「話を進めろ」に相当する条項が1つも無い。物語は loglines 側にしか
 * 要求されていない。
 *
 * このスクリプトは同じブリーフを2通りで走らせて文章だけ突き合わせる:
 *   A … 現行の SYSTEM_PROMPT（対照群）
 *   B … 現行 + STORY_RULES（下記）
 *
 * **画は作らない。** 数セントで文章を読み、納得してから
 * scripts/live-storyboard.ts で約$2.6かけて描く。文章が的外れなまま
 * 18枚描くのが一番もったいない。
 *
 * 使い方: npx tsx --env-file=.env scripts/story-test.ts [orderId]
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { SYSTEM_PROMPT, TREATMENT_TOOL } from "@/lib/claude-script";

const DEFAULT_ORDER = "cmsovxam4000004l6jwkmopr1"; // LALA（deepspace）

/**
 * B群で追加する条項。既存ルールを消さず、後ろに足すだけ —
 * 同一性のガード（顔を覆うな / 他の動物を入れるな / 顔の前を遮るな）は
 * そのまま効かせたい。変えたいのは「何を描くか」であって「どう守るか」ではない。
 */
const STORY_RULES = `

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

/** 現行のツール定義から、Klingの微動時代の一文だけ差し替えた版を作る。 */
function storyTool(): Anthropic.Tool {
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

type Bundle = {
  cuts?: { scene: string }[];
  inserts?: string[];
  loglines?: Record<string, string>;
  costume?: string;
  score?: string;
};

async function run(client: Anthropic, label: string, system: string, tool: Anthropic.Tool, userMessage: string) {
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: [tool],
    tool_choice: { type: "tool", name: "submit_treatment" },
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error(`${label}: no tool_use block`);
  return block.input as Bundle;
}

function show(label: string, b: Bundle) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);
  b.cuts?.forEach((c, i) => console.log(`\n[cut ${i}] ${c.scene}`));
  console.log(`\n--- inserts ---`);
  (b.inserts ?? ["(なし)"]).forEach((s, i) => console.log(`  ${i}: ${s}`));
  console.log(`\n--- loglines ---`);
  for (const [k, v] of Object.entries(b.loglines ?? {})) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log(`\n--- score ---\n  ${String(b.score ?? "").slice(0, 240)}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const orderId = process.argv[2] ?? DEFAULT_ORDER;
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { petName: true, customBrief: true },
  });
  if (!o.customBrief) throw new Error(`order ${orderId} has no customBrief (Preset 注文はブリーフを持たない)`);

  console.log(`pet: ${o.petName}\nbrief:\n${o.customBrief}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // buildUserMessage 相当。product 側と同じ形に揃える必要はなく、
  // A/B で同一であることだけが条件。
  const userMessage = `Pet name: ${o.petName}\n\nCustomer brief:\n${o.customBrief}`;

  const [a, b] = await Promise.all([
    run(client, "A", SYSTEM_PROMPT, TREATMENT_TOOL, userMessage),
    run(client, "B", SYSTEM_PROMPT + STORY_RULES, storyTool(), userMessage),
  ]);

  show("A — 現行のルール（対照群）", a);
  show("B — STORY_RULES 追加", b);
}

main().then(() => process.exit(0));
