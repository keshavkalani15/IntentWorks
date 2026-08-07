import { useEffect, useRef, useState } from "react"

/**
 * One-shot scroll reveal. Disconnects after firing, so scrolling back up does not replay it —
 * repeated animation on the same element reads as a glitch rather than a flourish.
 */
export function useReveal<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  visible: boolean
} {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, visible }
}
