"use client";

import { useState, useTransition } from "react";
import { rekickGenerationAction } from "./actions";

/**
 * 生成中のまま止まった注文（IMAGE_GENERATING / VIDEO_GENERATING /
 * TREATMENT_GENERATING）の再キック。
 *
 * stills/film: 生成タスクがクラッシュで強制終了すると onFailure が走らず、
 * 注文は生成中のステータスのまま取り残される（FAILED にならないので
 * RetryFilmButton では拾えない）。顧客側も待ち画面のまま進めないため、
 * ここから救う。
 *
 * treatment: 別の原因（submit-photos がインラインで呼ぶ generateTreatment
 * が、compensating revert の前に関数ごと強制終了された場合）で同じ症状に
 * なる、Director's Cut Gate 0 専用のケース。既に treatmentText がある注文
 * （revise-treatment の再生成中）ではサーバー側が拒否する — 詳細は
 * app/admin/actions.ts#rekickGenerationAction 参照。
 *
 * ステータスは変わらないとは限らない（treatment は成功時に
 * AWAITING_TREATMENT_APPROVAL へ進む）が、このボタンは押した後も消えないので、
 * 押したことが分かるように結果を出す。
 */
export function RekickGenerationButton({
  orderId,
  stage,
}: {
  orderId: string;
  stage: "stills" | "film" | "treatment";
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label =
    stage === "stills" ? "絵コンテ生成" : stage === "film" ? "動画生成" : "トリートメント生成";
  const nextStatus =
    stage === "stills" ? "絵コンテ待ち" : stage === "film" ? "管理者確認待ち" : "トリートメント承認待ち";

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
