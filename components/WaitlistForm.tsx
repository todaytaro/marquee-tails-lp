"use client";

import { useState, type FormEvent } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PERKS = [
  "20% off any edition",
  "Free poster upgrade",
  "Behind-the-scenes peeks from the studio",
] as const;

type Status = "idle" | "loading" | "success";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot — humans never see it
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, company }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (res.ok && data?.ok) {
        setStatus("success");
      } else {
        setStatus("idle");
        setError(
          data?.error ??
            "Something went wrong on our end. Please try again in a moment."
        );
      }
    } catch {
      setStatus("idle");
      setError("Couldn't reach the box office. Check your connection and try again.");
    }
  }

  return (
    <section id="waitlist" aria-labelledby="waitlist-title" className="px-4 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-[rgba(232,182,76,0.15)] bg-[#14121c] px-5 py-10 sm:px-10 sm:py-12">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.25em] text-[#e8b64c]">
          Orders open now
        </p>
        <h2
          id="waitlist-title"
          className="text-center uppercase leading-none tracking-[0.06em] text-[#f6d27e] [font-family:var(--font-display),Impact,sans-serif] [font-size:clamp(2.25rem,7vw,3.5rem)]"
        >
          Get a launch discount code
        </h2>
        <p className="mx-auto mt-5 max-w-prose text-center text-sm leading-relaxed text-[#a09aae] sm:text-base">
          You can order your pet&rsquo;s film right now — no waiting required.
          Drop your email and we&rsquo;ll send you a launch discount code plus
          behind-the-scenes peeks from the studio while your storyboard comes
          together.
        </p>

        {/* Discount perks as ticket stubs */}
        <ul className="mt-8 flex flex-col gap-3" aria-label="Email signup perks">
          {PERKS.map((perk, i) => (
            <li
              key={perk}
              className="relative flex items-stretch overflow-hidden rounded-lg border border-[rgba(232,182,76,0.15)] bg-[#0b0a10]"
            >
              {/* Stub cell */}
              <span className="flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-dashed border-[rgba(232,182,76,0.35)] px-2 py-3">
                <span
                  className="text-xl leading-none text-[#e8b64c] [font-family:var(--font-display),Impact,sans-serif]"
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#a09aae]">
                  Admit one
                </span>
              </span>
              {/* Perforation notches */}
              <span
                aria-hidden="true"
                className="absolute left-20 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(232,182,76,0.15)] bg-[#14121c]"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-20 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border border-[rgba(232,182,76,0.15)] bg-[#14121c]"
              />
              <span className="flex items-center px-4 py-3 text-sm font-medium text-[#f4f1e8] sm:text-base">
                {perk}
              </span>
            </li>
          ))}
        </ul>

        {/* Form / success — min-height keeps the section from jumping on swap */}
        <div className="mt-8 flex min-h-[13rem] flex-col justify-start sm:min-h-[9.5rem]" aria-live="polite">
          {status === "success" ? (
            <div className="text-center">
              <h3 className="uppercase tracking-[0.06em] text-[#f6d27e] [font-family:var(--font-display),Impact,sans-serif] [font-size:clamp(1.6rem,5vw,2.25rem)]">
                Check your inbox.
              </h3>
              <p className="mx-auto mt-3 max-w-prose text-sm leading-relaxed text-[#f4f1e8] sm:text-base">
                We&rsquo;ve sent your launch discount code, good on any
                edition. Orders are open now — start shortlisting your 5–8
                best photos and put your pet on the marquee today.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="waitlist-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="waitlist-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "loading"}
                  aria-invalid={error !== null}
                  aria-describedby={error ? "waitlist-error" : undefined}
                  className="h-12 w-full flex-1 rounded-lg border border-[rgba(232,182,76,0.15)] bg-[#0b0a10] px-4 text-base text-[#f4f1e8] placeholder:text-[#a09aae] focus:border-[#e8b64c] focus:outline-none focus:ring-2 focus:ring-[rgba(232,182,76,0.35)] disabled:opacity-60"
                />
                {/* Honeypot: invisible to humans, tempting to bots */}
                <div
                  aria-hidden="true"
                  className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
                >
                  <label htmlFor="waitlist-company">Company</label>
                  <input
                    id="waitlist-company"
                    type="text"
                    name="company"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="h-12 shrink-0 rounded-lg bg-[#e8b64c] px-6 text-sm font-bold uppercase tracking-[0.08em] text-[#0b0a10] motion-safe:transition-shadow hover:shadow-[0_0_40px_rgba(232,182,76,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6d27e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#14121c] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {status === "loading"
                    ? "Sending your code…"
                    : "Send me my discount code"}
                </button>
              </div>
              {error && (
                <p
                  id="waitlist-error"
                  role="alert"
                  className="mt-3 text-sm text-[#f6d27e]"
                >
                  {error}
                </p>
              )}
              <p className="mt-4 text-center text-xs leading-relaxed text-[#a09aae]">
                One email with your code, plus the occasional
                behind-the-scenes peek. No spam, ever. Unsubscribe anytime.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
