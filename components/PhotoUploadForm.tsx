"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

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

// LORA-STORYBOARD-SPEC.md §5 (owner-approved): raised from 4-8. The trainer's
// own recommendation is 10+, but 7 is the owner's deliberate conversion
// trade-off, not the trainer's floor — see the guidance copy below, which
// pushes toward full-body / undressed / varied / same-era / mostly-frontal
// photos rather than raising this further. camyu's own training set (the
// bake-off that produced this spec) was 8 photos, all face-forward, none of
// them a bare full body — exactly what this copy now steers customers away
// from.
const MIN_PHOTOS = 7;
const MAX_PHOTOS = 12;
const BRIEF_MIN = 20;
const BRIEF_MAX = 2000;

/** Submit-button copy while `pending`: upload progress, then the final POST. */
function submitButtonLabel(status: { uploaded: number; total: number } | "sending" | null): string {
  if (status === "sending") return "Sending to the studio…";
  if (status) return `Uploading photo ${Math.min(status.uploaded + 1, status.total)} of ${status.total}…`;
  return "Sending to the studio…";
}

/**
 * Intake form shown on /approve/[token] while the order is UPLOADING.
 *
 * preset: pet name + world/personality pick + 4-8 photos.
 * custom (Director's Cut, isCustom=true): pet name + 4 guided brief fields
 * (setting / mood / one highlight / ending), assembled into ONE customBrief
 * string on submit, + the same 4-8 photos — no world/personality picker.
 *
 * Photos are uploaded straight from the browser to Vercel Blob (Vercel
 * rejects any function request body over ~4.5MB before our handler runs, so
 * a server-side multipart upload of real phone photos is impossible in
 * production) — see app/api/orders/upload-token/route.ts for the token
 * endpoint. Only the resulting URLs are then POSTed as JSON to submit-photos.
 * Uploads run sequentially, not in parallel, so a phone on mobile data isn't
 * saturated and the "photo N of M" progress readout stays meaningful.
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
  // Drives the submit button's label while uploading: number of photos
  // uploaded so far, or "sending" once we've moved on to the final JSON POST.
  const [uploadStatus, setUploadStatus] = useState<{ uploaded: number; total: number } | "sending" | null>(
    null
  );
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

  // Strip path separators and anything but a safe filename charset, keeping
  // the extension — this becomes part of the Blob pathname, not a display
  // name, so it just needs to be inoffensive, not pretty.
  function safeFileName(name: string): string {
    const cleaned = name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
    return cleaned || "photo";
  }

  /**
   * HEIC / HEIF は iPhone の標準形式なので、Mac の Finder から選ぶと普通に
   * 混ざる。放っておくと**二通りに黙って壊れる**:
   *   ・type が "image/heic" … 下の image/ フィルタを通り、Blob に上がり、
   *     その URL を受け取った fal が読めない
   *   ・type が ""（Finder 経由だと空になることがある）… フィルタで捨てられ、
   *     顧客には何も表示されない
   * どちらもエラーが出ないのが最悪で、顧客は「7枚入れたのに送れない」だけを見る。
   *
   * ブラウザ内で JPEG に焼き直す。Safari は HEIC をデコードできるので
   * createImageBitmap がそのまま通る。Chrome はデコードできないので、
   * **落とさずに例外にして、ファイル名を出して伝える**。ライブラリを足せば
   * Chrome でも変換できる（heic2any / libheif-wasm）が、1MB 超の wasm を
   * 全員に配ることになるので、まずは変換できる環境で変換し、できない環境には
   * 何が起きたか伝えるところまで。
   */
  async function toJpegIfHeic(file: File): Promise<File> {
    const isHeic =
      /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (!isHeic) return file;

    const bitmap = await createImageBitmap(file); // Chrome ではここで throw
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92)
    );
    if (!blob) throw new Error("canvas.toBlob returned null");
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
      type: "image/jpeg",
    });
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);

    const incoming = Array.from(list);
    const converted: File[] = [];
    const failed: string[] = [];
    for (const f of incoming) {
      try {
        const out = await toJpegIfHeic(f);
        if (out.type.startsWith("image/")) converted.push(out);
        else failed.push(f.name);
      } catch {
        failed.push(f.name);
      }
    }

    const next = [...files, ...converted];
    // 上限超過は**黙って切らない**。以前は slice するだけだったので、20枚
    // 選んだ人は後ろの8枚が消えたことに気づけなかった。しかも捨てられるのは
    // 後から足した方なので、「一番いい写真を最後に選んだ」人ほど損をする。
    const dropped = Math.max(0, next.length - MAX_PHOTOS);
    setFiles(next.slice(0, MAX_PHOTOS));

    const notes: string[] = [];
    if (failed.length) {
      notes.push(
        `We couldn't read ${failed.length} file${failed.length > 1 ? "s" : ""} (${failed
          .slice(0, 3)
          .join(", ")}${failed.length > 3 ? "…" : ""}). If these are iPhone HEIC photos, open them and export as JPEG, or send them from your phone instead.`
      );
    }
    if (dropped > 0) {
      notes.push(`We kept the first ${MAX_PHOTOS} photos — ${dropped} more didn't fit.`);
    }
    if (notes.length) setError(notes.join(" "));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      // Upload photos straight to Vercel Blob first, sequentially (not
      // Promise.all) so a phone on mobile data isn't saturated by 5+
      // concurrent uploads, and so "photo N of M" is a meaningful readout.
      const photoUrls: string[] = [];
      try {
        for (let i = 0; i < files.length; i++) {
          setUploadStatus({ uploaded: i, total: files.length });
          const file = files[i];
          const pathname = `orders/${orderId}/${Date.now()}-${i}-${safeFileName(file.name)}`;
          const blob = await upload(pathname, file, {
            access: "public",
            handleUploadUrl: "/api/orders/upload-token",
            clientPayload: JSON.stringify({ orderId, approveToken }),
          });
          photoUrls.push(blob.url);
        }
      } catch {
        setUploadStatus(null);
        setError("We couldn't upload your photos — please check your connection and try again.");
        return;
      }

      setUploadStatus("sending");
      try {
        const res = await fetch("/api/orders/submit-photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isCustom
              ? { orderId, approveToken, petName, customBrief, photoUrls }
              : { orderId, approveToken, petName, world, personality, photoUrls }
          ),
        });
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
      } finally {
        setUploadStatus(null);
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
        {/* LORA-STORYBOARD-SPEC.md §5: the old one-liner ("front-facing face
            works best, side profile sharpens it") pulled customers toward
            face-only collections — camyu's own 8-photo set (the bake-off
            behind this spec) was 4 face/chest close-ups, 2 near-duplicates,
            and 0 full-body shots without a harness on, which is exactly why
            the trained LoRA barely learned the body. This list steers toward
            what the trainer actually needs, without turning any of it into a
            hard requirement a customer could get stuck on. */}
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">
          {/* The 7-in-10 split is the owner's call (spec §5). Don't dress it up
              with an invented mechanism — "angles alone make the likeness
              flatter" was never measured. The honest reason is downstream: all
              six storyboard framings (SHOT_FRAMINGS, lib/film-script.ts) turn
              the face toward camera, so front-facing is simply what most of
              the film asks for. */}
          <li>Mostly front-facing (about 7 in 10) — nearly every shot in the film looks your pet right in the face — with a few side and angled photos mixed in.</li>
          <li>At least 2 standing full-body shots with no costume or harness on — this is what teaches the body, not just the face.</li>
          <li>Skip near-duplicates — different moments and angles beat five photos of the same pose.</li>
          <li>Keep it to one time period (e.g. all recent, not puppy photos mixed with grown-up ones) — mixing ages blends into a look that matches neither.</li>
          <li>Good light, one pet only, nothing covering the face.</li>
        </ul>
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
          // HEIC/HEIF を明示。Finder 経由だと type が空になることがあり、
          // image/* だけだとピッカーに出ない環境がある。拾ってから
          // addFiles が JPEG に焼き直す（変換できなければ名前を出して伝える）。
          accept="image/*,.heic,.heif"
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
        {pending ? submitButtonLabel(uploadStatus) : "Send photos — start pre-production"}
      </button>
      {/* The wait is worth naming here, not just in email (LORA-STORYBOARD-SPEC.md
          §2.1/§2.7): a model of this pet is trained before any scene is drawn,
          so the storyboard takes real time now. Unexplained silence after a
          $159–$249 checkout reads as a stalled order. Split by plan because the
          wait starts at different moments — a custom order writes its treatment
          first and only kicks the pipeline once the customer approves it
          (app/api/orders/approve-treatment/route.ts calls kickLoraTraining),
          while a preset order starts the moment these photos land.
          STORYBOARD-ADMIN-GATE-SPEC.md §3.6: "up to about three hours" is gone
          — a director now reviews all eighteen shots before any of them reach
          the customer (§0/§3.1), and that review has no fixed duration, so "up
          to one business day" is the bound we can actually keep. The director
          review is named explicitly here too, so the longer wait reads as an
          extra quality step, not an unexplained delay. */}
      <p className="mt-3 text-center text-xs text-muted">
        {isCustom
          ? "Next step: your director writes a treatment for you to approve. Nothing goes to storyboard until you sign off — and once you do, a director reviews every shot before it reaches you, so it takes up to one business day. We'll email you when it's ready."
          : "Next step: we paint your storyboard — six scenes, three takes each — then a director reviews every shot before it reaches you. It takes up to one business day, because we also train a custom model of your pet first. We'll email you the moment it's ready, and nothing goes to film until you approve it."}
      </p>
    </div>
  );
}
