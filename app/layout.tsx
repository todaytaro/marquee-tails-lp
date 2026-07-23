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
  "Turn 5–8 photos of your pet into a 60-second cinematic movie trailer — recognizably them in every shot — plus a matching movie poster you can print. Made with AI, directed and finished by humans. Orders open now, from $75.";

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
      </body>
    </html>
  );
}
