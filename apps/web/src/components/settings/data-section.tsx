import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"

import { api } from "@/lib/api"

const CONFIRM_WORD = "erase"

export function DataSection() {
  const queryClient = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api.stats() })

  const [exporting, setExporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [wiping, setWiping] = useState(false)

  async function exportMemories() {
    setExporting(true)
    try {
      const payload = await api.memories.exportAll()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "memories.json"
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export.")
    } finally {
      setExporting(false)
    }
  }

  async function wipe() {
    setWiping(true)
    try {
      const { deleted } = await api.memories.wipe()
      await queryClient.invalidateQueries()
      setConfirmOpen(false)
      setConfirmText("")
      toast.success(deleted === 0 ? "There was nothing to erase." : `Erased ${deleted} memories.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not erase your memories.")
    } finally {
      setWiping(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="border-border bg-card/40 rounded-2xl border p-6">
        <h2 className="text-sm font-semibold">Your data</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Everything MemBot knows about you, as JSON. It is your data — you should be able to
          take it and leave.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={exporting}
          onClick={() => void exportMemories()}
        >
          {exporting ? (
            <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
          ) : (
            <Download data-icon="inline-start" className="size-3.5" />
          )}
          Export memories
        </Button>
      </section>

      <section className="border-destructive/25 bg-destructive/[0.03] rounded-2xl border p-6">
        <div className="flex items-start gap-3">
          <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Erase everything</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Deletes all {stats?.memories.active ?? 0} memories and the record of what you
              declined. Facts you turned down could be suggested again afterwards. Your
              conversations are kept.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-4"
              onClick={() => setConfirmOpen(true)}
            >
              Erase all memories
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase every memory?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Export first if you want a copy. Type{" "}
              <span className="text-foreground font-mono font-medium">{CONFIRM_WORD}</span> to
              confirm.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={confirmText}
            autoFocus
            placeholder={CONFIRM_WORD}
            onChange={(event) => setConfirmText(event.target.value)}
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText.trim().toLowerCase() !== CONFIRM_WORD || wiping}
              onClick={() => void wipe()}
            >
              {wiping && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
              Erase everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
