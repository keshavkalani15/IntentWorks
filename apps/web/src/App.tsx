import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router"

import { SessionBoundary } from "@/components/session-boundary"
import { useSession } from "@/lib/auth-client"
import { AppLayout } from "@/routes/app-layout"
import { AuthPage } from "@/routes/auth"
import { ConnectionsPage } from "@/routes/connections"
import { GraphPage } from "@/routes/graph"
import { HomePage } from "@/routes/home"
import { LandingPage } from "@/routes/landing"
import { MemBotPage } from "@/routes/membot"
import { NotFoundPage } from "@/routes/not-found"
import { PricingPage } from "@/routes/pricing"
import { SettingsPage } from "@/routes/settings"

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="border-muted-foreground/25 border-t-primary size-6 animate-spin rounded-full border-2" />
    </div>
  )
}

function RequireAuth() {
  const { data, isPending } = useSession()

  if (isPending) return <Splash />
  if (!data?.user) return <Navigate to="/login" replace />
  return <Outlet />
}

/** Signed-in users landing on `/` or `/login` go straight to the product. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession()

  if (isPending) return <Splash />
  if (data?.user) return <Navigate to="/app/home" replace />
  return children
}

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  // Deliberately not wrapped in `RedirectIfAuthed`: a signed-in user on a lower plan is exactly
  // who needs to read this page.
  { path: "/pricing", element: <PricingPage /> },
  {
    path: "/login",
    element: (
      <RedirectIfAuthed>
        <AuthPage mode="signin" />
      </RedirectIfAuthed>
    ),
  },
  {
    path: "/signup",
    element: (
      <RedirectIfAuthed>
        <AuthPage mode="signup" />
      </RedirectIfAuthed>
    ),
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/app", element: <Navigate to="/app/home" replace /> },
          { path: "/app/home", element: <HomePage /> },
          { path: "/app/membot", element: <MemBotPage /> },
          { path: "/app/graph", element: <GraphPage /> },
          { path: "/app/connections", element: <ConnectionsPage /> },
          { path: "/app/settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
])

export function App() {
  return (
    <SessionBoundary>
      <RouterProvider router={router} />
    </SessionBoundary>
  )
}
