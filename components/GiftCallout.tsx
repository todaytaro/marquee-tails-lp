export default function GiftCallout() {
  return (
    <section
      id="gifting"
      aria-labelledby="gifting-heading"
      className="w-full border-y border-hairline bg-surface/60"
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:py-16">
        <div className="ticket-stub mx-auto max-w-3xl rounded-card border border-hairline bg-surface px-8 py-8 sm:px-12">
          <p className="text-center font-display text-sm uppercase tracking-[0.3em] text-gold">
            Admit two — you and the surprise
          </p>
          <h2
            id="gifting-heading"
            className="mt-3 text-center font-display uppercase tracking-[0.06em] text-ivory text-[clamp(1.5rem,5vw,2.25rem)] leading-tight"
          >
            The gift for the friend who loves their dog more than people
          </h2>
          <div
            aria-hidden="true"
            className="mx-auto my-6 h-px w-full max-w-md border-t border-dashed border-gold/30"
          />
          <p className="mx-auto max-w-xl text-center text-[0.95rem] leading-relaxed text-muted">
            Most of our films are gifts — birthdays, Gotcha Days, &ldquo;just
            because you two are ridiculous together.&rdquo; You send us the
            photos in secret; we send back a premiere. Sixty seconds in, when
            their pet turns to camera and it&rsquo;s unmistakably them, you win
            gifting forever. Gift options come with a cinematic reveal card, so
            the surprise lands like an opening night.
          </p>
        </div>
      </div>
    </section>
  );
}
