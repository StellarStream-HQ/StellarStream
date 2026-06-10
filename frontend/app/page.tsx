import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { FeatureBentoSection } from "@/components/landing/feature-bento-section";
import { HeroSection } from "@/components/landing/hero-section";
import { MoneyInMotionSection } from "@/components/landing/money-in-motion-section";
import { NeonTickerSection } from "@/components/landing/neon-ticker-section";

/**
 * Landing Page / Home
 *
 * Public landing page showcasing StellarStream's key features.
 * Features hero section, value propositions, and call-to-action.
 */
export default function Home() {
  return (
    <>
      <Nav />
      <main className="w-full">
        <HeroSection />
        <MoneyInMotionSection />
        <FeatureBentoSection />
        <NeonTickerSection />
      </main>
      <Footer />
    </>
  );
}
