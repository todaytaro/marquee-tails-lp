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

/**
 * ブラウザで選んだ画像を fal のストレージに上げて、URLを返す。
 *
 * ブラウザから直接は上げられない（FAL_KEY はサーバー専用で、クライアントに
 * 出した時点で誰でも使える鍵になる）ので、一度ここを経由する。
 *
 * 受け取るのは data URL。**呼ぶ側で長辺2048pxに縮めてから渡すこと** —
 * サーバーアクションの body 上限は既定1MBで、スマホの写真はそのままだと
 * 数MBあって弾かれる。上限を上げると本番のアクションにも同じ緩和が
 * かかるので、ローカル専用の機能のために本番の受け口を広げないほうを選んだ。
 */
export async function uploadAdImageAction(
  dataUrl: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (process.env.NODE_ENV !== "development") {
    return { ok: false, error: "この画面はローカル（npm run dev）でのみ使えます。" };
  }
  try {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) return { ok: false, error: "画像として読めませんでした。" };
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: process.env.FAL_KEY });
    const bytes = Buffer.from(m[2], "base64");
    const ext = m[1] === "image/png" ? "png" : "jpg";
    const url = await fal.storage.upload(
      new File([new Uint8Array(bytes)], `ad-source.${ext}`, { type: m[1] })
    );
    return { ok: true, url };
  } catch (err) {
    console.error("[ad-studio:upload]", err);
    return { ok: false, error: err instanceof Error ? err.message : "アップロードに失敗しました。" };
  }
}
