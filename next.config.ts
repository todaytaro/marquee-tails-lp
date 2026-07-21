import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a platform binary and resolves its path from __dirname.
  // Next's server bundling rewrites that path (to a bogus /ROOT/...), so spawn
  // fails with ENOENT when the film pipeline runs inside the server runtime.
  // Marking it external keeps it in node_modules and the path correct.
  //
  // @resvg/resvg-js is the same shape of problem: it lazy-loads a
  // platform-specific native binding package (@resvg/resvg-js-darwin-arm64
  // etc.) that Turbopack can't resolve into a module during bundling — the
  // poster print renderer (lib/poster-print.ts) then 500s on every Gate 2
  // approval. External keeps it a plain Node require at runtime.
  serverExternalPackages: ["ffmpeg-static", "@resvg/resvg-js"],
};

export default nextConfig;
