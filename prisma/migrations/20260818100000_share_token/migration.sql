-- 贈られた人に渡す専用トークン（REVEAL-CARD-SPEC）。
--
-- NOT APPLIED BY THIS CHANGE. ローカルの DATABASE_URL は**本番の Supabase**を
-- 指しているので、このリポジトリは prisma migrate / db push を実行しない。
-- このファイルは prisma/schema.prisma が期待する SQL の記録で、実行はオーナーが手で行う。
--
-- なぜ approveToken を使い回さないのか:
--   approveToken は /approve/[token] を開く鍵で、その画面にはダウンロード・評価・
--   SNS許諾・アドオン購入が並ぶ。贈られた人に渡すと、買った人の操作権を渡すことになる。
--   shareToken は /premiere/[token]（再生のみ）専用。
--
-- なぜ NULL 可なのか:
--   Prisma の @default(cuid()) は**これから作る行**にしか効かない。既存行は
--   この UPDATE で埋める。埋め漏れても機能が壊れないよう、コード側も
--   null なら生成して保存する（lib/share-token.ts）。
--
-- gen_random_uuid() は pgcrypto。Supabase では既定で有効。使えない場合は
--   md5(random()::text || clock_timestamp()::text)
-- に置き換えてよい（衝突は UNIQUE 制約が弾く）。

ALTER TABLE "Order" ADD COLUMN "shareToken" TEXT;

UPDATE "Order" SET "shareToken" = gen_random_uuid()::text WHERE "shareToken" IS NULL;

CREATE UNIQUE INDEX "Order_shareToken_key" ON "Order"("shareToken");
