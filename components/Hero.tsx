import Image from "next/image";

export default function Hero() {
  return (
    <section
      aria-labelledby="hero-headline"
      className="film-grain relative isolate flex min-h-svh flex-col overflow-hidden bg-night"
    >
      {/* Background still */}
      <Image
        src="/assets/hero.png"
        alt="A scruffy mixed-breed dog and a tabby cat sit side by side on a red carpet at a nighttime movie premiere, gazing up at a glowing vintage theater marquee that reads MARQUEE TAILS in golden bulb letters, with paparazzi flashes on both sides."
        fill
        preload
        sizes="100vw"
        className="object-cover object-center"
      />

      {/* Readability gradients */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-night via-night/75 to-night/35"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(11,10,16,0.5)_100%)]"
      />

      {/* Letterbox bars */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-20 h-4 bg-black sm:h-6"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-20 h-4 bg-black sm:h-6"
      />

      {/* Content */}
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 py-20 text-center sm:py-28">
        {/* NOW CASTING badge chip */}
        <p className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/75 px-4 py-1.5 text-[0.7rem] font-semibold tracking-[0.2em] text-gold-bright uppercase backdrop-blur-sm">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-gold motion-safe:animate-pulse"
          />
          Now casting — waitlist open
        </p>

        {/* Brand wordmark */}
        <p className="font-display gold-glow-text mt-7 text-xl tracking-[0.45em] text-gold uppercase sm:text-2xl">
          Marquee Tails
        </p>

        {/* Headline */}
        <h1
          id="hero-headline"
          className="font-display gold-glow-text mt-3 max-w-3xl text-[clamp(2.75rem,10vw,5.5rem)] leading-[0.95] tracking-[0.03em] text-balance text-ivory uppercase"
        >
          Your actual pet, starring in a cinematic trailer.
        </h1>

        {/* Subhead */}
        <p className="mt-5 max-w-2xl text-[clamp(1rem,2.5vw,1.125rem)] leading-relaxed text-pretty text-muted">
          Send us 5–8 photos. We turn them into a 60–90 second movie trailer —
          8 to 12 shots, one epic world, and your pet recognizably themselves
          in every single frame. Poster included.{" "}
          <span className="text-ivory">Every pet deserves top billing.</span>
        </p>

        {/* CTAs */}
        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:gap-4">
          <a
            href="#waitlist"
            className="btn-marquee w-full px-8 py-3.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright sm:w-auto"
          >
            Join the waitlist
          </a>
          <a
            href="#worlds"
            className="inline-flex w-full items-center justify-center rounded-chip border border-hairline px-8 py-3.5 text-base font-semibold text-ivory transition-colors hover:border-gold/50 hover:text-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright sm:w-auto"
          >
            See the three worlds
          </a>
        </div>

        {/* Proof line */}
        <p className="mt-6 text-sm text-muted">
          We produce just 5 films a day. The first 100 on the list become
          Founding Members.
        </p>
      </div>
    </section>
  );
}
