import type { PendingProposal, ProposeResult } from "@workspace/shared"
import {
  AGENT_TOOLS,
  proposeMemoryArgs,
  searchMemoryArgs,
  toOpenAIFunction,
} from "@workspace/shared"

import type { RequestContext } from "../context"
import { findContext, resolveProject } from "../memory/containers"
import { propose } from "../memory/negotiation"
import { searchMemories } from "../memory/retrieval"
import type { ToolDefinition } from "./openrouter"

/**
 * The agent's entire surface. Deliberately two tools: read, and ask-to-write.
 *
 * There is no `save_memory`, no `forget`, no `set_scope`. Those all exist as REST endpoints
 * but only on the user plane, because an agent that could call them could approve its own
 * proposals and the consent model would be decoration.
 *
 * The contracts themselves live in `@workspace/shared/tools` because the MCP server serves
 * the same two tools to external agents. Derived rather than restated: two hand-maintained
 * copies of a consent-bearing schema would eventually disagree.
 */
export const CHAT_TOOLS: ToolDefinition[] = AGENT_TOOLS.map(toOpenAIFunction)

export type ToolOutcome =
  | { kind: "result"; summary: string; content: string; memoryIds?: string[] }
  /** The loop must stop here. A human is being asked; nothing has been written. */
  | {
      kind: "awaiting_user"
      proposal: PendingProposal
      summary: string
      content: string
    }

export interface ToolInvocationContext {
  conversationId: string
  projectKey?: string
}

export async function runTool(
  ctx: RequestContext,
  name: string,
  rawArgs: string,
  invocation: ToolInvocationContext
): Promise<ToolOutcome> {
  let args: unknown
  try {
    args = JSON.parse(rawArgs || "{}")
  } catch {
    return {
      kind: "result",
      summary: "invalid arguments",
      content: "Tool arguments were not valid JSON.",
    }
  }

  if (name === "search_memory") {
    const parsed = searchMemoryArgs.safeParse(args)
    if (!parsed.success) {
      return {
        kind: "result",
        summary: "invalid arguments",
        content: parsed.error.message,
      }
    }

    const [projectId, contextId] = await Promise.all([
      resolveProject(
        ctx.db,
        ctx.userId,
        parsed.data.projectKey ?? invocation.projectKey,
        { create: false }
      ),
      findContext(ctx.db, ctx.userId, invocation.conversationId),
    ])

    const results = await searchMemories(ctx, {
      query: parsed.data.query,
      projectId,
      contextId,
      categories: parsed.data.categories,
      limit: parsed.data.limit,
    })

    return {
      kind: "result",
      summary: results.length === 1 ? "1 memory" : `${results.length} memories`,
      memoryIds: results.map((memory) => memory.id),
      content:
        results.length === 0
          ? "No stored memories match that, within what is visible here."
          : results
              .map(
                (memory) => `[${memory.id} · ${memory.scope}] ${memory.fact}`
              )
              .join("\n"),
    }
  }

  if (name === "propose_memory") {
    const parsed = proposeMemoryArgs.safeParse(args)
    if (!parsed.success) {
      return {
        kind: "result",
        summary: "invalid arguments",
        content: parsed.error.message,
      }
    }

    const result = await propose(ctx, {
      ...parsed.data,
      conversationId: invocation.conversationId,
      projectKey: parsed.data.projectKey ?? invocation.projectKey,
    })
    if (result.status === "input_required") {
      return {
        kind: "awaiting_user",
        proposal: result,
        summary: "awaiting the user",
        content:
          "The user is being asked to approve this memory and choose its scope.",
      }
    }
    return {
      kind: "result",
      summary: result.status.replace(/_/g, " "),
      content: describe(result),
    }
  }

  return {
    kind: "result",
    summary: "unknown tool",
    content: `No tool named "${name}".`,
  }
}

export function describe(result: ProposeResult): string {
  switch (result.status) {
    case "committed":
      return `Saved as ${result.memory.id} with ${result.memory.scope} scope.`
    case "already_known":
    case "suppressed":
    case "cooldown":
    case "quota_exceeded":
    case "expired":
    case "declined":
    case "cancelled":
      return result.message
    default:
      return "Nothing was saved."
  }
}
