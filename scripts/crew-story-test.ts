/**
 * 新しい規則で Claude が実際に何を書くかを見る（**文章だけ・画も動画も作らない**）。
 *
 * 変えたのは2つで、どちらも「何を描くか」ではなく「何が描けるか」を変えている:
 *   ・cuts の `crew` — 仲間の犬を背景に置けるカット（最大2、コードで切る）
 *   ・規則7(a) — 敵が**生き物**になれる（インサートの中だけ。飼い犬とは決して
 *     同じ画に入らないので「見せるが出会わない」形になる）
 *
 * 本番と同じ経路（generateTreatment）を通す。scripts/story-test.ts は
 * STORY_RULES を**後付けする**前提の A/B ハーネスで、いまはそれが SYSTEM_PROMPT
 * に取り込み済みなので二重適用になり、比較にならない。
 *
 * 3本のブリーフで、それぞれ別のことを確かめる:
 *   1. 海賊  … 集団が実在する世界。crew が立つか。生き物の敵に手が伸びるか
 *   2. 探偵  … 集団が**いない**世界。「無ければ全部 false」が守られるか
 *   3. 灯台  … 敵を指定しない。生き物を自分から選ぶか、環境のままか
 *
 * 見るのは3点:
 *   ・crew が立ったカットは2本以下か（プロンプト側。コード側の cap は別途検証済み）
 *   ・インサートに生き物を出したなら、6カットのどれかに**痕跡**があるか
 *     （出しっぱなしは「伏線ではなく切れた糸」— 規則に書いた条項が効くか）
 *   ・犬をインサートに出したとき、顔を描かせない書き方になっているか
 *
 * 費用は Anthropic のトークンのみ。fal は1回も呼ばない。
 *
 * 使い方: npx tsx --env-file=.env scripts/crew-story-test.ts
 */
import { generateTreatment } from "@/lib/claude-script";
import { capCrewCuts, MAX_CREW_CUTS } from "@/lib/film-script";

const BRIEFS = [
  {
    name: "PEP",
    label: "海賊（集団が実在する）",
    brief:
      "Setting: The deck of a wooden pirate ship at sea, sails up, rigging everywhere, crates and barrels lashed down. PEP is the captain — a small dog running a ship built for people three times his size.\n" +
      "Mood: Bold and funny. A storm-tossed adventure where the smallest one on board is the one giving orders.\n" +
      "One highlight moment: PEP hauling the ship's wheel around with his whole body while the deck tilts under him.\n" +
      "How it ends: Calm water at dawn. PEP asleep on a coil of rope with the ship's hat over his eyes.",
  },
  {
    name: "MILO",
    label: "探偵（集団がいない）",
    brief:
      "Setting: A rain-soaked city at 3am, empty streets, neon in the puddles, one office with the light still on. MILO works alone.\n" +
      "Mood: Noir. Tired, wry, nobody left to call.\n" +
      "One highlight moment: MILO pulling one file out of a cabinet and knowing, right then, who did it.\n" +
      "How it ends: MILO asleep at the desk, the case file closed under one paw.",
  },
  {
    name: "NOA",
    label: "灯台（敵を指定しない）",
    brief:
      "Setting: A lighthouse on a rock in the North Sea. NOA keeps the light.\n" +
      "Mood: Lonely and grand. Very old, very cold, the sea always doing something.\n" +
      "One highlight moment: NOA climbing the spiral stairs to relight the lamp.\n" +
      "How it ends: The lamp turning again at dawn, NOA curled at the top of the stairs.",
  },
];

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

async function main() {
  for (const b of BRIEFS) {
    console.log(`\n${"=".repeat(70)}\n${b.name} — ${b.label}\n${"=".repeat(70)}`);
    const r = await generateTreatment({ brief: b.brief, petName: b.name });
    if (r.status !== "ok") {
      console.log(`REJECTED: ${r.reason}`);
      continue;
    }
    const cuts = r.bundle.cuts;
    const crewRaw = cuts.map((c) => c.crew === true);
    const crewCapped = capCrewCuts(cuts);

    console.log(`\n--- costume ---\n${r.bundle.costume}`);
    console.log(`\n--- cuts ---`);
    cuts.forEach((c, i) => {
      console.log(`${i}${c.crew ? " [CREW]" : "      "} ${c.scene}`);
      if (c.action) console.log(`        action: ${c.action}`);
    });
    console.log(`\n--- inserts ---`);
    (r.bundle.inserts ?? ["(なし)"]).forEach((s, i) => console.log(`${i}: ${s}`));
    console.log(`\n--- loglines ---`);
    for (const [k, v] of Object.entries(r.bundle.loglines)) console.log(`${k}: ${v}`);

    // 判定
    const crewCount = crewRaw.filter(Boolean).length;
    console.log(`\n--- 判定 ---`);
    console.log(
      `crew: Claude が ${crewCount} 本 -> コードで ${crewCapped.filter(Boolean).length} 本` +
        `${crewCount > MAX_CREW_CUTS ? `  ※プロンプトの上限(${MAX_CREW_CUTS})を超えた。コード側の cap が仕事をした` : ""}`
    );

    // インサートの生き物が6カットに痕跡を残しているか（語の重なりで粗く見る）
    const inserts = r.bundle.inserts ?? [];
    const cutText = cuts.map((c) => c.scene).join(" ");
    const cutWords = words(cutText);
    inserts.forEach((ins, i) => {
      const shared = [...words(ins)].filter((w) => cutWords.has(w));
      console.log(`insert${i} と cuts の共通語: ${shared.length ? shared.join(", ") : "**なし（切れた糸の疑い）**"}`);
    });
    const dogInInsert = inserts.some((s) => /\bdogs?\b|puppy|hound/i.test(s));
    if (dogInInsert) console.log(`※ インサートに犬あり — 顔を描かせない書き方か目視で確認すること`);
  }
}

main().then(() => process.exit(0));
