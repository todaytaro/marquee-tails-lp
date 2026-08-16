"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * Cinematic reveal — implemented as a pure CSS keyframe animation
 * (`.hero-reveal` in globals.css: blur + fade + rise, staggered via inline
 * animation-delay).
 *
 * WHY CSS, NOT FRAMER MOTION: the JS/Motion approach was tried first and
 * intermittently stalled every text element at opacity 0 in this environment
 * — Motion's rAF-driven enter animation does not reliably progress behind the
 * heavy placeholder background video (11MB, main-thread decode) under Next dev
 * + React 19 StrictMode + Motion v12. CSS keyframes run on the compositor,
 * are immune to main-thread starvation, and honour prefers-reduced-motion via
 * the media query in globals.css. Once C-1's lightweight montage replaces the
 * placeholder video, a Motion-based reveal could be revisited, but CSS is the
 * more robust choice here. See LP-CONVERSION-SPEC.md C-3.
 */
export default function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pause the background video for reduced-motion visitors (the video is also
  // hidden via the `motion-reduce:` CSS utility below; this stops it decoding).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) videoRef.current?.pause();
  }, []);

  return (
    <section
      aria-labelledby="hero-headline"
      className="film-grain relative isolate flex min-h-svh flex-col overflow-hidden bg-night"
    >
      {/*
        Hero background loop: a lightweight (~1MB), silent 10s cut trimmed from
        the Camyu film (19-29s — Camyu walking through the ship hatch, no baked
        caption). This is a hero-appropriate teaser, NOT the full before/after
        reveal, which stays exclusive to the Showcase section. Silent by design
        (see LP-CONVERSION-SPEC.md C-1/C-5): the "with sound" button below sends
        viewers to the Showcase to watch the real premiere with audio. A bespoke
        multi-world montage could still replace this later.
      */}
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover object-center motion-reduce:hidden"
        src="/assets/hero-loop.mp4"
        poster="/assets/hero-loop-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
      {/* Reduced-motion fallback: static poster only, no video, no autoplay. */}
      <Image
        src="/assets/hero.png"
        alt="A scruffy mixed-breed dog and a tabby cat sit side by side on a red carpet at a nighttime movie premiere, gazing up at a glowing vintage theater marquee that reads MARQUEE TAILS in golden bulb letters, with paparazzi flashes on both sides."
        fill
        priority
        sizes="100vw"
        className="hidden object-cover object-center motion-reduce:block"
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

      {/* Content — text/CTA render immediately regardless of video load (LCP) */}
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 py-20 text-center sm:py-28">
        {/* NOW CASTING badge chip */}
        <p
          className="hero-reveal inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/75 px-4 py-1.5 text-[0.7rem] font-semibold tracking-[0.2em] text-gold-bright uppercase backdrop-blur-sm"
          style={{ animationDelay: "0.1s" }}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-gold motion-safe:animate-pulse"
          />
          Now casting — orders open
        </p>

        {/* Brand wordmark */}
        <p
          className="hero-reveal font-display gold-glow-text mt-7 text-xl tracking-[0.45em] text-gold uppercase sm:text-2xl"
          style={{ animationDelay: "0.25s" }}
        >
          Marquee Tails
        </p>

        {/* Headline — status/flex angle: sets the buyer above the crowd of
            filter-app users. "You commissioned a film" = social currency. */}
        <h1
          id="hero-headline"
          className="hero-reveal font-display gold-glow-text mt-3 max-w-4xl text-[clamp(2.5rem,8.5vw,5rem)] leading-[0.95] tracking-[0.02em] text-balance text-ivory uppercase"
          style={{ animationDelay: "0.4s", animationDuration: "1.3s" }}
        >
          Anyone can post a photo. You commissioned a film.
        </h1>

        {/* Subhead — one tight line. The likeness hook is the differentiator;
            process detail (photo count, shots, poster) lives in How It Works
            and Pricing, so the hero stays lean and punchy. */}
        <p
          className="hero-reveal mt-5 max-w-xl text-[clamp(1.05rem,2.6vw,1.25rem)] leading-relaxed text-pretty text-muted"
          style={{ animationDelay: "0.6s" }}
        >
          A 60-second cinematic trailer starring your pet —{" "}
          <span className="text-ivory">unmistakably them, in every frame.</span>
        </p>

        {/* CTAs */}
        <div
          className="hero-reveal mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:gap-4"
          style={{ animationDelay: "0.78s" }}
        >
          <a
            href="#pricing"
            className="btn-marquee w-full px-8 py-3.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright sm:w-auto"
          >
            Start Casting — from $159
          </a>
          <a
            href="#showcase"
            className="inline-flex w-full items-center justify-center gap-2 rounded-chip border border-hairline px-8 py-3.5 text-base font-semibold text-ivory transition-colors hover:border-gold/50 hover:text-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright sm:w-auto"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            See a real premiere
          </a>
        </div>

        {/* Proof line — scarcity reframed as urgency, not "wait your turn" */}
        <p
          className="hero-reveal mt-6 text-sm text-muted"
          style={{ animationDelay: "0.92s" }}
        >
          We produce just 5 films a day — reserve your slot.
        </p>
      </div>

      {/*
        The hero loop is silent by design (C-5). This sends viewers down to the
        Showcase, where the full Camyu premiere plays with sound — that's where
        the audio payoff and the complete before/after reveal live.
      */}
      <a
        href="#showcase"
        className="absolute bottom-6 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/70 px-4 py-2 text-xs font-semibold tracking-[0.08em] text-ivory backdrop-blur-md transition-colors hover:border-gold/50 hover:text-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright sm:right-8 sm:bottom-8"
      >
        <span aria-hidden="true">🔊</span>
        Watch the premiere with sound
      </a>
    </section>
  );
}
