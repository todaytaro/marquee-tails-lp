import Image from "next/image";

type World = {
  key: string;
  name: string;
  logline: string;
  image: string;
  alt: string;
};

const WORLDS: World[] = [
  {
    key: "deepspace",
    name: "Deep Space Explorer",
    logline:
      "One small crew, one vast galaxy — and a captain who never left your side.",
    image: "/assets/world-deepspace.png",
    alt: "A golden retriever in a gold astronaut suit stands on a starship bridge, looking out a large viewport at a purple-and-orange nebula, with crew members at glowing consoles behind; letterboxed title reads STAR PAWS: ODYSSEY.",
  },
  {
    key: "storybook",
    name: "Storybook Kingdom",
    logline:
      "An enchanted realm in peril calls for its bravest knight. The knight is napping on your couch.",
    image: "/assets/world-storybook.png",
    alt: "A regal ginger cat in tiny crimson-and-gold royal robes and a jeweled crown stands on a mossy stone castle balcony, overlooking a painterly fairytale kingdom of hills, a winding river, and villages at golden hour.",
  },
  {
    key: "noir",
    name: "Noir Detective",
    logline:
      "Rain-slick streets. A case nobody could crack. A detective who works for belly rubs.",
    image: "/assets/world-noir.png",
    alt: "A dachshund in a tiny belted trench coat and fedora stands in a rain-slicked 1940s cobblestone alley in dramatic black and white, lit by a single warm golden streetlamp cutting through the mist.",
  },
];

export default function Worlds() {
  return (
    <section
      id="worlds"
      aria-labelledby="worlds-title"
      className="scroll-mt-6 bg-night px-5 py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl">
        {/* Film-strip sprocket-hole divider */}
        <div
          aria-hidden="true"
          className="film-strip mx-auto mb-10 max-w-64 sm:mb-14"
        />

        <h2
          id="worlds-title"
          className="font-display text-center text-[clamp(2rem,6vw,3.25rem)] leading-none tracking-[0.06em] text-ivory uppercase"
        >
          The three worlds
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-base leading-relaxed text-muted">
          We never do knock-off franchise styles — only original worlds.
        </p>

        <ul className="mt-10 grid list-none grid-cols-1 gap-8 sm:mt-14 md:grid-cols-3 md:gap-6 lg:gap-8">
          {WORLDS.map((world) => (
            <li key={world.key}>
              <article className="group">
                <div className="relative aspect-video overflow-hidden rounded-card border border-hairline bg-surface">
                  <Image
                    src={world.image}
                    alt={world.alt}
                    fill
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <h3 className="font-display mt-5 text-2xl tracking-[0.08em] text-gold-bright uppercase sm:text-3xl">
                  {world.name}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-pretty text-muted">
                  {world.logline}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
