-- 決済時の請求先の国・郵便番号を注文に保存する。
--
-- NOT APPLIED BY THIS CHANGE. The owner runs this by hand — local .env
-- DATABASE_URL points at PRODUCTION Supabase, so this repo never runs
-- `prisma migrate` / `db push` against it. This file only records the SQL
-- that prisma/schema.prisma's Order model now expects.
--
-- なぜ持つのか（税務）:
--   ・デジタル役務の内外判定は**顧客の住所地**で行う。海外の顧客への提供は
--     日本の消費税の課税対象外だが、「海外だった」と後から示せる記録が要る。
--     IP ログは根拠にならない。
--   ・米国の州税は州ごとの経済的ネクサス（例: 年10万ドル / 200取引）で
--     判定する。どこからいくら売れたかを自分の側に持っていないと、閾値に
--     近づいたことに気づけない。郵便番号は州を割り出すために要る。
--
-- 既存の shippingCountry とは別物。あちらは物理アドオン（Printify）の
-- 配送先で、基本プランの注文には入らない。こちらは全注文に入る。
--
-- 2026-08-16 より前の注文は NULL のまま。当時 checkout は請求先住所を
-- 集めておらず、遡って埋める手段が無い（Stripe 側にも無い）。集計するときは
-- 「NULL = 記録開始前」として扱うこと — 0件ではない。

ALTER TABLE "Order" ADD COLUMN "billingCountry" TEXT;
ALTER TABLE "Order" ADD COLUMN "billingPostalCode" TEXT;
