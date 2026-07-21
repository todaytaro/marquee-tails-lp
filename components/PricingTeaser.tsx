import Image from "next/image";

type Tier = {
  name: string;
  price: string;
  items: readonly string[];
  flag: string;
};

const tiers: readonly Tier[] = [
  {
    name: "Digital Premiere",
    price: "$75",
    items: [
      "60-second cinematic trailer",
      "Your pet, recognizably them, in six shots",
      "Your choice of the three original worlds",
      "Digital movie poster",
      "HD delivery, 48h after storyboard approval",
    ],
    flag: "",
  },
  {
    name: "Feature Film",
    price: "$129",
    items: [
      "Everything in Digital Premiere",
      "Cinema-quality movie poster, printed and shipped",
      "Formats cut for TikTok, Instagram, and the big screen",
      "The one most people gift",
    ],
    flag: "Most Popular",
  },
  {
    name: "Collector's Edition",
    price: "$199",
    items: [
      "16×20 gallery canvas of the poster",
      "Full 4K delivery",
      "Priority production slot — you skip the queue",
      "Everything in Feature Film",
    ],
    flag: "",
  },
];

export default function PricingTeaser() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24"
    >
      <p className="text-center font-display text-sm uppercase tracking-[0.3em] text-gold">
        Launch pricing preview
      </p>
      <h2
        id="pricing-heading"
        className="mt-3 text-center font-display uppercase tracking-[0.08em] text-ivory text-[clamp(2rem,6vw,3.25rem)] leading-none"
      >
        Three editions. One star.
      </h2>

      <div className="mt-12 grid gap-6 md:grid-cols-3 md:items-start">
        {tiers.map((tier) => {
          const isPopular = tier.flag === "Most Popular";
          const isCollectors = tier.name === "Collector's Edition";
          return (
            <article
              key={tier.name}
              className={`relative overflow-hidden rounded-card border bg-surface p-6 ${
                isPopular ? "border-gold/60 gold-glow-box" : "border-hairline"
              }`}
            >
              {isPopular && (
                <p className="absolute top-0 right-0 rounded-bl-card bg-gold px-3 py-1 font-display text-xs uppercase tracking-[0.2em] text-night">
                  {tier.flag}
                </p>
              )}
              <h3 className="font-display text-xl uppercase tracking-[0.12em] text-ivory">
                {tier.name}
              </h3>
              <p className="mt-2 font-display text-[3rem] leading-none tracking-[0.04em] text-gold">
                {tier.price}
              </p>
              <ul className="mt-5 space-y-2.5 border-t border-hairline pt-5">
                {tier.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-[0.9rem] leading-snug text-muted"
                  >
                    <span aria-hidden="true" className="mt-px text-gold">
                      ★
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {isCollectors && (
                <div className="mt-5 flex items-center gap-3 rounded-chip border border-hairline bg-night/60 p-2.5">
                  <Image
                    src="/assets/poster.png"
                    alt="Painterly movie poster of a heroic corgi in a khaki explorer jacket with leather straps, posed on a rocky summit from a dramatic low angle against golden storm clouds, with the bold title TOP BILLING and a faux credit block at the bottom."
                    width={64}
                    height={96}
                    className="h-24 w-16 rounded-[4px] object-cover"
                  />
                  <p className="text-xs leading-relaxed text-muted">
                    The poster, printed on 16×20 gallery canvas — ready for the
                    lobby wall.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-10 text-center">
        <a
          href="#waitlist"
          className="btn-marquee px-8 py-4 text-base font-semibold"
        >
          Founding Members get 20% off these prices
        </a>
        <p className="mt-3 text-sm text-muted">
          No checkout yet — the waitlist casts our first production slots.
        </p>
      </div>
    </section>
  );
}
