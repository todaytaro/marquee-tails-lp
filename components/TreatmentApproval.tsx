"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Director's Cut "Gate 0" — the treatment approval gate (custom orders only).
 *
 * Shows Claude's treatment (order.treatmentText) and offers two paths:
 *   - Approve -> POST approve-treatment -> IMAGE_GENERATING (existing stills
 *     pipeline takes over, unchanged from here on).
 *   - Request changes (free text, TREATMENT_REVISION_CAP free revisions —
 *     shown to the customer, same posture as the Gate-1 re-roll counter)
 *     -> POST revise-treatment -> a fresh treatment comes back on the SAME
 *     status (AWAITING_TREATMENT_APPROVAL), so router.refresh() re-renders
 *     this component with the new order.treatmentText.
 *
 * Mirrors StoryboardWizard / PhotoUploadForm's loading + error-state style.
 *
 * WHY the wardrobe block exists (WARDROBE-VISIBILITY-SPEC.md): this gate is
 * the costume's actual point of no return — approving here moves the order
 * straight to storyboard takes, which have no path back to wardrobe. Before
 * this block, the costume Claude picked lived only inside the treatment
 * prose (one parenthetical, no label), so a customer could approve a look
 * they never consciously noticed. It's surfaced separately and ABOVE the
 * prose so it's read first, not buried in it.
 */

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  treatmentText: string;
  // WorldBundle.costume, threaded through as a primitive by the server
  // component (see app/approve/[token]/page.tsx) — null whenever there is no
  // structured costume to show: legacy generatedScript rows, a draft that
  // hasn't finished generating, or (defensively) a non-custom order. Never
  // throw or render an empty box for those cases — just skip the block.
  costume: string | null;
  // Server-computed (TREATMENT_REVISION_CAP - order.treatmentRevisionCount),
  // never recomputed here — this component has no access to the cap and
  // must not duplicate it (lib/safety-net.ts is the one place it's defined).
  initialRevisionsRemaining: number;
};

/**
 * The one outfit Claude locked in for every shot. Framed as craft, not
 * limitation: a single costume worn identically across all six cuts is what
 * keeps the pet reading as unmistakably itself, shot to shot — the same
 * reason a series keeps its lead in one look across a trailer. Placed above
 * TreatmentBody so it's the first thing read, and it explicitly points at
 * the existing free-text revision box below rather than inventing a new
 * "change costume" control.
 */
function WardrobeBlock({ costume }: { costume: string }) {
  return (
    <div className="mb-6 border-b border-hairline pb-6 text-left">
      <p className="font-display text-xs tracking-[0.3em] text-gold uppercase">
        Wardrobe — worn in every shot
      </p>
      <p className="mt-2 leading-relaxed text-ivory">{costume}</p>
      <p className="mt-2 text-sm text-muted">
        One outfit, locked in across all six scenes — it&apos;s what keeps
        every shot unmistakably them. Not what you pictured? Ask for a
        different look below.
      </p>
    </div>
  );
}

type Phase = "idle" | "approving" | "revising" | "already" | "error";

/** Split the treatment into paragraphs for readable formatting. */
function TreatmentBody({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return <p className="text-muted">Your treatment is on its way — refresh in a moment.</p>;
  }
  return (
    <div className="space-y-4 text-left">
      {paragraphs.map((p, i) => (
        <p key={i} className="leading-relaxed text-ivory">
          {p}
        </p>
      ))}
    </div>
  );
}

