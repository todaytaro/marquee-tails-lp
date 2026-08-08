/**
 * Permission to show a customer's order on Marquee Tails' own social accounts.
 *
 * WHY THIS EXISTS AS ITS OWN THING: `/terms` §4 grants us a licence to use the
 * uploaded photos "solely for the purpose of producing your film and poster"
 * and states, in those words, "We do not use your photos for any other purpose
 * without your consent." §5 says nothing at all about us showing the finished
 * film publicly. So promotional use is not merely undisclosed — it is closed
 * off by our own terms until the customer opens it, per order.
 *
 * That matters more than it looks: the "before / after" format the marketing
 * plan is built on needs BOTH the customer's own submitted photo and the
 * finished film. It works on camyu only because the owner is also the
 * customer. On a real order it needs this.
 *
 * TWO separate permissions, not one. Handing over a film we generated is a
 * different ask from publishing the photos someone took of their own pet in
 * their own home, and plenty of people will happily say yes to the first and
 * no to the second. Collapsing them into one checkbox would technically be
 * "consent" while quietly taking more than most people think they gave.
 */

export type ShareConsent = {
  /** The finished film + poster may appear on our social accounts. */
  film: boolean;
  /** The customer's own submitted photos may appear alongside it (before/after). */
  photos: boolean;
};

/**
 * Enforces the one invariant this pair has: photos may only be shared as part
 * of showing the film. Photo permission WITHOUT film permission is a state we
 * would never act on — the photos are only ever wanted as the "before" half of
 * a before/after — so storing it would leave a row claiming a permission that
 * means nothing, and a later reader could easily misread it as "we may post
 * this customer's photos".
 *
 * Applied server-side, not just in the UI: the checkbox that enforces this on
 * screen is not a guarantee about what arrives at the endpoint.
 */
export function normalizeShareConsent(input: {
  film?: unknown;
  photos?: unknown;
}): ShareConsent {
  if (typeof input.film !== "boolean" || typeof input.photos !== "boolean") {
    throw new Error("share consent: film and photos must both be booleans");
  }
  return { film: input.film, photos: input.film ? input.photos : false };
}
