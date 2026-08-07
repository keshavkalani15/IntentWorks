import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { api } from "@/lib/api"
import { authClient, useSession } from "@/lib/auth-client"
import { formatDate, initialsOf } from "@/lib/format"

export function ProfileSection() {
  const { data: session, refetch } = useSession()
  const queryClient = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api.stats() })

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  const user = session?.user
  if (!user) return null

  async function saveName() {
    const next = name.trim()
    if (!next || next === user!.name) {
      setEditing(false)
      return
    }

    setSaving(true)
    const result = await authClient.updateUser({ name: next })
    setSaving(false)

    if (result.error) {
      toast.error(result.error.message ?? "Could not update your name.")
      return
    }

    await refetch()
    queryClient.invalidateQueries({ queryKey: ["stats"] })
    setEditing(false)
    toast.success("Name updated.")
  }

  return (
    <section className="border-border bg-card/40 rounded-2xl border p-6">
      <div className="flex items-start gap-4">
        <Avatar className="size-14 shrink-0">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="text-base">
            {initialsOf(user.name || user.email)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  autoFocus
                  value={name}
                  disabled={saving}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveName()
                    if (event.key === "Escape") setEditing(false)
                  }}
                />
                <Button size="icon" disabled={saving} onClick={() => void saveName()} aria-label="Save">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                  aria-label="Cancel"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-semibold">{user.name}</p>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Edit name"
                  onClick={() => {
                    setName(user.name)
                    setEditing(true)
                  }}
                >
                  <Pencil className="size-3" />
                </Button>
              </div>
              <p className="text-muted-foreground truncate text-sm">{user.email}</p>
            </>
          )}
        </div>
      </div>

      <dl className="border-border/70 mt-6 grid gap-x-6 gap-y-4 border-t pt-6 sm:grid-cols-3">
        <Field label="Member since" value={formatDate(new Date(user.createdAt).getTime())} />
        <Field
          label="First memory"
          value={stats?.memories.firstAt ? formatDate(stats.memories.firstAt) : "None yet"}
        />
        <Field
          label="Email verified"
          value={user.emailVerified ? "Yes" : "Not required in development"}
        />
        <Field label="Memories" value={stats ? String(stats.memories.active) : "—"} />
        <Field label="Conversations" value={stats ? String(stats.conversations) : "—"} />
        <Field
          label="Suggestions answered"
          value={stats ? String(stats.proposals.accepted + stats.proposals.declined) : "—"}
        />
      </dl>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  )
}
