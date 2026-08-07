import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { Composer } from "@/components/chat/composer"
import { ConversationList } from "@/components/chat/conversation-list"
import { Message } from "@/components/chat/message"
import { Mark } from "@/components/brand"
import { useChatStore } from "@/stores/chat-store"

const SUGGESTIONS = [
  "I always deploy on Fridays — remember that about me.",
  "What do you already know about me?",
  "I'm building a memory system for my side project.",
  "I'm vegetarian, but only mention it if food comes up.",
]

export function MemBotPage() {
  const queryClient = useQueryClient()
  const {
    conversationId,
    messages,
    status,
    error,
    send,
    resolveProposal,
    openConversation,
    startNewConversation,
  } = useChatStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const isStreaming = status === "streaming"

  // Follow the stream. `auto` rather than `smooth` — smooth scrolling fights token-by-token
  // appends and ends up lagging several lines behind the caret.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" })
  }, [messages])

  // A new conversation only exists server-side once the first message is sent, so the
  // sidebar is refreshed on that transition rather than on every render.
  useEffect(() => {
    if (conversationId) queryClient.invalidateQueries({ queryKey: ["conversations"] })
  }, [conversationId, queryClient])

  return (
    <div className="flex h-full">
      <ConversationList
        activeId={conversationId}
        onSelect={(id) => void openConversation(id)}
        onNew={startNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <EmptyState onPick={(text) => void send(text)} />
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    onResolve={(input) => resolveProposal(message.id, input)}
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="border-destructive/25 bg-destructive/10 text-destructive mt-6 flex items-start gap-2.5 rounded-2xl border p-3.5 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="leading-relaxed">{error}</p>
              </div>
            )}
          </div>
        </div>

        <Composer
          disabled={isStreaming}
          onSend={(text, images) => void send(text, images)}
        />
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <Mark className="text-primary size-9" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Tell me something worth keeping.
      </h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-relaxed text-pretty">
        I can suggest things to remember, but I can&rsquo;t save them. You choose what sticks,
        and how far it travels.
      </p>

      <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            className="h-auto justify-start rounded-2xl px-4 py-3 text-left text-sm whitespace-normal"
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  )
}
