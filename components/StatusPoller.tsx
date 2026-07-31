"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the order while the page is on a non-interactive "in progress" view
 * (generating stills, filming, quality check) and refreshes the server
 * component when something the page shows has changed — no manual reload.
 *
 * It watches TWO things, because status alone missed a case badly enough to
 * cost a deliverable. The poster options finish rendering part-way through
 * VIDEO_GENERATING, so with only the status compared the poll never fired:
 * the customer sat on a screen telling them they could close the page, while
 * the picker existed server-side and was never rendered to them. Missing that
 * pick costs them the free digital poster and costs us the print upsell, and
 * nothing anywhere says so.
 */
export default function StatusPoller({
  token,
  currentStatus,
  currentPosterReady = false,
  intervalMs = 5000,
}: {
  token: string;
  currentStatus: string;
  /** Whether a poster choice is on screen right now (see the status route). */
  currentPosterReady?: boolean;
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
          const { status, posterReady } = (await res.json()) as {
            status?: string;
            posterReady?: boolean;
          };
          const statusChanged = Boolean(status) && status !== currentStatus;
          // Older deployments of the route don't send posterReady; treating
          // undefined as "unchanged" keeps this poll behaving exactly as it
          // did rather than refreshing in a loop against a stale server.
          const posterChanged =
            posterReady !== undefined && posterReady !== currentPosterReady;
          if (statusChanged || posterChanged) {
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
  }, [token, currentStatus, currentPosterReady, intervalMs, router]);

  return null;
}
