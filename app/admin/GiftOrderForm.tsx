"use client";

import { useState, useTransition } from "react";
import { createGiftOrderAction } from "./actions";

/**
 * 無償枠（クリエイター向けシーディング）の発行フォーム。
 *
 * 折りたたんであるのは、これが日常操作ではないから。注文一覧の上に開いた
 * まま置くと、admin で一番よく使う画面の一等地を、月に数回しか押さないボタン
 * が占める。
 *
 * 発行後はリンクを画面に出したままにする。メールは送るが、クリエイターへの
 * 連絡は DM で行うことの方が多く、そのとき手元にリンクが要る。
 */
export function GiftOrderForm() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [giftedTo, setGiftedTo] = useState("");
  const [tier, setTier] = useState<"preset" | "custom">("preset");
  const [issued, setIssued] = useState<{ orderId: string; approveUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createGiftOrderAction({ email, tier, giftedTo });
      if (r.ok) {
        setIssued({ orderId: r.orderId, approveUrl: r.approveUrl });
        setEmail("");
        setGiftedTo("");
      } else {
        setError(r.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-chip)] border border-gold/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10"
      >
        ＋ 無償枠を発行
      </button>
    );
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-gold/40 bg-gold/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wide text-gold-bright">無償枠を発行</h2>
        <button
          type="button"
          onClick={() => { setOpen(false); setIssued(null); setError(null); }}
          className="text-xs text-muted hover:text-ivory"
        >
          閉じる
        </button>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted">
        決済を通さずに注文を1件作ります。以降は通常の注文と<strong className="text-ivory">完全に同じ経路</strong>
        （写真提出 → 絵コンテ → 承認 → 納品）を通ります。
        <br />
        <strong className="text-ivory">1本あたり約$20の実費</strong>がかかります。無料なのは相手だけです。
        <br />
        米国向けの依頼では、<strong className="text-ivory">投稿時に #ad / #gifted の開示を必ず求めてください</strong>
        — 開示は広告主側の責任でもあります。
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          メールアドレス
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="creator@example.com"
            className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-2 py-1.5 text-sm text-ivory placeholder:text-muted/60 focus:border-gold/60 focus:outline-none"
          />
        </label>
        <label className="text-xs text-muted">
          配布先（必須）
          <input
            type="text"
            value={giftedTo}
            onChange={(e) => setGiftedTo(e.target.value)}
            placeholder="@handle / 名前"
            className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-2 py-1.5 text-sm text-ivory placeholder:text-muted/60 focus:border-gold/60 focus:outline-none"
          />
        </label>
        <label className="text-xs text-muted">
          プラン
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "preset" | "custom")}
            className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-2 py-1.5 text-sm text-ivory focus:border-gold/60 focus:outline-none"
          >
            <option value="preset">Preset Worlds（$99相当）</option>
            <option value="custom">Director&apos;s Cut（$249相当）</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="btn-marquee mt-3 px-4 py-2 text-sm disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "発行中…" : "発行する"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {issued && (
        <div className="mt-3 rounded-[var(--radius-chip)] border border-gold/40 bg-night/40 p-3">
          <p className="text-xs text-muted">
            発行しました。案内メールも送信済みです。DMで渡す場合はこのリンクを使ってください。
          </p>
          <p className="mt-1 break-all font-mono text-xs text-gold">{issued.approveUrl}</p>
          <a href={`/admin/${issued.orderId}`} className="mt-2 inline-block text-xs text-gold underline">
            この注文を開く →
          </a>
        </div>
      )}
    </section>
  );
}
