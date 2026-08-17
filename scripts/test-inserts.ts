/**
 * Preset の B-roll が満たすべき性質を検査する（生成なし・DB なし・純粋な計算）。
 *
 * WORLD_INSERTS の doc コメントは「5本中3本に生き物を入れてあるので、どの注文にも
 * 必ず1本以上入る」と主張している。**主張はコードで確かめられる形にしておかないと、
 * 次に誰かが本数を2本に減らしたときに黙って嘘になる。** ここがその番人。
 *
 * pickWorldInserts は連続3本（base, base+1, base+2）を採るので、外れるのは常に
 * 2本だけ。生き物が3本あれば鳩の巣原理で必ず当たる — その論理を全 base で
 * 実際に回して確かめる。
 *
 * 使い方: npx tsx scripts/test-inserts.ts
 */
import { WORLD_INSERTS, pickWorldInserts } from "@/lib/film-script";

/** 生き物を名指ししている語。プールの文面と対応させて手で保守する。 */
const CREATURE =
  /\b(creature|drifters|winged|stag|birds?|fox|rat|crow|moth|shoal)\b/i;

/** ここに犬が出てはいけない — LoRA を通らないので他人の犬になる。 */
const DOG = /\b(dogs?|puppy|puppies|hound|terrier|beagle)\b/i;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
  if (ok) pass++;
  else fail++;
}

for (const [world, pool] of Object.entries(WORLD_INSERTS)) {
  check(`${world}: プールは5本`, pool.length === 5, `actual=${pool.length}`);

  const creatures = pool.filter((p) => CREATURE.test(p)).length;
  check(
    `${world}: 生き物入りが3本以上（どの注文にも1本以上入るための条件）`,
    creatures >= 3,
    `actual=${creatures}`
  );

  const dogs = pool.filter((p) => DOG.test(p));
  check(`${world}: 犬が1本も出てこない`, dogs.length === 0, dogs.join(" / "));

  const people = pool.filter((p) => !/no people/i.test(p));
  check(`${world}: 全本が "no people" を含む`, people.length === 0, people.join(" / "));

  // 本番の選び方そのもので、全 base を回す。orderId は使わず base を直接動かす —
  // ハッシュの当たり外れではなく、**どの base でも成り立つ**ことを見たい。
  let worstCase = -1;
  for (let base = 0; base < pool.length; base++) {
    const picked = [0, 1, 2].map((k) => pool[(base + k) % pool.length]);
    const n = picked.filter((p) => CREATURE.test(p)).length;
    if (worstCase < 0 || n < worstCase) worstCase = n;
  }
  check(
    `${world}: どの base でも生き物が最低1本は選ばれる`,
    worstCase >= 1,
    `最悪の base で ${worstCase} 本`
  );
}

// pickWorldInserts が実際に3本返し、決定的であること（再レンダリングで
// 別の3本になると、admin が直したはずのものが直っていないように見える）。
const a = pickWorldInserts("noir", "cmtestorder000000000000");
const b = pickWorldInserts("noir", "cmtestorder000000000000");
check("pickWorldInserts は3本返す", a.length === 3, `actual=${a.length}`);
check("pickWorldInserts は決定的", JSON.stringify(a) === JSON.stringify(b));
check(
  "未知の世界は deepspace にフォールバックする",
  JSON.stringify(pickWorldInserts("nosuchworld", "cmtestorder000000000000")) ===
    JSON.stringify(pickWorldInserts("deepspace", "cmtestorder000000000000"))
);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
