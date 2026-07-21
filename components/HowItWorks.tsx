const steps = [
  {
    scene: "01",
    title: "Send the photos",
    body: "Upload 5–8 photos of your pet — different angles, good light, no studio required. Our team builds a character sheet: the official reference that locks in their face, markings, and that one look they give you.",
  },
  {
    scene: "02",
    title: "Direct your star",
    body: 'You pick their world — Deep Space Explorer, Storybook Kingdom, or Noir Detective — then approve the storyboard shot by shot, choosing your favorite take of every scene. Nothing gets filmed until you say "that’s my pet."',
  },
  {
    scene: "03",
    title: "Premiere in 48 hours",
    body: "Our human directors produce, check, and finish every shot. Two days after you approve the storyboard, your 60-second trailer arrives — with a movie poster worthy of the lobby wall.",
  },
] as const;

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24"
    >
      <h2
        id="how-it-works-heading"
        className="font-display uppercase tracking-[0.08em] text-ivory text-[clamp(2rem,6vw,3.25rem)] leading-none text-center"
      >
        How it works
      </h2>
      <p className="mt-3 text-center text-muted text-[clamp(0.95rem,2.5vw,1.05rem)]">
        Three scenes between the camera roll and the red carpet.
      </p>

      <ol className="relative mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
        {/* connecting line between the scene markers, desktop only */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent md:block"
        />
        {steps.map((step) => (
          <li key={step.scene} className="relative">
            <span className="relative z-10 inline-flex h-14 items-center justify-center rounded-chip border border-hairline bg-surface px-4 font-display text-lg uppercase tracking-[0.25em] text-gold">
              Scene&nbsp;{step.scene}
            </span>
            <h3 className="mt-5 font-display text-[1.6rem] uppercase tracking-[0.06em] leading-none text-ivory">
              {step.title}
            </h3>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-muted">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
