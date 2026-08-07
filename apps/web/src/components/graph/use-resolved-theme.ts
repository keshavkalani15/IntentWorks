import { useEffect, useState } from "react"

import { useTheme } from "@workspace/ui/components/theme-provider"

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

/**
 * Whether dark colours apply right now.
 *
 * `useTheme` reports the *setting*, which on "system" is not an answer. The canvas needs a
 * literal colour rather than a CSS variable — WebGL cannot resolve `var(--…)` — so it has to
 * resolve "system" itself, and subscribe, or a mid-session OS switch leaves the scene painted
 * for the old mode until something else happens to re-render it.
 */
export function useResolvedDark(): boolean {
  const { theme } = useTheme()
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(COLOR_SCHEME_QUERY).matches
  )

  useEffect(() => {
    const query = window.matchMedia(COLOR_SCHEME_QUERY)
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return theme === "dark" || (theme === "system" && systemDark)
}
