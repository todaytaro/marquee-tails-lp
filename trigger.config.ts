import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, additionalFiles } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

// Trigger.dev v4 offload for the heavy film/poster/rerender pipelines (see
// FILM-ASYNC-SPEC.md). Vercel stays Hobby / low-load; the actual generation
// (ffmpeg composition, Kling polling, nano-banana renders) runs here instead,
// with no platform time limit.
export default defineConfig({
  project: "proj_hvrskkcikwxjqqvsoqvl",
  dirs: ["./trigger"],
  maxDuration: 1800, // default for any task that doesn't set its own; individual tasks override up (train-pet-lora, see LORA-STORYBOARD-SPEC.md §2.7) or down (poster) as needed
  build: {
    extensions: [
      ffmpeg(), // injects FFMPEG_PATH / FFPROBE_PATH
      additionalFiles({
        files: [
          "public/fonts/**", // ffmpeg drawtext fonts (film-pipeline title cards)
          // 締めのブランドカードに重ねる MT ロゴ（film-pipeline の BRAND_LOGO）。
          // fonts / sfx と同じで、ここに書かないとタスクからは見えない。ロゴを
          // 足したときにこの行を忘れ、べっぷ君のDCが文字だけのカードで納品された
          // （2026-08-16）。**public/ 配下をコードから読むときは必ずここに追記する。**
          "public/brand/**",
          // Trailer SFX bed (boom/riser/whoosh) mixed by ffmpeg in the film
          // assembly. Without these here the task can't see them and every
          // order silently falls back to the music-only mix.
          "public/sfx/**",
          // Safety net for the custom Prisma client output (see prismaExtension
          // note below): make sure the generated client ships even if the
          // build snapshot is taken before `prisma generate` (postinstall) has
          // run in Trigger.dev's build environment.
          "generated/prisma/**",
        ],
      }),
      // This repo uses Prisma 7's new `prisma-client` generator (TS client,
      // custom output "../generated/prisma") + a driver adapter (@prisma/adapter-pg,
      // lib/db.ts). Per Trigger.dev v4 docs (config/extensions/prismaExtension),
      // that combination is exactly what "modern" mode targets: "You're using
      // Prisma 6.16+ with the new `prisma-client` provider ... or preparing for
      // Prisma 7" / "Requires database adapters (e.g., @prisma/adapter-pg)".
      // Modern mode is "zero configuration" and, like engine-only mode, expects
      // the caller to manage client generation itself — this repo already does
      // that via `"postinstall": "prisma generate"` in package.json, so no
      // `schema`/`version` overrides are needed here.
      prismaExtension({ mode: "modern" }),
    ],
  },
});
