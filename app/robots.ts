import type { MetadataRoute } from "next";

/**
 * robots.txt — allow indexing of the public marketing site, but keep the
 * admin surface, API routes, and per-order customer flows (checkout / approval
 * links) out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/approve/", "/premiere/", "/checkout/"],
    },
    sitemap: "https://www.marqueetails.com/sitemap.xml",
    host: "https://www.marqueetails.com",
  };
}
