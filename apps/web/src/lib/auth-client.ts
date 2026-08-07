import { createAuthClient } from "better-auth/react"

/**
 * Same-origin in development: Vite proxies `/api` to the Worker on :8787, so the browser
 * never sees a cross-origin request and the session cookie needs no special handling.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
})

export const { signIn, signUp, signOut, useSession } = authClient
