"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Dashboard search box (A-2). Client component so it can read/write the URL
 * via useRouter — the actual query runs server-side in app/admin/page.tsx
 * against `?q=`. Submitting (or clearing) navigates to /admin?q=<value>,
 * which re-renders the server component with a "検索結果" section.
 */
export function AdminSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function go(next: string) {
    const trimmed = next.trim();
    if (trimmed) {
      router.push(`/admin?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/admin");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
      className="flex items-center gap-2"
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="メール・ペット名・注文ID・Stripeセッションで検索"
        className="w-72 max-w-full rounded-[var(--radius-chip)] border border-hairline bg-surface px-3 py-1.5 text-sm text-ivory placeholder:text-muted focus:border-gold/50 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-[var(--radius-chip)] border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:border-gold/50 hover:text-gold"
      >
        検索
      </button>
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            go("");
          }}
          className="text-xs uppercase tracking-wider text-muted transition-colors hover:text-gold"
        >
          クリア
        </button>
      )}
    </form>
  );
}
