import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import StoryboardWizard from "@/components/StoryboardWizard";
import PosterPicker from "@/components/PosterPicker";
import { normalizeStoryboard } from "@/lib/stills-pipeline";
import {
  STORYBOARD_REROLL_CAP,
  TREATMENT_REVISION_CAP,
  REFUND_AMOUNT_USD,
  NONREFUNDABLE_FEE_USD,
} from "@/lib/safety-net";
import { resolveWorld, fillPetName, type WorldBundle } from "@/lib/film-script";
import PhotoUploadForm from "@/components/PhotoUploadForm";
import StatusPoller from "@/components/StatusPoller";
import ProductionProgress from "@/components/ProductionProgress";
import AddonUpsell from "@/components/AddonUpsell";
import TreatmentApproval from "@/components/TreatmentApproval";

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

function WaitingView({ petName, elapsedSeconds }: { petName: string; elapsedSeconds: number }) {
  // The first message is the LoRA training that opens this stage and eats
  // most of the machine-time part of the wait (~45 min) — the status line
  // should describe what is actually happening, not skip to the drawing.
  // The LAST message is the human step STORYBOARD-ADMIN-GATE-SPEC.md §0/§3.1
  // added on top of that: a director looks at all eighteen shots before any
  // of them reach the customer, which is why the bound below moved from
  // hours to a business day (§3.6) — this message is what makes that extra
  // time legible as care rather than a stall.
  const messages = [
    `Studying ${petName} from every angle…`,
    `Casting ${petName} in the lead role…`,
    "Fitting the costume…",
    "Setting the lights…",
    "The director is storyboarding the scenes…",
    "Painting the opening shots…",
    "A director is giving every shot a final look…",
  ];
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Now in pre-production
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        SCENE 01: {petName.toUpperCase()} IS IN WARDROBE
      </h1>
      <p className="mt-6 text-lg text-muted">
        Our directors are storyboarding {petName}&apos;s film — six scenes,
        three takes each — starting with training a model of {petName} alone,
        so every shot is unmistakably them. Then a director reviews all
        eighteen shots before any of them come to you. That takes up to one
        business day.
      </p>
      {/* No estimateSeconds any more. It used to say 90 and render a live
          countdown, which was already a lie the moment LoRA training moved in
          front of this stage (LORA-STORYBOARD-SPEC.md §2.1: ~45 min for
          training alone), and STORYBOARD-ADMIN-GATE-SPEC.md's human review
          step (§3.1) has no fixed duration at all to count down from. Over a
          span this long, what reassures is knowing what's happening and that
          the email will come; the countdown only helps at the scale of
          minutes, which is where the other two waiting screens still use it. */}
      <ProductionProgress messages={messages} elapsedSeconds={elapsedSeconds} />
      <p className="mt-6 text-xs text-muted">
        No need to keep this open — close the page and we&apos;ll email you the
        moment it&apos;s ready. If you stay, it updates on its own.
      </p>
    </div>
  );
}

/**
 * Director's Cut "Gate 0" waiting view — shown while Claude drafts (or
 * redrafts) the treatment. In the B1 flow this runs inline inside the
 * submit-photos / revise-treatment request, so a customer normally never
 * lands here mid-render; it exists as a defensive fallback (a second tab, a
 * slow request that outlasts the client's own fetch, or a future async move).
 */
function TreatmentWaitingView({ petName, elapsedSeconds }: { petName: string; elapsedSeconds: number }) {
  const messages = [
    `Our director is writing ${petName}'s treatment…`,
    "Sketching the world…",
    "Blocking the six key scenes…",
    "Finding the tagline…",
  ];
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Now in the writers&apos; room
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        DRAFTING {petName.toUpperCase()}&apos;S TREATMENT
      </h1>
      <p className="mt-6 text-lg text-muted">
        Your director is turning {petName}&apos;s brief into a story — a
        world, a costume, six scenes and a tagline. You&apos;ll get the first
        look in a moment, and you can ask for changes before anything is
        filmed.
      </p>
      <ProductionProgress messages={messages} elapsedSeconds={elapsedSeconds} estimateSeconds={30} />
      <p className="mt-6 text-xs text-muted">
        This updates on its own — no need to refresh.
      </p>
    </div>
  );
}

