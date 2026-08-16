/**
 * Preset 12アークの「中途の動作」だけを直す（使い捨て・文章のみ）。
 *
 * 12アークは条項(e)が「決定的瞬間を書け」だった時期に作った。その条項は
 * 2026-08-15 に撤回されている — 動作の途中を静止画に描かせると胴が伸び、
 * 関節が壊れるため（TRAILER-STORY-V3-SPEC.md §8）。実際いまの下書きには
 * "caught mid-run, front paws off the ground" / "skidding, one back leg thrown
 * out sideways" / "mid-step over the threshold" が残っている。
 *
 * **再生成ではなく改訂。** 字幕72行はその物語固有の出来事を指しているので
 * （温室ドーム、玉軸受、屋上タンク）、絵コンテが別の話になると食い違う。
 * 物語・対象物・場所・順序は保持し、**姿勢だけ**を直させる。
 *
 * 使い方: npx tsx --env-file=.env scripts/preset-repose.ts
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { PERSONALITIES, type Personality } from "@/lib/film-script";
import { DRAFT_FILM_SCRIPTS } from "./preset-story-draft";

const SYSTEM = `You are revising the storyboard text for a 60-second pet trailer. You are NOT writing a new story.

Each scene becomes ONE still image, which a video model animates afterwards. A still of a body mid-movement has no correct answer, so the image generator invents one — that is how stretched torsos and impossible joints get made. These scenes were written under an earlier rule that asked for "the decisive instant of an action", and some of them now describe a body in flight.

YOUR ONLY JOB is to replace any mid-movement pose with a STABLE, LOADED one.

  STABLE   — a pose a photograph can hold: braced, crouched, gathered, standing,
             reaching and holding, weight planted.
  LOADED   — but not rested. It must still have a big movement waiting inside
             it: gathered before a spring, braced at the START of a pull, at the
             near end of a corridor not yet crossed, one paw lifted at the edge
             of a jump.

  BANNED   — caught mid-run, mid-stride, mid-leap, mid-fall, mid-skid, legs off
             the ground, body twisting through the air.

EVERYTHING ELSE MUST SURVIVE UNCHANGED. Same story, same objects, same
locations, same order, same what-goes-wrong, same ending. The title cards for
these films are already written and they name these specific objects and
events — if you invent a different mishap, the cards stop matching the pictures.

Keep each scene's length and voice. If a scene is already a stable pose, RETURN
IT VERBATIM — most of them are fine, and a needless rewrite risks drifting the
story. Change only what is actually mid-movement.

Respond by calling submit_arc. English only.`;

const TOOL: Anthropic.Tool = {
  name: "submit_arc",
  description: "Return the six revised scenes, in order.",
  input_schema: {
    type: "object",
    properties: {
      scenes: { type: "array", items: { type: "string" }, description: "EXACTLY 6, in the same order as given." },
      changed: {
        type: "array",
        items: { type: "number" },
        description: "Indices (0-5) you actually rewrote. Leave empty if none needed changing.",
      },
    },
    required: ["scenes", "changed"],
  },
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const out: Record<string, Record<string, string[]>> = {};

  for (const [world, arcs] of Object.entries(DRAFT_FILM_SCRIPTS)) {
    out[world] = {};
    for (const p of PERSONALITIES) {
      const scenes = (arcs as Record<Personality, readonly string[]>)[p];
      const res = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: "user", content: scenes.map((s, i) => `${i}. ${s}`).join("\n\n") }],
        tools: [TOOL],
        tool_choice: { type: "tool", name: "submit_arc" },
      });
      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!block) throw new Error(`${world}/${p}: no tool_use`);
      const { scenes: revised, changed } = block.input as { scenes: string[]; changed: number[] };
      if (revised.length !== 6) throw new Error(`${world}/${p}: got ${revised.length} scenes, expected 6`);
      out[world][p] = revised;

      console.log(`\n=== ${world}/${p} — 変更 ${changed.length}/6 ===`);
      for (const i of changed) {
        console.log(`\n  [${i}] 旧: ${scenes[i]}`);
        console.log(`      新: ${revised[i]}`);
      }
      if (!changed.length) console.log("  （変更なし）");
    }
  }

  console.log(`\n\n${"=".repeat(72)}\n貼り付け用\n${"=".repeat(72)}`);
  for (const [world, arcs] of Object.entries(out)) {
    console.log(`  ${world}: {`);
    for (const p of PERSONALITIES) {
      console.log(`    ${p}: [`);
      for (const s of arcs[p]) console.log(`      ${JSON.stringify(s)},`);
      console.log(`    ],`);
    }
    console.log(`  },`);
  }
}

main().then(() => process.exit(0));
