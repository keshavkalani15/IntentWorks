import { Closing, LandingFooter } from "@/components/landing/closing"
import { Contrast } from "@/components/landing/contrast"
import { Hero } from "@/components/landing/hero"
import { HowItWorks } from "@/components/landing/how-it-works"
import { MemoryMap } from "@/components/landing/memory-map"
import { LandingNav } from "@/components/landing/nav"
import { Portable } from "@/components/landing/portable"
import { Scopes } from "@/components/landing/scopes"

export function LandingPage() {
  return (
    <div className="min-h-svh scroll-smooth bg-background">
      <LandingNav />
      <main>
        <Hero />
        <Contrast />
        <Scopes />
        {/* After Scopes, which argues the boundary is real, and before HowItWorks: this section's
            job is that the boundary is legible at scale, not to re-teach what a scope is. */}
        <MemoryMap />
        <HowItWorks />
        {/* After the three steps, not before: the loop has to be understood before "and it
            holds for every other assistant too" means anything. */}
        <Portable />
        <Closing />
      </main>
      <LandingFooter />
    </div>
  )
}
