"use client";

import Image from "next/image";
import { useRef, useState } from "react";

/**
 * The proof section: a REAL film we made, not a mockup. The film, storyboard
 * stills, and poster below are the actual pipeline output for a real
 * customer's pet — Camyu, a miniature schnauzer, in the Deep Space Explorer
 * world. Shown so a first-time visitor sees the finished product before they
 * ever read a price.
 *
 * THE "PRESET WORLDS" CAPTION, and why it is accurate even though this
 * particular order was placed as a custom one (2026-08-16):
 *
 * It was produced in July, before the plans diverged, on the Kling pipeline —
 * which is exactly what Preset Worlds runs today (MOTION-V2-SPEC.md §4.0.1).
 * Director's Cut moved to Seedance and now produces visibly larger movement,
 * so calling this a Director's Cut example would UNDERSELL that plan and
 * mislead a buyer about what $249 delivers. The caption claims what the
 * finished film looks like, not which button was pressed to order it, and on
 * that claim it is right: same video model, same edit engine, same six-shot
 * shape a Preset buyer receives.
 *
 * Two things would make this cleaner and are worth doing when there is
 * material for them: swap in Camyu's actual Preset order (noir, delivered
 * 2026-08-01) so provenance and caption match exactly, or replace the whole
 * showcase with a new-pipeline Director's Cut once one has been reviewed —
 * this film predates the no-helmet rule and its bubble helmet is a look the
 * pipeline no longer produces.
 *
 * UPLOAD_PHOTO is the one illustrative exception: a same-likeness recreation
 * of an ordinary backyard snapshot (not the customer's literal raw upload),
 * generated so the "before" shot reads as an everyday US pet photo rather
 * than a candid indoor snap that doesn't travel well outside Japan.
 *
 * INTERIM (LP copy fix, 2026-08): that illustrative image was previously
 * presented with alt text and a caption implying it was Camyu's actual
 * upload — inside the one section whose whole job is proof. The label under
 * the thumbnail below and this alt text are the interim fix: make the
 * illustration status visible to the reader, without touching the film,
 * stills, or poster, which ARE real pipeline output. This whole showcase is
 * slated for replacement (real photo + new-pipeline film) after the next
 * Director's Cut verification — remove the label and this note then.
 *
 * The video autoplays muted + looping (ambient teaser); "Play with sound"
 * restarts from the top, unmuted, with native controls so they can hear the
 * scored 60-second cut. Reduced-motion visitors get the poster frame + button.
 */

const UPLOAD_PHOTO = {
  src: "/assets/showcase/camus/uploads/camyu-before.jpg",
  alt: "Illustrative recreation of the kind of ordinary phone photo owners send in — not Camyu's actual uploaded photo.",
};

const STILLS = [
  { src: "/assets/showcase/camus/stills/still-0.jpg", alt: "Camyu in an astronaut suit and glass helmet peeks around a bulkhead in a red-lit spaceship corridor, tongue out." },
  { src: "/assets/showcase/camus/stills/still-1.jpg", alt: "Close on Camyu's face inside the helmet, lit warm against the ship interior." },
  { src: "/assets/showcase/camus/stills/still-2.jpg", alt: "Camyu at a glowing control console on the starship bridge." },
  { src: "/assets/showcase/camus/stills/still-3.jpg", alt: "Camyu floating in his space suit above the blue curve of Earth, tether trailing." },
  { src: "/assets/showcase/camus/stills/still-4.jpg", alt: "Low angle of Camyu standing heroically in the spacecraft." },
  { src: "/assets/showcase/camus/stills/still-5.jpg", alt: "Wide shot of Camyu on the bridge, a vivid nebula filling the viewport behind him." },
];

