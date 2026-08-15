/**
 * Preset の12セット（3世界 × 4性格）を、DCで検証した条項で書き直す。使い捨て。
 *
 * DC は Claude が注文ごとに書くので条項を足せば直る。**Preset は静的データ**
 * （lib/film-script.ts の FILM_SCRIPTS / LOGLINES）なので、一度生成して人が
 * 読み、承認してからコードに貼る。生成は1世界あたり数セント。
 *
 * 直す対象は「起承転結が無いこと」。いまの Preset は、たとえば deepspace/brave が
 *   ブリッジで胸を張る → 制御盤を叩く → 機関室で火花に耐える →
 *   船外で船体にしがみつく → 異星に旗を立てる → 新銀河を望んで勝利
 * と、**かっこいい瞬間が6つ並んでいるだけ**。場所は変わるが、原因も、問題も、
 * 転換もない。DC の「立っている・座っている」とは違う失敗だが、
 * 物語が無いという点では同じ。
 *
 * **性格は残す。** 4性格は顧客が選んだ「うちの子はこういう子」の表現なので、
 * 全部をアクション映画にすると商品として壊れる。構造（何かが起きる / 悪化する /
 * 頂点で切る / 結末はタイトル後）は4つ全部に適用し、**何が起きるかと、その深刻さ**
 * だけを性格で変える。easygoing でも「問い」は要るが、それが船体破断である必要はない。
 *
 * 使い方: npx tsx --env-file=.env scripts/preset-story.ts [world]
 *   world: deepspace（既定） | storybook | noir
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { WORLD_COSTUMES, WORLD_INSERTS, WORLD_SCORES, PERSONALITIES, type Personality } from "@/lib/film-script";
import { SYSTEM_PROMPT } from "@/lib/claude-script";
import { STORY_RULES, CARD_RULES, WITHHOLD_RULES, storyTool } from "./story-rules";

/**
 * 世界の説明。FILM_SCRIPTS の既存6カットから読み取れる「その世界らしさ」を
 * 文章にしたもの — 世界そのものを作り変えるのが目的ではないので、
 * 舞台と小道具は今あるものを引き継ぐ。
 */
const WORLD_BRIEF: Record<string, string> = {
  deepspace:
    "A deep-space starship: the bridge with its viewport and star-chart holograms, the engine bay, the airlock, the hull, and alien surfaces under strange suns. Corridors lit by console glow and alert strips.",
  storybook:
    "A storybook kingdom: the castle courtyard and its banners, the royal library, a stone bridge over a river gorge, wildflower meadows, and an ancient forest where fireflies drift.",
  noir:
    "A rain-slicked noir city at night: neon signs bleeding into puddles, a detective's office with venetian blinds, empty alleys, midnight crosswalks, and taillights receding into fog.",
};

/**
 * 性格ごとの「どんな厄介事か」。**構造は共通、強度だけ変える。**
 * ここを書き分けないと4性格が同じ話になり、顧客が性格を選ぶ意味が消える。
 */
const PERSONALITY_BRIEF: Record<Personality, string> = {
  // 最初の版は "something is breaking, burning, flooding, or closing in" と
  // 候補を並べた。3世界とも brave だけが**そのリストを全部やった** — 橋が割れ、
  // 旗が燃え、燭台が倒れ、井戸が崩れる。無関係な災害の羅列で、1つの問題が
  // 悪化していく形になっていない。他3性格は1本道だったので、原因は列挙。
  brave:
    "BRAVE. Real physical danger with real stakes, and the pet runs at it. This is the one personality whose film is an action film. ONE emergency only, from one cause, escalating: name the single thing that goes wrong at cut 0 and let every later cut be that same thing getting worse and harder to stop. Do NOT stage a series of separate accidents — a second unrelated disaster makes it a list, not a story. The ending is earned and triumphant.",
  easygoing:
    "EASYGOING. Gentle stakes, but stakes. Nothing explodes. Something small goes wrong that MATTERS to this pet and would be lost if it did nothing — weather closing in before it gets home, something precious drifting away, the light going before the job is done. Calm does not mean nothing happens: the viewer must still want to know how it turns out. The ending is warm and restful.",
  playful:
    "PLAYFUL. Mischief with consequences. The pet causes the problem, or makes it worse, and then has to deal with it — something knocked loose, something set rolling, a door left open. Comic escalation, real jeopardy underneath, no cruelty. The ending is a lucky, delighted landing.",
  timid:
    "TIMID. The threat is real but the story is about fear. The problem arrives, the pet is frightened of it, and the trailer's question is whether it can make itself act at all. The peak is the moment it moves despite being afraid. The ending is quiet, proud relief.",
};