function Gate1View({ order, petName }: { order: Order; petName: string }) {
  const storyboard = normalizeStoryboard(order.storyboardOptions);
  // Defensive: an order can only reach Gate 1 with a storyboard, but guard
  // against a legacy/empty row rather than rendering a dead wizard.
  if (storyboard.length === 0) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-display text-4xl tracking-wide text-gold gold-glow-text">
          ONE MOMENT
        </h1>
        <p className="mt-4 text-muted">
          {petName}&apos;s storyboard is still coming together — refresh in a
          few moments, or check back from the link in your email.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          Gate 1 · Storyboard approval
        </p>
        <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
          DIRECT {petName.toUpperCase()}&apos;S FILM
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          {storyboard.length} scenes, each with three takes of {petName}. Pick
          the take that&apos;s unmistakably them for every scene — your choices
          become the film, frame for frame.
        </p>
      </div>
      <div className="mt-12">
        <StoryboardWizard
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          // PRICING-PRODUCT-V2-SPEC.md §3.5(C): the CLEAN url must never reach
          // the browser at all — not just "not be rendered". StoryboardWizard
          // is a client component, so whatever object we pass as `storyboard`
          // gets serialized into the page's client payload verbatim (visible
          // in view-source / devtools) regardless of what the component
          // chooses to render. Stripping `.clean` here, server-side, before
          // it ever reaches the client boundary, is the only way to guarantee
          // that. The API route re-resolves the customer's preview pick back
          // to the clean url itself (see approve-storyboard/route.ts).
          storyboard={storyboard.map((cut) => ({
            scene: cut.scene,
            options: cut.options.map((o) => o.preview),
          }))}
          // B2-SAFETY-NET-SPEC.md §3/§4/§7 — Preset ($99) sees none of this;
          // only a Director's Cut ("custom") order carries a real re-roll
          // count / refund state.
          isCustom={order.tier === "custom"}
          rerollCap={STORYBOARD_REROLL_CAP}
          initialRerollsRemaining={Math.max(0, STORYBOARD_REROLL_CAP - order.storyboardRerollCount)}
          refundAlreadyRequested={Boolean(order.refundRequestedAt)}
        />
      </div>
    </div>
  );
}

/**
 * Poster copy reuses the same per-world/personality loglines as the film's
 * title cards — no separate authoring, and it reads as one connected story.
 */
function posterCopy(order: Order): { tagline: string; subtitle: string } {
  const loglines = resolveWorld(order).loglines;
  return { tagline: loglines.intro, subtitle: loglines.tagline };
}

