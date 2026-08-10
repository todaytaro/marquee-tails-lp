"use server";

import { generateAdAssets, type AdAssets, type AdInput } from "@/lib/ad-studio";

/**
 * 広告スタジオのサーバーアクション。**開発時のみ動く。**
 *
 * 本番で無効にしているのは2つの理由。1つは費用 — 生成のボタンが公開側の
 * URLに存在する状態を作らない。もう1つは時間 — 動画は3分前後かかるので、
 * Vercelのサーバーレス関数の実行時間に収まらない（製品の映像生成を
 * Trigger.dev に逃がしているのと同じ理由）。
 *
 * ローカルなら Node がそのまま動くので時間制限がなく、鍵も .env から読む。
 */
export async function generateAdAction(
  input: AdInput
): Promise<{ ok: true; assets: AdAssets } | { ok: false; error: string }> {
  if (process.env.NODE_ENV !== "development") {
    return { ok: false, error: "この画面はローカル（npm run dev）でのみ使えます。" };
  }
  if (!input.title?.trim()) return { ok: false, error: "名前を入力してください。" };
  if (!input.concept?.trim() && !input.imageUrl) {
    return { ok: false, error: "コンセプトを入力してください。" };
  }
  try {
    const assets = await generateAdAssets({ ...input, title: input.title.trim() });
    return { ok: true, assets };
  } catch (err) {
    console.error("[ad-studio]", err);
    return { ok: false, error: err instanceof Error ? err.message : "生成に失敗しました。" };
  }
}
