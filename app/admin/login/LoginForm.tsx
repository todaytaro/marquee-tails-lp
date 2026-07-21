"use client";

import { useState, useTransition } from "react";
import { loginAction } from "./actions";

/**
 * Admin password form (ADMIN-AUTH-SPEC.md §4). On submit calls loginAction,
 * which redirects to /admin on success — a redirect thrown from a server
 * action surfaces here as a rejected promise (Next's internal redirect
 * signal), so we only ever handle the {ok:false} inline-error case.
 */
export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginAction(password);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-[10px] uppercase tracking-widest text-muted"
        >
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          className="w-full rounded-[var(--radius-chip)] border border-hairline bg-night px-3 py-2 text-sm text-ivory placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-chip)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-marquee w-full px-6 py-2.5 text-sm tracking-wider disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