function FilmingView({ order, petName, elapsedSeconds }: { order: Order; petName: string; elapsedSeconds: number }) {
  return (
    <div className="text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Cameras rolling
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
        NOW FILMING
      </h1>
      {order.selectedImageUrl && (
        <div className="relative mx-auto mt-10 aspect-video w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border border-gold/40">
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
      {/* No estimateSeconds, for the same reason as the storyboard screen
          above: this used to claim 240s and then sit on "Almost ready…" for
          however long the film actually took, directly under a paragraph
          promising the premiere "within 48 hours". A countdown that expires
          while the work continues is worse than no countdown — it turns a
          working page into an apparently stuck one. */}
      <ProductionProgress
        messages={[
          `Action! Rolling ${petName}'s scenes…`,
          "Capturing the hero shot…",
          "Scoring the soundtrack…",
          "Color-grading the footage…",
          "Cutting the trailer together…",
        ]}
        elapsedSeconds={elapsedSeconds}
      />
      <p className="mt-6 text-muted">
        {petName}&apos;s film is in production. Expect your premiere within 48
        hours of approval — we&apos;ll email you the moment it&apos;s ready.
      </p>
      {order.posterOptions.length === 0 && (
        /*
          Announce the poster before it exists, so the customer knows there is
          still something here for them. Without it the page reads as "we're
          done with you, close the tab" — and then the picker appears with no
          announcement at all, which is exactly how the choice gets missed.
          StatusPoller watches posterReady and swaps this for the picker.
        */
        <p className="mt-8 text-sm text-muted">
          {petName}&apos;s movie poster is being painted too — three versions
          to choose from. They&apos;ll appear right here shortly; no need to
          refresh the page.
        </p>
      )}
      {order.posterOptions.length > 0 && (
        <PosterPicker
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          posterOptions={order.posterOptions}
          chosenPosterUrl={order.posterUrl}
          {...posterCopy(order)}
        />
      )}
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
        <div className="relative mx-auto mt-10 aspect-video w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border border-gold/40">
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
      {order.posterOptions.length > 0 && (
        <PosterPicker
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          posterOptions={order.posterOptions}
          chosenPosterUrl={order.posterUrl}
          {...posterCopy(order)}
        />
      )}
    </div>
  );
}

/**
 * B2-SAFETY-NET-SPEC.md §4.3 — reached only after an admin records the
 * REFUND_AMOUNT_USD refund as issued (AWAITING_CUSTOMER_APPROVAL ->
 * CANCELLED, lib/orders.ts). Read-only: there is nothing left for the
 * customer to do on this page, and this app never displays a computed
 * refund amount as if it paid it — this is the same fixed refund/fee split
 * disclosed before purchase, not a number this page calculated.
 *
 * Below the refund facts, this view now backs up the line StoryboardWizard
 * says at the moment of refund request ("the treatment and storyboard we
 * made for {petName} are yours to keep either way"): the concept &
 * storyboard fee bought real work, and a CANCELLED order is the only place
 * that work is ever handed over — there is no login, no separate delivery
 * email attachment, nothing else. Without this, the promise was a memory of
 * a page the customer saw once, never a thing they could actually keep.
 *
 * Shows ALL THREE takes of every cut, not one "winning" pick — the customer
 * never chose a winner (refund only fires before Gate 1 approval, so
 * chosenStills is empty), and "the storyboard" in the promise is the whole
 * six-scene, three-take set the fee paid for, not a curated one-per-cut
 * highlight reel that would quietly hand over less than advertised.
 *
 * Uses `.preview`, never `.clean` (same posture as Gate1View above): with
 * WATERMARK_PREVIEWS_ENABLED currently false the two are identical, but if
 * that flag is ever flipped back on (lib/stills-pipeline.ts's own comment
 * flags this as a follow-up decision once a real refund path exists — this
 * page is that path), this keepsake should automatically start showing the
 * same watermarked proof sheets the customer actually saw at Gate 1, not a
 * clean asset that was never exposed to the browser anywhere else.
 */
function RefundIssuedView({ order, petName }: { order: Order; petName: string }) {
  const treatmentParagraphs = fillPetName(order.treatmentText ?? "", order.petName)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const storyboard = normalizeStoryboard(order.storyboardOptions);

  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted">
        Production ended
      </p>
      <h1 className="mt-4 font-display text-4xl tracking-wide text-gold gold-glow-text sm:text-5xl">
        {petName.toUpperCase()}&apos;S REFUND IS ON ITS WAY
      </h1>
      <p className="mt-6 text-muted">
        We&apos;ve issued your ${REFUND_AMOUNT_USD} refund — it should land on
        your card within 5&ndash;10 business days. The ${NONREFUNDABLE_FEE_USD}{" "}
        concept &amp; storyboard fee covered the treatment and storyboard
        work already done for {petName}, so it isn&apos;t included.
      </p>
      <p className="mt-4 text-xs text-muted">
        Questions? Just reply to any of our emails.
      </p>

      {(treatmentParagraphs.length > 0 || storyboard.length > 0) && (
        <div className="mt-14 border-t border-hairline pt-10 text-left">
          <p className="text-center text-sm uppercase tracking-[0.3em] text-muted">
            Yours to keep
          </p>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
            The ${NONREFUNDABLE_FEE_USD} concept &amp; storyboard fee paid for
            real work on {petName}&apos;s film. Here it is, in full.
          </p>

          {treatmentParagraphs.length > 0 && (
            <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-6 sm:p-8">
              <p className="font-display text-xs tracking-[0.3em] text-gold uppercase">
                The treatment
              </p>
              <div className="mt-4 space-y-4">
                {treatmentParagraphs.map((p, i) => (
                  <p key={i} className="leading-relaxed text-ivory">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          )}

          {storyboard.length > 0 && (
            <div className="mt-8">
              <p className="font-display text-xs tracking-[0.3em] text-gold uppercase">
                The storyboard — {storyboard.length} scenes, three takes each
              </p>
              <div className="mt-6 space-y-8">
                {storyboard.map((cut, cutIdx) => (
                  <div key={cutIdx}>
                    <p className="text-sm text-ivory">
                      Scene {cutIdx + 1}
                      {cut.scene && (
                        <>
                          {" "}
                          — {cut.scene.charAt(0).toUpperCase() + cut.scene.slice(1)}
                        </>
                      )}
                    </p>
                    <ol className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {cut.options.map((opt, takeIdx) => (
                        <li key={takeIdx} className="space-y-2">
                          <div className="relative aspect-video overflow-hidden rounded-[var(--radius-card)] border border-hairline">
                            <Still
                              src={opt.preview}
                              alt={`${petName} — scene ${cutIdx + 1} take ${takeIdx + 1}`}
                            />
                          </div>
                          {/* Through /api/download, not straight at fal:
                              `download` is advisory and browsers drop it
                              cross-origin, so a direct link would open the
                              image in a tab instead of saving it — and the
                              promise this whole view exists to keep is that
                              these are the customer's to KEEP. */}
                          <a
                            href={`/api/download?token=${order.approveToken}&kind=take&cut=${cutIdx}&take=${takeIdx}`}
                            className="block text-center text-xs text-gold underline decoration-hairline underline-offset-4 transition-colors hover:text-gold-bright"
                          >
                            Download take {takeIdx + 1}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* /api/download names the file and forces a save. A direct
                fal.media href silently did neither: `download` is ignored
                cross-origin, so "Download your film" opened the video in a
                tab. That was true of the main deliverable of both plans from
                the day it shipped. */}
            <a
              href={`/api/download?token=${order.approveToken}&kind=film`}
              className="btn-marquee px-6 py-3 text-base"
            >
              Download {petName}&apos;s film
            </a>
            {order.socialVideoUrl && (
              <a
                href={`/api/download?token=${order.approveToken}&kind=social`}
                className="inline-flex items-center rounded-[var(--radius-chip)] border border-gold/50 px-6 py-3 text-base text-gold transition-colors hover:bg-gold/10"
              >
                Vertical cut for TikTok / Reels
              </a>
            )}
            {/*
              The digital poster is a promised deliverable of BOTH plans
              (PRICING-PRODUCT-V2-SPEC.md §2: 無料同梱, granted at delivery) and
              the add-on section right below already tells the customer "the
              free digital version is already yours" — but there was no way to
              take it. posterPrintUrl, not posterUrl: posterUrl is the
              text-free art, whose title block only exists as a CSS overlay in
              this page, so downloading it would hand over artwork that is not
              a movie poster. posterPrintUrl is the flattened composite.
            */}
            {order.posterPrintUrl && (
              <a
                href={`/api/download?token=${order.approveToken}&kind=poster`}
                className="inline-flex items-center rounded-[var(--radius-chip)] border border-gold/50 px-6 py-3 text-base text-gold transition-colors hover:bg-gold/10"
              >
                Download the poster
              </a>
            )}
          </div>
          <p className="max-w-md text-sm text-muted">
            {petName} earned the big screen — share the trailer with the rest
            of the fan club. Group chats, grandparents, the vet who always
            asks for photos.
          </p>
        </div>
      )}
      {order.posterPrintUrl && (
        <AddonUpsell
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          posterUrl={order.posterUrl}
          purchasedAddon={order.addonType}
        />
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
  const ord = order; // non-null binding for use inside nested closures

  const petName = ord.petName ?? "Your Star";

  // Seconds since generation started (the transition INTO the current status),
  // for the ETA countdown on the waiting screens. updatedAt is unreliable —
  // it moves on artifact saves — so use the audit log's transition time.
  async function elapsedInStatus(): Promise<number> {
    const ev = await prisma.statusEvent.findFirst({
      where: { orderId: ord.id, to: ord.status },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const since = ev?.createdAt ?? ord.updatedAt;
    // eslint-disable-next-line react-hooks/purity -- server component rendered per-request; wall-clock read is intentional (ETA countdown age)
    return Math.max(0, Math.round((Date.now() - since.getTime()) / 1000));
  }

  const isCustom = order.tier === "custom";

  let view: React.ReactNode;
  switch (order.status) {
    case OrderStatus.UPLOADING:
      view = (
        <section className="px-5 py-10">
          <header className="mx-auto mb-10 max-w-2xl text-center">
            <p className="font-display text-sm tracking-[0.3em] text-muted uppercase">
              Pre-production
            </p>
            <h1 className="font-display gold-glow-text mt-2 text-4xl tracking-wide text-gold uppercase sm:text-5xl">
              Casting call
            </h1>
            <p className="mt-4 leading-relaxed text-muted">
              {isCustom
                ? "Send us your pet's photos and tell us the story you want — the world, the mood, one moment that has to be in it, how it ends. Our director turns that into a treatment for you to approve before anything is filmed."
                : "Send us your pet's photos and pick their world. Our directors will paint three concept stills for you to choose from — nothing goes to film until you approve one."}
            </p>
          </header>
          <PhotoUploadForm orderId={order.id} approveToken={order.approveToken} isCustom={isCustom} />
        </section>
      );
      break;
    case OrderStatus.TREATMENT_GENERATING:
      view = (
        <>
          <StatusPoller token={order.approveToken} currentStatus={order.status} />
          <TreatmentWaitingView petName={petName} elapsedSeconds={await elapsedInStatus()} />
        </>
      );
      break;
    case OrderStatus.AWAITING_TREATMENT_APPROVAL: {
      // generatedScript is Json, so this is read defensively: a legacy row
      // (pre-costume feature) or a shape mismatch just yields undefined, not
      // a throw — resolveWorld() is NOT reused here because its non-custom
      // fallback branch (getCostume(order.world ?? "deepspace")) would hand
      // back a made-up preset costume for a custom order with no
      // generatedScript yet, which is not what the customer actually
      // approved. This block only ever shows a REAL costume or nothing.
      const bundle = order.generatedScript as unknown as WorldBundle | null;
      const costume = typeof bundle?.costume === "string" ? bundle.costume : null;
      view = (
        <TreatmentApproval
          orderId={order.id}
          approveToken={order.approveToken}
          petName={petName}
          // Claude writes the title as "{name} AND THE LAST GREAT SPELL", so the
          // token has to be filled or the customer is asked to approve prose
          // with a raw template placeholder sitting in it.
          treatmentText={fillPetName(order.treatmentText ?? "", order.petName)}
          costume={costume}
          initialRevisionsRemaining={Math.max(0, TREATMENT_REVISION_CAP - order.treatmentRevisionCount)}
        />
      );
      break;
    }
    case OrderStatus.IMAGE_GENERATING:
      view = (
        <>
          <StatusPoller token={order.approveToken} currentStatus={order.status} />
          <WaitingView petName={petName} elapsedSeconds={await elapsedInStatus()} />
        </>
      );
      break;
    case OrderStatus.AWAITING_CUSTOMER_APPROVAL:
      view = <Gate1View order={order} petName={petName} />;
      break;
    case OrderStatus.VIDEO_GENERATING:
      view = (
        <>
          {/* The one view where the page changes without the status changing:
              the poster options land mid-filming. Pass the current answer so
              the poller can notice it flip and swap in the picker. */}
          <StatusPoller
            token={order.approveToken}
            currentStatus={order.status}
            currentPosterReady={order.posterOptions.length > 0 && !order.posterUrl}
          />
          <FilmingView order={order} petName={petName} elapsedSeconds={await elapsedInStatus()} />
        </>
      );
      break;
    case OrderStatus.AWAITING_ADMIN_APPROVAL:
      view = (
        <>
          <StatusPoller token={order.approveToken} currentStatus={order.status} />
          <QualityCheckView order={order} petName={petName} />
        </>
      );
      break;
    case OrderStatus.COMPLETED:
      view = <PremiereView order={order} petName={petName} />;
      break;
    // B2-SAFETY-NET-SPEC.md §4.3 — set only via the admin's manual-refund
    // action (AWAITING_CUSTOMER_APPROVAL -> CANCELLED, lib/orders.ts). No
    // other flow produces this status, so no other tier/gate needs a
    // branch here.
    case OrderStatus.CANCELLED:
      view = <RefundIssuedView order={order} petName={petName} />;
      break;
  }

  return <Shell>{view}</Shell>;
}
