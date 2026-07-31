import type { Loglines, Personality } from "./film-script";

/**
 * Japanese glosses of the trailer cards — ADMIN ONLY.
 *
 * The cards themselves stay English: the audience is English-speaking, and
 * FONT_DISPLAY (Bebas Neue) is Latin-only anyway. But the person running the
 * service reads Japanese, and had no way to check what the film was actually
 * saying — "字幕（トレーラーカード）" in app/admin/[orderId] showed six English
 * lines and nothing else. You cannot judge whether a card matches the footage
 * it sits between if you cannot read the card.
 *
 * Deliberately a separate file from film-script.ts: nothing here ever reaches
 * the pipeline, the customer, or a generation prompt. It exists purely so the
 * admin view can show a translation underneath each card. Keeping it out of
 * the pipeline's core file is also what makes it obvious that adding a
 * translation can never change a film.
 *
 * `{name}` is left in place and substituted by the caller (fillPetName), the
 * same way the English lines are, so the gloss reads with the pet's name too.
 *
 * A world/personality with no entry simply shows no translation — this must
 * never be load-bearing.
 */
export const LOGLINES_JA: Record<string, Record<Personality, Required<Loglines>>> = {
  deepspace: {
    brave: {
      premise: "最後の前哨基地が、消息を絶った。",
      intro: "銀河は英雄を求めていた。",
      turn: "まさか{name}だとは。",
      rise: "勇気は体の大きさを問わない。",
      tagline: "星々へ、そして帰還を",
      stinger: "操縦席には補助シートが付いていた。",
    },
    easygoing: {
      premise: "全艦隊が辺境を目指して先を争っている。",
      intro: "最果ての星の、その先で……",
      turn: "……{name}は、ゆっくり行く道を選んだ。",
      rise: "景色は、ゆっくりの方が美しい。",
      tagline: "ここでは急ぐ必要はない",
      stinger: "到着予定時刻：そのうち。",
    },
    playful: {
      premise: "宇宙ステーションの備品が、次々と消えていく。",
      intro: "無重力。ルールもゼロ。",
      turn: "そこへ{name}が漂ってきた。",
      rise: "軌道上に安全なおやつは存在しない。",
      tagline: "軌道上のトラブルメーカー",
      stinger: "プレッツェルは、ついに発見されなかった。",
    },
    timid: {
      premise: "小さな船が一隻、航路を外れて漂っていた。",
      intro: "宇宙は、とてもとても広い。",
      turn: "そして{name}は、とても小さい。",
      rise: "勇気は、静かな者のもとに訪れる。",
      tagline: "遠回りの帰り道",
      stinger: "船室の灯りは点けたまま。これは譲れない。",
    },
  },
  storybook: {
    brave: {
      premise: "竜が、高い塔を奪った。",
      intro: "勇気を忘れた王国に……",
      turn: "……{name}が立ち上がった。",
      rise: "伝説は、どんな大きさにも宿る。",
      tagline: "しっぽの勇者伝",
      stinger: "王国はスリッパを返してほしいそうだ。",
    },
    easygoing: {
      premise: "王が、最後の大いなる冒険を布告した。",
      intro: "果てなき冒険の王国で……",
      turn: "……{name}は寄り道を選んだ。",
      rise: "どんな国にも、休息は必要だ。",
      tagline: "おだやかなる治世",
      stinger: "冒険は昼寝のあとでいい。",
    },
    playful: {
      premise: "宴のたびに、王室のタルトが消えていく。",
      intro: "どんな王国にも伝説は要る。",
      turn: "この国が得たのは{name}だった。",
      rise: "王室のタルトを厳重に隠せ。",
      tagline: "ロイヤル・いたずら譚",
      stinger: "王冠にパン屑が付いていないか確認せよ。",
    },
    timid: {
      premise: "夜ごと、何かが城門を見つめていた。",
      intro: "森は暗く、深かった……",
      turn: "……だが{name}は違った。",
      rise: "どんなに小さくても、一歩は一歩。",
      tagline: "森の奥へ",
      stinger: "十分に勇敢。ただし昼間に限る。",
    },
  },
  noir: {
    brave: {
      premise: "この街から、何かが消えた。",
      intro: "街は決して眠らない。",
      turn: "{name}もまた、眠らない。",
      rise: "どんな事件にも、相手はいる。",
      tagline: "一件落着",
      stinger: "{name}は、いまだにドアノブに手が届かない。",
    },
    easygoing: {
      premise: "十年、迷宮入りしたままの事件がある。",
      intro: "どんな街にも影がある……",
      turn: "……{name}は、焦らない。",
      rise: "真実は、コーヒーのあとでいい。",
      tagline: "アフター・アワーズ",
      stinger: "コーヒーの方が、事件より長持ちした。",
    },
    playful: {
      premise: "町中のゴミ箱が、何者かに荒らされている。",
      intro: "謎だらけの街。",
      turn: "そして{name}：ただの無秩序。",
      rise: "手がかりは混沌のみ。",
      tagline: "いつもの容疑者",
      stinger: "逮捕者なし。反省もなし。",
    },
    timid: {
      premise: "霧のどこかで、目撃者が姿を消した。",
      intro: "通りは冷たく、非情だった……",
      turn: "……{name}が立ち上がるまでは。",
      rise: "勇気は小さなコートを着ている。",
      tagline: "霧を抜けて",
      stinger: "{name}は、いまも雷にびくつく。",
    },
  },
};
