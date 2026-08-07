import { cn } from "@workspace/ui/lib/utils"

import { useReveal } from "@/hooks/use-reveal"

export function Reveal({
  children,
  className,
  delay = 0,
  as: Component = "div",
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  as?: "div" | "section" | "li" | "span"
}) {
  const { ref, visible } = useReveal<HTMLDivElement>()

  return (
    <Component
      ref={ref as never}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        className
      )}
    >
      {children}
    </Component>
  )
}
