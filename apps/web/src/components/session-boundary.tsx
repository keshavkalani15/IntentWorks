import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useSession } from "@/lib/auth-client"
import { useChatStore } from "@/stores/chat-store"

/**
 * Throws away all client-held state when the signed-in user changes.
 *
 * Every query key in this app is global — `["graph"]`, `["stats"]`, `["memories"]` — and the
 * React Query cache lives for the lifetime of the tab. Without this, signing out and back in
 * as somebody else serves the previous user's data straight from memory: their memories,
 * their graph, their conversations. The API is correctly scoped; the cache was not.
 *
 * Done here rather than by prefixing twelve query keys with a user id, because that only
 * works for as long as everyone remembers to do it. This holds even for a key added later.
 * It also covers the cases a sign-out handler misses — an expired session, a revoked
 * session, or another tab signing out.
 */
export function SessionBoundary({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession()
  const queryClient = useQueryClient()

  // `undefined` means "nothing observed yet", which is distinct from `null` for signed out.
  const previousUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    // Ignore the pending phase, or the first resolve would look like a change and cancel
    // every query that had just started.
    if (isPending) return

    const userId = data?.user?.id ?? null
    const previous = previousUserId.current
    previousUserId.current = userId

    if (previous === undefined || previous === userId) return

    queryClient.clear()
    useChatStore.getState().startNewConversation()
  }, [data?.user?.id, isPending, queryClient])

  return children
}
