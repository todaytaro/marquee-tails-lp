import Link from "next/link";

/**
 * Shared shell for the legal pages (/terms, /privacy, /refund, /tokushoho).
 * Premiere Night design system: bg-night / text-ivory / text-muted, plain
 * reading column, no marketing chrome.
 */
export default function LegalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto min-h-svh max-w-3xl px-5 py-16 sm:py-24">
      <Link
        href="/"
        className="text-xs uppercase tracking-widest text-muted transition-colors hover:text-gold"
      >
        ← Marquee Tails
      </Link>
      <div className="mt-8 text-muted leading-relaxed [&_h1]:font-display [&_h1]:uppercase [&_h1]:tracking-[0.06em] [&_h1]:text-ivory [&_h1]:text-[clamp(2rem,5vw,2.75rem)] [&_h1]:leading-none [&_h2]:mt-10 [&_h2]:font-display [&_h2]:uppercase [&_h2]:tracking-[0.08em] [&_h2]:text-gold [&_h2]:text-xl [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-2 [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-hairline [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-ivory [&_td]:border [&_td]:border-hairline [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_a]:text-gold [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </main>
  );
}
