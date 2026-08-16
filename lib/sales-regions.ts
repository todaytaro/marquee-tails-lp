/**
 * どの国に売るか。**税務上の理由で決めている。**
 *
 * 域外事業者がEU・英国の消費者にデジタル役務（電気通信利用役務）を売ると、
 * **免税点なしで1件目から VAT の課税義務**が生じる。EU は OSS 登録、英国は
 * 英国 VAT 登録が必要で、登録すれば四半期ごとの申告が続く。米国・カナダ・
 * 豪州・NZ・シンガポールには閾値があり（州10万ドル、CAD3万、A$7.5万、
 * NZ$6万、S$10万など）、現在の規模では届かない — **EU/英国だけが例外的に
 * 「1件でも売ったら義務」** という構造になっている。
 *
 * そこで、登録する価値が出る売上規模になるまでは EU・英国を売り先から外す。
 * これは小規模事業者の一般的な選択で、後から開けるのは簡単（この配列から
 * 消すだけ）。英語圏の市場として英国を捨てるのは実際に痛いので、**売上が
 * 立ったら英国 VAT 登録をして GB を外す**のが本筋。
 *
 * ここに書いてあるのは一般論としての整理で、税務判断そのものではない。
 * 課税事業者かどうか、仕入税額控除の扱いなどは税理士の領域。
 */

/** VAT登録なしでは売らない国。ISO 3166-1 alpha-2。 */
export const VAT_REGISTRATION_REQUIRED: readonly string[] = [
  // 英国（免税点なし、英国VAT登録が必要）
  "GB",
  // EU 27カ国（免税点なし、非EU事業者は non-Union OSS 登録が必要）
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EU域外だが同様に域外事業者へ登録義務がある国
  "NO", // ノルウェー（VOEC、免税点 NOK 50,000 だが低い）
  "CH", // スイス（世界売上 CHF 100,000 で登録義務。閾値は世界売上で判定される点が厄介）
  "IS", // アイスランド
];

/**
 * 販売を断るか。`undefined`（国が判定できない）は**通す** — IPだけで
 * 拒否すると、VPN や企業回線の誤判定で正規の顧客を落とすため。国の記録は
 * Stripe 側の請求先住所で別途残る（そちらが実際の課税判定の根拠になる）。
 */
export function isBlockedCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return VAT_REGISTRATION_REQUIRED.includes(country.toUpperCase());
}

/** 断るときに顧客へ返す文面。理由を伏せない。 */
export const BLOCKED_COUNTRY_MESSAGE =
  "We're not able to sell to customers in the UK or the EU just yet — we have to complete VAT registration there first, and we'd rather wait than get it wrong. If you'd like us to let you know when we open, email support@marqueetails.com.";
