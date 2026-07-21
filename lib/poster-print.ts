import { readFileSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { fal } from "@fal-ai/client";
import { publicUrl } from "./identity";
import { TITLE_CARDS } from "./film-script";
import { buildBillingBlock } from "@/components/MoviePosterOverlay";

/**
 * Poster PRINT renderer — flattens the exact MoviePosterOverlay design to a PNG
 * (satori → SVG → resvg), so the file that ships to POD is what the customer
 * picked on screen. Runs in Node with font buffers (no Chromium). Kept in lock
 * step with components/MoviePosterOverlay.tsx: same fonts, same proportions
 * (sized off the poster WIDTH to mirror the component's `cqi` units), same
 * scrims, same billing-block treatment (Oswald + scaleY).
 */

const PROJ = process.cwd();
const FONTS = {
  bebas: readFileSync(path.join(PROJ, "public/fonts/BebasNeue-Regular.ttf")),
  inter: readFileSync(path.join(PROJ, "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff")),
  oswald: readFileSync(path.join(PROJ, "node_modules/@fontsource/oswald/files/oswald-latin-400-normal.woff")),
};

/* --- Noto Sans JP: pick only the subset files covering the poster's text ---
   (the full CJK font is 100+ subsets; a name needs 1-2). Parse the fontsource
   700 stylesheet once into [{ranges, file}] and match by codepoint range. */

type NotoSubset = { ranges: [number, number][]; file: string };
let notoCache: NotoSubset[] | null = null;

function notoSubsets(): NotoSubset[] {
  if (notoCache) return notoCache;
  const dir = path.join(PROJ, "node_modules/@fontsource/noto-sans-jp");
  const css = readFileSync(path.join(dir, "700.css"), "utf8");
  const out: NotoSubset[] = [];
  // Each @font-face lists BOTH woff2 and woff (fontsource always ships woff2
  // first) — satori can't decode woff2 (no brotli), so target the .woff url
  // specifically rather than "the first url()" in the src list.
  const faceRe = /@font-face\s*{[^}]*?src:[^}]*?url\(([^)]+?\.woff)\)[^}]*?unicode-range:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = faceRe.exec(css))) {
    const file = path.join(dir, m[1].replace(/^\.\//, "").replace(/['"]/g, ""));
    const ranges: [number, number][] = [];
    for (const tok of m[2].split(",")) {
      const rm = tok.trim().match(/^U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?$/);
      if (!rm) continue;
      const s = parseInt(rm[1], 16);
      ranges.push([s, rm[2] ? parseInt(rm[2], 16) : s]);
    }
    if (ranges.length) out.push({ ranges, file });
  }
  notoCache = out;
  return out;
}

/**
 * satori keeps only ONE font per exact {name, weight, style} — registering
 * several subset files under the identical family name silently drops all
 * but one, so a name needing a glyph from subset #119 could tofu out if a
 * different subset (say #0) happened to "win". Each matched subset therefore
 * gets a UNIQUE family name; callers join `.names` into the fontFamily list
 * so satori's per-glyph fallback can walk through every candidate subset.
 */
function notoFontsFor(text: string): {
  fonts: { name: string; data: Buffer; weight: 700; style: "normal" }[];
  names: string;
} {
  const cps = new Set([...text].map((c) => c.codePointAt(0)!));
  const files = new Set<string>();
  for (const sub of notoSubsets()) {
    if ([...cps].some((cp) => sub.ranges.some(([s, e]) => cp >= s && cp <= e))) files.add(sub.file);
  }
  const fonts = [...files].map((file, i) => ({
    name: `Noto Sans JP Subset ${i}`,
    data: readFileSync(file),
    weight: 700 as const,
    style: "normal" as const,
  }));
  return { fonts, names: fonts.map((f) => f.name).join(", ") };
}

/* ------------------------------------------------------------------ */

async function artDataUri(artUrl: string): Promise<string> {
  const res = await fetch(publicUrl(artUrl));
  if (!res.ok) throw new Error(`poster art fetch failed ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/png";
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${type};base64,${b64}`;
}

type PosterText = {
  petName: string;
  subtitle?: string;
  tagline?: string;
  billing?: string;
  releaseText?: string;
};

/**
 * Render the poster to a print-ready PNG and upload it. Default 1800×2700
 * (2:3, ~150dpi at 12×18in — the standard POD one-sheet).
 */
export async function renderPosterPng(
  artUrl: string,
  t: PosterText,
  opts: { width?: number; uploadName?: string } = {}
): Promise<string> {
  const W = opts.width ?? 1800;
  const H = Math.round((W * 3) / 2);

  const name = t.petName.toUpperCase();
  const tagline = (t.tagline ?? "SOME JOURNEYS TAKE YOU BEYOND THE STARS").toUpperCase();
  const subtitle = t.subtitle?.toUpperCase();
  const billing = (t.billing ?? buildBillingBlock(t.petName)).toUpperCase();
  const release = (t.releaseText ?? TITLE_CARDS.comingSoon).toUpperCase();
  const art = await artDataUri(artUrl);

  const px = (cqi: number) => Math.round((cqi / 100) * W); // mirror component cqi (inline-size = width)
  const shadow = `0 ${px(0.4)}px ${px(1)}px rgba(0,0,0,0.75)`;

  // Resolve exactly which CJK subsets this poster's text needs, once, so both
  // the fontFamily strings below and the satori `fonts` array agree.
  const { fonts: notoFonts, names: notoNames } = notoFontsFor(name + billing);
  const withNoto = (family: string) => (notoNames ? `${family}, ${notoNames}` : family);

  const textLayer = {
    type: "div",
    props: {
      style: {
        position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "space-between",
        paddingLeft: px(7), paddingRight: px(7), paddingTop: px(5.5), paddingBottom: px(5.5), textAlign: "center",
      },
      children: [
        // top tagline
        {
          type: "div", props: {
            style: { display: "flex", fontFamily: "Inter", fontSize: px(2.15), letterSpacing: px(2.15) * 0.34, color: "#f4f1e8d9", textShadow: shadow },
            children: tagline,
          },
        },
        // bottom title block
        {
          type: "div", props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center" },
            children: [
              { type: "div", props: { style: { display: "flex", fontFamily: withNoto("Bebas Neue"), fontWeight: 700, fontSize: px(15), lineHeight: 0.82, color: "#e8b64c", textShadow: shadow }, children: name } },
              ...(subtitle ? [{ type: "div", props: { style: { display: "flex", fontFamily: "Bebas Neue", fontSize: px(4), letterSpacing: px(4) * 0.18, color: "#f4f1e8", marginTop: px(1.5), textShadow: shadow }, children: subtitle } }] : []),
              { type: "div", props: { style: { display: "flex", width: px(46), height: 2, background: "#f4f1e873", marginTop: px(3), marginBottom: px(2.4) } } },
              { type: "div", props: { style: { display: "flex", fontFamily: withNoto("Oswald"), fontSize: px(1.55), letterSpacing: -px(1.55) * 0.02, lineHeight: 1.08, color: "#f4f1e8b8", transform: "scaleY(1.62)", maxWidth: px(86), marginBottom: px(2.4) }, children: billing } },
              { type: "div", props: { style: { display: "flex", fontFamily: "Bebas Neue", fontSize: px(3), letterSpacing: px(3) * 0.42, color: "#f4f1e8", marginTop: px(1.5), textShadow: shadow }, children: release } },
            ],
          },
        },
      ],
    },
  };

  const tree = {
    type: "div",
    props: {
      style: { position: "relative", width: W, height: H, display: "flex", backgroundColor: "#000" },
      children: [
        { type: "div", props: { style: { position: "absolute", top: 0, left: 0, width: W, height: H, backgroundImage: `url(${art})`, backgroundSize: "cover", backgroundPosition: "center" } } },
        { type: "div", props: { style: { position: "absolute", top: 0, left: 0, width: W, height: Math.round(H * 0.28), backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.7), rgba(0,0,0,0))" } } },
        { type: "div", props: { style: { position: "absolute", top: Math.round(H * 0.38), left: 0, width: W, height: Math.round(H * 0.62), backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.8), #000)" } } },
        textLayer,
      ],
    },
  };

  const svg = await satori(tree as never, {
    width: W,
    height: H,
    fonts: [
      { name: "Inter", data: FONTS.inter, weight: 400, style: "normal" },
      { name: "Bebas Neue", data: FONTS.bebas, weight: 400, style: "normal" },
      { name: "Oswald", data: FONTS.oswald, weight: 400, style: "normal" },
      ...notoFonts,
    ],
  });

  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  const file = new File([new Uint8Array(png)], opts.uploadName ?? "poster.png", { type: "image/png" });
  return fal.storage.upload(file);
}