const PRESET_RULES = `

---

11. THIS IS A PRESET WORLD, NOT A CUSTOM BRIEF.

The costume is ALREADY LOCKED and is given to you below. Return it VERBATIM in
the "costume" field — do not reword, extend, or improve it. It is already in
production and any change would make this world's films inconsistent with the
ones already delivered.

The pet has NO NAME here: this text is reused across every customer who picks
this world, so write "{name}" wherever the loglines would use the pet's name
(it is substituted per order at render time). Never invent a name. The "cuts"
text must not refer to the pet by name at all — write "the pet", "the small
dog", or simply describe the action.

The PERSONALITY given below decides WHAT the trouble is and HOW severe, never
WHETHER there is any. All four personalities get the same structure: a
situation, something going wrong, it getting worse, the pet committing to act,
the peak withheld, and the customer-facing ending after the title. An easygoing
film is not an eventless film — it is a gentle problem that still has to be
solved before the light goes.

"treatmentText" is not used for presets. Write one short sentence there.`;

/**
 * 既に生成して**採用が決まった** premise。`--only` で1性格だけ作り直すときに、
 * 残り3本の話を「これは使うな」として渡すために要る — 作り直した1本が
 * 他の3本と同じ事故になっては、直した意味がない。
 *
 * brave 以外の9本は 2026-08-14 の生成をオーナーが採用。brave だけ、
 * 災害の羅列になっていたので PERSONALITY_BRIEF.brave を直して作り直す。
 */
const KEPT_PREMISES: Record<string, Partial<Record<Personality, string>>> = {
  deepspace: {
    easygoing: "A HAIRLINE CRACK IN THE GREENHOUSE DOME IS LETTING THE COLD OF SPACE IN, PANE BY PANE.",
    playful: "ONE LOOSE CANISTER IN THE CARGO BAY IS ABOUT TO SPILL SOMETHING ACROSS EVERY DECK.",
    timid: "A DISTRESS SIGNAL IS LOOPING FROM A DYING HATCH SOMEWHERE ON THIS SHIP.",
  },
  storybook: {
    easygoing: "A WISHING LANTERN SLIPS ITS STAKE — AND THE STORM WANTS IT FIRST.",
    playful: "ONE CURIOUS PAW TOPPLES THE ROYAL LIBRARY'S TALLEST SHELF.",
    timid: "A DROPPED CANDLE. A LIBRARY OF A THOUSAND YEARS BEGINS TO BURN.",
  },
  noir: {
    easygoing: "A LAST DRY MAP OF THE CITY IS TEARING LOOSE OFF THE ROOFTOPS BEFORE THE STORM HITS.",
    playful: "ONE STACK OF EVIDENCE BOXES. ONE NOSY DOG. ONE CITY FILE ROOM ABOUT TO CATCH FIRE.",
    timid: "A BURST MAIN IS FLOODING THE LOWER STREETS, AND THE WATER WANTS ONE LOCKED DOOR.",
  },
};

type Bundle = {
  costume?: string;
  cuts?: { scene: string }[];
  inserts?: string[];
  loglines?: Record<string, string>;
  score?: string;
};

