// Photo count (7-12) mirrors MIN_PHOTOS/MAX_PHOTOS in
// components/PhotoUploadForm.tsx, the source of truth — not re-exported here
// since these are plain copy strings, not shared logic.
const faqs = [
  {
    q: "How does it work, and what do I actually get?",
    a: "You upload 7–12 photos of your pet. We train a model of your pet from them, then build a full storyboard, and you approve it shot by shot before anything gets filmed. Our studio produces a 60-second cinematic trailer: six shots in your chosen world, scored and edited like a real film. Every plan includes a digital movie poster, free. Printed poster and gallery canvas are available as add-ons once your film is delivered.",
  },
  {
    q: "Will it actually look like my pet?",
    a: "That's the whole product. We train a model of your pet before drawing anything, so they're recognizably themselves in every shot — not a generic breed lookalike. You approve it before production starts, and a human director checks every frame against it before delivery. If it doesn't look like your pet, it doesn't ship.",
  },
  {
    q: "How is this different from free AI filter apps?",
    a: "Filters make an AI dog. We make a film starring yours. An app spits out one image of roughly-your-breed; we produce a directed, edited, human-finished trailer where your specific pet — their exact markings, their exact face — carries six shots of story. One is a novelty. The other goes on the wall.",
  },
  {
    q: "How long does it take?",
    a: "Getting to your storyboard takes up to one business day — we train a model of your pet, shoot eighteen takes, and a director reviews every one before you see anything. Once you approve it, your film premieres 48 hours later. We keep that turnaround fast by producing only 5 films per day — real slots, reserved on a first-come basis.",
  },
  {
    q: "Is this made with AI?",
    a: "Yes — proudly. Made with AI, directed, checked, and finished by humans. Every shot passes a human quality review before it reaches you. And one hard rule: we never do knock-off franchise styles. Our three worlds — Deep Space Explorer, Storybook Kingdom, Noir Detective — are original, built by us, for your star.",
  },
  {
    q: "Can I give it as a gift?",
    a: "Please do — most of our films are gifts. Birthdays, Gotcha Days, anniversaries of the day they picked their human. You just need 7–12 photos of the pet (borrow them from the camera roll or the group chat), and we handle the rest, including a reveal card that makes the surprise feel like a premiere.",
  },
  {
    q: "Can I order right now?",
    a: "Yes — Preset Worlds orders are open today. Pick a plan, upload your photos, and approve your storyboard; we produce just 5 films a day, so the earlier you order, the sooner your slot is locked in.",
  },
] as const;

export default function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-24"
    >
      <h2
        id="faq-heading"
        className="text-center font-display uppercase tracking-[0.08em] text-ivory text-[clamp(2rem,6vw,3.25rem)] leading-none"
      >
        Questions from the lobby
      </h2>

      {/* FAQPage structured data — built from the same `faqs` array so the
          markup and the rich-result data can never drift apart. Eligible for
          Google's FAQ rich results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }),
        }}
      />

      <div className="mt-10 divide-y divide-[rgba(232,182,76,0.15)] rounded-card border border-hairline bg-surface">
        {faqs.map((faq) => (
          <details key={faq.q} className="group px-5 sm:px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium text-ivory [&::-webkit-details-marker]:hidden">
              <span className="text-[0.95rem] leading-snug sm:text-base">
                {faq.q}
              </span>
              <span
                aria-hidden="true"
                className="shrink-0 font-display text-2xl leading-none text-gold"
              >
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">&minus;</span>
              </span>
            </summary>
            <p className="pb-6 text-[0.95rem] leading-relaxed text-muted">
              {faq.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
