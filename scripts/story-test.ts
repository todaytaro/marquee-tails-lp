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
// 条項の原本は story-rules.ts。ここに写すと preset-story.ts と食い違う。
import { STORY_RULES, CARD_RULES, WITHHOLD_RULES, storyTool } from "./story-rules";

const DEFAULT_ORDER = "cmsovxam4000004l6jwkmopr1"; // LALA（deepspace）




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

  const [a, c, d] = await Promise.all([
    run(client, "A", SYSTEM_PROMPT, TREATMENT_TOOL, userMessage),
    run(client, "C", SYSTEM_PROMPT + STORY_RULES + CARD_RULES, storyTool(), userMessage),
    run(client, "D", SYSTEM_PROMPT + STORY_RULES + CARD_RULES + WITHHOLD_RULES, storyTool(), userMessage),
  ]);

  show("A — 現行のルール（対照群）", a);
  show("C — 絵に出来事を + 文字に情報を", c);
  show("D — C + 答えを見せない（cut 5 はタイトル後のオチ）", d);
}

main().then(() => process.exit(0));