async function one(
  client: Anthropic,
  world: string,
  personality: Personality,
  taken: { personality: Personality; premise: string }[]
): Promise<Bundle> {
  const userMessage = [
    `PRESET WORLD: ${world}`,
    ``,
    `Setting: ${WORLD_BRIEF[world]}. These are examples of what exists in this world, not a list to work through — invent other corners of it.`,
    ``,
    `LOCKED COSTUME (return verbatim): ${WORLD_COSTUMES[world]}`,
    ``,
    `Personality: ${PERSONALITY_BRIEF[personality]}`,
    ``,
    // 並列生成した最初の版は、4性格すべてが「船体が破れる→レバーを締める」に
    // なった。性格ごとに強度を書き分けても、問題そのものが同じでは4本が1本になる。
    // 直列にして、既に使った話を渡す。
    ...(taken.length
      ? [
          `ALREADY USED BY THE OTHER FILMS IN THIS WORLD — your story must NOT be a variation of any of these. A different thing must go wrong, in a different part of this world, resolved by a different kind of action:`,
          ...taken.map((t) => `  - ${t.personality}: ${t.premise}`),
          ``,
        ]
      : []),
    `For reference, the atmospheric fragments this world already uses as B-roll:`,
    ...(WORLD_INSERTS[world] ?? []).map((s) => `  - ${s}`),
    ``,
    `Existing score direction for this world (you may sharpen it into trailer structure, but keep the instrumentation and mood): ${WORLD_SCORES[world]}`,
  ].join("\n");

  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT + STORY_RULES + CARD_RULES + WITHHOLD_RULES + PRESET_RULES,
    messages: [{ role: "user", content: userMessage }],
    tools: [storyTool()],
    tool_choice: { type: "tool", name: "submit_treatment" },
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error(`${world}/${personality}: no tool_use block`);
  return block.input as Bundle;
}

function show(world: string, personality: Personality, b: Bundle) {
  console.log(`\n${"=".repeat(72)}\n${world} / ${personality}\n${"=".repeat(72)}`);
  b.cuts?.forEach((c, i) => console.log(`  ${i}  ${c.scene}`));
  console.log(`\n  --- loglines ---`);
  for (const [k, v] of Object.entries(b.loglines ?? {})) console.log(`  ${k.padEnd(9)} ${v}`);
  if (b.costume && b.costume !== WORLD_COSTUMES[world]) {
    console.log(`\n  ⚠ 衣装が書き換えられている（そのまま返すよう指示済み）:\n    ${b.costume.slice(0, 160)}…`);
  }
  console.log(`\n  score: ${String(b.score ?? "").slice(0, 200)}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const world = process.argv[2] ?? "deepspace";
  if (!WORLD_COSTUMES[world]) throw new Error(`unknown world: ${world}`);

  // --only <personality>: 1性格だけ作り直す。残り3本は KEPT_PREMISES から
  // 「使うな」リストとして渡す。
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > 0 ? (process.argv[onlyIdx + 1] as Personality) : undefined;
  if (only && !PERSONALITIES.includes(only)) throw new Error(`unknown personality: ${only}`);
  const wanted = only ? [only] : PERSONALITIES;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // 直列。並列だと4本が互いを知らず、同じ事故を4回描く（PERSONALITY_BRIEF.brave のコメント）。
  const results: Bundle[] = [];
  const taken: { personality: Personality; premise: string }[] = only
    ? PERSONALITIES.filter((p) => p !== only && KEPT_PREMISES[world]?.[p]).map((p) => ({
        personality: p,
        premise: KEPT_PREMISES[world]![p]!,
      }))
    : [];
  for (const p of wanted) {
    const b = await one(client, world, p, taken);
    results.push(b);
    taken.push({ personality: p, premise: b.loglines?.premise ?? "(no premise)" });
    console.error(`  … ${p} 完了`);
  }

  wanted.forEach((p, i) => show(world, p, results[i]));

  // 承認後そのまま貼れる形。手で写すと必ず1文字ずれる。
  console.log(`\n\n${"=".repeat(72)}\nFILM_SCRIPTS.${world} — 貼り付け用\n${"=".repeat(72)}`);
  console.log(`  ${world}: {`);
  wanted.forEach((p, i) => {
    console.log(`    ${p}: [`);
    results[i].cuts?.forEach((c) => console.log(`      ${JSON.stringify(c.scene)},`));
    console.log(`    ],`);
  });
  console.log(`  },`);

  console.log(`\n${"=".repeat(72)}\nLOGLINES.${world} — 貼り付け用\n${"=".repeat(72)}`);
  console.log(`  ${world}: {`);
  wanted.forEach((p, i) => {
    const l = results[i].loglines ?? {};
    console.log(`    ${p}: {`);
    for (const k of ["premise", "intro", "turn", "rise", "tagline", "stinger"]) {
      console.log(`      ${k}: ${JSON.stringify(l[k] ?? "")},`);
    }
    console.log(`    },`);
  });
  console.log(`  },`);
}

main().then(() => process.exit(0));
