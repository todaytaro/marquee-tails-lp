import Hero from "@/components/Hero";
import ShowcaseFilm from "@/components/ShowcaseFilm";
import HowItWorks from "@/components/HowItWorks";
import Worlds from "@/components/Worlds";
import PricingTeaser from "@/components/PricingTeaser";
import GiftCallout from "@/components/GiftCallout";
import WaitlistForm from "@/components/WaitlistForm";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <main>
        <Hero />
        <ShowcaseFilm />
        <HowItWorks />
        <Worlds />
        <PricingTeaser />
        <GiftCallout />
        <WaitlistForm />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
