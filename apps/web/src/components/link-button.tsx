import { Link } from "react-router"

import { Button } from "@workspace/ui/components/button"

type ButtonProps = React.ComponentProps<typeof Button>

/**
 * A Button that navigates.
 *
 * Base UI's `render` prop swaps the underlying element, but it must be told the result is
 * no longer a native `<button>` or it applies button-only behaviour to an anchor. Wrapped
 * once here so that detail lives in a single place.
 */
export function LinkButton({
  to,
  children,
  ...props
}: Omit<ButtonProps, "render" | "nativeButton"> & { to: string }) {
  return (
    <Button {...props} nativeButton={false} render={<Link to={to} />}>
      {children}
    </Button>
  )
}

/** Same idea for in-page anchors, which stay plain `<a>` elements. */
export function AnchorButton({
  href,
  children,
  ...props
}: Omit<ButtonProps, "render" | "nativeButton"> & { href: string }) {
  return (
    <Button {...props} nativeButton={false} render={<a href={href} />}>
      {children}
    </Button>
  )
}
