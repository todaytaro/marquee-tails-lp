"use server";

import { generateAdAssets, saveAdAssets, type AdAssets, type AdInput } from "@/lib/ad-studio";

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
): Promise<{ ok: true; assets: AdAssets; savedTo: string } | { ok: false; error: string }> {
  if (process.env.NODE_ENV !== "development") {
    return { ok: false, error: "この画面はローカル（npm run dev）でのみ使えます。" };
  }
  if (!input.title?.trim()) return { ok: false, error: "名前を入力してください。" };
  if (!input.concept?.trim() && !input.imageUrl) {
    return { ok: false, error: "コンセプトを入力してください。" };
  }
  try {
    const assets = await generateAdAssets({ ...input, title: input.title.trim() });
    // 返り値にしか無いURLを、返す前にディスクへ。ブラウザ側で何が起きても
    // 生成物は残る（この関数が落ちたら生成物ごと失うので、ここは握り潰さない）。
    const savedTo = await saveAdAssets(assets, { title: input.title.trim(), concept: input.concept });
    console.log(`[ad-studio] saved -> ${savedTo}`);
    return { ok: true, assets, savedTo };
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

/**
 * 保存先のフォルダを Finder で開く。
 *
 * 「まとめて保存」ボタンにしなかった理由: ブラウザの `download` 属性は
 * **クロスオリジンでは無視される**。生成物は fal のドメインにあるので、
 * リンクを押しても保存されずタブで開くだけ — 顧客の納品ページで同じ罠を
 * 踏んで、同一オリジンのプロキシを作って直したのと全く同じ問題。
 *
 * ここではその必要が無い。生成した時点で saveAdAssets が**すでに全部
 * ディスクに書いている**ので、残る仕事は「そこへ連れて行く」ことだけ。
 * ポスターも静止画も動画もコンセプトも、1クリックで目の前に出る。
 */
export async function revealAdFolderAction(dir: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.NODE_ENV !== "development") {
    return { ok: false, error: "ローカルでのみ使えます。" };
  }
  // 生成物の保存先以外は開かない。パスは画面から往復してくるので、
  // 素通しにすると任意のディレクトリを開かせる入口になる。
  const root = `${process.env.HOME ?? ""}/Downloads/marquee-tails-ads`;
  if (!dir.startsWith(root)) return { ok: false, error: "想定外の場所です。" };
  try {
    const { spawn } = await import("node:child_process");
    spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (err) {
    console.error("[ad-studio:reveal]", err);
    return { ok: false, error: "フォルダを開けませんでした。" };
  }
}
