import type {
  ConnectionsResponse,
  Conversation,
  Memory,
  MemoryScope,
  MemoryStatus,
  PendingNegotiation,
  ProposeResult,
  ResolveNegotiationInput,
  MemoryGraph,
  RelatedGraph,
  Stats,
  StoredMessage,
  TimelineEntry,
} from "@workspace/shared"

export class ApiRequestError extends Error {
  // Declared explicitly rather than as constructor parameter properties: the app is built
  // with `erasableSyntaxOnly`, so only type-level syntax may be stripped.
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    // An expired session would otherwise surface as a confusing error on whatever the user
    // happened to click. Bounce to sign-in instead, once.
    if (
      response.status === 401 &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.assign("/login")
    }

    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string }
    } | null
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? `Request failed with ${response.status}.`
    )
  }

  return response.json() as Promise<T>
}

export const api = {
  stats: () => request<Stats>("/api/stats"),

  graph: () => request<MemoryGraph>("/api/graph"),

  /** Inferred similarity edges. Fetched separately so the graph itself never waits on Vectorize. */
  graphRelated: () => request<RelatedGraph>("/api/graph/related"),

  /** `base64` may be a data URI — the server strips the prefix before calling OpenRouter. */
  transcribe: (input: { base64: string; format: string }) =>
    request<{ text: string }>("/api/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio: input.base64, format: input.format }),
    }),

  memories: {
    list: (params: {
      scope?: MemoryScope
      status?: MemoryStatus
      q?: string
      limit?: number
      offset?: number
    }) => {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") query.set(key, String(value))
      }
      return request<{ items: Memory[]; counts: Record<string, number> }>(
        `/api/memories?${query.toString()}`
      )
    },
    timeline: (id: string) =>
      request<{ memory: Memory; events: TimelineEntry[] }>(
        `/api/memories/${id}/timeline`
      ),
    rescope: (id: string, scope: Exclude<MemoryScope, "suppressed">) =>
      request<{ memory: Memory }>(`/api/memories/${id}/scope`, {
        method: "PATCH",
        body: JSON.stringify({ scope }),
      }),
    suppress: (id: string) =>
      request<{ ok: true }>(`/api/memories/${id}/suppress`, { method: "POST" }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/memories/${id}`, { method: "DELETE" }),
    bulk: (body: {
      ids: string[]
      action: "rescope" | "suppress" | "delete"
      scope?: string
    }) =>
      request<{ ok: true; changed: number }>("/api/memories/bulk", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    exportAll: () =>
      request<{ memories: Memory[] }>("/api/memories/export/all"),
    wipe: () =>
      request<{ ok: true; deleted: number }>("/api/memories", {
        method: "DELETE",
      }),
  },

  /** MCP clients holding a grant on this account. */
  connections: {
    list: () => request<ConnectionsResponse>("/api/connections"),
    revoke: (clientId: string) =>
      request<{ ok: true }>(`/api/connections/${encodeURIComponent(clientId)}`, {
        method: "DELETE",
      }),
  },

  negotiations: {
    pending: () =>
      request<{ items: PendingNegotiation[] }>("/api/negotiations"),
    resolve: (id: string, body: ResolveNegotiationInput) =>
      request<{ result: ProposeResult }>(`/api/negotiations/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  conversations: {
    list: () => request<{ items: Conversation[] }>("/api/conversations"),
    create: () =>
      request<{ id: string }>("/api/conversations", { method: "POST" }),
    messages: (id: string) =>
      request<{ items: StoredMessage[] }>(`/api/conversations/${id}/messages`),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" }),
  },
}
