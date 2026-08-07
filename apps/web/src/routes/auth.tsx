import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { ArrowLeft, Loader2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { Wordmark } from "@/components/brand"
import { ConsentDemo } from "@/components/landing/consent-demo"
import { signIn, signUp } from "@/lib/auth-client"

interface AuthPageProps {
  mode: "signin" | "signup"
}

const COPY = {
  signin: {
    title: "Welcome back",
    subtitle: "Pick up where you left off.",
    action: "Sign in",
    alternate: "New here?",
    alternateLink: "/signup",
    alternateLabel: "Create an account",
  },
  signup: {
    title: "Create your account",
    subtitle: "Nothing is remembered until you approve it.",
    action: "Create account",
    alternate: "Already have an account?",
    alternateLink: "/login",
    alternateLabel: "Sign in",
  },
} as const

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate()
  const copy = COPY[mode]

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const result =
      mode === "signup"
        ? await signUp.email({ email, password, name: name.trim() || email.split("@")[0]! })
        : await signIn.email({ email, password })

    setPending(false)

    if (result.error) {
      setError(result.error.message ?? "Could not sign you in. Check your details.")
      return
    }

    navigate("/app/membot", { replace: true })
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="rounded-lg">
            <Wordmark />
          </Link>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
            <ArrowLeft data-icon="inline-start" className="size-3.5" />
            Back
          </Button>
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="text-muted-foreground mt-2 text-sm">{copy.subtitle}</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="border-destructive/25 bg-destructive/10 text-destructive rounded-xl border px-3 py-2 text-sm"
                >
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={pending}>
                {pending && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
                {copy.action}
              </Button>
            </form>

            <p className="text-muted-foreground mt-6 text-center text-sm">
              {copy.alternate}{" "}
              <Link
                to={copy.alternateLink}
                className="text-foreground font-medium underline underline-offset-4"
              >
                {copy.alternateLabel}
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* The same demo as the landing page — it explains the product better than a testimonial. */}
      <div className="bg-muted/30 relative hidden items-center justify-center overflow-hidden border-l p-12 lg:flex">
        <div
          aria-hidden
          className="bg-primary/12 pointer-events-none absolute top-[-8rem] right-[-8rem] size-[30rem] rounded-full blur-[120px]"
        />
        <div className="relative w-full max-w-md">
          <p className="text-muted-foreground mb-5 text-sm">
            A reminder of what you are signing up for:
          </p>
          <ConsentDemo />
        </div>
      </div>
    </div>
  )
}
