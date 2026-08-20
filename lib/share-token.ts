import { randomUUID } from "node:crypto";
import { prisma } from "./db";

/**
 * 贈られた人に渡すトークン（REVEAL-CARD-SPEC）。
 *
 * **approveToken とは別物で、混ぜてはいけない。** approveToken は
 * /approve/[token] を開く鍵で、その画面にはダウンロード・評価・SNS許諾・
 * アドオン購入が並ぶ — 買った人の操作権そのもの。贈られた人が持つべきなのは
 * 「映画とポスターを見る」だけの鍵で、それがこの shareToken。
 *
 * 遅延生成にしてあるのは既存注文のため。Prisma の `@default(cuid())` は
 * これから作る行にしか効かないので、移行SQL（20260818100000_share_token）で
 * 既存行を埋める。**ただしそれに依存しない**: 埋め漏れた行が1つでもあると
 * リビールカードが無言で作れなくなり、今日ロゴが黙って消えていたのと同じ
 * 壊れ方をする。だから必要になった時点で作って保存する。
 */
export async function ensureShareToken(orderId: string): Promise<string> {
  const found = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { shareToken: true },
  });
  if (found.shareToken) return found.shareToken;

  // cuid() は Prisma の DB 既定値側の話なので、ここでは自前で作る。
  // randomUUID は衝突を実質心配しなくてよく、依存も増えない。
  const token = randomUUID();
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { shareToken: token },
    select: { shareToken: true },
  });
  console.log(`[share-token] order=${orderId}: minted a share token (migration backfill had not covered this row)`);
  return updated.shareToken!;
}
