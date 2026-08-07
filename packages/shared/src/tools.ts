import { z } from "zod"

import { memoryCategorySchema, selectableScopeSchema } from "./scope"

/**
 * The agent's entire tool surface, defined once.
 *
 * Two transports consume this: the built-in chat loop converts it to OpenRouter function
 * definitions, and the MCP server registers it as MCP tools. They must not drift. A tool
 * that means one thing to the in-house agent and something subtly wider to an external one
 * is not a cosmetic inconsistency — it is a hole in the consent model, and it would open
 * silently the first time someone edited one copy.
 *
 * These are the AGENT-facing arguments, deliberately narrower than the domain inputs in
 * memory.ts. `conversationId` in particular is absent: it is resolved server-side from the
 * caller's own identity, because a model that could name a conversation could read another
 * conversation's session-scoped memories.
 */

export const searchMemoryArgs = z.object({
  query: z
    .string()
    .min(1)
    .max(1000)
    .describe("What you want to recall, in natural language."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Maximum number of memories to return."),
  categories: z
    .array(memoryCategorySchema)
    .optional()
    .describe(
      "Restrict results to these kinds of memory. Omit to search all of them."
    ),
  projectKey: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Only when the question is about one named project or workspace."
    ),
})
export type SearchMemoryArgs = z.infer<typeof searchMemoryArgs>

export const proposeMemoryArgs = z.object({
  fact: z
    .string()
    .min(3)
    .max(2000)
    .describe(
      "A short third-person statement, e.g. 'Prefers tabs over spaces'."
    ),
  category: memoryCategorySchema
    .default("fact")
    .describe("What kind of fact this is."),
  suggestedScope: selectableScopeSchema
    .optional()
    .describe(
      "Your recommendation for how widely this should apply. The user decides."
    ),
  projectKey: z
    .string()
    .max(200)
    .optional()
    .describe("Only when the fact belongs to one named project or workspace."),
})
export type ProposeMemoryArgs = z.infer<typeof proposeMemoryArgs>

/**
 * MCP has no protocol-level session, so an external client that wants `session` scope must
 * name its own thread. Absent, `session` is simply not offered — see `negotiation.propose`,
 * which builds the scope options from the containers that actually resolved. Failing closed
 * to project/global is the safe direction, so a client that forgets this loses a scope
 * rather than silently widening one.
 */
export const threadArg = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    "An opaque, stable id for the current conversation, chosen by you and reused for every " +
      "call in that conversation. Required for session-scoped memories; omit it and only " +
      "project and global scope are offered."
  )

/**
 * Behavioural hints, in MCP's `ToolAnnotations` vocabulary. OpenRouter has no equivalent
 * and ignores them.
 *
 * `propose_memory` is annotated `readOnlyHint: false` because it does write — to
 * `negotiations`, never to `memories`. Claiming it read-only would be a lie a client might
 * act on by skipping its own confirmation UI.
 */
export interface AgentToolContract {
  name: string
  title: string
  description: string
  args: z.ZodObject
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export const SEARCH_MEMORY: AgentToolContract = {
  name: "search_memory",
  title: "Search memory",
  description:
    "Search what you already know about this user. Results are automatically limited to " +
    "memories the user has allowed in this context — you cannot widen that.",
  args: searchMemoryArgs,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}

export const PROPOSE_MEMORY: AgentToolContract = {
  name: "propose_memory",
  title: "Propose a memory",
  description:
    "Suggest a fact for the user to save to long-term memory. The user must approve it and " +
    "choose its scope; you cannot save it yourself, and nothing is stored unless they agree. " +
    "Never call this twice for the same fact.",
  args: proposeMemoryArgs,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}

export const AGENT_TOOLS = [SEARCH_MEMORY, PROPOSE_MEMORY] as const

/**
 * Convert a contract to an OpenAI/OpenRouter function-calling definition.
 *
 * `io: "input"` matters: it is what makes a field with a `.default()` optional in the
 * emitted schema, which is the correct description of what the model may send. `$schema` is
 * stripped because OpenRouter forwards `parameters` verbatim to providers, some of which
 * reject unknown top-level keys.
 */
export function toOpenAIFunction(contract: AgentToolContract): {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
} {
  const { $schema: _discard, ...parameters } = z.toJSONSchema(contract.args, {
    target: "draft-7",
    io: "input",
  }) as Record<string, unknown>

  return {
    type: "function",
    function: {
      name: contract.name,
      description: contract.description,
      parameters,
    },
  }
}
