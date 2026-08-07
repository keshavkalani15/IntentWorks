import { LandingFooter } from "@/components/landing/closing"
import { LandingNav } from "@/components/landing/nav"
import { PricingFaq, PricingHero, PricingTable } from "@/components/landing/pricing"

export function PricingPage() {
  return (
    <div className="bg-background min-h-svh scroll-smooth">
      <LandingNav />
      <main>
        <PricingHero />
        <PricingTable />
        <PricingFaq />
      </main>
      <LandingFooter />
    </div>
  )
}
