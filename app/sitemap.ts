import type { MetadataRoute } from "next";

const BASE = "https://www.marqueetails.com";

/**
 * sitemap.xml — the public, indexable pages. Admin, API, checkout and per-order
 * approval routes are intentionally excluded (see robots.ts).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/refund`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/tokushoho`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
