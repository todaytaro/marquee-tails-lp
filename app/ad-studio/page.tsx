"use client";

import { useState, useTransition } from "react";
import { generateAdAction } from "./actions";
import type { AdAssets } from "@/lib/ad-studio";

/**
 * 広告スタジオ（ローカル専用）。名前とコンセプトを打って、出てきたポスターを
 * その場で見て、良ければ動画にする。
 *
 * CLI（scripts/ad-clip.ts）と同じ lib/ad-studio.ts を呼ぶので、片方だけ
 * 挙動が変わることはない。入口は2つ、中身は1つ。
 *
 * 既定が「ポスターのみ」なのは意図的。ポスターは生成を伴わないので何度でも
 * 無料で試せて、動画は1本$0.42かかる。**構図と文言が決まってから**動画に
 * 進むのが、この作業で一番お金を無駄にしない順番。
 */

type Run = { id: number; title: string; concept: string; assets: AdAssets };

const EXAMPLES = [
  "a deep-sea submarine exploring a trench nobody has mapped",
  "a 1940s rain-slicked detective office, venetian blind shadows",
  "a snow-covered mountain expedition camp at dawn",
  "a haunted victorian library where the books whisper",
];

export default function AdStudioPage() {
  const [title, setTitle] = useState("MILO");
  const [concept, setConcept] = useState(EXAMPLES[0]);
  const [motion, setMotion] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [posterOnly, setPosterOnly] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function go() {
    setError(null);
    startTransition(async () => {
      const r = await generateAdAction({
        title,
        concept,
        motion: motion || undefined,
        seconds,
        posterOnly,
      });
      if (r.ok) setRuns((prev) => [{ id: Date.now(), title, concept, assets: r.assets }, ...prev]);
      else setError(r.error);
    });
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-3xl tracking-wide text-gold">AD STUDIO</h1>
      <p className="mt-1 text-xs text-muted">
        ローカル専用。ポスターは無料で何度でも、動画は1本 ${(seconds * 0.084).toFixed(2)}。
        <span className="text-ivory"> これは製品ではありません</span> — LoRAを使わないので、
        特定の犬の再現ではなく世界観の見本です。
      </p>

      <section className="mt-6 rounded-[var(--radius-card)] border border-gold/40 bg-gold/5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-muted">
            名前
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-3 py-2 text-sm text-ivory focus:border-gold/60 focus:outline-none"
            />
          </label>
          <label className="text-xs text-muted">
            動きの指示（任意）
            <input
              value={motion}
              onChange={(e) => setMotion(e.target.value)}
              placeholder="Slow dolly-in, dust drifting through warm light"
              className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-3 py-2 text-sm text-ivory placeholder:text-muted/60 focus:border-gold/60 focus:outline-none"
            />
          </label>
        </div>

        <label className="mt-4 block text-xs text-muted">
          コンセプト
          <textarea
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-3 py-2 text-sm text-ivory focus:border-gold/60 focus:outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setConcept(e)}
              className="rounded-[var(--radius-chip)] border border-hairline px-2 py-1 text-[11px] text-muted hover:border-gold/50 hover:text-gold"
            >
              {e.slice(0, 34)}…
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={posterOnly}
              onChange={(e) => setPosterOnly(e.target.checked)}
              className="h-4 w-4 accent-[var(--gold)]"
            />
            ポスターだけ（動画を作らない）
          </label>
          {!posterOnly && (
            <label className="flex items-center gap-2 text-sm text-muted">
              秒数
              <input
                type="number"
                min={3}
                max={15}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                className="w-16 rounded-[var(--radius-chip)] border border-hairline bg-night/40 px-2 py-1 text-sm text-ivory focus:border-gold/60 focus:outline-none"
              />
            </label>
          )}
          <button type="button" onClick={go} disabled={isPending} className="btn-marquee px-5 py-2 text-sm disabled:pointer-events-none disabled:opacity-60">
            {isPending ? (posterOnly ? "生成中… 30秒ほど" : "生成中… 3分ほど") : "生成する"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
      </section>

      {runs.map((run) => (
        <section key={run.id} className="mt-8 rounded-[var(--radius-card)] border border-hairline p-5">
          <p className="text-xs text-muted">
            <span className="text-gold">{run.title}</span> — {run.concept}
          </p>
          <div className="mt-4 flex flex-wrap gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={run.assets.posterUrl} alt="poster" className="w-64 rounded-md" />
            {run.assets.clipUrl && (
              <video controls src={run.assets.clipUrl} className="w-96 rounded-md bg-black" />
            )}
          </div>
          {run.assets.script && (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">脚本（衣装・シーン・文言）</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-night/40 p-3 text-[11px] leading-relaxed text-ivory/80">
{`costume: ${run.assets.script.costume}

cut 1:   ${run.assets.script.scene}

tagline: ${run.assets.script.tagline}
intro:   ${run.assets.script.intro}`}
              </pre>
            </details>
          )}
          <p className="mt-3 flex gap-4 text-xs">
            <a href={run.assets.posterUrl} download className="text-gold underline">ポスターを保存</a>
            {run.assets.stillUrl && <a href={run.assets.stillUrl} download className="text-gold underline">静止画を保存</a>}
            {run.assets.clipUrl && <a href={run.assets.clipUrl} download className="text-gold underline">動画を保存</a>}
          </p>
        </section>
      ))}
    </main>
  );
}
