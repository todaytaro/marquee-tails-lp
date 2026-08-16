import { NextResponse } from "next/server";
import { getStripeClient, getPriceId, type Tier } from "@/lib/stripe";
import { checkoutConsentText } from "@/lib/checkout-consent";
import { isBlockedCountry, BLOCKED_COUNTRY_MESSAGE } from "@/lib/sales-regions";

const VALID_TIERS: Tier[] = ["preset", "custom"];

/**
 * Creates a Stripe Checkout Session for one of the 2 plans
 * (PRICING-PRODUCT-V2-SPEC.md).
 *
 * POST { tier: "preset" | "custom" }
 *
 * "custom" (Director's Cut) is video-only at base checkout, same session
 * shape as preset — the Claude script-generation + treatment-approval flow
 * (Director's Cut B1) picks up after intake, at /approve/[token].
 *
 * Returns 503 while STRIPE_SECRET_KEY is unset, same "not configured yet"
 * posture as the rest of the app's optional integrations.
 */
export async function POST(req: Request) {
  let body: { tier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { tier } = body;
  if (typeof tier !== "string" || !VALID_TIERS.includes(tier as Tier)) {
    return NextResponse.json(
      { ok: false, error: `tier must be one of: ${VALID_TIERS.join(", ")}.` },
      { status: 400 }
    );
  }

  // EU/英国は VAT 登録が済むまで売らない（lib/sales-regions.ts に理由）。
  // Stripe Checkout には請求先の国を制限する機能が無い（配送先にはあるが、
  // デジタル商品では配送先を取らない）ので、セッションを作る前にここで断る。
  //
  // **IP による判定は完全ではない** — VPN や企業回線で誤判定しうるし、
  // 判定できない場合は通す方に倒している（正規の顧客を落とす方が損失が
  // 大きい）。確実に締めたいなら Stripe Radar のルールを併用する。実際の
  // 課税判定の根拠になるのは、下で必須にした請求先住所の方。
  const ipCountry = req.headers.get("x-vercel-ip-country");
  if (isBlockedCountry(ipCountry)) {
    console.log(`[checkout] blocked country=${ipCountry} tier=${tier}`);
    return NextResponse.json({ ok: false, error: BLOCKED_COUNTRY_MESSAGE }, { status: 451 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, error: "Payments aren't configured yet." },
      { status: 503 }
    );
  }

  const priceId = getPriceId(tier as Tier);
  if (!priceId) {
    console.error(`[checkout] no Price ID configured for tier=${tier}`);
    return NextResponse.json(
      { ok: false, error: "This tier isn't configured yet." },
      { status: 500 }
    );
  }

  try {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3100";
    // Pass 1: "preset" is video-only (the digital poster ships free, no
    // physical good at base checkout) — no shipping address is collected
    // here. Printed poster / gallery canvas become a post-delivery add-on
    // purchase in a later pass (see PRICING-PRODUCT-V2-SPEC.md §5), with its
    // own Checkout session and shipping collection at that time.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      // 請求先住所を必須にする。理由は2つあって、どちらも税務。
      //   1. デジタル役務の内外判定は**顧客の住所地**で行う。海外の顧客なら
      //      日本の消費税は課税対象外だが、「海外だった」と後から示せる記録が
      //      無いと主張できない。IP は根拠にならない。
      //   2. 米国の州税は経済的ネクサス（州ごとの閾値）で判定する。どの州から
      //      いくら売れたかを持っていないと、閾値に近づいたことに気づけない。
      billing_address_collection: "required",
      // Stripe Tax。**既定は無効**にしてある — 有効にするには Stripe 側で
      // 事業所所在地と税務登録を先に設定する必要があり、未設定のまま送ると
      // セッション作成が失敗して決済導線ごと落ちる。ダッシュボードの設定を
      // 済ませてから STRIPE_AUTOMATIC_TAX=1 を入れる、という順序にする。
      ...(process.env.STRIPE_AUTOMATIC_TAX === "1"
        ? { automatic_tax: { enabled: true as const } }
        : {}),
      // Forces the buyer to check a Terms-of-service consent box on the
      // Stripe-hosted Checkout page. NOTE: this only works once the owner
      // sets the Terms of service URL in the Stripe Dashboard under
      // Settings -> Public business information -> Terms of service
      // (domain-dependent, done after the real domain is live).
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          // Absolute URLs, because this is the line the buyer actually ticks
          // to agree. `(URL)` shipped here as a literal placeholder, so the
          // consent pointed at nothing on the one page where it has to
          // resolve — and Checkout is served from Stripe's domain, so a
          // relative path would not work either.
          //
          // checkoutConsentText (lib/checkout-consent.ts) owns the exact
          // wording — including the non-refundable-fee dollar figure, which
          // it derives from NONREFUNDABLE_FEE_USD (lib/safety-net.ts) rather
          // than a literal here — so the Stripe webhook can record this SAME
          // string as chargeback evidence without the two ever drifting
          // apart (CHARGEBACK-DEFENSE-SPEC.md §3).
          message: checkoutConsentText(tier as Tier, base),
        },
      },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/#pricing`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[checkout] session creation failed", err);
    return NextResponse.json(
      { ok: false, error: "Something went wrong on our end." },
      { status: 500 }
    );
  }
}
