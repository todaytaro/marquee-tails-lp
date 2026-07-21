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

export const metadata: Metadata = {
  metadataBase: new URL("https://marqueetails.com"),
  title:
    "Marquee Tails — Your Pet, Starring in a Cinematic Trailer | Join the Waitlist",
  description:
    "From 5–8 photos, we produce a 60-second cinematic movie trailer starring your actual pet — recognizably them in every shot — plus a matching movie poster. Made with AI, finished by humans. Join the waitlist for Founding Member perks.",
  openGraph: {
    title:
      "Marquee Tails — Your Pet, Starring in a Cinematic Trailer | Join the Waitlist",
    description:
      "From 5–8 photos, we produce a 60-second cinematic movie trailer starring your actual pet — recognizably them in every shot — plus a matching movie poster. Made with AI, finished by humans. Join the waitlist for Founding Member perks.",
    images: ["/assets/hero.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bebas.variable} ${inter.variable} antialiased`}
    >
      <body className="min-h-svh flex flex-col bg-night text-ivory font-sans">
        {children}
      </body>
    </html>
  );
}
