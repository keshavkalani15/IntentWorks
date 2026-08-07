import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"

import { cn } from "@workspace/ui/lib/utils"

import { Wordmark } from "@/components/brand"
import { LinkButton } from "@/components/link-button"

/** Sections of the landing page. Reached by hash on `/`, and by a real navigation elsewhere. */
const SECTIONS = [
  { hash: "#contrast", label: "Why" },
  { hash: "#scopes", label: "Scopes" },
  { hash: "#map", label: "The map" },
  { hash: "#how", label: "How it works" },
  { hash: "#connect", label: "Connect" },
]

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const { pathname } = useLocation()

  const onLanding = pathname === "/"

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled && "border-border/70 bg-background/80 border-b backdrop-blur-xl"
      )}
    >
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          to="/"
          className="focus-visible:ring-ring/30 rounded-lg outline-none focus-visible:ring-3"
        >
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            // Off the landing page these must be full hrefs, or the hash resolves against the
            // current route and the link goes nowhere.
            <a
              key={section.hash}
              href={onLanding ? section.hash : `/${section.hash}`}
              className="text-muted-foreground hover:text-foreground rounded-full px-3 py-1.5 text-sm transition-colors"
            >
              {section.label}
            </a>
          ))}
          <Link
            to="/pricing"
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              pathname === "/pricing"
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Pricing
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <LinkButton to="/login" variant="ghost" size="sm">
            Sign in
          </LinkButton>
          <LinkButton to="/signup" size="sm">
            Get started
          </LinkButton>
        </div>
      </nav>
    </header>
  )
}
