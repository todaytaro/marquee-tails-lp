"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const WORLDS = [
  { key: "deepspace", name: "Deep Space Explorer", logline: "One small crew, one vast galaxy." },
  { key: "storybook", name: "Storybook Kingdom", logline: "An enchanted realm calls for its bravest knight." },
  { key: "noir", name: "Noir Detective", logline: "Rain-slick streets. A case nobody could crack." },
] as const;

// Picks the story arc — same world, different film (12 structures total).
const PERSONALITIES = [
  { key: "brave", name: "Brave", blurb: "Fearless lead. Runs toward the adventure." },
  { key: "easygoing", name: "Easygoing", blurb: "Cozy hero. The world can wait a nap." },
  { key: "playful", name: "Playful", blurb: "Chaos star. The plot chases THEM." },
  { key: "timid", name: "Timid", blurb: "Shy heart. Finds courage by the finale." },
] as const;

const MIN_PHOTOS = 4;
const MAX_PHOTOS = 8;
const BRIEF_MIN = 20;
const BRIEF_MAX = 2000;

/**
 * Intake form shown on /approve/[token] while the order is UPLOADING.
 *
 * preset: pet name + world/personality pick + 4-8 photos, multipart POST to
 * submit-photos (unchanged).
 * custom (Director's Cut, isCustom=true): pet name + 4 guided brief fields
 * (setting / mood / one highlight / ending), assembled into ONE customBrief
 * string on submit, + the same 4-8 photos — no world/personality picker.
 */
