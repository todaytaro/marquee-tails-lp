"use client";

import { useEffect, useState } from "react";

/**
 * "Something is happening" reassurance for the waiting screens — a gold
 * shimmer progress bar, a playful movie-production status line that cycles
 * through the crew's steps, and a soft ETA countdown. Not "generating…" —
 * it reads as a real film set at work.
 *
 * `elapsedSeconds` (server-computed at render, from the status-change time)
 * and `estimateSeconds` drive the countdown; the client ticks from there.
 * When it overruns the estimate we say "Almost ready…" rather than 0.
 */
export default function ProductionProgress({
  messages,
  elapsedSeconds = 0,
  estimateSeconds,
}: {
  messages: string[];
  elapsedSeconds?: number;
  estimateSeconds?: number;
}) {
  const [i, setI] = useState(0);
  const [tick, setTick] = useState(0); // seconds since mount

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 2800);
    return () => clearInterval(t);
  }, [messages.length]);

  useEffect(() => {
    if (!estimateSeconds) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [estimateSeconds]);

  let eta: string | null = null;
  if (estimateSeconds) {
    const remaining = Math.round(estimateSeconds - (elapsedSeconds + tick));
    if (remaining > 60) eta = `About ${Math.ceil(remaining / 60)} minutes left`;
    else if (remaining > 15) eta = "Under a minute left…";
    else eta = "Almost ready…";
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="progress-track" aria-hidden />
      <p
        key={i}
        className="status-line mt-4 text-center text-sm tracking-wide text-gold-bright"
        aria-live="polite"
      >
        {messages[i]}
      </p>
      {eta && <p className="mt-2 text-center text-xs text-muted">{eta}</p>}
    </div>
  );
}
