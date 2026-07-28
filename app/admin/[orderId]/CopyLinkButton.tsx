"use client";

import { useState } from "react";

/**
 * Generic copy-to-clipboard control (B-6). Used for the customer magic link
 * on the detail page, and reused by A-3 for podOrderId.
 */
export function CopyLinkButton({
  value,
  label = "コピー",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[CopyLinkButton] clipboard write failed", err);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-[var(--radius-chip)] border border-hairline bg-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted transition-colors hover:border-gold/50 hover:text-gold"
    >
      {copied ? "コピーしました" : label}
    </button>
  );
}
