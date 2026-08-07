import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageSquarePlus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { api } from "@/lib/api"
import { relativeTime } from "@/lib/format"

interface ConversationListProps {
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationList({ activeId, onSelect, onNew }: ConversationListProps) {
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.conversations.list(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.conversations.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete that conversation."),
  })

  return (
    <aside className="border-border/70 hidden w-64 shrink-0 flex-col border-r lg:flex">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <MessageSquarePlus data-icon="inline-start" className="size-4" />
          New conversation
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isPending ? (
          <div className="space-y-2 px-1">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs leading-relaxed">
            Could not load your conversations.
          </p>
        ) : data?.items.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs leading-relaxed">
            No conversations yet. Each one is its own memory boundary.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {data?.items.map((conversation) => (
              <li key={conversation.id} className="group/item relative">
                <button
                  onClick={() => onSelect(conversation.id)}
                  className={cn(
                    "w-full truncate rounded-lg px-3 py-2 pr-8 text-left text-sm transition-colors",
                    conversation.id === activeId
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <span className="block truncate">{conversation.title ?? "New conversation"}</span>
                  <span className="text-muted-foreground block truncate text-[0.7rem]">
                    {relativeTime(conversation.updatedAt)}
                  </span>
                </button>

                <button
                  aria-label="Delete conversation"
                  onClick={() => remove.mutate(conversation.id)}
                  className="text-muted-foreground hover:text-destructive absolute top-2 right-1.5 rounded p-1 opacity-0 transition-opacity group-hover/item:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