export default function TreatmentApproval({
  orderId,
  approveToken,
  petName,
  treatmentText,
  costume,
  initialRevisionsRemaining,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [showRevise, setShowRevise] = useState(false);
  const [revisionsRemaining, setRevisionsRemaining] = useState(initialRevisionsRemaining);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function approve() {
    setError(null);
    setRejection(null);
    setPhase("approving");
    startTransition(async () => {
      try {
        const res = await fetch("/api/orders/approve-treatment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, approveToken }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (json.ok) {
          router.refresh(); // -> IMAGE_GENERATING (existing waiting view takes over)
          return;
        }
        if (res.status === 409) {
          setPhase("already");
          return;
        }
        setError(json.error ?? "That didn't go through — please try again.");
        setPhase("idle");
      } catch {
        setError("Network hiccup — please try again.");
        setPhase("idle");
      }
    });
  }

  function submitRevision() {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setError(null);
    setRejection(null);
    setPhase("revising");
    startTransition(async () => {
      try {
        const res = await fetch("/api/orders/revise-treatment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, approveToken, instruction: trimmed }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string; revisionsRemaining?: number };
        if (json.ok) {
          setInstruction("");
          setShowRevise(false);
          if (typeof json.revisionsRemaining === "number") setRevisionsRemaining(json.revisionsRemaining);
          // Must go back to idle: a revision returns on the SAME status, so
          // this component stays mounted across the refresh — leaving phase at
          // "revising" keeps `busy` true and disables Approve and Request
          // changes for good. (approve() can skip this: it moves the order to
          // IMAGE_GENERATING, so the server swaps this view out entirely.)
          setPhase("idle");
          router.refresh(); // same status, fresh treatmentText from the server
          return;
        }
        if (res.status === 409) {
          setPhase("already");
          return;
        }
        if (res.status === 422) {
          // Claude declined this particular revision (moderation/IP/off-scope)
          // — the prior treatment is untouched, so stay put and explain why.
          setRejection(json.error ?? "That direction didn't work out — could you try rewording it?");
          setPhase("idle");
          return;
        }
        if (res.status === 429) {
          setRejection(json.error ?? "Let's take this one over email — reply to any of our messages.");
          setPhase("idle");
          return;
        }
        setError(json.error ?? "That didn't go through — please try again.");
        setPhase("idle");
      } catch {
        setError("Network hiccup — please try again.");
        setPhase("idle");
      }
    });
  }

  if (phase === "already") {
    return (
      <div className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
        <p className="font-display text-3xl tracking-wide text-gold">ALREADY DECIDED</p>
        <p className="mt-3 text-muted">
          This treatment was already approved (or is already being revised) —
          refresh in a moment to see where {petName}&apos;s film stands.
        </p>
      </div>
    );
  }

  const busy = pending || phase === "approving" || phase === "revising";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">Gate 0 · Treatment approval</p>
        <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-6xl">
          {petName.toUpperCase()}&apos;S TREATMENT
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          {/* "in your own words", not "in plain English": the brief and this
              treatment come back in whichever language the customer writes in
              (lib/claude-script.ts rule 5), so promising English would be
              wrong for everyone who didn't use it. */}
          Read through the world your director wrote around {petName}. Nothing
          goes to storyboard until you approve.
        </p>
        {/* Same "state the number plainly" posture as the Gate-1 re-roll
            counter — a limit that's hidden until you hit it reads as a
            broken promise, not a limit. */}
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
          {revisionsRemaining > 0
            ? `${revisionsRemaining} of 2 free revisions left, in your own words.`
            : "Both free revisions used — you can still approve and shape it further at the storyboard."}
        </p>
      </div>

      <div className="mt-10 rounded-[var(--radius-card)] border border-hairline bg-surface p-6 sm:p-8">
        {/* Guard: only ever render this for a real, present costume string —
            never an empty box for legacy orders or a still-drafting one. */}
        {costume && <WardrobeBlock costume={costume} />}
        <TreatmentBody text={treatmentText} />
      </div>

      {rejection && (
        <p className="mt-4 rounded-[var(--radius-chip)] border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold-bright" role="alert">
          {rejection}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-center sm:flex sm:items-center sm:justify-between sm:gap-6 sm:text-left">
        <p className="text-sm text-muted">
          Happy with the story? Approve and we&apos;ll start painting the
          storyboard.
        </p>
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className="btn-marquee mt-4 w-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40 sm:mt-0 sm:w-auto sm:shrink-0"
        >
          {phase === "approving" ? "Locking it in…" : "Approve — start my storyboard"}
        </button>
      </div>

      <div className="mt-6 text-center">
        {revisionsRemaining <= 0 ? (
          // Same posture as StoryboardWizard once its re-rolls are spent: the
          // limit is disclosed up front, so hitting it removes the control
          // rather than letting a customer burn a request they were told
          // they don't have.
          <p className="text-sm text-muted">
            Both free revisions are used. Approve to move to the storyboard —
            you can keep shaping it there.
          </p>
        ) : !showRevise ? (
          <button
            type="button"
            onClick={() => setShowRevise(true)}
            disabled={busy}
            className="text-sm text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-gold disabled:opacity-40"
          >
            Not quite right? Request changes →
          </button>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-left">
            <label className="block">
              <span className="font-display text-sm tracking-[0.2em] text-gold uppercase">
                What should change?
              </span>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="e.g. Make the jacket a leather one, and change scene 3 to a rainy street instead."
                className="mt-2 w-full rounded-lg border border-hairline bg-night/40 px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setShowRevise(false);
                  setInstruction("");
                }}
                disabled={busy}
                className="text-sm text-muted transition-colors hover:text-gold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRevision}
                disabled={busy || !instruction.trim()}
                className="btn-marquee px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === "revising" ? "Rewriting…" : "Send changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
