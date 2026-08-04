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
 * では、サーバーが一度拒否して確認を求める（顧客が読んでいる最中かもしれない
 * ので、既定は上書きしない側に倒す）。中身が壊れていて作り直したい場合は、
 * 出てきた確認ボタンをもう一度押す — 詳細は
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
  // Set when the server refused because a treatment already exists. Turns the
  // dead end into a second, deliberate click rather than hiding the option.
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label =
    stage === "stills" ? "絵コンテ生成" : stage === "film" ? "動画生成" : "トリートメント生成";
  const nextStatus =
    stage === "stills" ? "絵コンテ待ち" : stage === "film" ? "管理者確認待ち" : "トリートメント承認待ち";

  function fire(overwriteExisting = false) {
    setError(null);
    startTransition(async () => {
      const result = await rekickGenerationAction(orderId, overwriteExisting);
      if (result.ok) {
        setDone(true);
        setConfirmOverwrite(false);
        return;
      }
      setError(result.error);
      // Only a refusal the operator is allowed to override surfaces a second
      // button; every other failure stays a plain error.
      setConfirmOverwrite(result.needsOverwriteConfirm === true);
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => fire()}
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
      {confirmOverwrite && (
        <button
          type="button"
          onClick={() => fire(true)}
          disabled={isPending}
          className="rounded-[var(--radius-chip)] border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold tracking-wider text-red-400 uppercase transition-colors hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-60"
        >
          {isPending ? "作り直し中…" : "⚠ 既存のトリートメントを破棄して作り直す"}
        </button>
      )}
    </div>
  );
}
