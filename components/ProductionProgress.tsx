"use client";

import { useEffect, useState } from "react";

/**
 * "Something is happening" reassurance for the waiting screens — a gold
 * shimmer progress bar plus a playful, movie-production status line that
 * cycles through the crew's steps. Not "generating…" — it reads as a real
 * film set at work, which is the brand promise.
 */
export default function ProductionProgress({ messages }: { messages: string[] }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 2800);
    return () => clearInterval(t);
  }, [messages.length]);

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
    </div>
  );
}
