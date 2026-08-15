/**
 * Preset の字幕72行だけを書き直す。使い捨て。
 *
 * 絵コンテ（DRAFT_FILM_SCRIPTS）は採用済みなので触らない。**承認済みの6カットを
 * そのまま渡して、その映画の字幕だけを書かせる** — 絵と文字が別々に生成されると、
 * 文字が絵に無いものを語り始める（それが元々の欠陥だった）。
 *
 * 作り直す理由は文字数。最初の版は CARD_RULES で「90字まで」と許可したが、
 * カードは**2.0秒**しか出ない。大文字の表示フォントは秒15字程度でしか読めず、
 * さらに fitFontSize が長い行ほど小さく縮める。実測すると72行中20行が70字超、
 * 最長102字 — 読み終わらないうえに一番小さい字で出る。上限を55字に絞った。
 *
 * ついでに brave 3本のタイトルが常套句（HOLD THE LINE / SHUT IT DOWN）になって
 * いたので、そこも条項で禁止した。
 *
 * 使い方: npx tsx --env-file=.env scripts/preset-cards.ts [world]
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { PERSONALITIES, type Personality } from "@/lib/film-script";
import { DRAFT_FILM_SCRIPTS, DRAFT_LOGLINES } from "./preset-story-draft";
import { CARD_RULES } from "./story-rules";

const MAX_CHARS = 55;

const SYSTEM = `You write the title cards for a 60-second cinematic movie trailer starring a customer's pet. You are given the six shots of a finished storyboard; write the six cards that play between them.

The cards are the only place the story is told in words. A viewer watches six shots of a small dog and reads six lines, and must come away knowing what the film is about.

Write the cards for THE STORYBOARD YOU ARE GIVEN. Do not invent events the shots do not show, and do not ignore what they do show.

Always respond by calling the submit_cards tool.
${CARD_RULES}

---

PRESET NOTE. This text is reused for every customer who picks this world, so
the pet has no name: write "{name}" wherever the pet's name belongs (it is
substituted per order). Never invent a name.

NEVER WRITE HE, SHE, HIM, HER, HIS OR HERS. You do not know this animal's sex —
the same six cards ship to every customer who picks this world, and half of
them will be reading about the wrong dog. Use "{name}", or "THEY"/"THEM"/
"THEIR", or rewrite the line so no pronoun is needed. A first pass at a shorter
55-character limit produced "THE FROST OUTRUNS HIM" and "HE PLANTS HIS PAWS" —
the model bought characters by swapping the 6-character "{name}" for a
3-character pronoun. Do not make that trade; find the characters elsewhere.

The trailer's last body shot is the peak of the action and the final shot plays
AFTER the title card, so "rise" is the last thing read before the cut to black:
it must sharpen the question, never settle it. Nothing in premise/intro/turn/
rise may reveal that the hero succeeds — even though the storyboard's later
shots show that it does.`;

const TOOL: Anthropic.Tool = {
  name: "submit_cards",
  description: "Submit the six trailer title cards.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      (
        [
          ["premise", "The situation and the threat, named concretely."],
          ["intro", "Who the hero is, and why it is moving or absurd that this falls to them."],
          ["turn", "What goes wrong, or what raises the price. An event."],
          ["rise", "What the hero decides to do about it. Last card before the title — sharpen the question."],
          ["tagline", "The title line. Must only be sayable about THIS story."],
          ["stinger", "The closing joke, shown after the title."],
        ] as const
      ).map(([k, d]) => [k, { type: "string", description: `${d} ALL-CAPS English, ${MAX_CHARS} characters MAXIMUM.` }])
    ),
    required: ["premise", "intro", "turn", "rise", "tagline", "stinger"],
  },
};

const KEYS = ["premise", "intro", "turn", "rise", "tagline", "stinger"] as const;

async function one(client: Anthropic, world: string, personality: Personality) {
  const cuts = (DRAFT_FILM_SCRIPTS as Record<string, Record<string, readonly string[]>>)[world][personality];
  const userMessage = [
    `WORLD: ${world}   PERSONALITY: ${personality}`,
    ``,
    `The six shots, in order:`,
    ...cuts.map((c, i) => `  ${i}. ${c}`),
    ``,
    `Note: shots 4 and 5 play after the title card. Shots 0-3 are the body of the trailer.`,
  ].join("\n");

  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_cards" },
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error(`${world}/${personality}: no tool_use block`);
  return block.input as Record<string, string>;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const worlds = process.argv[2] ? [process.argv[2]] : Object.keys(DRAFT_FILM_SCRIPTS);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let over = 0;
  for (const world of worlds) {
    const out = await Promise.all(PERSONALITIES.map((p) => one(client, world, p)));
    console.log(`\n${"=".repeat(72)}\n${world}\n${"=".repeat(72)}`);
    PERSONALITIES.forEach((p, i) => {
      const old = (DRAFT_LOGLINES as Record<string, Record<string, Record<string, string>>>)[world][p];
      console.log(`\n--- ${p} ---`);
      for (const k of KEYS) {
        const v = out[i][k] ?? "";
        // 55字を超えたら黙って通さない。この作り直しの理由そのものなので、
        // 守れていないなら見えるようにする。
        const flag = v.length > MAX_CHARS ? ` ⚠ ${v.length}字` : "";
        if (v.length > MAX_CHARS) over++;
        console.log(`  ${k.padEnd(8)} ${String(v.length).padStart(3)}  ${v}${flag}`);
        console.log(`  ${"".padEnd(8)} ${String(old[k]?.length ?? 0).padStart(3)}  ${old[k] ?? ""}   ← 旧`);
      }
    });

    console.log(`\n  ${world}: {`);
    PERSONALITIES.forEach((p, i) => {
      console.log(`    ${p}: {`);
      for (const k of KEYS) console.log(`      ${k}: ${JSON.stringify(out[i][k] ?? "")},`);
      console.log(`    },`);
    });
    console.log(`  },`);
  }
  console.log(`\n${MAX_CHARS}字超: ${over} 本`);
}

main().then(() => process.exit(0));
