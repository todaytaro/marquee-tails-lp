import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import ConceptPicker from "@/components/ConceptPicker";

/**
 * Customer approval page (Gate 1) — opened from the email link.
 * The approveToken in the URL is the auth; it is never rendered back
 * into visible page text, and robots/referrer metadata keep the link
 * out of indexes and Referer headers.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Premiere — Marquee Tails",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/* ---------------------------------------------------------------- */
/* Small server-side pieces                                          */
/* ---------------------------------------------------------------- */

/** Local LP assets go through next/image; external CDN URLs use plain img. */
function Still({ src, alt }: { src: string; alt: string }) {
  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 100vw, 640px"
        className="object-cover"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto w-full max-w-5xl px-6 py-6 text-center">
        <p className="font-display text-2xl tracking-[0.2em] text-ivory">
          MARQUEE <span className="text-gold">TAILS</span>
        </p>
      </header>
      <div className="film-strip" aria-hidden />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:py-16">
        {children}
      </main>
      <div className="film-strip" aria-hidden />
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-center text-xs text-muted">
        A private screening link, just for you. Questions? Reply to any of our
        emails.
      </footer>
    </div>
  );
}

const TIMELINE = [
  "Concept approved",
  "Filming",
  "Quality check",
  "Premiere",
] as const;

/** Production timeline: steps before `current` are done, `current` is live. */
function Timeline({ current }: { current: number }) {
  return (
    <ol className="mx-auto mt-10 flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
      {TIMELINE.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center"
          >
            <span
              aria-hidden
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm ${
                done
                  ? "border-gold bg-gold text-night"
                  : active
                    ? "animate-pulse border-gold text-gold gold-glow-box"
                    : "border-hairline text-muted"
              }`}
            >
              {done ? "✓" : active ? "●" : i + 1}
            </span>
            <span
              className={`text-sm ${
                active
                  ? "font-semibold text-gold"
                  : done
                    ? "text-ivory"
                    : "text-muted"
              }`}
            >
              {label}
              {active && <span className="sr-only"> (in progress)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- */
/* Per-status views                                                  */
/* ---------------------------------------------------------------- */

function WaitingView({ petName }: { petName: string }) {
  return (
    <>
      {/* React 19 hoists this into <head>: gentle auto-refresh while we paint */}
      <meta httpEquiv="refresh" content="30" />
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          Now in pre-production
        </p>
        <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
          SCENE 01: {petName.toUpperCase()} IS IN WARDROBE
        </h1>
        <p className="mt-6 text-lg text-muted">
          Your concept stills are being painted right now. The moment
          they&apos;re ready, we&apos;ll email you to come choose{" "}
          {petName}&apos;s opening shot.
        </p>
        <p className="mt-8 inline-flex items-center gap-2 rounded-[var(--radius-chip)] border border-hairline bg-surface px-4 py-2 text-sm text-muted">
          <span
            aria-hidden
            className="h-2 w-2 animate-pulse rounded-full bg-gold"
          />
          This page refreshes itself — no need to do anything.
        </p>
      </div>
    </>
  );
}

function Gate1View({ order, petName }: { order: Order; petName: string }) {
  return (
    <div>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          Gate 1 · Director&apos;s choice
        </p>
        <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
          CHOOSE {petName.toUpperCase()}&apos;S OPENING SHOT
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          We painted {order.conceptImageUrls.length} concept stills of{" "}
          {petName}. Pick the one that&apos;s unmistakably them — it becomes
          the first frame of the film.
        </p>
      </div>
      <div className="mt-12">
        <ConceptPicker
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          images={order.conceptImageUrls}
        />
      </div>
    </div>
  );
}

function FilmingView({ order, petName }: { order: Order; petName: string }) {
  return (
    <div className="text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Cameras rolling
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        NOW FILMING
      </h1>
      {order.selectedImageUrl && (
        <div className="relative mx-auto mt-10 aspect-[4/5] w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] border border-gold/40">
          <Still
            src={order.selectedImageUrl}
            alt={`${petName} — approved opening shot`}
          />
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse rounded-[var(--radius-card)] ring-2 ring-inset ring-gold/40"
          />
        </div>
      )}
      <Timeline current={1} />
      <p className="mt-10 text-muted">
        {petName}&apos;s film is in production. Expect your premiere within 48
        hours of approval — we&apos;ll email you the moment it&apos;s ready.
      </p>
    </div>
  );
}

// Gate 2 pending: customers never see the video before our editors sign off,
// so finalVideoUrl is deliberately NOT rendered here.
function QualityCheckView({ order, petName }: { order: Order; petName: string }) {
  return (
    <div className="text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        In the cutting room
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        QUALITY CHECK
      </h1>
      {order.selectedImageUrl && (
        <div className="relative mx-auto mt-10 aspect-[4/5] w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] border border-gold/40">
          <Still
            src={order.selectedImageUrl}
            alt={`${petName} — approved opening shot`}
          />
        </div>
      )}
      <Timeline current={2} />
      <p className="mt-10 text-muted">
        Filming has wrapped. A human editor is reviewing every frame of{" "}
        {petName}&apos;s film before it premieres — expect it in your inbox
        within 48 hours of approval.
      </p>
    </div>
  );
}

function PremiereView({ order, petName }: { order: Order; petName: string }) {
  const videoUrl = order.finalVideoUrl;
  return (
    <div className="text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Now showing
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        {petName.toUpperCase()}&apos;S PREMIERE
      </h1>
      {videoUrl ? (
        <div className="film-grain mx-auto mt-10 max-w-3xl overflow-hidden rounded-[var(--radius-card)] border border-gold/40 gold-glow-box">
          <video
            controls
            playsInline
            preload="metadata"
            src={videoUrl}
            poster={order.selectedImageUrl ?? undefined}
            className="relative z-0 aspect-video w-full bg-night"
          >
            Your browser can&apos;t play this video —{" "}
            <a href={videoUrl} className="text-gold underline">
              download it instead
            </a>
            .
          </video>
        </div>
      ) : (
        <p className="mt-10 text-muted">
          Your film is ready — check your email for the delivery link.
        </p>
      )}
      {videoUrl && (
        <div className="mt-8 flex flex-col items-center gap-4">
          <a
            href={videoUrl}
            download={`${petName.toLowerCase()}-marquee-tails.mp4`}
            className="btn-marquee px-6 py-3 text-base"
          >
            Download {petName}&apos;s film
          </a>
          <p className="max-w-md text-sm text-muted">
            {petName} earned the big screen — share the trailer with the rest
            of the fan club. Group chats, grandparents, the vet who always
            asks for photos.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Page                                                              */
/* ---------------------------------------------------------------- */

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await prisma.order.findUnique({
    where: { approveToken: decodeURIComponent(token) },
  });
  if (!order) notFound();

  const petName = order.petName ?? "Your Star";

  let view: React.ReactNode;
  switch (order.status) {
    case OrderStatus.UPLOADING:
    case OrderStatus.IMAGE_GENERATING:
      view = <WaitingView petName={petName} />;
      break;
    case OrderStatus.AWAITING_CUSTOMER_APPROVAL:
      view = <Gate1View order={order} petName={petName} />;
      break;
    case OrderStatus.VIDEO_GENERATING:
      view = <FilmingView order={order} petName={petName} />;
      break;
    case OrderStatus.AWAITING_ADMIN_APPROVAL:
      view = <QualityCheckView order={order} petName={petName} />;
      break;
    case OrderStatus.COMPLETED:
      view = <PremiereView order={order} petName={petName} />;
      break;
  }

  return <Shell>{view}</Shell>;
}
