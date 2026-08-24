import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const SEO_TITLE =
  "Marquee Tails — A Cinematic Movie Trailer & Poster of Your Pet";
const SEO_DESCRIPTION =
  "Turn 7–12 photos of your pet into a 60-second cinematic movie trailer — recognizably them in every shot — plus a matching digital movie poster, free. Made with AI, directed and finished by humans. Orders open now, from $159.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.marqueetails.com"),
  title: {
    default: SEO_TITLE,
    // Sub-pages that set their own full `title` keep it; a plain title gets the
    // brand appended.
    template: "%s | Marquee Tails",
  },
  description: SEO_DESCRIPTION,
  applicationName: "Marquee Tails",
  keywords: [
    "custom pet movie trailer",
    "pet movie poster",
    "AI pet video",
    "personalized dog gift",
    "cinematic pet trailer",
    "turn your pet into a movie",
    "custom dog portrait film",
    "pet gift",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
    url: "https://www.marqueetails.com",
    siteName: "Marquee Tails",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/assets/og.jpg",
        width: 1200,
        height: 630,
        alt: "Marquee Tails — a pet on the red carpet under a golden theater marquee.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
    images: ["/assets/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Organization + WebSite structured data (JSON-LD). Helps search engines
  // understand the brand/site; safe, evergreen schema. Product/FAQ schema live
  // closer to their content (FAQ.tsx).
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.marqueetails.com/#organization",
        name: "Marquee Tails",
        url: "https://www.marqueetails.com",
        logo: "https://www.marqueetails.com/assets/og.jpg",
        description: SEO_DESCRIPTION,
        sameAs: ["https://www.instagram.com/marqueetails.studio"],
      },
      {
        "@type": "WebSite",
        "@id": "https://www.marqueetails.com/#website",
        url: "https://www.marqueetails.com",
        name: "Marquee Tails",
        publisher: { "@id": "https://www.marqueetails.com/#organization" },
        inLanguage: "en-US",
      },
    ],
  };

  return (
    <html
      lang="en"
      className={`${bebas.variable} ${inter.variable} antialiased`}
    >
      <body className="min-h-svh flex flex-col bg-night text-ivory font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        {/*
          Cloudflare Web Analytics（social/ANALYTICS-SPEC.md ①）。
          無料・無制限・cookieless。Cookie を使わないので同意バナーは足していない
          —— ただしこれは法的な整理であって確定ではないので、
          LAWYER-REVIEW-QUESTIONS.md に項目を足してある。

          **トークン未設定なら何も出力しない。** 未取得の間に空の beacon を
          読み込ませても、リクエストが1つ増えるだけで何も記録されない。

          **このサイトの計測はこれが全部。** サーバー側で数える案（着地と決済試行を
          DBに残す）は一度実装したうえで取り消した —— 壊れるからではなく、LPの配信を
          静的から動的に変え、決済経路にDB書き込みを足すことになるため。

          その結果**判定できないものがある。** このスクリプトは広告ブロッカーに
          落とされるので、訪問数は必ず実数より小さい。「500セッションで注文0だから
          ページか価格の問題」の判定には分母が信用できないし、英国を開ける判断に要る
          「451で断った件数」は決済経路にしか無く、Vercelのログ保持期限で消えている。
          何が測れて何が測れないかは lp/ANALYTICS-READOUT.md に書いてある。

          置き場所は Cloudflare の公式スニペットに合わせて body の末尾。module は
          既定で defer 相当なので head でも描画は妨げないが、公式の位置から動かす
          理由が無い。
        */}
        {process.env.NEXT_PUBLIC_CF_BEACON_TOKEN && (
          <>
            {/* eslint-disable-next-line @next/next/no-sync-scripts --
                no-sync-scripts は async / defer 属性の有無だけを見ており
                type="module" を認識しない。**モジュールスクリプトは HTML 仕様上
                つねに defer 相当**（module では defer 属性の方が無視される）なので
                これは誤検知で、ルールが防ごうとしている「描画をブロックする
                スクリプト」には当たらない。 */}
            <script
              // Cloudflare が現在配っているスニペットに合わせて type="module"。
              // 以前は defer だった。beacon.min.js が ES モジュールとして
              // 配信されている場合、classic script として読むと動かないので、
              // 公式の形から外れる理由が無い。
              type="module"
              src="https://static.cloudflareinsights.com/beacon.min.js"
              data-cf-beacon={JSON.stringify({ token: process.env.NEXT_PUBLIC_CF_BEACON_TOKEN })}
            />
          </>
        )}
      </body>
    </html>
  );
}