export default function PhotoUploadForm({
  orderId,
  approveToken,
  isCustom = false,
}: {
  orderId: string;
  approveToken: string;
  isCustom?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [petName, setPetName] = useState("");
  const [world, setWorld] = useState<string>("");
  const [personality, setPersonality] = useState<string>("");
  // Director's Cut guided brief fields — concatenated into one customBrief
  // string on submit (server enforces 20-2000 chars overall).
  const [setting, setSetting] = useState("");
  const [mood, setMood] = useState("");
  const [highlight, setHighlight] = useState("");
  const [ending, setEnding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const customBrief = [
    setting.trim() && `Setting: ${setting.trim()}`,
    mood.trim() && `Mood: ${mood.trim()}`,
    highlight.trim() && `One highlight moment: ${highlight.trim()}`,
    ending.trim() && `How it ends: ${ending.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files, ...Array.from(list)].filter((f) => f.type.startsWith("image/"));
    setFiles(next.slice(0, MAX_PHOTOS));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("orderId", orderId);
        fd.set("approveToken", approveToken);
        fd.set("petName", petName);
        if (isCustom) {
          fd.set("customBrief", customBrief);
        } else {
          fd.set("world", world);
          fd.set("personality", personality);
        }
        files.forEach((f) => fd.append("photos", f));
        const res = await fetch("/api/orders/submit-photos", { method: "POST", body: fd });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          setError(json.error ?? "Something went wrong. Please try again.");
          return;
        }
        // Preset: order is now IMAGE_GENERATING. Custom: the treatment already
        // drafted inline (submit-photos runs it synchronously), so the order
        // is already at AWAITING_TREATMENT_APPROVAL (or reverted, in which
        // case json.ok would be false above). Either way, re-render the
        // server tree so the next status's view takes over.
        setDone(true);
        router.refresh();
      } catch {
        setError("Network hiccup — please try again.");
      }
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display gold-glow-text text-4xl tracking-wide text-gold uppercase sm:text-5xl">
          {petName || "Your star"} is in wardrobe.
        </h2>
        <p className="mt-5 leading-relaxed text-muted">
          {isCustom
            ? `Your director is drafting ${petName ? `${petName}'s` : "the"} treatment from your brief. This only takes a moment.`
            : `Our directors are painting three concept stills — three different scenes from ${petName ? `${petName}'s` : "their"} world. We'll email you the moment they're ready to choose from (usually under an hour).`}
        </p>
        <p className="mt-3 text-sm text-muted">You can close this page.</p>
      </div>
    );
  }

  const canSubmit =
    !pending &&
    petName.trim().length > 0 &&
    files.length >= MIN_PHOTOS &&
    (isCustom
      ? customBrief.trim().length >= BRIEF_MIN && customBrief.trim().length <= BRIEF_MAX
      : world !== "" && personality !== "");

  return (
    <div className="mx-auto max-w-2xl">
      {/* Pet name */}
      <label className="block">
        <span className="font-display text-sm tracking-[0.2em] text-gold uppercase">
          Your pet&apos;s name
        </span>
        <input
          type="text"
          value={petName}
          onChange={(e) => setPetName(e.target.value)}
          maxLength={40}
          placeholder="Luna"
          className="mt-2 w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
        />
      </label>

      {isCustom ? (
        <>
          {/* Director's Cut — guided brief fields, assembled into one customBrief string */}
          <fieldset className="mt-8 space-y-6">
            <legend className="font-display text-sm tracking-[0.2em] text-gold uppercase">
              Tell us the story
            </legend>
            <p className="-mt-3 text-xs text-muted">
              No preset world here — this is your director&apos;s brief.
              Answer in your own words; the more specific, the better.
            </p>
            <label className="block">
              <span className="text-sm font-semibold text-ivory">
                What&apos;s the setting / world?
              </span>
              <textarea
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="A cozy mountain ski lodge in the 1970s…"
                className="mt-2 w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ivory">
                What&apos;s the mood / vibe?
              </span>
              <textarea
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Warm, cozy, a little adventurous…"
                className="mt-2 w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ivory">
                One moment that HAS to be in it
              </span>
              <textarea
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Sledding down the big hill, ears flying…"
                className="mt-2 w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ivory">
                How does it end?
              </span>
              <textarea
                value={ending}
                onChange={(e) => setEnding(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Curled up by the fire, a hero's welcome…"
                className="mt-2 w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-ivory placeholder:text-muted/50 focus:border-gold/60 focus:outline-none"
              />
            </label>
            <p className="text-xs text-muted">
              {customBrief.trim().length}/{BRIEF_MAX} characters
              {customBrief.trim().length > 0 && customBrief.trim().length < BRIEF_MIN
                ? " — tell us a little more"
                : ""}
            </p>
          </fieldset>
        </>
      ) : (
        <>
          {/* World pick */}
          <fieldset className="mt-8">
            <legend className="font-display text-sm tracking-[0.2em] text-gold uppercase">
              Choose their world
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup">
              {WORLDS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  role="radio"
                  aria-checked={world === w.key}
                  onClick={() => setWorld(w.key)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    world === w.key
                      ? "border-gold bg-surface shadow-[0_0_24px_rgba(232,182,76,0.25)]"
                      : "border-hairline bg-surface/50 hover:border-gold/40"
                  }`}
                >
                  <span className="font-display block text-lg tracking-wide text-ivory uppercase">
                    {w.name}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{w.logline}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Personality pick — chooses the story arc within the world */}
          <fieldset className="mt-8">
            <legend className="font-display text-sm tracking-[0.2em] text-gold uppercase">
              Their personality
            </legend>
            <p className="mt-1 text-xs text-muted">
              Shapes the story — same world, a different film.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup">
              {PERSONALITIES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={personality === p.key}
                  onClick={() => setPersonality(p.key)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    personality === p.key
                      ? "border-gold bg-surface shadow-[0_0_24px_rgba(232,182,76,0.25)]"
                      : "border-hairline bg-surface/50 hover:border-gold/40"
                  }`}
                >
                  <span className="font-display block text-lg tracking-wide text-ivory uppercase">
                    {p.name}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{p.blurb}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {/* Photos */}
      <fieldset className="mt-8">
        <legend className="font-display text-sm tracking-[0.2em] text-gold uppercase">
          {MIN_PHOTOS}–{MAX_PHOTOS} photos of your pet
        </legend>
        <p className="mt-1 text-xs text-muted">
          At least one clear front-facing face works best. Adding a side
          profile too sharpens the likeness. Good light, one pet only.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 w-full rounded-xl border border-dashed border-hairline bg-surface/40 px-4 py-8 text-center text-muted transition-colors hover:border-gold/50 hover:text-ivory"
        >
          {files.length === 0
            ? "Tap to add photos"
            : `${files.length} photo${files.length > 1 ? "s" : ""} added — tap to add more`}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        {files.length > 0 && (
          <ul className="mt-3 grid grid-cols-4 gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt={`photo ${i + 1}`}
                  className="aspect-square w-full rounded-lg border border-hairline object-cover"
                />
                <button
                  type="button"
                  aria-label={`remove photo ${i + 1}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-night text-xs text-muted ring-1 ring-hairline hover:text-ivory"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="btn-marquee mt-8 w-full px-8 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Sending to the studio…" : "Send photos — start pre-production"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        {isCustom
          ? "Next step: your director writes a treatment for you to approve. Nothing goes to storyboard until you sign off."
          : "Next step: we paint three concept stills. Nothing goes to film until you approve one."}
      </p>
    </div>
  );
}
