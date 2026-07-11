const faqs = [
  {
    q: "How does it work, and what do I actually get?",
    a: "You upload 5–8 photos of your pet. We build a character sheet — the official reference for their face, coat, and markings — and you approve it before anything gets made. Then our studio produces a 60–90 second cinematic trailer: 8 to 12 shots in your chosen world, scored and edited like a real film. Every edition includes a movie poster; the Feature Film and Collector's editions add printed poster and gallery canvas.",
  },
  {
    q: "Will it actually look like my pet?",
    a: "That's the whole product. The character sheet exists so your pet is recognizably themselves in every shot — not a generic breed lookalike. You approve it before production starts, and a human director checks every frame against it before delivery. If it doesn't look like your pet, it doesn't ship.",
  },
  {
    q: "How is this different from free AI filter apps?",
    a: "Filters make an AI dog. We make a film starring yours. An app spits out one image of roughly-your-breed; we produce a directed, edited, human-finished trailer where your specific pet — their exact markings, their exact face — carries 8 to 12 shots of story. One is a novelty. The other goes on the wall.",
  },
  {
    q: "How long does it take?",
    a: "48 hours from the moment you approve the character sheet. We keep it that fast by producing only 5 films per day — real slots, real queue. Collector's Edition and Founding Members get priority production.",
  },
  {
    q: "Is this made with AI?",
    a: "Yes — proudly. Made with AI, directed, checked, and finished by humans. Every shot passes a human quality review before it reaches you. And one hard rule: we never do knock-off franchise styles. Our three worlds — Deep Space Explorer, Storybook Kingdom, Noir Detective — are original, built by us, for your star.",
  },
  {
    q: "Can I give it as a gift?",
    a: "Please do — most of our films are gifts. Birthdays, Gotcha Days, anniversaries of the day they picked their human. You just need 5–8 photos of the pet (borrow them from the camera roll or the group chat), and we handle the rest, including a reveal card that makes the surprise feel like a premiere.",
  },
  {
    q: "When do you launch, and what do Founding Members get?",
    a: "We're in final production rehearsals now, and the waitlist opens the doors — in order. The first 100 sign-ups become Founding Members: 20% off any edition, a free poster upgrade, and a priority production slot at launch. Joining the waitlist is free and commits you to nothing; the perks are simply gone once 100 spots fill.",
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