export default function ShowcaseFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function playWithSound() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.controls = true;
    v.currentTime = 0;
    void v.play();
    setPlaying(true);
  }

  return (
    <section
      id="showcase"
      aria-labelledby="showcase-heading"
      className="scroll-mt-6 border-y border-hairline bg-night px-5 py-16 sm:py-24"
    >
      <div className="mx-auto max-w-5xl">
        {/* Eyebrow */}
        <p className="text-center font-display text-sm uppercase tracking-[0.3em] text-gold">
          Not a mockup — a real premiere
        </p>
        <h2
          id="showcase-heading"
          className="mt-3 text-center font-display text-[clamp(2rem,6vw,3.25rem)] leading-none tracking-[0.06em] text-ivory uppercase"
        >
          Meet Camyu
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-[clamp(0.95rem,2.5vw,1.05rem)] leading-relaxed text-pretty text-muted">
          A real schnauzer, Camyu&apos;s own order. His owner sent in eight
          photos — one 60-second space epic came out. Watch his face across
          every shot:{" "}
          <span className="text-ivory">unmistakably him, the whole way.</span>
        </p>

        {/* Before: the camera roll */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-muted">
            You send us this
          </p>
          <div className="flex flex-col items-center gap-1.5">
            <div className="size-24 rotate-[-2deg] overflow-hidden rounded-chip border border-hairline bg-surface shadow-[0_10px_30px_rgba(0,0,0,0.4)] sm:size-32">
              <Image
                src={UPLOAD_PHOTO.src}
                alt={UPLOAD_PHOTO.alt}
                width={128}
                height={128}
                className="size-full object-cover"
              />
            </div>
            {/* Visible disclosure, not sr-only and not a tooltip — see the
                INTERIM note in the file-level doc comment above. */}
            <span className="text-[0.65rem] uppercase tracking-[0.15em] text-muted/80">
              Illustration — representative example
            </span>
          </div>
          <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
            &darr; we send back a premiere
          </p>
        </div>

        {/* The film */}
        <figure className="mt-10">
          <div className="film-grain relative isolate overflow-hidden rounded-card border border-gold/40 bg-black shadow-[0_0_60px_rgba(232,182,76,0.18)]">
            {/* letterbox bars */}
            <div aria-hidden="true" className="absolute inset-x-0 top-0 z-20 h-3 bg-black sm:h-4" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 z-20 h-3 bg-black sm:h-4" />

            <video
              ref={videoRef}
              className="aspect-video w-full object-cover"
              poster="/assets/showcase/camus/film-poster.jpg"
              src="/assets/showcase/camus/film.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />

            {/* Ambient overlay + Play-with-sound button (hidden once unmuted) */}
            {!playing && (
              <button
                type="button"
                onClick={playWithSound}
                aria-label="Play Camus's film with sound"
                className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gradient-to-t from-black/50 via-transparent to-black/20 transition-colors hover:from-black/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-bright"
              >
                <span className="flex size-16 items-center justify-center rounded-full border border-gold/60 bg-night/70 backdrop-blur-sm transition-transform group-hover:scale-110 sm:size-20">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 size-7 text-gold-bright sm:size-9" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span className="font-display text-sm uppercase tracking-[0.25em] text-ivory sm:text-base">
                  Play with sound
                </span>
              </button>
            )}
          </div>
          <figcaption className="mt-3 text-center text-xs tracking-wide text-muted">
            Camyu · <span className="text-gold-bright">“The Long Way Home”</span> · Deep Space Explorer · 60 seconds, six shots
            <br />
            <span className="text-muted/80">This is what a Preset Worlds film looks like.</span>
          </figcaption>
        </figure>

        {/* Storyboard strip */}
        <div className="mt-16">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h3 className="font-display text-xl uppercase tracking-[0.1em] text-gold-bright sm:text-2xl">
              Six shots, one star
            </h3>
            <p className="hidden text-sm text-muted sm:block">
              Every cut, painted before we roll.
            </p>
          </div>
          <div className="film-strip mb-4" aria-hidden="true" />
          <ul className="grid list-none grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {STILLS.map((still, i) => (
              <li key={still.src}>
                <div className="relative aspect-video overflow-hidden rounded-chip border border-hairline bg-surface">
                  <Image
                    src={still.src}
                    alt={still.alt}
                    fill
                    sizes="(min-width: 640px) 33vw, 50vw"
                    className="object-cover"
                  />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-night/70 px-1.5 py-0.5 font-display text-[0.65rem] uppercase tracking-[0.2em] text-gold backdrop-blur-sm">
                    Cut {i + 1}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="film-strip mt-4" aria-hidden="true" />
        </div>

        {/* The poster */}
        <div className="mt-16 grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="mx-auto w-full max-w-[300px] md:mx-0 md:ml-auto">
            <div className="rotate-[-1.5deg] overflow-hidden rounded-card border border-gold/40 shadow-[0_20px_60px_rgba(0,0,0,0.6)] transition-transform duration-500 hover:rotate-0">
              <Image
                src="/assets/showcase/camus/poster.jpg"
                alt="Movie poster for Camyu: The Long Way Home. Camyu in a space helmet fills the frame, with the title and a full Hollywood billing block."
                width={1000}
                height={1500}
                className="h-auto w-full"
              />
            </div>
          </div>
          <div className="text-center md:text-left">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              And a poster for the wall
            </p>
            <h3 className="mt-3 font-display text-[clamp(1.5rem,4vw,2.25rem)] uppercase leading-tight tracking-[0.04em] text-ivory">
              A one-sheet worthy of the lobby
            </h3>
            <p className="mx-auto mt-4 max-w-md text-[0.95rem] leading-relaxed text-muted md:mx-0">
              Every film comes with its own movie poster — real title treatment,
              real billing block, your pet on the marquee — included free as a
              digital download. Want it on your wall? Printed poster and
              gallery canvas are available as add-ons once your film is
              delivered.
            </p>
            <a
              href="#pricing"
              className="btn-marquee mt-6 inline-flex px-7 py-3 text-sm"
            >
              Put your pet on the marquee
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
