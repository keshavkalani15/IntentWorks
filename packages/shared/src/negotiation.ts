import { z } from "zod"

import { memorySchema } from "./memory"
import { memoryCategorySchema, selectableScopeSchema } from "./scope"

/**
 * The two-phase negotiation is the heart of the product: an agent may only ever
 * reach `input_required`. Only a human-authenticated request can call `resolve`.
 *
 * The shape is deliberately a discriminated union rather than a thrown error or a
 * blocking promise, because MCP's elicitation (SEP-2322 "MRTR") works exactly this way:
 * a tool call returns "input required", the request *terminates*, and the client comes
 * back with the answer as a fresh request. Our chat UI is simply the first client of
 * that engine; the MCP adapter later maps the same union onto `InputRequiredResult`.
 */
export const proposeResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("input_required"),
    negotiationId: z.string(),
    fact: z.string(),
    category: memoryCategorySchema,
    prompt: z.string(),
    options: z.array(selectableScopeSchema),
    /** A near-duplicate we already hold, if any. Offering a merge instead of a second copy. */
    nearDuplicate: z.object({ id: z.string(), fact: z.string() }).nullable(),
    expiresAt: z.number(),
  }),
  z.object({ status: z.literal("committed"), memory: memorySchema }),
  z.object({ status: z.literal("already_known"), memory: memorySchema, message: z.string() }),
  z.object({ status: z.literal("suppressed"), message: z.string() }),
  z.object({ status: z.literal("cooldown"), message: z.string(), until: z.number() }),
  z.object({ status: z.literal("quota_exceeded"), message: z.string() }),
  z.object({ status: z.literal("expired"), message: z.string() }),
  z.object({ status: z.literal("declined"), message: z.string() }),
  z.object({ status: z.literal("cancelled"), message: z.string() }),
])
export type ProposeResult = z.infer<typeof proposeResultSchema>
export type PendingProposal = Extract<ProposeResult, { status: "input_required" }>

/**
 * `accept` commits at the chosen scope.
 * `decline` tombstones the fact so it is never proposed again.
 * `cancel` is a dismissal — nothing is written, but a cooldown stops the model
 *          immediately re-asking. Prose in a tool result will not stop it; this will.
 */
export const resolveNegotiationInput = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    scope: selectableScopeSchema.optional(),
    replacesExisting: z.boolean().optional(),
  })
  .refine((v) => v.action !== "accept" || v.scope !== undefined, {
    message: "A scope is required when accepting a proposal.",
    path: ["scope"],
  })
export type ResolveNegotiationInput = z.infer<typeof resolveNegotiationInput>

export const pendingNegotiationSchema = z.object({
  id: z.string(),
  fact: z.string(),
  category: memoryCategorySchema,
  options: z.array(selectableScopeSchema),
  originClient: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
})
export type PendingNegotiation = z.infer<typeof pendingNegotiationSchema>
