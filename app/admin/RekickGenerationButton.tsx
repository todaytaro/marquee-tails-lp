"use client";

import { useState, useTransition } from "react";
import { rekickGenerationAction } from "./actions";

/**
 * 生成中のまま止まった注文（IMAGE_GENERATING / VIDEO_GENERATING）の再キック。
 *
 * 生成タスクがクラッシュで強制終了すると onFailure が走らず、注文は生成中の
 * ステータスのまま取り残される（FAILED にならないので RetryFilmButton では
 * 拾えない）。顧客側も待ち画面のまま進めないため、ここから救う。
 *
 * ステータスは変わらない＝このボタンは押した後も消えないので、押したことが
 * 分かるように結果を出す。
 */
export function RekickGenerationButton({
  orderId,
  stage,
}: {
  orderId: string;
  stage: "stills" | "film";
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label = stage === "stills" ? "絵コンテ生成" : "動画生成";
  const nextStatus = stage === "stills" ? "絵コンテ待ち" : "管理者確認待ち";

  function fire() {
    setError(null);
    startTransition(async () => {
      const result = await rekickGenerationAction(orderId);
      if (result.ok) {
        setDone(true);
        return;
      }
      setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={fire}
        disabled={isPending}
        className="rounded-[var(--radius-chip)] border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-semibold tracking-wider text-gold-bright uppercase transition-colors hover:bg-gold/20 disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? "再キック中…" : `↻ ${label}を再実行`}
      </button>
      {done && (
        <p className="text-[11px] leading-snug text-muted">
          再キックしました。数分後にステータスが「{nextStatus}」に進めば成功です。
          進まない場合は Trigger.dev の Runs でエラーを確認してください。
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
