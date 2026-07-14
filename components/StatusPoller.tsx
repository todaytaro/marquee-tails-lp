"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the order status while the page is on a non-interactive "in progress"
 * view (generating stills, filming, quality check). When the status changes,
 * it refreshes the server component so the page auto-advances — no manual
 * browser refresh to see the finished stills / film.
 */
export default function StatusPoller({
  token,
  currentStatus,
  intervalMs = 5000,
}: {
  token: string;
  currentStatus: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/orders/status?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const { status } = (await res.json()) as { status?: string };
          if (status && status !== currentStatus) {
            stopped.current = true;
            router.refresh(); // re-render the server component -> next view
            return;
          }
        }
      } catch {
        // transient network error — keep polling
      }
      timer = setTimeout(tick, intervalMs);
    }

    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [token, currentStatus, intervalMs, router]);

  return null;
}
