export default function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-hairline bg-surface/60">
      <div className="film-strip" aria-hidden="true" />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-5 py-12 text-center">
        <p className="font-display text-2xl uppercase tracking-[0.18em] text-gold">
          Marquee Tails
        </p>
        <p className="font-display text-sm uppercase tracking-[0.3em] text-ivory/80">
          Every pet deserves top billing.
        </p>

        <p className="max-w-xl rounded-chip border border-hairline bg-night/60 px-5 py-3 text-sm leading-relaxed text-ivory/90">
          Made with AI. Directed, checked and finished by humans. We never do
          knock-off franchise styles — only original worlds.
        </p>

        <nav aria-label="Social links" className="flex gap-6 text-sm">
          <a
            href="#"
            className="text-muted transition-colors hover:text-gold focus-visible:text-gold"
          >
            Instagram
          </a>
          <a
            href="#"
            className="text-muted transition-colors hover:text-gold focus-visible:text-gold"
          >
            TikTok
          </a>
        </nav>

        <p className="text-xs text-muted">&copy; 2026 Marquee Tails</p>
      </div>
    </footer>
  );
}
