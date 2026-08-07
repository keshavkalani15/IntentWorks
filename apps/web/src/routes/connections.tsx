import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Loader2, Plug, ShieldCheck, Unplug } from "lucide-react"
import { toast } from "sonner"

import type { McpConnection } from "@workspace/shared"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { api } from "@/lib/api"
import { relativeTime } from "@/lib/format"

/** What each scope means, in the same words the OAuth consent screen uses. */
const SCOPE_LABEL: Record<string, string> = {
  "memory:read": "Read memories",
  "memory:propose": "Suggest memories",
  offline_access: "Stay connected",
}

export function ConnectionsPage() {
  const { data, isPending } = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.connections.list(),
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Other AI assistants can read your memories and suggest new ones. None of them can
          save anything — that still only happens when you say so.
        </p>

        <Endpoint url={data?.endpoint} />

        <section className="mt-10">
          <h2 className="text-sm font-semibold">Connected</h2>

          {isPending ? (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ) : data && data.items.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {data.items.map((connection) => (
                <li key={connection.clientId}>
                  <ConnectionCard connection={connection} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground border-border/70 mt-4 rounded-2xl border border-dashed px-5 py-8 text-center text-sm">
              Nothing connected yet. Add the address above to Claude, Cursor or any other MCP
              client.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The address people came here for.
 *
 * A copy button rather than selectable text: this string gets pasted into another
 * application's settings field, and a partial selection produces a failure that looks like
 * the server is broken.
 */
function Endpoint({ url }: { url: string | undefined }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy. Select the address and copy it manually.")
    }
  }

  return (
    <section className="border-border bg-card/40 mt-8 rounded-2xl border p-6">
      <div className="flex items-center gap-2">
        <Plug className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">Connect an assistant</h2>
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Paste this address into your assistant's connector settings. It will ask you to sign
        in and show you exactly what it wants before anything is shared.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <code className="border-border/70 bg-background min-w-0 flex-1 truncate rounded-xl border px-3.5 py-2.5 font-mono text-sm">
          {url ?? "…"}
        </code>
        <Button variant="outline" size="sm" onClick={copy} disabled={!url}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          An assistant can only ever ask. Every suggestion opens a page here, in your browser,
          where you choose whether to keep it and how widely it applies.
        </span>
      </p>
    </section>
  )
}

function ConnectionCard({ connection }: { connection: McpConnection }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const revoke = useMutation({
    mutationFn: () => api.connections.revoke(connection.clientId),
    onSuccess: async () => {
      setConfirming(false)
      toast.success(`${label(connection)} disconnected.`)
      await queryClient.invalidateQueries({ queryKey: ["connections"] })
    },
    onError: () => toast.error("Could not disconnect. Try again."),
  })

  // `proposed` counts every ask, including ones the guards answered without involving the
  // user. `saved + declined` is what they actually ruled on, which is the honest denominator
  // for "did I want this?" — so the two are shown separately rather than as one ratio.
  const answered = connection.saved + connection.declined

  return (
    <>
      <article className="border-border bg-card/40 rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Client-chosen at registration, so untrusted text. React escapes it. */}
            <h3 className="truncate text-sm font-semibold">{label(connection)}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {connection.connectedAt
                ? `Connected ${relativeTime(connection.connectedAt)}`
                : "Connected"}
              {connection.lastActiveAt
                ? ` · last suggested ${relativeTime(connection.lastActiveAt)}`
                : " · has not suggested anything yet"}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={revoke.isPending}
          >
            {revoke.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Unplug className="size-3.5" />
            )}
            Disconnect
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {connection.scopes.map((scope) => (
            <Badge key={scope} variant="secondary" className="font-normal">
              {SCOPE_LABEL[scope] ?? scope}
            </Badge>
          ))}
        </div>

        <dl className="border-border/70 mt-4 grid grid-cols-3 gap-4 border-t pt-4">
          <Stat label="Suggested" value={connection.proposed} />
          <Stat label="You kept" value={connection.saved} />
          <Stat label="You declined" value={connection.declined} />
        </dl>

        {connection.pending > 0 ? (
          <p className="mt-4 text-xs font-medium">
            {connection.pending === 1
              ? "1 suggestion is waiting for your answer."
              : `${connection.pending} suggestions are waiting for your answer.`}
          </p>
        ) : answered === 0 && connection.proposed > 0 ? (
          <p className="text-muted-foreground mt-4 text-xs">
            Nothing reached you — everything it suggested was already known, already declined,
            or asked too soon after a previous try.
          </p>
        ) : null}
      </article>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {label(connection)}?</DialogTitle>
            <DialogDescription>
              It loses access immediately and will not be able to read your memories or suggest
              new ones. Anything you already chose to keep stays. You can reconnect it at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
            >
              {revoke.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** Registration-time `client_name`, or the opaque id if the client did not send one. */
function label(connection: McpConnection): string {
  return connection.name?.trim() || connection.clientId
}
