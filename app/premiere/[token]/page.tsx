import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatus, type Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import MoviePosterOverlay from "@/components/MoviePosterOverlay";
import { resolveWorld } from "@/lib/film-script";

/**
 * 贈られた人が見る画面（REVEAL-CARD-SPEC）。
 *
 * **`/approve/[token]` とは別のページで、別のトークンで開く。** あちらは買った人の
 * 画面で、ダウンロード・評価・SNS許諾・アドオン購入が並んでいる。リビールカードに
 * あの URL を刷ってしまうと、贈られた人に買った人の操作権を渡すことになる。
 * ここにあるのは映画とポスターだけ。ボタンは1つも無い。
 *
 * 買った人の画面と違い、ここは**贈られた人が最初に開く場所**でもある。
 * 説明も、購入の痕跡（価格・注文番号・プラン名）も出さない — 贈り物の値札を
 * 剥がすのと同じ理由。
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "A Private Screening — Marquee Tails",
  // approveToken と同じ扱い: 検索に載せない、Referer に載せない。
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto w-full max-w-5xl px-6 py-6 text-center">
        <p className="font-display text-2xl tracking-[0.2em] text-ivory">
          MARQUEE <span className="text-gold">TAILS</span>
        </p>
      </header>
      <div className="film-strip" aria-hidden />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:py-16">{children}</main>
      <div className="film-strip" aria-hidden />
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-center text-xs text-muted">
        Someone had this made for you.
      </footer>
    </div>
  );
}

function posterCopy(order: Order): { tagline: string; subtitle: string } {
  const loglines = resolveWorld(order).loglines;
  return { tagline: loglines.intro, subtitle: loglines.tagline };
}

export default async function PremierePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await prisma.order.findUnique({
    where: { shareToken: decodeURIComponent(token) },
  });

  // 未納品の注文でこのページが開けてはいけない。贈る人が受け取る前にリンクを
  // 試したときに、作りかけを見せることになる。
  if (!order || order.status !== OrderStatus.COMPLETED || !order.finalVideoUrl) {
    notFound();
  }

  const petName = (order.petName ?? "Your Star").toUpperCase();
  const shareToken = order.shareToken!; // findUnique の条件そのもの。null ではありえない

  return (
    <Shell>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">Now showing</p>
        <h1 className="mt-4 font-display text-5xl tracking-wide text-gold gold-glow-text sm:text-7xl">
          {petName}
        </h1>

        <div className="film-grain mx-auto mt-10 max-w-3xl overflow-hidden rounded-[var(--radius-card)] border border-gold/40 gold-glow-box">
          <video
            controls
            playsInline
            preload="metadata"
            src={order.finalVideoUrl}
            poster={order.selectedImageUrl ?? undefined}
            className="relative z-0 aspect-video w-full bg-night"
          >
            Your browser can&apos;t play this video —{" "}
            <a href={order.finalVideoUrl} className="text-gold underline">
              open it directly
            </a>
            .
          </video>
        </div>

        {/*
          贈られた人も持ち帰れる。最初はボタンを1つも置かなかったが、それは
          やりすぎだった —— 映画とポスターは受け取った人のものだ。
          渡すのはこの2つだけで、評価・SNS許諾・アドオン購入・カードは出さない。
          あれらは買った人の権限（approveToken）で、shareToken では
          /api/download が 404 を返す。
        */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={`/api/download?token=${shareToken}&kind=film`}
            className="btn-marquee px-6 py-3 text-base"
          >
            Download the film
          </a>
          {order.posterPrintUrl && (
            <a
              href={`/api/download?token=${shareToken}&kind=poster`}
              className="inline-flex items-center rounded-[var(--radius-chip)] border border-gold/50 px-6 py-3 text-base text-gold transition-colors hover:bg-gold/10"
            >
              Download the poster
            </a>
          )}
        </div>

        {order.posterUrl && (
          <section className="mt-16">
            <p className="text-sm uppercase tracking-[0.3em] text-muted">The one-sheet</p>
            <div className="film-grain mx-auto mt-6 max-w-sm overflow-hidden rounded-[var(--radius-card)] border border-gold/40 gold-glow-box sm:max-w-md">
              <MoviePosterOverlay
                src={order.posterUrl}
                petName={order.petName ?? "Your Star"}
                {...posterCopy(order)}
              />
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
