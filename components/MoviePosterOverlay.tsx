import Image from "next/image";

/**
 * MoviePosterOverlay — a Hollywood one-sheet typography layer rendered over
 * TEXT-FREE key art (the poster pipeline generates art with no letters in it,
 * so nothing here fights AI-drawn text). Pure CSS/Tailwind: no ffmpeg bake, so
 * we get real tracking, gradients, drop shadows and a proper condensed billing
 * block — plus automatic per-glyph font fallback (Japanese pet names just
 * work). Presentational only (no hooks) → usable as a server component.
 *
 * Everything is sized in container-query units (cqi) and the root is a
 * `@container`, so the SAME component reads correctly at any scale — a tiny
 * grid thumbnail or a full-bleed preview — without prop tweaks.
 *
 * The print/POD file is produced by rendering this exact overlay to a flat
 * image (html-to-image / satori) so what the customer picks is what ships.
 */

type Props = {
  /** Text-free key art (2:3). */
  src: string;
  /** Top line — thin, wide-tracked, uppercase teaser. */
  tagline?: string;
  /** The star: the pet's name. */
  petName: string;
  /** Sub-title beneath the name (the film's tagline/logline). */
  subtitle?: string;
  /** The dense credits block. Use buildBillingBlock() for a realistic one. */
  billing?: string;
  /** Release strap. */
  releaseText?: string;
  /** Local `/assets` art goes through next/image; external CDN art uses <img>. */
  priority?: boolean;
  className?: string;
};

/** A realistic, densely-packed billing block in the Hollywood house style. */
export function buildBillingBlock(petName: string): string {
  const NAME = petName.toUpperCase();
  return (
    `MARQUEE TAILS PRESENTS  A STUDIO PETVERSE PRODUCTION  ` +
    `A MARQUEE TAILS FILM  "${NAME}"  STARRING ${NAME}  ` +
    `CASTING BY THE GOOD BOY AGENCY  COSTUMES BY WARDROBE & WHISKERS  ` +
    `ORIGINAL SCORE BY THE HOWLING PHILHARMONIC  ` +
    `DIRECTOR OF PHOTOGRAPHY A. LENS  PRODUCED BY THE FAN CLUB  ` +
    `WRITTEN & DIRECTED BY YOU`
  );
}

function Art({ src, priority }: { src: string; priority?: boolean }) {
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt=""
        fill
        priority={priority}
        sizes="(max-width: 640px) 100vw, 33vw"
        className="object-cover"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
  );
}

export default function MoviePosterOverlay({
  src,
  tagline = "SOME JOURNEYS TAKE YOU BEYOND THE STARS",
  petName,
  subtitle,
  billing,
  releaseText = "COMING SOON",
  priority,
  className = "",
}: Props) {
  const billingText = billing ?? buildBillingBlock(petName);

  return (
    <div
      className={`@container relative aspect-[2/3] w-full overflow-hidden bg-black select-none ${className}`}
    >
      {/* 1 · key art */}
      <Art src={src} priority={priority} />

      {/* 2 · cinematic scrims: strong well at the bottom for the title + billing
             legibility, a soft vignette up top for the tagline, and a faint
             all-over darken so gold/ivory text always pops. */}
      <div className="pointer-events-none absolute inset-0 bg-black/10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28%] bg-gradient-to-b from-black/70 via-black/20 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black via-black/80 to-transparent" />

      {/* 3 · typography */}
      <div className="absolute inset-0 flex flex-col px-[7%] py-[5.5%] text-center">
        {/* Top · tagline */}
        <p
          className="font-sans text-[2.15cqi] font-light uppercase leading-snug text-ivory/85"
          style={{ letterSpacing: "0.34em", textShadow: "0 0.2cqi 0.6cqi rgba(0,0,0,0.6)" }}
        >
          {tagline}
        </p>

        {/* Bottom · title block */}
        <div className="mt-auto flex flex-col items-center">
          {/* Title — the pet's name. Bebas for the cinematic caps; the browser
              falls back per-glyph for non-Latin names automatically. */}
          <h2
            className="font-display text-[15cqi] leading-[0.82] tracking-[0.01em] text-gold"
            style={{ textShadow: "0 0.45cqi 1.1cqi rgba(0,0,0,0.75)" }}
          >
            {petName.toUpperCase()}
          </h2>

          {subtitle && (
            <p
              className="mt-[1.5cqi] font-display text-[4cqi] uppercase leading-none text-ivory"
              style={{ letterSpacing: "0.18em", textShadow: "0 0.25cqi 0.7cqi rgba(0,0,0,0.7)" }}
            >
              {subtitle}
            </p>
          )}

          {/* hairline rule above the billing block, one-sheet style */}
          <span
            aria-hidden
            className="mt-[3cqi] block h-px w-[46%] bg-gradient-to-r from-transparent via-ivory/45 to-transparent"
          />

          {/* Billing block — the star of the request. Recreated in pure CSS:
              an ultra-condensed grotesque (Arial Narrow / system fallback),
              vertically stretched with scaleY, negatively tracked, thin and
              tiny, wrapped to a tall narrow column — exactly the "credits
              crammed together" look of a real one-sheet. */}
          <p
            className="mt-[2.4cqi] mb-[2.4cqi] mx-auto max-w-[86%] text-[1.55cqi] font-normal uppercase text-ivory/72"
            style={{
              fontFamily:
                "'Haettenschweiler','Arial Narrow Bold','Arial Narrow','Roboto Condensed','Oswald',sans-serif",
              transform: "scaleY(1.62)",
              transformOrigin: "center",
              letterSpacing: "-0.02em",
              lineHeight: 1.08,
              wordSpacing: "0.05em",
            }}
          >
            {billingText}
          </p>

          {/* Release strap */}
          <p
            className="mt-[1.5cqi] font-display text-[3cqi] uppercase leading-none text-ivory"
            style={{ letterSpacing: "0.42em", textShadow: "0 0.25cqi 0.7cqi rgba(0,0,0,0.7)" }}
          >
            {releaseText}
          </p>
        </div>
      </div>
    </div>
  );
}
