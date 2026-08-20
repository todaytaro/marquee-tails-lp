import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import { FONTS, notoFontsFor } from "./poster-print";
import { stripLeadingPetName } from "./film-script";

/**
 * リビールカード — 贈る人が渡すための、映画のチケット（REVEAL-CARD-SPEC）。
 *
 * LP のギフト欄が以前から "Gift options come with a cinematic reveal card" と
 * 書いていたのに、**実体が無かった**。これがその実体。
 *
 * ポスター（lib/poster-print.ts）と同じ satori -> resvg 経路で、**生成AIを一切
 * 使わない**。追加費用ゼロなので、ギフト限定の特典にせず全注文に付ける
 * ——「原価がかからないものを出し惜しみして、LP の記述を嘘のままにしておく」
 * 理由が無い。
 *
 * 5×7インチ / 300dpi = 1500×2100。写真プリントの標準サイズなので、贈る人が
 * コンビニでも自宅でも刷れる。画像のまま送ってもいい。
 *
 * QR の宛先は `/premiere/[shareToken]`。**`/approve/[approveToken]` ではない。**
 * あちらは買った人の操作画面（ダウンロード・評価・アドオン購入）で、カードに
 * 刷ったら贈られた人に操作権を渡してしまう。lib/share-token.ts の注記も参照。
 */

const W = 1500;
const H = 2100;

/** ポスターと同じ絵柄の色。night / gold / ivory。 */
const NIGHT = "#0b0a10";
const GOLD = "#e8b64c";
const IVORY = "#f4f1e8";

/** 用紙の中で使える幅に対する比率で組む（ポスターの cqi と同じ考え方）。 */
const px = (ratio: number) => Math.round((ratio / 100) * W);

export type RevealCardText = {
  petName: string;
  /** 映画のタグライン（loglines.tagline）。名前が頭に付いていたら落とす。 */
  subtitle?: string;
  /** 贈られた人が開く URL。QR とテキストの両方に出る。 */
  watchUrl: string;
};

/** QR を satori に埋められる data URI にする。 */
async function qrDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 0,
    // 暗部を金、明部を透明にはできない（satori/resvg は QR の白を必要とする）。
    // 紙に刷る前提なので、読み取り率を優先して黒白のままにする。
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * カードを PNG で返す。保存もアップロードもしない — 呼び出し側が
 * そのままレスポンスに流す。**保管しない理由**: 中身は注文の名前・タグライン・
 * トークンだけで、いつでも同じものが再生成できる。列を1つ増やして
 * 「古いカードが残っている」状態を作る価値がない。
 */
export async function renderRevealCardPng(t: RevealCardText): Promise<Buffer> {
  const name = t.petName.toUpperCase();
  const subtitle = t.subtitle ? stripLeadingPetName(t.subtitle, t.petName).toUpperCase() : undefined;
  const qr = await qrDataUri(t.watchUrl);

  // 日本語の名前でも豆腐にならないよう、ポスターと同じ解決を使う。
  const { fonts: notoFonts, names: notoNames } = notoFontsFor(name);
  const display = notoNames ? `Bebas Neue, ${notoNames}` : "Bebas Neue";

  const row = (children: unknown[], style: Record<string, unknown> = {}) => ({
    type: "div",
    props: { style: { display: "flex", alignItems: "center", justifyContent: "center", ...style }, children },
  });
  const text = (content: string, style: Record<string, unknown>) => ({
    type: "div",
    props: { style: { display: "flex", ...style }, children: content },
  });

  const tree = {
    type: "div",
    props: {
      style: {
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: NIGHT,
        paddingTop: px(7),
        paddingBottom: px(7),
        paddingLeft: px(6),
        paddingRight: px(6),
      },
      children: [
        // --- 上: ブランドと「一夜限り」 ---
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center" },
            children: [
              text("MARQUEE TAILS", {
                fontFamily: "Bebas Neue",
                fontSize: px(4.6),
                letterSpacing: px(4.6) * 0.32,
                color: IVORY,
              }),
              text("ONE NIGHT ONLY", {
                fontFamily: "Inter",
                fontSize: px(1.9),
                letterSpacing: px(1.9) * 0.42,
                color: GOLD,
                marginTop: px(2.4),
              }),
            ],
          },
        },

        // --- 中: 主役の名前とタグライン ---
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" },
            children: [
              text("STARRING", {
                fontFamily: "Inter",
                fontSize: px(1.7),
                letterSpacing: px(1.7) * 0.5,
                color: "#f4f1e8a8",
                marginBottom: px(2.2),
              }),
              text(name, {
                fontFamily: display,
                fontWeight: 700,
                fontSize: px(name.length > 9 ? 13 : 17),
                lineHeight: 0.86,
                color: GOLD,
                maxWidth: px(88),
              }),
              ...(subtitle
                ? [
                    { type: "div", props: { style: { display: "flex", width: px(34), height: 2, background: "#e8b64c66", marginTop: px(4), marginBottom: px(3.4) } } },
                    text(subtitle, {
                      fontFamily: "Bebas Neue",
                      fontSize: px(2.9),
                      letterSpacing: px(2.9) * 0.16,
                      lineHeight: 1.2,
                      color: IVORY,
                      maxWidth: px(80),
                      textAlign: "center",
                    }),
                  ]
                : []),
            ],
          },
        },

        // --- 下: 半券。切り取り線 → QR → 案内 ---
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center", width: "100%" },
            children: [
              // 破線。satori に border-style: dashed は無いので、四角を並べて作る。
              row(
                Array.from({ length: 26 }, () => ({
                  type: "div",
                  props: { style: { display: "flex", width: px(1.5), height: 2, background: "#f4f1e83d", marginLeft: px(0.55), marginRight: px(0.55) } },
                })),
                { width: "100%", marginBottom: px(5) }
              ),
              {
                type: "div",
                props: {
                  style: { display: "flex", padding: px(1.6), background: "#ffffff", borderRadius: px(1) },
                  children: [
                    { type: "img", props: { src: qr, width: px(26), height: px(26) } },
                  ],
                },
              },
              text("SCAN TO WATCH THE PREMIERE", {
                fontFamily: "Inter",
                fontSize: px(1.75),
                letterSpacing: px(1.75) * 0.34,
                color: IVORY,
                marginTop: px(3.4),
              }),
              text(t.watchUrl.replace(/^https?:\/\//, ""), {
                fontFamily: "Inter",
                fontSize: px(1.15),
                color: "#f4f1e878",
                marginTop: px(1.6),
                maxWidth: px(88),
                textAlign: "center",
              }),
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(tree as never, {
    width: W,
    height: H,
    fonts: [
      { name: "Inter", data: FONTS.inter, weight: 400, style: "normal" },
      { name: "Bebas Neue", data: FONTS.bebas, weight: 400, style: "normal" },
      ...notoFonts,
    ],
  });

  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}
